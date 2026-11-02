"""CRUD de zonas de tarifa fija (decretos municipales). Solo admin."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from asyncpg import Pool
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_pool
from app.core.dependencies import get_current_admin

router = APIRouter(prefix="/admin/fare-zones", tags=["fare-zones"],
                   dependencies=[Depends(get_current_admin)])


class FareZoneBody(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    municipality: str = Field(min_length=2, max_length=80)
    province: str = Field(default="velez", pattern="^(velez|ricaurte)$")
    polygon: list[list[float]]
    fixed_fare: float = Field(gt=0)
    allow_surcharges: bool = False
    decree_ref: str | None = None
    priority: int = 0
    is_active: bool = True

    @field_validator("polygon")
    @classmethod
    def check_polygon(cls, v):
        if len(v) < 3:
            raise ValueError("El polígono necesita al menos 3 puntos")
        for p in v:
            if len(p) != 2 or not (-90 <= p[0] <= 90) or not (-180 <= p[1] <= 180):
                raise ValueError("Cada punto debe ser [lat, lng] válido")
        return v


def _row(r) -> dict:
    d = dict(r)
    d["id"] = str(d["id"])
    d["fixed_fare"] = float(d["fixed_fare"])
    if isinstance(d["polygon"], str):
        d["polygon"] = json.loads(d["polygon"])
    d["created_at"] = d["created_at"].isoformat()
    d["updated_at"] = d["updated_at"].isoformat()
    return d


@router.get("")
async def list_zones(pool: Pool = Depends(get_pool)) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM fare_zones ORDER BY municipality, priority DESC, name")
    return [_row(r) for r in rows]


@router.post("", status_code=201)
async def create_zone(body: FareZoneBody, pool: Pool = Depends(get_pool)) -> dict:
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            """INSERT INTO fare_zones (name, municipality, province, polygon, fixed_fare,
                   allow_surcharges, decree_ref, priority, is_active)
               VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *""",
            body.name, body.municipality, body.province, json.dumps(body.polygon),
            body.fixed_fare, body.allow_surcharges, body.decree_ref,
            body.priority, body.is_active)
    return _row(r)


@router.put("/{zone_id}")
async def update_zone(zone_id: UUID, body: FareZoneBody, pool: Pool = Depends(get_pool)) -> dict:
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            """UPDATE fare_zones SET name=$2, municipality=$3, province=$4, polygon=$5::jsonb,
                   fixed_fare=$6, allow_surcharges=$7, decree_ref=$8, priority=$9,
                   is_active=$10, updated_at=NOW()
               WHERE id=$1 RETURNING *""",
            zone_id, body.name, body.municipality, body.province, json.dumps(body.polygon),
            body.fixed_fare, body.allow_surcharges, body.decree_ref,
            body.priority, body.is_active)
    if not r:
        raise HTTPException(404, "Zona no encontrada")
    return _row(r)


@router.delete("/{zone_id}")
async def delete_zone(zone_id: UUID, pool: Pool = Depends(get_pool)) -> dict:
    async with pool.acquire() as conn:
        res = await conn.execute("DELETE FROM fare_zones WHERE id=$1", zone_id)
    if res.endswith("0"):
        raise HTTPException(404, "Zona no encontrada")
    return {"deleted": str(zone_id)}
