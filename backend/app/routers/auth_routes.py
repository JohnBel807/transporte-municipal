from fastapi import APIRouter, Depends, HTTPException, Request, status
from asyncpg import Pool
from app.core.database import get_pool
from app.core.dependencies import get_current_user
from app.core.security import verify_password, create_access_token, generate_refresh_token
from app.models.auth import LoginRequest, RefreshRequest, TokenResponse
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login", response_model=TokenResponse)
async def login_endpoint(body: LoginRequest, request: Request, pool: Pool = Depends(get_pool)) -> TokenResponse:
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT u.id, u.password_hash, u.role, u.full_name, u.is_active FROM users u WHERE u.email = $1",
            body.email,
        )
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    if not user["is_active"]:
        raise HTTPException(status_code=401, detail="Cuenta desactivada")
    access_token  = create_access_token(str(user["id"]), user["role"])
    refresh_token = generate_refresh_token()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_min * 60,
        role=user["role"],
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_endpoint(body: RefreshRequest, pool: Pool = Depends(get_pool)) -> TokenResponse:
    raise HTTPException(status_code=501, detail="Implementar refresh token completo")

@router.post("/logout", status_code=204)
async def logout_endpoint(payload: dict = Depends(get_current_user), pool: Pool = Depends(get_pool)) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
            payload["sub"],
        )
