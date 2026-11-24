"""Bandeja de soporte: los usuarios reportan (publico) y el admin gestiona."""
import uuid
from typing import Optional

from asyncpg import Pool
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_pool
from app.core.dependencies import get_current_admin

CATEGORIES = {"tarifa", "conductor", "seguridad", "app", "otro"}
STATUSES   = {"abierto", "en_proceso", "resuelto", "cerrado"}

# Endpoint publico (lo usa cualquier pasajero, sin iniciar sesion)
public_router = APIRouter(prefix="/support", tags=["soporte"])

# Endpoints de administracion (requieren admin)
admin_router = APIRouter(
    prefix="/admin/support",
    tags=["admin-soporte"],
    dependencies=[Depends(get_current_admin)],
)


class ReportCreate(BaseModel):
    reporter_name:  Optional[str] = Field(default=None, max_length=60)
    reporter_phone: Optional[str] = Field(default=None, max_length=20)
    trip_id:        Optional[str] = None
    category:       str = Field(default="otro")
    message:        str = Field(min_length=3, max_length=1000)


@public_router.post("/reports", status_code=201)
async def create_report(body: ReportCreate, pool: Pool = Depends(get_pool)) -> dict:
    category = body.category if body.category in CATEGORIES else "otro"

    trip_uuid = None
    if body.trip_id:
        try:
            trip_uuid = str(uuid.UUID(body.trip_id))
        except ValueError:
            trip_uuid = None  # un trip_id invalido no bloquea el reporte

    async with pool.acquire() as conn:
        ticket = await conn.fetchrow(
            """INSERT INTO support_tickets
               (reporter_name, reporter_phone, trip_id, category, message)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id, created_at""",
            (body.reporter_name or "").strip() or None,
            (body.reporter_phone or "").strip() or None,
            trip_uuid, category, body.message.strip(),
        )

    return {
        "id": str(ticket["id"]),
        "status": "abierto",
        "message": "Gracias. Recibimos tu reporte y lo revisaremos.",
    }


@admin_router.get("")
async def list_tickets(
    status: Optional[str] = Query(default=None),
    pool: Pool = Depends(get_pool),
) -> dict:
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail="Estado invalido")

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, reporter_name, reporter_phone, trip_id, category,
                      message, status, admin_note, created_at, updated_at
               FROM support_tickets
               WHERE ($1::text IS NULL OR status = $1)
               ORDER BY
                   CASE status
                       WHEN 'abierto'    THEN 1
                       WHEN 'en_proceso' THEN 2
                       WHEN 'resuelto'   THEN 3
                       WHEN 'cerrado'    THEN 4
                   END,
                   created_at DESC
               LIMIT 200""",
            status,
        )
        counts = await conn.fetch(
            "SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status"
        )

    summary = {s: 0 for s in STATUSES}
    for c in counts:
        summary[c["status"]] = c["n"]

    def _ticket(r) -> dict:
        d = dict(r)
        d["id"] = str(d["id"])
        d["trip_id"] = str(d["trip_id"]) if d["trip_id"] else None
        d["created_at"] = d["created_at"].isoformat()
        d["updated_at"] = d["updated_at"].isoformat()
        return d

    return {"summary": summary, "tickets": [_ticket(r) for r in rows]}


class TicketUpdate(BaseModel):
    status:     Optional[str] = None
    admin_note: Optional[str] = Field(default=None, max_length=1000)


@admin_router.patch("/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    body: TicketUpdate,
    pool: Pool = Depends(get_pool),
) -> dict:
    sent = body.model_dump(exclude_unset=True)
    if not sent:
        raise HTTPException(status_code=422, detail="Nada que actualizar")
    if "status" in sent and sent["status"] not in STATUSES:
        raise HTTPException(status_code=422, detail="Estado invalido")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE support_tickets
               SET status     = COALESCE($2, status),
                   admin_note = COALESCE($3, admin_note),
                   updated_at = NOW()
               WHERE id = $1
               RETURNING id, status, admin_note""",
            ticket_id,
            sent.get("status"),
            sent.get("admin_note"),
        )
        if not row:
            raise HTTPException(status_code=404, detail="Reporte no encontrado")

    return {"id": str(row["id"]), "status": row["status"], "admin_note": row["admin_note"]}