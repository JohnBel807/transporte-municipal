"""Plantillas de ruta: privadas del conductor, compartidas entre conductores u oficiales (admin)."""
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from asyncpg import Pool
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_pool
from app.core.dependencies import get_current_driver, get_current_admin, DriverContext

router = APIRouter(prefix="/route-templates", tags=["route-templates"])


class TplWaypoint(BaseModel):
    sequence_order: int
    place_name: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    is_terminal: bool = False
    estimated_wait_min: int = Field(default=0, ge=0, le=120)


class TemplateBody(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=300)
    base_fare: float = Field(ge=0)
    estimated_duration_min: int = Field(default=30, ge=1, le=600)
    tolerance_m: int = Field(default=300, ge=50, le=2000)
    waypoints: list[TplWaypoint]
    visibility: str = Field(default="private", pattern="^(private|shared)$")

    @field_validator("waypoints")
    @classmethod
    def check_wps(cls, v):
        if len(v) < 2:
            raise ValueError("La plantilla necesita al menos 2 paradas")
        return v


def _row(r, me: str | None = None) -> dict:
    d = dict(r)
    d["id"] = str(d["id"])
    d["base_fare"] = float(d["base_fare"])
    if isinstance(d["waypoints"], str):
        d["waypoints"] = json.loads(d["waypoints"])
    d["owner_driver_id"] = str(d["owner_driver_id"]) if d["owner_driver_id"] else None
    d["is_mine"] = bool(me and d["owner_driver_id"] == me)
    d["created_at"] = d["created_at"].isoformat()
    d.pop("updated_at", None)
    return d


_SELECT = """SELECT t.*, COALESCE(u.full_name, 'Administración') AS owner_name
             FROM route_templates t
             LEFT JOIN drivers d ON d.id = t.owner_driver_id
             LEFT JOIN users u ON u.id = d.user_id"""


@router.get("")
async def list_templates(
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    """Oficiales + compartidas + propias."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            _SELECT + """ WHERE t.is_official OR t.visibility = 'shared'
                             OR t.owner_driver_id = $1
                          ORDER BY t.is_official DESC, t.uses_count DESC, t.created_at DESC
                          LIMIT 200""",
            driver.driver_id)
    return [_row(r, driver.driver_id) for r in rows]


@router.post("", status_code=201)
async def create_template(
    body: TemplateBody,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    wps = [w.model_dump() for w in sorted(body.waypoints, key=lambda w: w.sequence_order)]
    for i, w in enumerate(wps):
        w["sequence_order"] = i
    async with pool.acquire() as conn:
        tid = await conn.fetchval(
            """INSERT INTO route_templates (owner_driver_id, name, description, base_fare,
                   estimated_duration_min, tolerance_m, waypoints, visibility)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id""",
            driver.driver_id, body.name, body.description, body.base_fare,
            body.estimated_duration_min, body.tolerance_m, json.dumps(wps), body.visibility)
        r = await conn.fetchrow(_SELECT + " WHERE t.id=$1", tid)
    return _row(r, driver.driver_id)


@router.post("/from-route/{route_id}", status_code=201)
async def template_from_route(
    route_id: UUID,
    visibility: str = "private",
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    """Guarda una ruta existente del conductor como plantilla."""
    if visibility not in ("private", "shared"):
        raise HTTPException(422, "visibility inválida")
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            """SELECT route_name, description, base_fare, estimated_duration_min
               FROM colectivo_routes WHERE id=$1 AND driver_id=$2""",
            route_id, driver.driver_id)
        if not route:
            raise HTTPException(404, "Ruta no encontrada")
        wps = await conn.fetch(
            """SELECT place_name, latitude, longitude, is_terminal, estimated_wait_min
               FROM route_waypoints WHERE route_id=$1 ORDER BY sequence_order""", route_id)
        if len(wps) < 2:
            raise HTTPException(422, "La ruta no tiene suficientes paradas")
        data = [{"sequence_order": i, "place_name": w["place_name"],
                 "latitude": float(w["latitude"]), "longitude": float(w["longitude"]),
                 "is_terminal": bool(w["is_terminal"]),
                 "estimated_wait_min": int(w["estimated_wait_min"] or 0)}
                for i, w in enumerate(wps)]
        tid = await conn.fetchval(
            """INSERT INTO route_templates (owner_driver_id, name, description, base_fare,
                   estimated_duration_min, waypoints, visibility)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id""",
            driver.driver_id, route["route_name"], route["description"] or "",
            route["base_fare"], route["estimated_duration_min"], json.dumps(data), visibility)
        r = await conn.fetchrow(_SELECT + " WHERE t.id=$1", tid)
    return _row(r, driver.driver_id)


@router.patch("/{template_id}")
async def update_visibility(
    template_id: UUID,
    body: dict,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    vis = body.get("visibility")
    if vis not in ("private", "shared"):
        raise HTTPException(422, "visibility debe ser 'private' o 'shared'")
    async with pool.acquire() as conn:
        res = await conn.execute(
            "UPDATE route_templates SET visibility=$3, updated_at=NOW() WHERE id=$1 AND owner_driver_id=$2",
            template_id, driver.driver_id, vis)
    if res.endswith("0"):
        raise HTTPException(404, "Plantilla no encontrada")
    return {"id": str(template_id), "visibility": vis}


@router.delete("/{template_id}")
async def delete_template(
    template_id: UUID,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM route_templates WHERE id=$1 AND owner_driver_id=$2",
            template_id, driver.driver_id)
    if res.endswith("0"):
        raise HTTPException(404, "Plantilla no encontrada")
    return {"deleted": str(template_id)}


@router.post("/{template_id}/use")
async def mark_used(
    template_id: UUID,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE route_templates SET uses_count = uses_count + 1 WHERE id=$1", template_id)
    return {"ok": True}


@router.patch("/{template_id}/official")
async def set_official(
    template_id: UUID,
    body: dict,
    pool: Pool = Depends(get_pool),
    admin: DriverContext = Depends(get_current_admin),
) -> dict:
    """Solo admin: marca una plantilla como oficial (visible para todos)."""
    official = bool(body.get("is_official", True))
    async with pool.acquire() as conn:
        res = await conn.execute(
            "UPDATE route_templates SET is_official=$2, updated_at=NOW() WHERE id=$1",
            template_id, official)
    if res.endswith("0"):
        raise HTTPException(404, "Plantilla no encontrada")
    return {"id": str(template_id), "is_official": official}