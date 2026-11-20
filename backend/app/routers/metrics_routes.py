"""Metricas del piloto para el administrador. Todas las fechas se cuentan en America/Bogota."""
from datetime import date
from typing import Optional

from asyncpg import Pool
from fastapi import APIRouter, Depends, Query

from app.core.database import get_pool
from app.core.dependencies import DriverContext, get_current_admin

router = APIRouter(prefix="/admin/metrics", tags=["admin-metrics"])

BOGOTA_DAY = "(created_at AT TIME ZONE 'America/Bogota')::date"


@router.get("/pilot")
async def pilot_metrics(
    since: date = Query(..., description="Inicio del piloto, YYYY-MM-DD"),
    route_id: Optional[str] = Query(None, description="Opcional: solo una ruta"),
    pool: Pool = Depends(get_pool),
    admin: DriverContext = Depends(get_current_admin),
) -> dict:
    async with pool.acquire() as conn:
        totals = await conn.fetchrow(
            f"""SELECT COUNT(*) AS reservations,
                       COUNT(*) FILTER (WHERE passenger_id IS NOT NULL) AS registered_reservations,
                       COUNT(*) FILTER (WHERE passenger_id IS NULL)     AS anonymous_reservations,
                       COALESCE(SUM(seats), 0)                          AS seats_requested,
                       COUNT(DISTINCT passenger_id)                     AS registered_passengers_booking
                FROM seat_reservations
                WHERE {BOGOTA_DAY} >= $1
                  AND ($2::uuid IS NULL OR route_id = $2::uuid)""",
            since, route_id,
        )

        repeat = await conn.fetchrow(
            f"""SELECT COUNT(*) AS unique_passengers,
                       COUNT(*) FILTER (WHERE days >= 2) AS repeat_passengers
                FROM (
                    SELECT passenger_id, COUNT(DISTINCT {BOGOTA_DAY}) AS days
                    FROM seat_reservations
                    WHERE passenger_id IS NOT NULL
                      AND {BOGOTA_DAY} >= $1
                      AND ($2::uuid IS NULL OR route_id = $2::uuid)
                    GROUP BY passenger_id
                ) t""",
            since, route_id,
        )

        accounts = await conn.fetchrow(
            f"""SELECT COUNT(*) AS total_accounts,
                       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'America/Bogota')::date >= $1)
                           AS new_accounts_in_period
                FROM users WHERE role = 'pasajero' AND is_active""",
            since,
        )

        daily = await conn.fetch(
            f"""SELECT {BOGOTA_DAY} AS day,
                       COUNT(*) AS reservations,
                       COUNT(*) FILTER (WHERE passenger_id IS NOT NULL) AS registered,
                       COALESCE(SUM(seats), 0) AS seats
                FROM seat_reservations
                WHERE {BOGOTA_DAY} >= $1
                  AND ($2::uuid IS NULL OR route_id = $2::uuid)
                GROUP BY 1 ORDER BY 1""",
            since, route_id,
        )

    unique = repeat["unique_passengers"] or 0
    repeat_n = repeat["repeat_passengers"] or 0
    return {
        "since": since.isoformat(),
        "route_id": route_id,
        "accounts": {
            "total": accounts["total_accounts"],
            "new_in_period": accounts["new_accounts_in_period"],
        },
        "reservations": {
            "total": totals["reservations"],
            "registered": totals["registered_reservations"],
            "anonymous": totals["anonymous_reservations"],
            "seats_requested": int(totals["seats_requested"]),
        },
        "passengers": {
            "unique_booking": unique,
            "repeat": repeat_n,
            "repeat_rate": round(repeat_n / unique, 3) if unique else 0.0,
        },
        "daily": [
            {
                "day": r["day"].isoformat(),
                "reservations": r["reservations"],
                "registered": r["registered"],
                "seats": int(r["seats"]),
            }
            for r in daily
        ],
    }