import asyncio
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from asyncpg import Pool
from app.core.database import get_pool
from app.core.dependencies import get_current_admin, DriverContext
from pydantic import BaseModel, Field
import bcrypt as _bcrypt

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])

@router.get("/dashboard")
async def dashboard(pool: Pool = Depends(get_pool)) -> dict:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT cr.id AS route_id, cr.route_name,
                   d.id AS driver_id, u.full_name AS driver_name, d.avg_rating AS driver_rating,
                   v.plate, v.vehicle_type,
                   ST_Y(rls.current_position::GEOMETRY) AS lat,
                   ST_X(rls.current_position::GEOMETRY) AS lng,
                   rls.heading, rls.speed_kmh, rls.passengers_aboard, v.capacity,
                   ROUND((rls.passengers_aboard::FLOAT / NULLIF(v.capacity,0) * 100)::NUMERIC, 1) AS occupancy_pct,
                   COALESCE(rw.place_name, 'Desconocida') AS next_stop,
                   COALESCE(rls.eta_next_stop_sec, 0) AS eta_seconds,
                   CASE WHEN rls.updated_at > NOW()-INTERVAL '10s' THEN 'live'
                        WHEN rls.updated_at > NOW()-INTERVAL '30s' THEN 'stale'
                        ELSE 'offline' END AS signal_status,
                   COALESCE(oz.name, 'fuera de zona') AS province,
                   rls.updated_at::TEXT AS updated_at
            FROM route_live_state rls
            JOIN colectivo_routes cr ON cr.id = rls.route_id
            JOIN drivers d ON d.id = rls.driver_id
            JOIN users u ON u.id = d.user_id
            JOIN vehicles v ON v.driver_id = d.id AND v.is_active
            LEFT JOIN route_waypoints rw ON rw.id = rls.next_waypoint_id
            LEFT JOIN operational_zones oz ON oz.zone_type='provincia'
                AND ST_Within(rls.current_position::GEOMETRY, oz.geom)
            WHERE cr.status = 'activa'
            ORDER BY province, cr.route_name
        """)
    vehicles = [dict(r) for r in rows]
    by_province: dict[str, int] = {}
    stale = 0
    for v in vehicles:
        by_province[v["province"]] = by_province.get(v["province"], 0) + 1
        if v["signal_status"] != "live":
            stale += 1
    return {
        "total_active_routes": len(vehicles),
        "total_passengers_now": sum(v["passengers_aboard"] for v in vehicles),
        "avg_occupancy_pct": round(sum(v["occupancy_pct"] for v in vehicles) / len(vehicles), 1) if vehicles else 0,
        "routes_by_province": by_province,
        "stale_signals": stale,
        "vehicles": vehicles,
    }

@router.get("/reports/mobility")
async def mobility_report(
    report_date: date = Query(default_factory=date.today),
    province: str | None = Query(default=None),
    pool: Pool = Depends(get_pool),
) -> dict:
    async with pool.acquire() as conn:
        routes, vehicles = await asyncio.gather(
            conn.fetch("""
                SELECT th.route_id, cr.route_name, th.province,
                       COUNT(*) AS total_trips,
                       SUM(th.total_passengers) AS total_passengers,
                       ROUND(AVG(th.total_passengers)::NUMERIC,1) AS avg_passengers,
                       ROUND(AVG(EXTRACT(EPOCH FROM (th.ended_at-th.started_at))/60)::NUMERIC,1) AS avg_duration_min,
                       0 AS peak_hour
                FROM trip_history th JOIN colectivo_routes cr ON cr.id=th.route_id
                WHERE th.date=$1 AND ($2::TEXT IS NULL OR th.province=$2)
                GROUP BY th.route_id, cr.route_name, th.province
                ORDER BY total_passengers DESC LIMIT 20
            """, report_date, province),
            conn.fetch("""
                SELECT v.id AS vehicle_id, v.plate, u.full_name AS driver_name, v.vehicle_type,
                       COUNT(th.id) AS trips_today,
                       COALESCE(SUM(th.total_passengers),0) AS total_passengers,
                       COALESCE(ROUND(SUM(th.total_distance_km)::NUMERIC,2),0) AS total_distance_km,
                       ROUND(SUM(EXTRACT(EPOCH FROM (th.ended_at-th.started_at)))/3600.0,2) AS active_hours,
                       MODE() WITHIN GROUP (ORDER BY th.province) AS province
                FROM trip_history th JOIN vehicles v ON v.id=th.vehicle_id
                JOIN drivers d ON d.id=th.driver_id JOIN users u ON u.id=d.user_id
                WHERE th.date=$1 AND ($2::TEXT IS NULL OR th.province=$2)
                GROUP BY v.id, v.plate, u.full_name, v.vehicle_type
                ORDER BY trips_today DESC
            """, report_date, province),
        )
    routes_list = [dict(r) for r in routes]
    return {
        "date": report_date.isoformat(),
        "province_filter": province,
        "top_routes": routes_list,
        "vehicles_summary": [dict(v) for v in vehicles],
        "totals": {
            "total_trips": sum(r["total_trips"] for r in routes_list),
            "total_passengers": sum(r["total_passengers"] for r in routes_list),
            "total_vehicles": len(vehicles),
            "most_demanded_route": routes_list[0]["route_name"] if routes_list else None,
        },
    }

@router.patch("/drivers/{driver_id}/status")
async def manage_driver_status(
    driver_id: str,
    body: dict,
    pool: Pool = Depends(get_pool),
    admin: DriverContext = Depends(get_current_admin),
) -> dict:
    action = body.get("action")
    reason = body.get("reason", "")
    is_blocking = action == "bloquear"
    async with pool.acquire() as conn:
        async with conn.transaction():
            prev = await conn.fetchrow(
                "SELECT u.id AS user_id, u.full_name, u.is_active, d.is_verified, d.status AS driver_status FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.id=$1",
                driver_id,
            )
            if not prev:
                raise HTTPException(status_code=404, detail="Conductor no encontrado")
            await conn.execute("UPDATE users SET is_active=$2 WHERE id=$1", str(prev["user_id"]), not is_blocking)
            await conn.execute("UPDATE drivers SET is_verified=$2 WHERE id=$1", driver_id, not is_blocking)
            affected_routes = 0
            if is_blocking:
                await conn.execute("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", str(prev["user_id"]))
                active_routes = await conn.fetch("SELECT id FROM colectivo_routes WHERE driver_id=$1 AND status='activa'", driver_id)
                for route_row in active_routes:
                    rid = str(route_row["id"])
                    await conn.execute("UPDATE colectivo_routes SET status='pausada', is_public=FALSE WHERE id=$1", rid)
                    await conn.execute("DELETE FROM route_live_state WHERE route_id=$1", rid)
                    affected_routes += 1
    return {
        "driver_id": driver_id,
        "full_name": prev["full_name"],
        "action": action,
        "affected_routes": affected_routes,
        "message": f"Conductor {'bloqueado' if is_blocking else 'desbloqueado'}. {affected_routes} ruta(s) afectada(s).",
    }
    
class DriverCreateRequest(BaseModel):
        full_name:        str = Field(min_length=3, max_length=100)
        email:            str = Field(min_length=5, max_length=100)
        phone:            str = Field(min_length=7, max_length=20)
        password:         str = Field(min_length=6, max_length=50)
        driver_type:      str = Field(pattern="^(taxi|particular|colectivo)$")
        license_number:   str = Field(min_length=3, max_length=30)
        license_category: str = Field(min_length=1, max_length=10)
        zone_slug:        str = Field(default="velez")
        plate:            str = Field(min_length=5, max_length=10)
        brand:            str = Field(min_length=2, max_length=50)
        model:            str = Field(min_length=1, max_length=50)
        year:             int = Field(ge=2000, le=2030)
        capacity:         int = Field(ge=1, le=60)
        color:            str = Field(min_length=2, max_length=30)
        vehicle_type:     str = Field(pattern="^(sedan|van|bus|moto)$")


class DriverCreateResponse(BaseModel):
    user_id:    str
    driver_id:  str
    vehicle_id: str
    full_name:  str
    email:      str
    message:    str


@router.post("/drivers", response_model=DriverCreateResponse, status_code=201)
async def create_driver(
    body:  DriverCreateRequest,
    pool:  Pool          = Depends(get_pool),
    admin: DriverContext = Depends(get_current_admin),
) -> DriverCreateResponse:
    password_hash = _bcrypt.hashpw(
        body.password.encode(), _bcrypt.gensalt()
    ).decode()

    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchval(
                "SELECT id FROM users WHERE email=$1 OR phone=$2",
                body.email, body.phone,
            )
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail="Ya existe un usuario con ese email o teléfono"
                )

            zone_id = await conn.fetchval(
                "SELECT id FROM zones WHERE slug=$1 AND is_active=TRUE",
                body.zone_slug,
            )
            if not zone_id:
                raise HTTPException(status_code=404, detail="Zona no encontrada")

            user_id = await conn.fetchval(
                """INSERT INTO users
                   (email, phone, password_hash, full_name, role, is_active, zone_id)
                   VALUES ($1,$2,$3,$4,'conductor',TRUE,$5) RETURNING id""",
                body.email, body.phone, password_hash, body.full_name, zone_id,
            )

            driver_id = await conn.fetchval(
                """INSERT INTO drivers
                   (user_id, driver_type, license_number, license_category,
                    status, is_verified, zone_id)
                   VALUES ($1,$2,$3,$4,'disponible',TRUE,$5) RETURNING id""",
                user_id, body.driver_type, body.license_number,
                body.license_category, zone_id,
            )

            vehicle_id = await conn.fetchval(
                """INSERT INTO vehicles
                   (driver_id, plate, brand, model, year,
                    capacity, color, vehicle_type, is_active)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id""",
                driver_id, body.plate.upper(), body.brand, body.model,
                body.year, body.capacity, body.color, body.vehicle_type,
            )

    return DriverCreateResponse(
        user_id=str(user_id),
        driver_id=str(driver_id),
        vehicle_id=str(vehicle_id),
        full_name=body.full_name,
        email=body.email,
        message=f"Conductor {body.full_name} registrado correctamente",
    )