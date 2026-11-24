"""Monitoreo de documentos de conductores para el administrador.

Licencia -> drivers.license_expiry
SOAT y tecnomecanica -> vehiculo activo (vehicles.soat_expiry, vehicles.tecnomecanica_expiry)

El estado se calcula a nivel de fecha; un dia de diferencia a medianoche es irrelevante
para documentos.
"""
from datetime import date, timedelta
from typing import Optional

from asyncpg import Pool
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_pool
from app.core.dependencies import get_current_admin

router = APIRouter(
    prefix="/admin/documents",
    tags=["admin-documentos"],
    dependencies=[Depends(get_current_admin)],
)

_RANK = {"vencido": 0, "sin_dato": 1, "por_vencer": 2, "vigente": 3}


def _status(expiry: Optional[date], today: date, warn_days: int) -> str:
    if expiry is None:
        return "sin_dato"
    if expiry < today:
        return "vencido"
    if expiry <= today + timedelta(days=warn_days):
        return "por_vencer"
    return "vigente"


def _doc(expiry: Optional[date], today: date, warn_days: int) -> dict:
    st = _status(expiry, today, warn_days)
    days_left = (expiry - today).days if expiry is not None else None
    return {
        "expiry": expiry.isoformat() if expiry else None,
        "status": st,
        "days_left": days_left,
    }


@router.get("")
async def list_documents(
    warn_days: int = Query(default=30, ge=1, le=180),
    only: Optional[str] = Query(default=None, description="'problem' = solo vencidos/por vencer/sin dato"),
    pool: Pool = Depends(get_pool),
) -> dict:
    today = date.today()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT d.id AS driver_id, u.full_name, u.phone,
                      d.driver_type, d.license_expiry,
                      v.id AS vehicle_id, v.plate,
                      v.soat_expiry, v.tecnomecanica_expiry
               FROM drivers d
               JOIN users u ON u.id = d.user_id
               LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active
               ORDER BY u.full_name"""
        )

    drivers = []
    counters = {"vencido": 0, "por_vencer": 0, "sin_dato": 0, "vigente": 0}
    for r in rows:
        docs = {
            "licencia":      _doc(r["license_expiry"], today, warn_days),
            "soat":          _doc(r["soat_expiry"], today, warn_days),
            "tecnomecanica": _doc(r["tecnomecanica_expiry"], today, warn_days),
        }
        overall = min((d["status"] for d in docs.values()), key=lambda s: _RANK[s])
        counters[overall] = counters.get(overall, 0) + 1
        if only == "problem" and overall == "vigente":
            continue
        drivers.append({
            "driver_id":   str(r["driver_id"]),
            "full_name":   r["full_name"],
            "phone":       r["phone"],
            "driver_type": r["driver_type"],
            "plate":       r["plate"],
            "vehicle_id":  str(r["vehicle_id"]) if r["vehicle_id"] else None,
            "overall":     overall,
            "documents":   docs,
        })

    return {"warn_days": warn_days, "summary": counters, "drivers": drivers}


class DocumentUpdate(BaseModel):
    license_expiry:       Optional[date] = None
    soat_expiry:          Optional[date] = None
    tecnomecanica_expiry: Optional[date] = None


@router.patch("/{driver_id}")
async def update_documents(
    driver_id: str,
    body: DocumentUpdate,
    pool: Pool = Depends(get_pool),
) -> dict:
    sent = body.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="No enviaste ninguna fecha")

    async with pool.acquire() as conn:
        drv = await conn.fetchrow("SELECT id FROM drivers WHERE id = $1", driver_id)
        if not drv:
            raise HTTPException(status_code=404, detail="Conductor no encontrado")

        if "license_expiry" in sent:
            await conn.execute(
                "UPDATE drivers SET license_expiry = $2 WHERE id = $1",
                driver_id, sent["license_expiry"],
            )

        veh_fields = {k: v for k, v in sent.items()
                      if k in ("soat_expiry", "tecnomecanica_expiry")}
        if veh_fields:
            vehicle_id = await conn.fetchval(
                "SELECT id FROM vehicles WHERE driver_id = $1 AND is_active LIMIT 1",
                driver_id,
            )
            if not vehicle_id:
                raise HTTPException(
                    status_code=404,
                    detail="El conductor no tiene vehiculo activo para SOAT/tecnomecanica",
                )
            for col, val in veh_fields.items():
                await conn.execute(
                    f"UPDATE vehicles SET {col} = $2 WHERE id = $1",  # col es de lista fija
                    vehicle_id, val,
                )

    return {"driver_id": driver_id, "updated": list(sent.keys())}