import { useEffect, useRef, useCallback } from 'react'
import { api } from '../services/apiClient'

interface TrackingOptions {
  enabled:       boolean    // true cuando hay ruta activa
  intervalMs?:   number     // default 4000ms
  onError?:      (msg: string) => void
}

export function useGPSTracking({
  enabled,
  intervalMs = 4000,
  onError,
}: TrackingOptions) {
  const watchIdRef   = useRef<number | null>(null)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastPosition = useRef<GeolocationPosition | null>(null)

  const sendPosition = useCallback(async (pos: GeolocationPosition) => {
    try {
      await api.post('/conductor/location', {
        lat:       pos.coords.latitude,
        lng:       pos.coords.longitude,
        speed_kmh: pos.coords.speed
          ? pos.coords.speed * 3.6   // m/s → km/h
          : 0,
        heading:   pos.coords.heading ?? 0,
      })
    } catch (err) {
      // Fallo silencioso — el conductor no debe ver errores de red
      // en medio del servicio
      console.warn('GPS send failed:', err)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Limpiar al desactivar la ruta
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    if (!navigator.geolocation) {
      onError?.('Tu dispositivo no soporta GPS')
      return
    }

    // Escuchar cambios de posición continuamente
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => { lastPosition.current = pos },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          onError?.('Debes permitir el acceso a la ubicación para el tracking')
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge:         2000,
        timeout:            5000,
      },
    )

    // Enviar al backend cada intervalMs
    intervalRef.current = setInterval(() => {
      if (lastPosition.current) {
        sendPosition(lastPosition.current)
      }
    }, intervalMs)

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [enabled, intervalMs, sendPosition, onError])
}