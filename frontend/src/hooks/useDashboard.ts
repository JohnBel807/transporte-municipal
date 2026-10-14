/**
 * useDashboard.ts
 *
 * Hook que encapsula toda la lógica de polling del dashboard.
 *
 * TanStack Query gestiona automáticamente:
 *   - Polling cada 3 segundos (refetchInterval)
 *   - Pausa cuando la pestaña pierde el foco (refetchIntervalInBackground: false)
 *   - Caché: los datos anteriores se muestran mientras llegan los nuevos
 *   - Reintentos con backoff exponencial en caso de error de red
 *
 * El componente solo consume el hook — no conoce nada de fetch, polling
 * ni gestión de errores.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/apiClient'
import { DashboardSummary } from '../types/api'

const POLL_INTERVAL_MS = 3_000

async function fetchDashboard(): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>('/admin/dashboard')
  return data
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn:  fetchDashboard,

    // Polling cada 3s — se detiene si la pestaña no está visible
    refetchInterval:             POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,

    // No re-fetch al volver a enfocar la pestaña (el polling lo cubre)
    refetchOnWindowFocus: false,

    // Mostrar datos anteriores mientras llegan los nuevos (sin flash de loading)
    placeholderData: (prev) => prev,

    // Reintentar 2 veces antes de mostrar error
    retry: 2,
  })
}

// Hook separado para reportes (no hace polling — se piden bajo demanda)
export function useMobilityReport(date: string, province: string | null) {
  return useQuery({
    queryKey: ['mobility-report', date, province],
    queryFn:  async () => {
      const params = new URLSearchParams({ report_date: date })
      if (province) params.set('province', province)
      const { data } = await api.get(`/admin/reports/mobility?${params}`)
      return data
    },
    enabled: !!date,
    staleTime: 5 * 60 * 1000,  // 5 minutos — los reportes no cambian frecuente
  })
}
