import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from asyncpg import Pool
import asyncpg
from app.core.database import get_pool
from app.core.dependencies import get_current_driver, DriverContext
from app.models.routes import (
    RouteCreate, RouteCreateResponse, WaypointResponse,
    ActivateRouteResponse, RouteStatus,
    DeactivateRouteRequest, DeactivateRouteResponse,
)
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)
router = APIRouter(prefix="/routes", tags=["routes"])


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
                       (driver_id, route_name, description, base_fare, estimated_duration_min, status, is_public)
                       VALUES ($1,$2,$3,$4,$5,'pausada',$6)
                       RETURNING id, route_name, status, is_public""",
                    driver.driver_id, payload.route_name, payload.description,
                    payload.base_fare, payload.estimated_duration_min, payload.is_public,
                )
                route_id = str(route_row["id"])
                waypoint_data = sorted(payload.waypoints, key=lambda x: x.sequence_order)
                waypoint_rows = await conn.fetch(
                    """INSERT INTO route_waypoints
                       (route_id, sequence_order, place_name, latitude, longitude, is_terminal, estimated_wait_min)
                       SELECT d.rid, d.seq, d.name, d.lat, d.lng, d.terminal, d.wait
                       FROM UNNEST($1::uuid[],$2::int[],$3::text[],$4::float[],$5::float[],$6::bool[],$7::int[])
                       AS d(rid, seq, name, lat, lng, terminal, wait)
                       RETURNING id, sequence_order, place_name, latitude, longitude, is_terminal, estimated_wait_min""",
                    [route_id]*len(waypoint_data),
                    [w.sequence_order for w in waypoint_data],
                    [w.place_name for w in waypoint_data],
                    [w.latitude for w in waypoint_data],
                    [w.longitude for w in waypoint_data],
                    [w.is_terminal for w in waypoint_data],
                    [w.estimated_wait_min for w in waypoint_data],
                )
                await conn.execute("SELECT rebuild_route_corridor($1, $2)", route_id, payload.tolerance_m)
                corridor_exists = await conn.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM route_corridors WHERE route_id = $1)", route_id
                )
                if not corridor_exists:
                    raise RuntimeError("rebuild_route_corridor falló")

        return RouteCreateResponse(
            route_id=route_id,
            route_name=route_row["route_name"],
            status=route_row["status"],
            is_public=route_row["is_public"],
            waypoints=[WaypointResponse(
                id=str(r["id"]), sequence_order=r["sequence_order"],
                place_name=r["place_name"], latitude=float(r["latitude"]),
                longitude=float(r["longitude"]), is_terminal=r["is_terminal"],
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


@router.patch("/{route_id}/activate", response_model=ActivateRouteResponse)
async def activate_route_endpoint(
    route_id: str,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> ActivateRouteResponse:
    async with pool.acquire() as conn:
        async with conn.transaction():
            route = await conn.fetchrow(
                """SELECT cr.id, cr.driver_id, cr.status, cr.route_name,
                          COUNT(rw.id) AS waypoint_count,
                          EXISTS(SELECT 1 FROM route_corridors rc WHERE rc.route_id = cr.id) AS has_corridor
                   FROM colectivo_routes cr
                   LEFT JOIN route_waypoints rw ON rw.route_id = cr.id
                   WHERE cr.id = $1 GROUP BY cr.id""",
                route_id,
            )
            if not route:
                raise HTTPException(status_code=404, detail="Ruta no encontrada")
            if str(route["driver_id"]) != driver.driver_id:
                raise HTTPException(status_code=403, detail="No tienes permiso para activar esta ruta")
            if route["status"] == "activa":
                raise HTTPException(status_code=422, detail="La ruta ya está activa")
            if route["waypoint_count"] < 2:
                raise HTTPException(status_code=422, detail="La ruta necesita al menos 2 paradas")
            if not route["has_corridor"]:
                raise HTTPException(status_code=422, detail="El corredor geográfico no está construido")

            driver_location = await conn.fetchrow(
                """SELECT lat, lng,
                          EXTRACT(EPOCH FROM (NOW() - updated_at)) AS age_seconds
                   FROM drivers_location WHERE driver_id = $1""",
                driver.driver_id,
            )
            if not driver_location:
                raise HTTPException(status_code=422, detail="No se encontró tu ubicación GPS")
            if driver_location["age_seconds"] > 300:
                raise HTTPException(status_code=422, detail=f"Tu ubicación GPS tiene {int(driver_location['age_seconds'])}s de antigüedad")

            zone = await conn.fetchrow(
                """SELECT oz.name FROM operational_zones oz
                WHERE oz.zone_type = 'provincia' AND oz.is_active = TRUE
                    AND $1 BETWEEN oz.min_lat AND oz.max_lat
                    AND $2 BETWEEN oz.min_lng AND oz.max_lng
                LIMIT 1""",
                driver_location["lat"], driver_location["lng"],
            )
            if not zone:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "Tu ubicación está fuera de las zonas operativas",
                        "driver_lat": float(driver_location["lat"]),
                        "driver_lng": float(driver_location["lng"]),
                        "hint": "Debes estar dentro de Vélez o Ricaurte",
                    },
                )

            activated = await conn.fetchrow(
                "UPDATE colectivo_routes SET status='activa', is_public=TRUE, updated_at=NOW() WHERE id=$1 RETURNING updated_at",
                route_id,
            )
            await conn.execute(
                """INSERT INTO route_live_state 
                   (route_id, driver_id, current_lat, current_lng, current_segment_seq, heading, speed_kmh, next_waypoint_id, eta_next_stop_sec, passengers_aboard)
                   SELECT $1,$2,$3,$4,0,0,0,rw.id,0,0
                   FROM route_waypoints rw WHERE rw.route_id=$1 ORDER BY rw.sequence_order LIMIT 1
                   ON CONFLICT (route_id) DO UPDATE 
                   SET driver_id   = EXCLUDED.driver_id,
                       current_lat = EXCLUDED.current_lat,
                       current_lng = EXCLUDED.current_lng,
                       updated_at  = NOW()""",
                route_id, driver.driver_id, driver_location["lat"], driver_location["lng"],
            )

    return ActivateRouteResponse(
        route_id=route_id,
        status=RouteStatus.ACTIVE,
        activated_at=activated["updated_at"].isoformat(),
        driver_location={"lat": float(driver_location["lat"]), "lng": float(driver_location["lng"])},
        zone_confirmed=zone["name"],
        message=f"Ruta activada en {zone['name']}. Los pasajeros pueden ver tu recorrido.",
    )


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
                "SELECT id, driver_id, status FROM colectivo_routes WHERE id=$1 FOR UPDATE", route_id
            )
            if not route:
                raise HTTPException(status_code=404, detail="Ruta no encontrada")
            is_owner = str(route["driver_id"]) == driver.driver_id
            is_admin = driver.role == "admin"
            if not is_owner and not is_admin:
                raise HTTPException(status_code=403, detail="Solo el dueño o admin puede desactivar")
            if route["status"] in ("pausada", "archivada"):
                raise HTTPException(status_code=409, detail=f"La ruta ya está en estado '{route['status']}'")

            previous_status = route["status"]
            await conn.execute(
                "UPDATE colectivo_routes SET status=$2, is_public=FALSE, updated_at=NOW() WHERE id=$1",
                route_id, body.final_status,
            )
            await conn.execute("UPDATE drivers SET status='disponible' WHERE id=$1", driver.driver_id)
            await conn.execute("DELETE FROM route_live_state WHERE route_id=$1", route_id)
            subs_result = await conn.execute(
                "UPDATE passenger_route_subscriptions SET is_active=FALSE, expires_at=NOW() WHERE route_id=$1 AND is_active=TRUE",
                route_id,
            )
            subscriptions_cleared = int(subs_result.split()[-1])

            await conn.execute(
                "SELECT pg_notify($1, $2)",
                f"route:{route_id}",
                json.dumps({"type": "route_closed", "route_id": route_id,
                            "message": "Este servicio ha finalizado."}),
            )

    return DeactivateRouteResponse(
        route_id=route_id, previous_status=previous_status,
        current_status=body.final_status, driver_status="disponible",
        passengers_notified=0, subscriptions_cleared=subscriptions_cleared,
        deactivated_by="admin" if driver.role == "admin" else "conductor",
        reason=body.reason, message="Ruta desactivada correctamente.",
    )

@router.get("/conductor/routes")
async def get_my_routes(
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, route_name, status, base_fare,
                   estimated_duration_min, is_public, created_at
            FROM   colectivo_routes
            WHERE  driver_id = $1
            ORDER BY
                CASE status
                    WHEN 'activa'    THEN 1
                    WHEN 'pausada'   THEN 2
                    WHEN 'archivada' THEN 3
                END,
                created_at DESC
            """,
            driver.driver_id,
        )
    return [dict(r) for r in rows]

class LocationUpdate(BaseModel):
    lat:       float = Field(ge=-90,  le=90)
    lng:       float = Field(ge=-180, le=180)
    speed_kmh: float = Field(ge=0, default=0)
    heading:   int   = Field(ge=0, le=359, default=0)

@router.post("/conductor/location", status_code=200)
async def update_location(
    body:   LocationUpdate,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        # Verificar que tiene una ruta activa
        route = await conn.fetchrow(
            """
            SELECT rls.route_id, rls.next_waypoint_id,
                   rls.current_segment_seq, rls.passengers_aboard
            FROM   route_live_state rls
            JOIN   colectivo_routes cr ON cr.id = rls.route_id
            WHERE  rls.driver_id = $1
              AND  cr.status     = 'activa'
            """,
            driver.driver_id,
        )

        if not route:
            return {"status": "no_active_route"}

        # Calcular ETA simple basado en velocidad actual
        eta_sec = 0
        if body.speed_kmh > 3 and route["next_waypoint_id"]:
            dist = await conn.fetchval(
                """
                SELECT SQRT(
                    POWER((rw.latitude  - $1) * 111320, 2) +
                    POWER((rw.longitude - $2) * 111320 *
                          COS(RADIANS($1)), 2)
                )
                FROM route_waypoints rw
                WHERE rw.id = $3
                """,
                body.lat, body.lng, str(route["next_waypoint_id"]),
            )
            if dist:
                speed_ms = body.speed_kmh * 1000 / 3600
                eta_sec  = int(dist / speed_ms) if speed_ms > 0 else 0

        # Actualizar posición en live state
        await conn.execute(
            """
            UPDATE route_live_state
               SET current_lat       = $1,
                   current_lng       = $2,
                   speed_kmh         = $3,
                   heading           = $4,
                   eta_next_stop_sec = $5,
                   updated_at        = NOW()
             WHERE driver_id = $6
            """,
            body.lat, body.lng,
            int(body.speed_kmh), body.heading,
            eta_sec, driver.driver_id,
        )
        
        # Actualizar drivers_location
        await conn.execute(
            """INSERT INTO drivers_location (driver_id, lat, lng, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (driver_id) DO UPDATE
                   SET lat = EXCLUDED.lat,
                       lng = EXCLUDED.lng,
                       updated_at = NOW()
            """,
            driver.driver_id, body.lat, body.lng,
        )

        # Emitir NOTIFY manualmente
        route_id = str(route["route_id"])
        payload = json.dumps({
            "type":             "position_update",
            "route_id":         route_id,
            "driver_id":        driver.driver_id,
            "lat":              body.lat,
            "lng":              body.lng,
            "heading":          body.heading,
            "speed_kmh":        body.speed_kmh,
            "eta_seconds":      eta_sec,
            "eta_confidence":   "alta" if body.speed_kmh > 3 else "estimada",
            "passengers_aboard": route["passengers_aboard"],
            "updated_at":       "now",
        })
        await conn.execute(
            f"SELECT pg_notify('route:{route_id}', $1)",
            payload,
        )

    return {"status": "ok", "eta_seconds": eta_sec}