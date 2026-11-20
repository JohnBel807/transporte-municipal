"""Cuentas de pasajero: celular colombiano + PIN de 4 digitos.

Los tokens, el refresh y /auth/logout reutilizan el sistema existente
(app.routers.auth_routes), porque la tabla refresh_tokens ya acepta cualquier rol.
"""
import re
import uuid
from typing import Optional

import asyncpg
from asyncpg import Pool
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.core.database import get_pool
from app.core.dependencies import get_current_user
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.auth import TokenResponse

router = APIRouter(prefix="/auth/passenger", tags=["auth-pasajero"])

MAX_FAILED_PIN = 5
LOCK_MINUTES = 15
WEAK_PINS = {"0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777",
             "8888", "9999", "1234", "4321", "1212", "0123"}


def normalize_phone(raw: str) -> str:
    """Devuelve +57 y 10 digitos. Los celulares colombianos empiezan por 3."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("57"):
        digits = digits[2:]
    if len(digits) != 10 or not digits.startswith("3"):
        raise ValueError("Ingresa un celular colombiano de 10 digitos")
    return "+57" + digits


class PassengerRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=60)
    phone: str
    pin: str = Field(pattern=r"^\d{4}$")

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("pin")
    @classmethod
    def _pin(cls, v: str) -> str:
        if v in WEAK_PINS:
            raise ValueError("Elige un PIN menos predecible")
        return v


class PassengerLogin(BaseModel):
    phone: str
    pin: str = Field(pattern=r"^\d{4}$")

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


async def _issue_tokens(conn: asyncpg.Connection, user_id, role: str) -> TokenResponse:
    access = create_access_token(str(user_id), role)
    refresh = generate_refresh_token()
    await conn.execute(
        """INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')""",
        str(user_id), hash_refresh_token(refresh), str(uuid.uuid4()),
    )
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_expire_min * 60,
        role=role,
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register_passenger(body: PassengerRegister, pool: Pool = Depends(get_pool)) -> TokenResponse:
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                user = await conn.fetchrow(
                    """INSERT INTO users (email, phone, password_hash, full_name, role)
                       VALUES (NULL, $1, $2, $3, 'pasajero')
                       RETURNING id""",
                    body.phone, hash_password(body.pin), body.full_name.strip(),
                )
            except asyncpg.UniqueViolationError:
                raise HTTPException(
                    status_code=409,
                    detail="Este celular ya tiene cuenta. Ingresa con tu PIN.",
                )
            await conn.execute("INSERT INTO passengers (user_id) VALUES ($1)", user["id"])
            return await _issue_tokens(conn, user["id"], "pasajero")


@router.post("/login", response_model=TokenResponse)
async def login_passenger(body: PassengerLogin, pool: Pool = Depends(get_pool)) -> TokenResponse:
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            """SELECT id, password_hash, is_active, pin_locked_until
               FROM users WHERE phone = $1 AND role = 'pasajero'""",
            body.phone,
        )
        if not user or not user["password_hash"]:
            raise HTTPException(status_code=401, detail="Celular o PIN incorrectos")
        if not user["is_active"]:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")

        from datetime import datetime, timezone
        if user["pin_locked_until"] and user["pin_locked_until"] > datetime.now(timezone.utc):
            raise HTTPException(
                status_code=429,
                detail="Demasiados intentos. Intenta de nuevo en unos minutos.",
            )

        if not verify_password(body.pin, user["password_hash"]):
            # Se guarda fuera de una transaccion que se revertiria por el raise.
            await conn.execute(
                """UPDATE users SET
                       failed_pin_attempts = CASE WHEN failed_pin_attempts + 1 >= $2
                                                  THEN 0 ELSE failed_pin_attempts + 1 END,
                       pin_locked_until = CASE WHEN failed_pin_attempts + 1 >= $2
                                               THEN NOW() + make_interval(mins => $3)
                                               ELSE pin_locked_until END
                   WHERE id = $1""",
                user["id"], MAX_FAILED_PIN, LOCK_MINUTES,
            )
            raise HTTPException(status_code=401, detail="Celular o PIN incorrectos")

        await conn.execute(
            "UPDATE users SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = $1",
            user["id"],
        )
        return await _issue_tokens(conn, user["id"], "pasajero")


@router.get("/me")
async def passenger_me(
    payload: dict = Depends(get_current_user),
    pool: Pool = Depends(get_pool),
) -> dict:
    if payload.get("role") != "pasajero":
        raise HTTPException(status_code=403, detail="Se requiere cuenta de pasajero")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, full_name, phone, created_at FROM users WHERE id = $1",
            payload["sub"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return {
        "user_id": str(row["id"]),
        "full_name": row["full_name"],
        "phone_masked": f"+57 ******{row['phone'][-4:]}",
        "created_at": row["created_at"].isoformat(),
    }


@router.get("/reservations")
async def passenger_reservations(
    payload: dict = Depends(get_current_user),
    pool: Pool = Depends(get_pool),
) -> list:
    if payload.get("role") != "pasajero":
        raise HTTPException(status_code=403, detail="Se requiere cuenta de pasajero")
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT sr.id, sr.seats, sr.status, sr.created_at, cr.route_name
               FROM seat_reservations sr
               JOIN colectivo_routes cr ON cr.id = sr.route_id
               WHERE sr.passenger_id = $1
               ORDER BY sr.created_at DESC
               LIMIT 50""",
            payload["sub"],
        )
    return [dict(r) for r in rows]


# ── Dependencia reutilizable: pasajero opcional en endpoints publicos ─────────

_optional_bearer = HTTPBearer(auto_error=False)


async def optional_passenger_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_optional_bearer),
) -> Optional[str]:
    """Devuelve el id del pasajero si envia un token de pasajero valido; si no, None."""
    if credentials is None:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError:
        return None
    return payload["sub"] if payload.get("role") == "pasajero" else None