"""
taxi_routes.py — Módulo de viajes particulares (taxi)
"""
import json
import logging
from datetime import datetime, timezone
from math import radians, sin, cos, sqrt, atan2

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from asyncpg import Pool
from pydantic import BaseModel, Field

from app.core.database import get_pool
from app.core.dependencies import get_current_driver, DriverContext

log = logging.getLogger(__name__)
router = APIRouter(prefix="/taxi", tags=["taxi"])


# ── Modelos ───────────────────────────────────────────────────────────────────

class TripRequest(BaseModel):
    origin_lat:      float  = Field(ge=-90, le=90)
    origin_lng:      float  = Field(ge=-180, le=180)
    origin_address:  str    = Field(default="", max_length=200)
    dest_lat:        float  = Field(ge=-90, le=90)
    dest_lng:        float  = Field(ge=-180, le=180)
    dest_address:    str    = Field(default="", max_length=200)
    passenger_name:  str    = Field(default="Pasajero", max_length=60)
    passenger_phone: str    = Field(default="", max_length=20)
    has_luggage:     bool   = False
    has_ac:          bool   = False


class TaxiModeUpdate(BaseModel):
    taxi_mode: bool


class TripStatusUpdate(BaseModel):
    road_type: str = Field(default="pavimentada",
        pattern="^(pavimentada|destapada|trocha)$")


class TripLocation(BaseModel):
    lat:       float = Field(ge=-90, le=90)
    lng:       float = Field(ge=-180, le=180)
    speed_kmh: int   = Field(ge=0, default=0)


class TripRating(BaseModel):
    rating: int = Field(ge=1, le=5)
    role:   str = Field(pattern="^(passenger|driver)$")


# ── Utilidades ────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en km entre dos puntos GPS."""
    R = 6371
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)**2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def is_night_time() -> bool:
    hour = datetime.now(timezone.utc).hour
    # UTC-5 Colombia: 8pm-5am local = 1am-10am UTC
    return hour >= 1 and hour < 10


async def get_fare_config(conn, zone_slug: str = "velez") -> dict:
    row = await conn.fetchrow(
        "SELECT * FROM fare_config WHERE zone_slug=$1 AND is_active=TRUE LIMIT 1",
        zone_slug,
    )
    if not row:
        raise HTTPException(status_code=500, detail="Configuracion de tarifa no encontrada")
    return dict(row)


def calculate_fare(
    km: float,
    minutes: int,
    road_type: str,
    is_night: bool,
    is_holiday: bool,
    has_luggage: bool,
    has_ac: bool,
    config: dict,
) -> dict:
    road_factor = {
        "pavimentada": 1.0,
        "destapada":   1.5,
        "trocha":      2.0,
    }.get(road_type, 1.0)

    fare_base = float(config["base_fare"])
    fare_km   = km * float(config["price_per_km_paved"]) * road_factor
    fare_time = minutes * float(config["price_per_minute"])
    subtotal  = fare_base + fare_km + fare_time

    surcharge_pct = 0.0
    if is_night:   surcharge_pct += float(config["surcharge_night"])
    if is_holiday: surcharge_pct += float(config["surcharge_holiday"])
    fare_pct = subtotal * surcharge_pct

    fare_fixed = 0.0
    if has_luggage: fare_fixed += float(config["surcharge_luggage"])
    if has_ac:      fare_fixed += float(config["surcharge_ac"])

    fare_surcharges = fare_pct + fare_fixed
    fare_total = max(subtotal + fare_surcharges, float(config["min_fare_urban"]))

    return {
        "fare_base":       round(fare_base),
        "fare_km":         round(fare_km),
        "fare_time":       round(fare_time),
        "fare_surcharges": round(fare_surcharges),
        "fare_total":      round(fare_total),
        "road_factor":     road_factor,
        "km":              round(km, 2),
        "minutes":         minutes,
    }


# ── Toggle modo taxi ──────────────────────────────────────────────────────────

@router.patch("/conductor/mode")
async def set_taxi_mode(
    body:   TaxiModeUpdate,
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> dict:
    """Conductor activa o desactiva modo taxi."""
    async with pool.acquire() as conn:
        # No puede estar en modo taxi si tiene ruta de colectivo activa
        if body.taxi_mode:
            active_colectivo = await conn.fetchval(
                """SELECT COUNT(*) FROM route_live_state rls
                   JOIN colectivo_routes cr ON cr.id = rls.route_id
                   WHERE rls.driver_id = $1 AND cr.status = 'activa'""",
                driver.driver_id,
            )
            if active_colectivo > 0:
                raise HTTPException(status_code=422,
                    detail="Finaliza tu ruta de colectivo antes de activar modo taxi")

        await conn.execute(
            """UPDATE drivers
               SET taxi_mode = $2, taxi_available = $2
               WHERE id = $1""",
            driver.driver_id, body.taxi_mode,
        )

    return {
        "driver_id":      driver.driver_id,
        "taxi_mode":      body.taxi_mode,
        "taxi_available": body.taxi_mode,
        "message":        "Modo taxi activado" if body.taxi_mode else "Modo taxi desactivado",
    }


# ── Conductores disponibles cerca ─────────────────────────────────────────────

@router.get("/drivers/nearby")
async def get_nearby_drivers(
    lat:       float = 5.877,
    lng:       float = -73.669,
    radius_km: float = 5.0,
    pool: Pool = Depends(get_pool),
) -> list:
    """Conductores en modo taxi disponibles cerca del pasajero."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT
                   d.id AS driver_id,
                   u.full_name,
                   d.avg_rating,
                   v.plate, v.brand, v.model, v.vehicle_type, v.capacity,
                   dl.lat, dl.lng,
                   SQRT(
                       POWER((dl.lat - $1) * 111320, 2) +
                       POWER((dl.lng - $2) * 111320 * COS(RADIANS($1)), 2)
                   ) / 1000 AS distance_km,
                   EXTRACT(EPOCH FROM (NOW() - dl.updated_at)) AS signal_age_sec
               FROM drivers d
               JOIN users u ON u.id = d.user_id
               JOIN vehicles v ON v.driver_id = d.id AND v.is_active
               JOIN drivers_location dl ON dl.driver_id = d.id
               WHERE d.taxi_mode = TRUE
                 AND d.taxi_available = TRUE
                 AND d.is_verified = TRUE
                 AND u.is_active = TRUE
                 AND dl.updated_at > NOW() - INTERVAL '5 minutes'
                 AND SQRT(
                     POWER((dl.lat - $1) * 111320, 2) +
                     POWER((dl.lng - $2) * 111320 * COS(RADIANS($1)), 2)
                 ) / 1000 <= $3
               ORDER BY distance_km
               LIMIT 10""",
            lat, lng, radius_km,
        )

    result = []
    for r in rows:
        dist = float(r["distance_km"])
        speed_kmh = 30  # velocidad promedio estimada
        eta_min   = round((dist / speed_kmh) * 60)
        result.append({
            "driver_id":    str(r["driver_id"]),
            "full_name":    r["full_name"],
            "avg_rating":   float(r["avg_rating"] or 0),
            "plate":        r["plate"],
            "brand":        r["brand"],
            "model":        r["model"],
            "vehicle_type": r["vehicle_type"],
            "distance_km":  round(dist, 2),
            "eta_min":      eta_min,
            "signal_age_sec": int(r["signal_age_sec"]),
        })
    return result


# ── Solicitar viaje ───────────────────────────────────────────────────────────

@router.post("/request", status_code=201)
async def request_trip(
    body: TripRequest,
    pool: Pool = Depends(get_pool),
) -> dict:
    """Pasajero solicita un viaje particular."""
    night = is_night_time()

    async with pool.acquire() as conn:
        config = await get_fare_config(conn)

        # Estimar distancia y tarifa
        dist_km = haversine_km(
            body.origin_lat, body.origin_lng,
            body.dest_lat, body.dest_lng,
        )
        speed_kmh = 30
        est_min   = round((dist_km / speed_kmh) * 60)

        est_fare = calculate_fare(
            km=dist_km, minutes=est_min,
            road_type="pavimentada",
            is_night=night,
            is_holiday=False,
            has_luggage=body.has_luggage,
            has_ac=body.has_ac,
            config=config,
        )

        # Zona
        zone_id = await conn.fetchval(
            """SELECT id FROM zones
               WHERE $1 BETWEEN bbox_min_lat AND bbox_max_lat
                 AND $2 BETWEEN bbox_min_lng AND bbox_max_lng
               LIMIT 1""",
            body.origin_lat, body.origin_lng,
        )

        trip_id = await conn.fetchval(
            """INSERT INTO particular_trips
               (origin_lat, origin_lng, origin_address,
                dest_lat, dest_lng, dest_address,
                passenger_name, passenger_phone,
                is_night, has_luggage, has_ac, zone_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
               RETURNING id""",
            body.origin_lat, body.origin_lng, body.origin_address,
            body.dest_lat, body.dest_lng, body.dest_address,
            body.passenger_name, body.passenger_phone,
            night, body.has_luggage, body.has_ac, zone_id,
        )
        
        # Notificar a conductores disponibles via pg_notify
        await conn.execute(
            "SELECT pg_notify('taxi:new_request', $1)",
            json.dumps({
                "type":           "new_taxi_request",
                "trip_id":        str(trip_id),
                "passenger_name": body.passenger_name,
                "origin_address": body.origin_address,
                "dest_address":   body.dest_address,
                "estimated_fare": est_fare["fare_total"],
                "lat":            body.origin_lat,  # 👈 CORREGIDO
                "lng":            body.origin_lng,  # 👈 CORREGIDO
            }),
        )

    return {
        "trip_id":        str(trip_id),
        "status":         "solicitado",
        "estimated_fare": est_fare,
        "is_night":       night,
        "message":        "Viaje solicitado. Buscando conductor disponible.",
    }


# ── Conductor acepta viaje ────────────────────────────────────────────────────

@router.patch("/trips/{trip_id}/accept")
async def accept_trip(
    trip_id: str,
    pool:    Pool          = Depends(get_pool),
    driver:  DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            "SELECT id, status, passenger_name FROM particular_trips WHERE id=$1",
            trip_id,
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")
        if trip["status"] != "solicitado":
            raise HTTPException(status_code=422,
                detail=f"El viaje ya esta en estado '{trip['status']}'")

        vehicle = await conn.fetchval(
            "SELECT id FROM vehicles WHERE driver_id=$1 AND is_active=TRUE LIMIT 1",
            driver.driver_id,
        )
        if not vehicle:
            raise HTTPException(status_code=422, detail="No tienes vehiculo activo")

        await conn.execute(
            """UPDATE particular_trips
               SET status='aceptado', driver_id=$2, vehicle_id=$3,
                   accepted_at=NOW()
               WHERE id=$1""",
            trip_id, driver.driver_id, str(vehicle),
        )
        await conn.execute(
            "UPDATE drivers SET taxi_available=FALSE WHERE id=$1",
            driver.driver_id,
        )

    return {
        "trip_id":        trip_id,
        "status":         "aceptado",
        "passenger_name": trip["passenger_name"],
        "message":        "Viaje aceptado. Dirígete al punto de recogida.",
    }


# ── Conductor llegó al punto de recogida ──────────────────────────────────────

@router.patch("/trips/{trip_id}/arrived")
async def arrived_at_pickup(
    trip_id: str,
    pool:    Pool          = Depends(get_pool),
    driver:  DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            "SELECT id, status, passenger_name FROM particular_trips "
            "WHERE id=$1 AND driver_id=$2",
            trip_id, driver.driver_id,
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")
        if trip["status"] != "aceptado":
            raise HTTPException(status_code=422, detail="Estado invalido")

        await conn.execute(
            "UPDATE particular_trips SET status='esperando', arrived_at=NOW() WHERE id=$1",
            trip_id,
        )

    return {
        "trip_id": trip_id,
        "status":  "esperando",
        "message": "Llegaste al punto de recogida. Esperando al pasajero.",
    }


# ── Pasajero abordó — inicia taxímetro ───────────────────────────────────────

@router.patch("/trips/{trip_id}/board")
async def board_trip(
    trip_id: str,
    body:    TripStatusUpdate,
    pool:    Pool          = Depends(get_pool),
    driver:  DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            "SELECT id, status, is_night, has_luggage, has_ac, passenger_name "
            "FROM particular_trips WHERE id=$1 AND driver_id=$2",
            trip_id, driver.driver_id,
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")
        if trip["status"] not in ("aceptado", "esperando"):
            raise HTTPException(status_code=422, detail="Estado invalido")

        await conn.execute(
            """UPDATE particular_trips
               SET status='en_curso', road_type=$2, boarded_at=NOW()
               WHERE id=$1""",
            trip_id, body.road_type,
        )

    return {
        "trip_id":   trip_id,
        "status":    "en_curso",
        "road_type": body.road_type,
        "message":   "Taximetro iniciado. La tarifa corre desde ahora.",
    }


# ── Actualizar ubicación durante el viaje ────────────────────────────────────

@router.post("/trips/{trip_id}/location")
async def update_trip_location(
    trip_id: str,
    body:    TripLocation,
    pool:    Pool          = Depends(get_pool),
    driver:  DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            """SELECT id, status, boarded_at, origin_lat, origin_lng,
                      road_type, is_night, is_holiday, has_luggage, has_ac
               FROM particular_trips
               WHERE id=$1 AND driver_id=$2 AND status='en_curso'""",
            trip_id, driver.driver_id,
        )
        if not trip:
            raise HTTPException(status_code=404,
                detail="Viaje no encontrado o no en curso")

        # Guardar punto GPS
        await conn.execute(
            """INSERT INTO trip_gps_trace (trip_id, lat, lng, speed_kmh)
               VALUES ($1,$2,$3,$4)""",
            trip_id, body.lat, body.lng, body.speed_kmh,
        )

        # Calcular km recorridos desde el origen
        km = haversine_km(
            trip["origin_lat"], trip["origin_lng"],
            body.lat, body.lng,
        )

        # Calcular minutos transcurridos desde que abordó
        boarded = trip["boarded_at"]
        now     = datetime.now(timezone.utc)
        minutes = int((now - boarded).total_seconds() / 60)

        config = await get_fare_config(conn)
        fare   = calculate_fare(
            km=km, minutes=minutes,
            road_type=trip["road_type"],
            is_night=trip["is_night"],
            is_holiday=trip["is_holiday"],
            has_luggage=trip["has_luggage"],
            has_ac=trip["has_ac"],
            config=config,
        )

        # Actualizar ubicación del conductor
        await conn.execute(
            """INSERT INTO drivers_location (driver_id, lat, lng, updated_at)
               VALUES ($1,$2,$3,NOW())
               ON CONFLICT (driver_id) DO UPDATE
                   SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, updated_at=NOW()""",
            driver.driver_id, body.lat, body.lng,
        )

    return {
        "trip_id":       trip_id,
        "km_recorridos": fare["km"],
        "minutes":       fare["minutes"],
        "fare_current":  fare["fare_total"],
        "fare_breakdown": fare,
    }


# ── Finalizar viaje ───────────────────────────────────────────────────────────

@router.patch("/trips/{trip_id}/complete")
async def complete_trip(
    trip_id: str,
    pool:    Pool          = Depends(get_pool),
    driver:  DriverContext = Depends(get_current_driver),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            """SELECT id, status, boarded_at, origin_lat, origin_lng,
                      road_type, is_night, is_holiday, has_luggage, has_ac
               FROM particular_trips
               WHERE id=$1 AND driver_id=$2 AND status='en_curso'""",
            trip_id, driver.driver_id,
        )
        if not trip:
            raise HTTPException(status_code=404,
                detail="Viaje no encontrado o no en curso")

        # Calcular distancia total con traza GPS
        trace = await conn.fetch(
            "SELECT lat, lng FROM trip_gps_trace WHERE trip_id=$1 ORDER BY recorded_at",
            trip_id,
        )

        km_total = 0.0
        for i in range(1, len(trace)):
            km_total += haversine_km(
                trace[i-1]["lat"], trace[i-1]["lng"],
                trace[i]["lat"],   trace[i]["lng"],
            )

        # Si no hay traza suficiente, usar haversine directo
        if km_total < 0.1:
            last = await conn.fetchrow(
                "SELECT lat, lng FROM drivers_location WHERE driver_id=$1",
                driver.driver_id,
            )
            if last:
                km_total = haversine_km(
                    trip["origin_lat"], trip["origin_lng"],
                    last["lat"], last["lng"],
                )

        boarded = trip["boarded_at"]
        now     = datetime.now(timezone.utc)
        minutes = int((now - boarded).total_seconds() / 60)

        config = await get_fare_config(conn)
        fare   = calculate_fare(
            km=km_total, minutes=minutes,
            road_type=trip["road_type"],
            is_night=trip["is_night"],
            is_holiday=trip["is_holiday"],
            has_luggage=trip["has_luggage"],
            has_ac=trip["has_ac"],
            config=config,
        )

        await conn.execute(
            """UPDATE particular_trips
               SET status='completado', completed_at=NOW(),
                   km_recorridos=$2, minutes_elapsed=$3,
                   fare_base=$4, fare_km=$5, fare_time=$6,
                   fare_surcharges=$7, fare_total=$8
               WHERE id=$1""",
            trip_id, fare["km"], fare["minutes"],
            fare["fare_base"], fare["fare_km"], fare["fare_time"],
            fare["fare_surcharges"], fare["fare_total"],
        )

        # Conductor vuelve a estar disponible
        await conn.execute(
            "UPDATE drivers SET taxi_available=TRUE WHERE id=$1",
            driver.driver_id,
        )

        # Actualizar total de viajes del conductor
        await conn.execute(
            "UPDATE drivers SET total_trips = total_trips + 1 WHERE id=$1",
            driver.driver_id,
        )

    return {
        "trip_id":       trip_id,
        "status":        "completado",
        "km_recorridos": fare["km"],
        "minutes":       fare["minutes"],
        "fare_breakdown": fare,
        "fare_total":    fare["fare_total"],
        "payment_method": "efectivo",
        "message":       f"Viaje completado. Total: ${fare['fare_total']:,.0f} COP",
    }


# ── Cancelar viaje ────────────────────────────────────────────────────────────

@router.patch("/trips/{trip_id}/cancel")
async def cancel_trip(
    trip_id: str,
    body:    dict,
    pool:    Pool = Depends(get_pool),
) -> dict:
    reason = body.get("reason", "Cancelado")
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            "SELECT id, status, driver_id FROM particular_trips WHERE id=$1",
            trip_id,
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")
        if trip["status"] in ("completado", "cancelado"):
            raise HTTPException(status_code=422, detail="El viaje ya finalizo")

        await conn.execute(
            """UPDATE particular_trips
               SET status='cancelado', cancelled_at=NOW(), cancel_reason=$2
               WHERE id=$1""",
            trip_id, reason,
        )

        # Liberar al conductor si estaba asignado
        if trip["driver_id"]:
            await conn.execute(
                "UPDATE drivers SET taxi_available=TRUE WHERE id=$1",
                trip["driver_id"],
            )

    return {
        "trip_id": trip_id,
        "status":  "cancelado",
        "reason":  reason,
    }


# ── Estado del viaje en tiempo real ──────────────────────────────────────────

@router.get("/trips/{trip_id}/status")
async def get_trip_status(
    trip_id: str,
    pool:    Pool = Depends(get_pool),
) -> dict:
    async with pool.acquire() as conn:
        trip = await conn.fetchrow(
            """SELECT pt.id, pt.status, pt.passenger_name,
                      pt.origin_lat, pt.origin_lng,
                      pt.dest_lat, pt.dest_lng,
                      pt.road_type, pt.is_night,
                      pt.boarded_at, pt.fare_total,
                      pt.km_recorridos, pt.minutes_elapsed,
                      pt.fare_base, pt.fare_km, pt.fare_time,
                      pt.fare_surcharges,
                      u.full_name AS driver_name,
                      v.plate, v.brand, v.model, v.vehicle_type,
                      dl.lat AS driver_lat, dl.lng AS driver_lng
               FROM particular_trips pt
               LEFT JOIN drivers d ON d.id = pt.driver_id
               LEFT JOIN users u ON u.id = d.user_id
               LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active
               LEFT JOIN drivers_location dl ON dl.driver_id = d.id
               WHERE pt.id = $1""",
            trip_id,
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Viaje no encontrado")

        fare_current = None
        if trip["status"] == "en_curso" and trip["boarded_at"]:
            config  = await get_fare_config(conn)
            km_now  = 0.0
            if trip["driver_lat"] and trip["driver_lng"]:
                km_now = haversine_km(
                    trip["origin_lat"], trip["origin_lng"],
                    trip["driver_lat"], trip["driver_lng"],
                )
            boarded = trip["boarded_at"]
            now     = datetime.now(timezone.utc)
            min_now = int((now - boarded).total_seconds() / 60)
            fare_current = calculate_fare(
                km=km_now, minutes=min_now,
                road_type=trip["road_type"] or "pavimentada",
                is_night=trip["is_night"],
                is_holiday=False,
                has_luggage=False,
                has_ac=False,
                config=config,
            )

    return {
        "trip_id":        trip_id,
        "status":         trip["status"],
        "passenger_name": trip["passenger_name"],
        # 🟢 INTEGRADAS: Coordenadas de origen del pasajero para la navegación GPS del conductor
        "origin_lat":     float(trip["origin_lat"]) if trip["origin_lat"] is not None else None,
        "origin_lng":     float(trip["origin_lng"]) if trip["origin_lng"] is not None else None,
        "driver": {
            "name":         trip["driver_name"],
            "plate":        trip["plate"],
            "brand":        trip["brand"],
            "model":        trip["model"],
            "vehicle_type": trip["vehicle_type"],
            "lat":          trip["driver_lat"],
            "lng":          trip["driver_lng"],
        } if trip["driver_name"] else None,
        "fare_current":  fare_current,
        "fare_total":    float(trip["fare_total"]) if trip["fare_total"] else None,
    }


# ── Historial de viajes del conductor ────────────────────────────────────────

@router.get("/conductor/trips")
async def get_driver_trips(
    pool:   Pool          = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, status, passenger_name,
                      origin_address, dest_address,
                      road_type, km_recorridos, minutes_elapsed,
                      fare_total, payment_method, payment_status,
                      requested_at, completed_at
               FROM particular_trips
               WHERE driver_id = $1
               ORDER BY requested_at DESC
               LIMIT 50""",
            driver.driver_id,
        )
    return [dict(r) for r in rows]

@router.get("/requests/pending")
async def get_pending_requests(
    lat: float = 5.877,
    lng: float = -73.669,
    pool: Pool = Depends(get_pool),
    driver: DriverContext = Depends(get_current_driver),
) -> list:
    """Conductor obtiene solicitudes de taxi pendientes cercanas."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT
                   pt.id AS trip_id,
                   pt.passenger_name,
                   pt.origin_lat, pt.origin_lng,
                   pt.origin_address, pt.dest_address,
                   pt.dest_lat, pt.dest_lng,
                   pt.is_night, pt.has_luggage, pt.has_ac,
                   SQRT(
                       POWER((pt.origin_lat - $1) * 111320, 2) +
                       POWER((pt.origin_lng - $2) * 111320 * COS(RADIANS($1)), 2)
                   ) / 1000 AS distance_km
               FROM particular_trips pt
               WHERE pt.status = 'solicitado'
                 AND pt.requested_at > NOW() - INTERVAL '10 minutes'
                 AND SQRT(
                     POWER((pt.origin_lat - $1) * 111320, 2) +
                     POWER((pt.origin_lng - $2) * 111320 * COS(RADIANS($1)), 2)
                 ) / 1000 <= 10
               ORDER BY distance_km
               LIMIT 5""",
            lat, lng,
        )

        result = []
        config = await get_fare_config(conn)
        for r in rows:
            dist = haversine_km(
                r["origin_lat"], r["origin_lng"],
                r["dest_lat"] or r["origin_lat"],
                r["dest_lng"] or r["origin_lng"],
            )
            est_min  = round((dist / 30) * 60)
            est_fare = calculate_fare(
                km=dist, minutes=est_min,
                road_type="pavimentada",
                is_night=r["is_night"],
                is_holiday=False,
                has_luggage=r["has_luggage"],
                has_ac=r["has_ac"],
                config=config,
            )
            result.append({
                **dict(r),
                "estimated_fare": est_fare,
            })
    return result