import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'
import { useAuthStore } from '../../store/authStore'
import { useGPSTracking } from '../../hooks/useGPSTracking'

interface Route {
  id:                     string
  route_name:             string
  status:                 string
  base_fare:              number
  estimated_duration_min: number
  is_public:              boolean
  created_at:             string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  activa:    { label: 'Activa',    color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  pausada:   { label: 'Pausada',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  archivada: { label: 'Archivada', color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
}

export function DriverHomePage() {
  const navigate    = useNavigate()
  const { user, logout } = useAuthStore()
  const queryClient = useQueryClient()

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [gpsError, setGpsError]             = useState<string | null>(null)

  const { data: routes = [], isLoading } = useQuery<Route[]>({
    queryKey: ['driver-routes'],
    queryFn:  async () => {
      const { data } = await api.get('/conductor/routes')
      return data
    },
    refetchInterval: 10_000,
  })

  const activeRoute = routes.find(r => r.status === 'activa')

  // Tracking GPS — arranca automáticamente cuando hay ruta activa
  useGPSTracking({
    enabled:    !!activeRoute,
    intervalMs: 4000,
    onError:    setGpsError,
  })

  const activateMutation = useMutation({
    mutationFn: (routeId: string) =>
      api.patch(`/routes/${routeId}/activate`),
    onSuccess: () => {
      setGpsError(null)
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
    },
    onError: (err: any) =>
      alert(err?.response?.data?.detail?.message
        ?? err?.response?.data?.detail
        ?? 'Error al activar'),
  })

  const deactivateMutation = useMutation({
    mutationFn: ({ routeId, reason }: { routeId: string; reason: string }) =>
      api.patch(`/routes/${routeId}/deactivate`, {
        reason, final_status: 'pausada',
      }),
    onSuccess: () => {
      setDeactivatingId(null)
      setGpsError(null)
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
    },
  })

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-slate-800 px-4 py-4
                         flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-500/15 border border-teal-500/30
                          rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-teal-400" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0
                   00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0
                   01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3
                   0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0
                   1.129-.504 1.09-1.124a17.902 17.902 0
                   00-3.213-9.193 2.056 2.056 0
                   00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958
                   c0-.568-.422-1.048-.987-1.106a48.554 48.554 0
                   00-10.026 0 1.106 1.106 0 00-.987
                   1.106v7.635m12-6.677v6.677m0
                   4.5v-4.5m0 0h-12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {user?.fullName ?? 'Conductor'}
            </p>
            <p className="text-xs text-slate-500">
              {activeRoute ? '🟢 En servicio' : '⚪ Disponible'}
            </p>
          </div>
        </div>
        <button
          onClick={() => { logout(); navigate('/login') }}
          className="text-sm text-slate-500 hover:text-red-400
                     transition px-3 py-1.5 rounded-lg hover:bg-slate-800"
        >
          Salir
        </button>
      </header>

      {/* Contenido */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">

        {/* Banner ruta activa */}
        {activeRoute && (
          <div className="bg-teal-500/10 border border-teal-500/30
                          rounded-xl p-4">

            {/* Título y estado */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-teal-400 font-medium uppercase
                              tracking-wider mb-0.5">
                  Ruta en curso
                </p>
                <p className="text-base font-semibold text-white">
                  {activeRoute.route_name}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs
                               text-teal-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-teal-400
                                 animate-pulse"/>
                Activa
              </span>
            </div>

            {/* Error de GPS */}
            {gpsError && (
              <div className="bg-red-500/10 border border-red-500/20
                              rounded-lg px-3 py-2 text-xs text-red-400 mb-3">
                ⚠️ {gpsError}
              </div>
            )}

            {/* Indicador GPS activo */}
            {!gpsError && (
              <div className="flex items-center gap-2 text-xs
                              text-slate-400 mb-3">
                <span className="w-2 h-2 rounded-full bg-teal-400
                                 animate-pulse"/>
                Enviando ubicación cada 4 segundos
              </div>
            )}

            {/* Botón finalizar */}
            {deactivatingId === activeRoute.id ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  ¿Confirmar fin de servicio?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeactivatingId(null)}
                    className="flex-1 py-2 text-sm border border-slate-700
                               rounded-lg text-slate-400
                               hover:bg-slate-800 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    disabled={deactivateMutation.isPending}
                    onClick={() => deactivateMutation.mutate({
                      routeId: activeRoute.id,
                      reason:  'Fin de turno',
                    })}
                    className="flex-1 py-2 text-sm bg-red-500/20
                               border border-red-500/40 rounded-lg
                               text-red-400 font-medium
                               hover:bg-red-500/30 disabled:opacity-50
                               transition"
                  >
                    {deactivateMutation.isPending
                      ? 'Finalizando…' : 'Confirmar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setDeactivatingId(activeRoute.id)}
                className="w-full py-2.5 text-sm bg-red-500/15
                           border border-red-500/30 rounded-xl
                           text-red-400 font-medium
                           hover:bg-red-500/25 transition"
              >
                Finalizar servicio
              </button>
            )}
          </div>
        )}

        {/* Botón nueva ruta */}
        {!activeRoute && (
          <button
            onClick={() => navigate('/driver/routes/new')}
            className="w-full py-3 border border-teal-500/30 rounded-xl
                       text-sm text-teal-400 font-medium
                       hover:bg-teal-500/10 transition"
          >
            + Crear nueva ruta
          </button>
        )}

        {/* Lista de rutas */}
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase
                        tracking-wider mb-3">
            Mis rutas
          </p>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i}
                     className="h-24 bg-slate-800 animate-pulse rounded-xl"/>
              ))}
            </div>
          )}

          {!isLoading && routes.length === 0 && (
            <div className="text-center py-12 text-slate-600 text-sm">
              No tienes rutas creadas aún
            </div>
          )}

          <div className="space-y-3">
            {routes.map(route => {
              const st       = STATUS_LABEL[route.status] ?? STATUS_LABEL.pausada
              const isActive = route.status === 'activa'

              return (
                <div key={route.id}
                     className="bg-slate-900 border border-slate-800
                                rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {route.route_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        ${route.base_fare.toLocaleString()} ·{' '}
                        {route.estimated_duration_min} min
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1
                                     rounded-lg border ml-2 shrink-0
                                     ${st.color}`}>
                      {st.label}
                    </span>
                  </div>

                  {route.status === 'pausada' && !activeRoute && (
                    <button
                      disabled={activateMutation.isPending}
                      onClick={() => activateMutation.mutate(route.id)}
                      className="w-full py-2 text-sm bg-teal-500
                                 hover:bg-teal-400 disabled:opacity-50
                                 text-slate-950 font-semibold
                                 rounded-lg transition"
                    >
                      {activateMutation.isPending
                        ? 'Activando…' : 'Iniciar servicio'}
                    </button>
                  )}

                  {route.status === 'pausada' && activeRoute && (
                    <p className="text-xs text-slate-600 text-center">
                      Finaliza la ruta activa primero
                    </p>
                  )}

                  {route.status === 'archivada' && (
                    <p className="text-xs text-slate-600 text-center">
                      Ruta archivada
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}