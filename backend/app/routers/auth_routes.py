from fastapi import APIRouter, Depends, HTTPException, Request, status
from asyncpg import Pool
from datetime import datetime, timezone, timedelta
from app.core.database import get_pool
from app.core.dependencies import get_current_user
from app.core.security import (
    verify_password, 
    create_access_token, 
    generate_refresh_token, 
    hash_refresh_token
)
from app.models.auth import LoginRequest, RefreshRequest, TokenResponse
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
async def login_endpoint(
    body: LoginRequest,
    pool: Pool = Depends(get_pool),
) -> TokenResponse:
    import uuid as _uuid
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT id, password_hash, role, full_name, is_active FROM users WHERE email = $1",
            body.email,
        )
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not user["is_active"]:
        raise HTTPException(status_code=401, detail="Cuenta desactivada")

    access_token  = create_access_token(str(user["id"]), user["role"])
    refresh_token = generate_refresh_token()
    refresh_hash  = hash_refresh_token(refresh_token)
    family_id     = str(_uuid.uuid4())

    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO refresh_tokens
               (user_id, token_hash, family_id, expires_at)
               VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
            """,
            str(user["id"]), refresh_hash, family_id,
        )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_min * 60,
        role=user["role"],
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_endpoint(
    body: RefreshRequest,
    pool: Pool = Depends(get_pool),
) -> TokenResponse:
    token_hash = hash_refresh_token(body.refresh_token)
    async with pool.acquire() as conn:
        record = await conn.fetchrow(
            """
            SELECT rt.id, rt.user_id, rt.expires_at,
                   rt.revoked_at, rt.family_id,
                   u.role, u.is_active, u.full_name
            FROM   refresh_tokens rt
            JOIN   users u ON u.id = rt.user_id
            WHERE  rt.token_hash = $1
            """,
            token_hash,
        )
        if not record:
            raise HTTPException(status_code=401, detail="Refresh token inválido")

        # Token ya revocado — posible robo de token, revocar familia completa
        if record["revoked_at"] is not None:
            await conn.execute(
                "UPDATE refresh_tokens SET revoked_at = NOW() WHERE family_id = $1",
                record["family_id"],
            )
            raise HTTPException(
                status_code=401,
                detail="Refresh token ya fue usado. Inicia sesión de nuevo."
            )

        # Token expirado
        if record["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Refresh token expirado")

        # Usuario desactivado
        if not record["is_active"]:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")

        # Revocar el token actual
        await conn.execute(
            "UPDATE refresh_tokens SET revoked_at = NOW(), rotated_at = NOW() WHERE id = $1",
            record["id"],
        )

        # Generar nuevos tokens
        new_access_token   = create_access_token(
            str(record["user_id"]), record["role"]
        )
        new_refresh_token  = generate_refresh_token()
        new_refresh_hash   = hash_refresh_token(new_refresh_token)

        # Guardar nuevo refresh token
        await conn.execute(
            """
            INSERT INTO refresh_tokens
                (user_id, token_hash, family_id, expires_at)
            VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
            """,
            record["user_id"],
            new_refresh_hash,
            record["family_id"],
        )

    return TokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.access_token_expire_min * 60,
        role=record["role"],
    )

@router.post("/logout", status_code=204)
async def logout_endpoint(payload: dict = Depends(get_current_user), pool: Pool = Depends(get_pool)) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            payload["sub"],
        )