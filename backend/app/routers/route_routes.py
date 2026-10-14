import json
import logging
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from asyncpg import Pool
import asyncpg
from app.core.database import get_pool
from app.core.dependencies import get_current_driver, DriverContext
from app.models.routes import (
    RouteCreate, RouteCreateResponse, WaypointResponse,
    ActivateRouteResponse, RouteStatus,
    DeactivateRouteRequest, DeactivateRouteResponse,
)
from fastapi import BackgroundTasks
from app.core import webhooks
log = logging.getLogger(__name__)
router = APIRouter(prefix="/routes", tags=["routes"])


# ── Modelos ───────────────────────────────────────────────────────────────────

class LocationUpdate(BaseModel):
    lat:       float = Field(ge=-90,  le=90)
    lng:       float = Field(ge=-180, le=180)
    speed_kmh: float = Field(ge=0, default=0)
    heading:   int   = Field(ge=0, le=359, default=0)


class ScheduleCreate(BaseModel):
    day_of_week:    str
    departure_time: str
    arrival_time:   str | None = None
    is_active:      bool = True


# ── Crear ruta ────────────────────────────────────────────────────────────────

@router.post("/", response_model=RouteCreateResponse, status_code=201)
async def create_route_endpoint(
    payload: RouteCreate,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> RouteCreateResponse:
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                route_row = await conn.fetchrow(
                    """INSERT INTO colectivo_routes
                       (driver_id, route_name, description, base_fare,
                        estimated_duration_min, status, is_public)
                       VALUES ($1,$2,$3,$4,$5,'pausada',$6)
                       RETURNING id, route_name, status, is_public""",
                    driver.driver_id, payload.route_name, payload.description,
                    payload.base_fare, payload.estimated_duration_min, payload.is_public,
                )
                route_id = str(route_row["id"])
                waypoint_data = sorted(payload.waypoints, key=lambda x: x.sequence_order)
                waypoint_rows = await conn.fetch(
                    """INSERT INTO route_waypoints
                       (route_id, sequence_order, place_name, latitude, longitude,
                        is_terminal, estimated_wait_min)
                       SELECT d.rid, d.seq, d.name, d.lat, d.lng, d.terminal, d.wait
                       FROM UNNEST($1::uuid[],$2::int[],$3::text[],$4::float[],
                                   $5::float[],$6::bool[],$7::int[])
                       AS d(rid, seq, name, lat, lng, terminal, wait)
                       RETURNING id, sequence_order, place_name, latitude,
                                 longitude, is_terminal, estimated_wait_min""",
                    [route_id] * len(waypoint_data),
                    [w.sequence_order for w in waypoint_data],
                    [w.place_name     for w in waypoint_data],
                    [w.latitude       for w in waypoint_data],
                    [w.longitude      for w in waypoint_data],
                    [w.is_terminal    for w in waypoint_data],
                    [w.estimated_wait_min for w in waypoint_data],
                )
                await conn.execute(
                    "SELECT rebuild_route_corridor($1, $2)",
                    route_id, payload.tolerance_m,
                )
                corridor_exists = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM route_corridors WHERE route_id=$1)",
                    route_id,
                )
                if not corridor_exists:
                    raise RuntimeError("rebuild_route_corridor falló")

        return RouteCreateResponse(
            route_id=route_id,
            route_name=route_row["route_name"],
            status=route_row["status"],
            is_public=route_row["is_public"],
            waypoints=[WaypointResponse(
                id=str(r["id"]),
                sequence_order=r["sequence_order"],
                place_name=r["place_name"],
                latitude=float(r["latitude"]),
                longitude=float(r["longitude"]),
                is_terminal=r["is_terminal"],
                estimated_wait_min=r["estimated_wait_min"],
            ) for r in sorted(waypoint_rows, key=lambda r: r["sequence_order"])],
            corridor_built=corridor_exists,
            message="Ruta creada en modo pausado.",
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail="Ya existe una ruta con ese nombre.")
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="Conductor no encontrado.")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Activar ruta ──────────────────────────────────────────────────────────────

@router.patch("/{route_id}/activate", response_model=ActivateRouteResponse)
async def activate_route_endpoint(
    route_id: str,
    background_tasks: BackgroundTasks,        # ← agregar
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> ActivateRouteResponse:
    async with pool.acquire() as conn:
        # ... código existente sin cambios ...

        # Justo antes del return, agrega:
        vehicle_info = await conn.fetchrow(
            """SELECT v.plate, v.brand, v.model, v.capacity, v.vehicle_type,
                      u.full_name, u.phone, d.avg_rating,
                      oz.name AS zone_name,
                      rw.place_name AS first_stop
               FROM vehicles v
               JOIN drivers d ON d.id = v.driver_id
               JOIN users u ON u.id = d.user_id
               LEFT JOIN operational_zones oz
                   ON oz.zone_type = 'provincia'
                   AND $1 BETWEEN oz.min_lat AND oz.max_lat
                   AND $2 BETWEEN oz.min_lng AND oz.max_lng
               LEFT JOIN route_waypoints rw
                   ON rw.route_id = $3
               WHERE v.driver_id = $4 AND v.is_active
               ORDER BY rw.sequence_order LIMIT 1""",
            driver_location["lat"], driver_location["lng"],
            route_id, driver.driver_id,
        )

    if vehicle_info:
        background_tasks.add_task(
            webhooks.emit_ruta_activada,
            route_id     = route_id,
            route_name   = route["route_name"],
            base_fare    = float(route.get("base_fare", 0)),
            driver_id    = driver.driver_id,
            driver_name  = vehicle_info["full_name"],
            driver_phone = vehicle_info["phone"],
            avg_rating   = float(vehicle_info["avg_rating"] or 0),
            plate        = vehicle_info["plate"],
            brand        = vehicle_info["brand"],
            model        = vehicle_info["model"],
            capacity     = vehicle_info["capacity"],
            vehicle_type = vehicle_info["vehicle_type"],
            lat          = float(driver_location["lat"]),
            lng          = float(driver_location["lng"]),
            zone_name    = zone["name"],
            next_stop    = vehicle_info["first_stop"] or "Primera parada",
        )

    return ActivateRouteResponse(...)


# ── Desactivar ruta ───────────────────────────────────────────────────────────

@router.patch("/{route_id}/deactivate", response_model=DeactivateRouteResponse)
async def deactivate_route_endpoint(
    route_id: str,
    body: DeactivateRouteRequest = DeactivateRouteRequest(),
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> DeactivateRouteResponse:
    async with pool.acquire() as conn:
        async with conn.transaction():
            route = await conn.fetchrow(
                "SELECT id, driver_id, status FROM colectivo_routes "
                "WHERE id=$1 FOR UPDATE",
                route_id,
            )
            if not route:
                raise HTTPException(status_code=404, detail="Ruta no encontrada")
            is_owner = str(route["driver_id"]) == driver.driver_id
            is_admin = driver.role == "admin"
            if not is_owner and not is_admin:
                raise HTTPException(status_code=403,
                    detail="Solo el dueño o admin puede desactivar")
            if route["status"] in ("pausada", "archivada"):
                raise HTTPException(status_code=409,
                    detail=f"La ruta ya está en estado '{route['status']}'")

            previous_status = route["status"]

            # Guardar historial antes de borrar el estado
            live = await conn.fetchrow(
                """SELECT current_lat, current_lng, passengers_aboard,
                          updated_at, current_segment_seq
                   FROM route_live_state WHERE route_id = $1""",
                route_id,
            )
            zone_row = await conn.fetchrow(
                """SELECT oz.name FROM operational_zones oz
                   WHERE oz.zone_type = 'provincia'
                     AND $1 BETWEEN oz.min_lat AND oz.max_lat
                     AND $2 BETWEEN oz.min_lng AND oz.max_lng
                   LIMIT 1""",
                live["current_lat"] if live else 0,
                live["current_lng"] if live else 0,
            )
            vehicle = await conn.fetchrow(
                "SELECT id FROM vehicles WHERE driver_id=$1 "
                "AND is_active=TRUE LIMIT 1",
                driver.driver_id,
            )
            if live and vehicle:
                await conn.execute(
                    """INSERT INTO trip_history
                       (route_id, driver_id, vehicle_id, started_at, ended_at,
                        total_passengers, province, waypoints_covered, zone_id)
                       SELECT $1, $2, $3, cr.updated_at, NOW(), $4, $5, $6, cr.zone_id
                       FROM colectivo_routes cr WHERE cr.id = $1""",
                    route_id,
                    driver.driver_id,
                    str(vehicle["id"]),
                    live["passengers_aboard"],
                    zone_row["name"] if zone_row else "Desconocida",
                    live["current_segment_seq"],
                )

            await conn.execute(
                "UPDATE colectivo_routes SET status=$2, is_public=FALSE, "
                "updated_at=NOW() WHERE id=$1",
                route_id, body.final_status,
            )
            await conn.execute(
                "UPDATE drivers SET status='disponible' WHERE id=$1",
                driver.driver_id,
            )
            await conn.execute(
                "DELETE FROM route_live_state WHERE route_id=$1", route_id,
            )
            subs_result = await conn.execute(
                "UPDATE passenger_route_subscriptions "
                "SET is_active=FALSE, expires_at=NOW() "
                "WHERE route_id=$1 AND is_active=TRUE",
                route_id,
            )
            subscriptions_cleared = int(subs_result.split()[-1])
            await conn.execute(
                "SELECT pg_notify($1, $2)",
                f"route:{route_id}",
                json.dumps({
                    "type":     "route_closed",
                    "route_id": route_id,
                    "message":  "Este servicio ha finalizado.",
                }),
            )

    return DeactivateRouteResponse(
        route_id=route_id,
        previous_status=previous_status,
        current_status=body.final_status,
        driver_status="disponible",
        passengers_notified=0,
        subscriptions_cleared=subscriptions_cleared,
        deactivated_by="admin" if driver.role == "admin" else "conductor",
        reason=body.reason,
        message="Ruta desactivada correctamente.",
    )


# ── Rutas del conductor ───────────────────────────────────────────────────────

@router.get("/conductor/routes")
async def get_my_routes(
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, route_name, status, base_fare,
                      estimated_duration_min, is_public, created_at
               FROM colectivo_routes
               WHERE driver_id = $1
               ORDER BY
                   CASE status
                       WHEN 'activa'    THEN 1
                       WHEN 'pausada'   THEN 2
                       WHEN 'archivada' THEN 3
                   END, created_at DESC""",
            driver.driver_id,
        )
    return [dict(r) for r in rows]


# ── Ubicación GPS del conductor ───────────────────────────────────────────────

@router.post("/conductor/location", status_code=200)
async def update_location(
    body:   LocationUpdate,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        # Siempre actualizar drivers_location
        await conn.execute(
            """INSERT INTO drivers_location (driver_id, lat, lng, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (driver_id) DO UPDATE
                   SET lat = EXCLUDED.lat,
                       lng = EXCLUDED.lng,
                       updated_at = NOW()""",
            driver.driver_id, body.lat, body.lng,
        )

        # Verificar si tiene ruta activa
        route = await conn.fetchrow(
            """SELECT rls.route_id, rls.next_waypoint_id,
                      rls.current_segment_seq, rls.passengers_aboard
               FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
            driver.driver_id,
        )

        if not route:
            return {"status": "no_active_route"}

        # Calcular ETA
        eta_sec = 0
        if body.speed_kmh > 3 and route["next_waypoint_id"]:
            dist = await conn.fetchval(
                """SELECT SQRT(
                       POWER((rw.latitude  - $1) * 111320, 2) +
                       POWER((rw.longitude - $2) * 111320 *
                             COS(RADIANS($1)), 2)
                   )
                   FROM route_waypoints rw WHERE rw.id = $3""",
                body.lat, body.lng, str(route["next_waypoint_id"]),
            )
            if dist:
                speed_ms = body.speed_kmh * 1000 / 3600
                eta_sec  = int(dist / speed_ms) if speed_ms > 0 else 0

        # Actualizar route_live_state
        await conn.execute(
            """UPDATE route_live_state
               SET current_lat       = $1,
                   current_lng       = $2,
                   speed_kmh         = $3,
                   heading           = $4,
                   eta_next_stop_sec = $5,
                   updated_at        = NOW()
               WHERE driver_id = $6""",
            body.lat, body.lng,
            int(body.speed_kmh), body.heading,
            eta_sec, driver.driver_id,
        )

        # Emitir NOTIFY
        route_id = str(route["route_id"])
        payload  = json.dumps({
            "type":              "position_update",
            "route_id":          route_id,
            "driver_id":         driver.driver_id,
            "lat":               body.lat,
            "lng":               body.lng,
            "heading":           body.heading,
            "speed_kmh":         body.speed_kmh,
            "eta_seconds":       eta_sec,
            "passengers_aboard": route["passengers_aboard"],
        })
        await conn.execute(
            f"SELECT pg_notify('route:{route_id}', $1)", payload,
        )

    return {"status": "ok", "eta_seconds": eta_sec}


# ── Endpoint público — rutas activas para pasajeros ───────────────────────────

@router.get("/public/active", tags=["public"])
async def get_active_routes_public(
    pool: Pool = Depends(get_pool),
) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT
                   cr.id          AS route_id,
                   cr.route_name,
                   cr.base_fare,
                   rls.current_lat AS lat,
                   rls.current_lng AS lng,
                   rls.heading,
                   rls.speed_kmh,
                   rls.passengers_aboard,
                   v.capacity,
                   v.capacity - rls.passengers_aboard AS seats_available,
                   COALESCE(rw.place_name, 'Proxima parada') AS next_stop,
                   rls.eta_next_stop_sec AS eta_seconds,
                   CASE
                       WHEN rls.updated_at > NOW() - INTERVAL '10s' THEN 'live'
                       WHEN rls.updated_at > NOW() - INTERVAL '30s' THEN 'stale'
                       ELSE 'offline'
                   END AS signal_status,
                   COALESCE(oz.name, 'Velez') AS province
               FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               JOIN drivers d ON d.id = rls.driver_id
               JOIN vehicles v ON v.driver_id = d.id AND v.is_active
               LEFT JOIN route_waypoints rw ON rw.id = rls.next_waypoint_id
               LEFT JOIN operational_zones oz
                   ON oz.zone_type = 'provincia'
                   AND rls.current_lat BETWEEN oz.min_lat AND oz.max_lat
                   AND rls.current_lng BETWEEN oz.min_lng AND oz.max_lng
               WHERE cr.status = 'activa'
                 AND rls.updated_at > NOW() - INTERVAL '2 minutes'
               ORDER BY oz.name, cr.route_name""",
        )
    return [dict(r) for r in rows]


# ── Endpoint público — waypoints con ETA para pasajeros ──────────────────────

@router.get("/public/{route_id}/waypoints", tags=["public"])
async def get_route_waypoints_public(
    route_id: str,
    pool: Pool = Depends(get_pool),
) -> list:
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            "SELECT id FROM colectivo_routes WHERE id=$1 AND status='activa'",
            route_id,
        )
        if not route:
            raise HTTPException(status_code=404,
                detail="Ruta no encontrada o inactiva")

        rows = await conn.fetch(
            """SELECT
                   rw.id,
                   rw.sequence_order,
                   rw.place_name,
                   rw.latitude,
                   rw.longitude,
                   rw.is_terminal,
                   rw.estimated_wait_min,
                   rls.current_lat   AS driver_lat,
                   rls.current_lng   AS driver_lng,
                   rls.speed_kmh,
                   rls.current_segment_seq,
                   ROUND((
                       SQRT(
                           POWER((rw.latitude  - rls.current_lat) * 111320, 2) +
                           POWER((rw.longitude - rls.current_lng) * 111320 *
                                 COS(RADIANS(rls.current_lat)), 2)
                       )
                   )::NUMERIC, 0) AS distance_m
               FROM route_waypoints rw
               JOIN route_live_state rls ON rls.route_id = rw.route_id
               WHERE rw.route_id = $1
               ORDER BY rw.sequence_order""",
            route_id,
        )

    result = []
    for r in rows:
        dist_m   = float(r["distance_m"] or 0)
        speed_ms = float(r["speed_kmh"] or 0) * 1000 / 3600
        eta_sec  = int(dist_m / speed_ms) if speed_ms > 2 else None
        eta_min  = round(eta_sec / 60, 1) if eta_sec else None
        result.append({
            "id":             str(r["id"]),
            "sequence_order": r["sequence_order"],
            "place_name":     r["place_name"],
            "latitude":       float(r["latitude"]),
            "longitude":      float(r["longitude"]),
            "is_terminal":    r["is_terminal"],
            "distance_m":     dist_m,
            "eta_seconds":    eta_sec,
            "eta_minutes":    eta_min,
            "already_passed": r["sequence_order"] < r["current_segment_seq"],
        })
    return result


# ── Horarios de ruta ──────────────────────────────────────────────────────────

@router.get("/{route_id}/schedules")
async def get_schedules(
    route_id: str,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, day_of_week, departure_time::TEXT,
                      arrival_time::TEXT, is_active
               FROM route_schedules WHERE route_id = $1
               ORDER BY
                   CASE day_of_week
                       WHEN 'lunes'     THEN 1
                       WHEN 'martes'    THEN 2
                       WHEN 'miercoles' THEN 3
                       WHEN 'jueves'    THEN 4
                       WHEN 'viernes'   THEN 5
                       WHEN 'sabado'    THEN 6
                       WHEN 'domingo'   THEN 7
                   END, departure_time""",
            route_id,
        )
    return [dict(r) for r in rows]


@router.post("/{route_id}/schedules", status_code=201)
async def add_schedule(
    route_id: str,
    body: ScheduleCreate,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            "SELECT id FROM colectivo_routes WHERE id=$1 AND driver_id=$2",
            route_id, driver.driver_id,
        )
        if not route:
            raise HTTPException(status_code=404, detail="Ruta no encontrada")
        row = await conn.fetchrow(
            """INSERT INTO route_schedules
               (route_id, day_of_week, departure_time, arrival_time, is_active)
               VALUES ($1,$2,$3::TIME,$4::TIME,$5)
               RETURNING id, day_of_week, departure_time::TEXT,
                         arrival_time::TEXT, is_active""",
            route_id, body.day_of_week, body.departure_time,
            body.arrival_time, body.is_active,
        )
    return dict(row)


@router.delete("/{route_id}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    route_id:    str,
    schedule_id: str,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> None:
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM route_schedules WHERE id=$1 AND route_id=$2",
            schedule_id, route_id,
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404,
                detail="Horario no encontrado")

class PassengerUpdate(BaseModel):
    action: str  # 'sube' o 'baja'

@router.patch("/conductor/passengers", status_code=200)
async def update_passengers(
    body:   PassengerUpdate,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            """SELECT rls.route_id, rls.passengers_aboard, v.capacity
               FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               JOIN vehicles v ON v.driver_id = rls.driver_id AND v.is_active
               WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
            driver.driver_id,
        )
        if not route:
            raise HTTPException(status_code=404,
                detail="No tienes una ruta activa")

        current  = route["passengers_aboard"]
        capacity = route["capacity"]

        if body.action == "sube":
            if current >= capacity:
                raise HTTPException(status_code=422,
                    detail=f"Vehículo lleno ({capacity}/{capacity})")
            new_count = current + 1
        elif body.action == "baja":
            if current <= 0:
                raise HTTPException(status_code=422,
                    detail="No hay pasajeros registrados")
            new_count = current - 1
        else:
            raise HTTPException(status_code=422,
                detail="Acción inválida. Usa 'sube' o 'baja'")

        await conn.execute(
            """UPDATE route_live_state
               SET passengers_aboard = $1, updated_at = NOW()
               WHERE driver_id = $2""",
            new_count, driver.driver_id,
        )

        # Notificar via WebSocket
        route_id = str(route["route_id"])
        payload  = json.dumps({
            "type":              "passengers_update",
            "route_id":          route_id,
            "passengers_aboard": new_count,
            "capacity":          capacity,
            "seats_available":   capacity - new_count,
        })
        await conn.execute(
            f"SELECT pg_notify('route:{route_id}', $1)", payload,
        )

    return {
        "passengers_aboard": new_count,
        "capacity":          capacity,
        "seats_available":   capacity - new_count,
    }

class MessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=140)

@router.post("/public/{route_id}/messages", status_code=201, tags=["public"])
async def send_message_to_driver(
    route_id: str,
    body: MessageCreate,
    pool: Pool = Depends(get_pool),
) -> dict:
    """Pasajero envía mensaje al conductor — sin autenticación."""
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            "SELECT id FROM colectivo_routes WHERE id=$1 AND status='activa'",
            route_id,
        )
        if not route:
            raise HTTPException(status_code=404,
                detail="Ruta no encontrada o inactiva")

        msg = await conn.fetchrow(
            """INSERT INTO route_messages (route_id, sender, message)
               VALUES ($1, 'pasajero', $2)
               RETURNING id, sender, message, created_at""",
            route_id, body.message,
        )

        # Notificar al conductor via WebSocket
        payload = json.dumps({
            "type":    "new_message",
            "route_id": route_id,
            "sender":  "pasajero",
            "message": body.message,
            "id":      str(msg["id"]),
        })
        await conn.execute(
            f"SELECT pg_notify('route:{route_id}', $1)", payload,
        )

    return {
        "id":         str(msg["id"]),
        "message":    msg["message"],
        "created_at": msg["created_at"].isoformat(),
    }


@router.get("/conductor/messages", tags=["conductor"])
async def get_my_messages(
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    """Conductor obtiene mensajes de su ruta activa."""
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            """SELECT rls.route_id FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
            driver.driver_id,
        )
        if not route:
            return []

        rows = await conn.fetch(
            """SELECT id, sender, message, created_at
               FROM route_messages
               WHERE route_id = $1
                 AND created_at > NOW() - INTERVAL '4 hours'
               ORDER BY created_at DESC
               LIMIT 20""",
            str(route["route_id"]),
        )
    return [dict(r) for r in rows]


@router.post("/conductor/messages/reply", status_code=201, tags=["conductor"])
async def reply_to_passengers(
    body:   MessageCreate,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    """Conductor responde a los pasajeros."""
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            """SELECT rls.route_id FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
            driver.driver_id,
        )
        if not route:
            raise HTTPException(status_code=404,
                detail="No tienes una ruta activa")

        route_id = str(route["route_id"])
        msg = await conn.fetchrow(
            """INSERT INTO route_messages (route_id, sender, message)
               VALUES ($1, 'conductor', $2)
               RETURNING id, sender, message, created_at""",
            route_id, body.message,
        )

        payload = json.dumps({
            "type":    "new_message",
            "route_id": route_id,
            "sender":  "conductor",
            "message": body.message,
            "id":      str(msg["id"]),
        })
        await conn.execute(
            f"SELECT pg_notify('route:{route_id}', $1)", payload,
        )

    return {
        "id":         str(msg["id"]),
        "message":    msg["message"],
        "created_at": msg["created_at"].isoformat(),
    }
    
@router.get("/public/{route_id}/messages", tags=["public"])
async def get_route_messages_public(
    route_id: str,
    pool: Pool = Depends(get_pool),
) -> list:
    """Pasajero obtiene mensajes de la ruta — sin autenticacion."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, sender, message, created_at
               FROM route_messages
               WHERE route_id = $1
                 AND created_at > NOW() - INTERVAL '4 hours'
               ORDER BY created_at ASC
               LIMIT 30""",
            route_id,
        )
    return [dict(r) for r in rows]

class ReservationCreate(BaseModel):
    passenger_name: str  = Field(default='Pasajero', max_length=60)
    seats:          int  = Field(default=1, ge=1, le=6)
    pickup_lat:     float | None = None
    pickup_lng:     float | None = None
    pickup_note:    str | None   = Field(default=None, max_length=140)


@router.post("/public/{route_id}/reservations", status_code=201, tags=["public"])
async def create_reservation(
    route_id: str,
    body: ReservationCreate,
    background_tasks: BackgroundTasks,        # ← agregar
    pool: Pool = Depends(get_pool),
) -> dict:
    async with pool.acquire() as conn:
        # ... código existente sin cambios ...

        # Al final, después del INSERT, agrega:
        driver_info = await conn.fetchrow(
            """SELECT u.full_name, u.phone, v.plate, v.capacity,
                      cr.route_name, cr.base_fare
               FROM colectivo_routes cr
               JOIN drivers d ON d.id = cr.driver_id
               JOIN users u ON u.id = d.user_id
               JOIN vehicles v ON v.driver_id = d.id AND v.is_active
               WHERE cr.id = $1""",
            route_id,
        )

    # Emitir webhook en segundo plano
    if driver_info:
        background_tasks.add_task(
            webhooks.emit_reserva_creada,
            reserva_id      = str(reservation["id"]),
            passenger_name  = body.passenger_name,
            seats           = body.seats,
            pickup_lat      = body.pickup_lat,
            pickup_lng      = body.pickup_lng,
            pickup_note     = body.pickup_note,
            route_id        = route_id,
            route_name      = driver_info["route_name"],
            base_fare       = float(driver_info["base_fare"]),
            driver_name     = driver_info["full_name"],
            driver_phone    = driver_info["phone"],
            plate           = driver_info["plate"],
            capacity        = driver_info["capacity"],
            seats_available = driver_info["capacity"] - route["passengers_aboard"] - body.seats,
        )

    return {
        "id":             str(reservation["id"]),
        "passenger_name": reservation["passenger_name"],
        "seats":          reservation["seats"],
        "status":         reservation["status"],
        "expires_at":     reservation["created_at"].isoformat(),
        "message":        f"Reserva confirmada para {body.seats} puesto(s). El conductor fue notificado.",
    }


@router.get("/conductor/reservations", tags=["conductor"])
async def get_my_reservations(
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    """Conductor ve las reservas de su ruta activa."""
    async with pool.acquire() as conn:
        route = await conn.fetchrow(
            """SELECT rls.route_id FROM route_live_state rls
               JOIN colectivo_routes cr ON cr.id = rls.route_id
               WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
            driver.driver_id,
        )
        if not route:
            return []

        rows = await conn.fetch(
            """SELECT id, passenger_name, seats, status,
                      pickup_lat, pickup_lng, pickup_note, created_at
               FROM seat_reservations
               WHERE route_id = $1
                 AND status IN ('pendiente','confirmada')
                 AND expires_at > NOW()
               ORDER BY created_at DESC""",
            str(route["route_id"]),
        )
    return [dict(r) for r in rows]


@router.patch("/conductor/reservations/{reservation_id}", tags=["conductor"])
async def update_reservation_status(
    reservation_id: str,
    body: dict,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    """Conductor confirma, rechaza o marca como abordado."""
    new_status = body.get("status")
    if new_status not in ("confirmada", "rechazada", "abordó"):
        raise HTTPException(status_code=422, detail="Estado invalido")

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """UPDATE seat_reservations SET status=$2
               WHERE id=$1 RETURNING id, passenger_name, seats, status""",
            reservation_id, new_status,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Reserva no encontrada")

    return dict(row)