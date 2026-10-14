from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
import asyncpg
from app.core.security import decode_access_token
from app.core.database import get_pool

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Token inválido o expirado",
    headers={"WWW-Authenticate": "Bearer"},
)

class DriverContext:
    def __init__(self, user_id: str, driver_id: str, role: str, full_name: str):
        self.user_id   = user_id
        self.driver_id = driver_id
        self.role      = role
        self.full_name = full_name

async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if not credentials:
        raise _UNAUTHORIZED
    try:
        return decode_access_token(credentials.credentials)
    except JWTError:
        raise _UNAUTHORIZED

async def get_current_driver(
    payload: dict = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> DriverContext:
    if payload.get("role") != "conductor":
        raise HTTPException(status_code=403, detail="Se requiere rol de conductor")
    user_id = payload["sub"]
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT d.id AS driver_id, u.full_name, u.is_active FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1 AND d.is_verified = TRUE",
            user_id,
        )
    if not row:
        raise HTTPException(status_code=403, detail="Conductor no encontrado")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Cuenta de conductor desactivada")
    return DriverContext(user_id=user_id, driver_id=str(row["driver_id"]), role="conductor", full_name=row["full_name"])

async def get_current_admin(
    payload: dict = Depends(get_current_user),
    pool: asyncpg.Pool = Depends(get_pool),
) -> DriverContext:
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Se requiere rol de administrador")
    user_id = payload["sub"]
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT full_name, is_active FROM users WHERE id = $1", user_id)
    if not row or not row["is_active"]:
        raise HTTPException(status_code=403, detail="Cuenta de admin desactivada")
    return DriverContext(user_id=user_id, driver_id="", role="admin", full_name=row["full_name"])
