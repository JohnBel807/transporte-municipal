import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import get_pool, close_database
from app.core.config import settings
from app.routers import auth_routes, route_routes, ws_routes, admin_routes
from app.routers import taxi_routes

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    logging.getLogger(__name__).info("Database pool ready")
    yield
    await close_database()
    logging.getLogger(__name__).info("Database connections closed")

app = FastAPI(
    title="Transporte Municipal API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://practical-creation-production-8797.up.railway.app",
        "https://admin.velezyricaurte.com",
        "https://bus.velezyricaurte.com",
        "https://app.velezyricaurte.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(route_routes.router)
app.include_router(ws_routes.router)
app.include_router(admin_routes.router)
app.include_router(taxi_routes.router)

@app.get("/health", tags=["sistema"])
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0", "env": settings.app_env}