"""
webhooks.py — Envío asíncrono de eventos a n8n vía HTTP POST.

Todas las funciones son fire-and-forget: se llaman desde BackgroundTasks
de FastAPI para no bloquear la respuesta al cliente. Un fallo de red
hacia n8n nunca afecta la operación principal de la API.
"""

import logging
from datetime import datetime, timezone

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(10.0)  # 10 segundos máximo por intento


async def _post(url: str, payload: dict, evento: str) -> None:
    """Envía el payload JSON a la URL indicada. Silencia cualquier error."""
    if not url:
        log.debug("Webhook %s no configurado — omitiendo", evento)
        return
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            log.info("Webhook %s enviado → %s %s", evento, resp.status_code, url)
    except httpx.TimeoutException:
        log.warning("Webhook %s: timeout al conectar con n8n (%s)", evento, url)
    except httpx.HTTPStatusError as exc:
        log.warning("Webhook %s: n8n respondio %s — %s",
                    evento, exc.response.status_code, url)
    except Exception as exc:
        log.warning("Webhook %s: error inesperado — %s", evento, exc)


# ── Evento 1: reserva_creada ──────────────────────────────────────────────────

async def emit_reserva_creada(
    *,
    reserva_id:     str,
    passenger_name: str,
    seats:          int,
    pickup_lat:     float | None,
    pickup_lng:     float | None,
    pickup_note:    str | None,
    route_id:       str,
    route_name:     str,
    base_fare:      float,
    driver_name:    str,
    driver_phone:   str,
    plate:          str,
    capacity:       int,
    seats_available: int,
) -> None:
    payload = {
        "evento":    "reserva_creada",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reserva": {
            "id":     reserva_id,
            "estado": "pendiente",
            "puestos": seats,
        },
        "pasajero": {
            "nombre":        passenger_name,
            "nota_recogida": pickup_note,
            "ubicacion_lat": pickup_lat,
            "ubicacion_lng": pickup_lng,
        },
        "ruta": {
            "id":     route_id,
            "nombre": route_name,
            "tarifa_base": base_fare,
        },
        "conductor": {
            "nombre":   driver_name,
            "telefono": driver_phone,
        },
        "vehiculo": {
            "placa":              plate,
            "capacidad":          capacity,
            "puestos_disponibles": seats_available,
        },
    }
    await _post(
        settings.n8n_webhook_reserva_creada,
        payload,
        "reserva_creada",
    )


# ── Evento 2: ruta_activada ───────────────────────────────────────────────────

async def emit_ruta_activada(
    *,
    route_id:    str,
    route_name:  str,
    base_fare:   float,
    driver_id:   str,
    driver_name: str,
    driver_phone: str,
    avg_rating:  float,
    plate:       str,
    brand:       str,
    model:       str,
    capacity:    int,
    vehicle_type: str,
    lat:         float,
    lng:         float,
    zone_name:   str,
    next_stop:   str,
) -> None:
    payload = {
        "evento":    "ruta_activada",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ruta": {
            "id":                   route_id,
            "nombre":               route_name,
            "tarifa_base":          base_fare,
            "es_publica":           True,
        },
        "conductor": {
            "id":                   driver_id,
            "nombre":               driver_name,
            "telefono":             driver_phone,
            "calificacion_promedio": avg_rating,
        },
        "vehiculo": {
            "placa":     plate,
            "marca":     brand,
            "modelo":    model,
            "capacidad": capacity,
            "tipo":      vehicle_type,
        },
        "ubicacion_inicial": {
            "lat":  lat,
            "lng":  lng,
            "zona": zone_name,
        },
        "proxima_parada": {
            "nombre":       next_stop,
            "eta_segundos": 0,
        },
    }
    await _post(
        settings.n8n_webhook_ruta_activada,
        payload,
        "ruta_activada",
    )


# ── Evento 3: conductor_registrado ────────────────────────────────────────────

async def emit_conductor_registrado(
    *,
    driver_id:    str,
    full_name:    str,
    email:        str,
    phone:        str,
    driver_type:  str,
    zone_name:    str,
    plate:        str,
    brand:        str,
    model:        str,
    year:         int,
    capacity:     int,
    color:        str,
    password_temp: str,
) -> None:
    payload = {
        "evento":    "conductor_registrado",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "conductor": {
            "id":           driver_id,
            "nombre_completo": full_name,
            "email":        email,
            "telefono":     phone,
            "tipo":         driver_type,
            "zona":         zone_name,
            "verificado":   False,
        },
        "vehiculo": {
            "placa":     plate,
            "marca":     brand,
            "modelo":    model,
            "año":       year,
            "capacidad": capacity,
            "color":     color,
        },
        "acceso": {
            "url_app":          "https://admin.velezyricaurte.com",
            "email":            email,
            "password_temporal": password_temp,
            "instrucciones":    (
                "Ingresa a la URL con tu email y contraseña. "
                "En el menú del navegador toca 'Agregar a pantalla de inicio' "
                "para instalar la app."
            ),
        },
    }
    await _post(
        settings.n8n_webhook_conductor_registrado,
        payload,
        "conductor_registrado",
    )