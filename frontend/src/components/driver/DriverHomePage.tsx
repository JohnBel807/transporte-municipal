import { useState, useRef, useEffect } from 'react'
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

interface Message {
  id:         string
  sender:     string
  message:    string
  created_at: string
}

interface Reservation {
  id:             string
  passenger_name: string
  seats:          number
  status:         string
  pickup_lat:     number | null
  pickup_lng:     number | null
  pickup_note:    string | null
  created_at:     string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  activa:    { label: 'Activa',    color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  pausada:   { label: 'Pausada',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  archivada: { label: 'Archivada', color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
}

const QUICK_REPLIES = [
  'Ok, los espero 🤝',
  'Voy en camino 🚌',
  'Ya llegue 📍',
  'Lleno por ahora 🙏',
]

export function DriverHomePage() {
  const navigate         = useNavigate()
  const { user, logout } = useAuthStore()
  const queryClient      = useQueryClient()

  const [deactivatingId,  setDeactivatingId]  = useState<string | null>(null)
  const [gpsError,        setGpsError]        = useState<string | null>(null)
  const [activatingId,    setActivatingId]    = useState<string | null>(null)
  const [localPassengers, setLocalPassengers] = useState<number | null>(null)
  const [replyText,       setReplyText]       = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [taxiMode, setTaxiMode] = useState(false)
  const [activeTaxiTrip, setActiveTaxiTrip] = useState<string | null>(null)

  const { data: routes = [], isLoading, error } = useQuery<Route[]>({
    queryKey: ['driver-routes'],
    queryFn:  async () => {
      const { data } = await api.get('/routes/conductor/routes')
      return data
    },
    refetchInterval: 30_000,
    retry: false,
  })

  const activeRoute = routes.find(r => r.status === 'activa')

  useGPSTracking({
    enabled:    !!activeRoute,
    intervalMs: 4000,
    onError:    setGpsError,
  })

  useEffect(() => {
    if (!navigator.geolocation) return
    const sendLocation = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.post('/routes/conductor/location', {
              lat: pos.coords.latitude, lng: pos.coords.longitude,
              speed_kmh: 0, heading: 0,
            })
          } catch {}
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
    sendLocation()
    const interval = setInterval(sendLocation, 60_000)
    return () => clearInterval(interval)
  }, [])

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['conductor-messages'],
    queryFn:  async () => {
      const { data } = await api.get('/routes/conductor/messages')
      return data
    },
    enabled:         !!activeRoute,
    refetchInterval: activeRoute ? 5_000 : false,
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const { data: reservations = [] } = useQuery<Reservation[]>({
    queryKey: ['conductor-reservations'],
    queryFn:  async () => {
      const { data } = await api.get('/routes/conductor/reservations')
      return data
    },
    enabled:         !!activeRoute,
    refetchInterval: activeRoute ? 8_000 : false,
  })

    // Query estado modo taxi
  const { data: driverStatus } = useQuery({
    queryKey: ['driver-taxi-mode'],
    queryFn: async () => {
      const { data } = await api.get('/taxi/conductor/trips')
      return data
    },
    retry: false,
  })

  // Mutation toggle modo taxi
  const taxiModeMutation = useMutation({
    mutationFn: (taxi_mode: boolean) =>
      api.patch('/taxi/conductor/mode', { taxi_mode }),
    onSuccess: (_, taxi_mode) => {
      queryClient.invalidateQueries({ queryKey: ['driver-taxi-mode'] })
      setTaxiMode(taxi_mode)
    },
    onError: (err: any) => {
      alert(err?.response?.data?.detail ?? 'Error al cambiar modo')
    },
  })

  const reservationMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/routes/conductor/reservations/${id}`, { status }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['conductor-reservations'] }),
  })

  const activateMutation = useMutation({
    mutationFn: (routeId: string) => {
      setActivatingId(routeId)
      return api.patch(`/routes/${routeId}/activate`)
    },
    onSuccess: () => {
      setActivatingId(null)
      setLocalPassengers(0)
      setGpsError(null)
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
    },
    onError: (err: any) => {
      setActivatingId(null)
      alert(err?.response?.data?.detail?.message
        ?? err?.response?.data?.detail
        ?? 'Error al activar')
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: ({ routeId, reason }: { routeId: string; reason: string }) =>
      api.patch(`/routes/${routeId}/deactivate`, { reason, final_status: 'pausada' }),
    onSuccess: () => {
      setDeactivatingId(null)
      setGpsError(null)
      setLocalPassengers(null)
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
      queryClient.invalidateQueries({ queryKey: ['conductor-messages'] })
      queryClient.invalidateQueries({ queryKey: ['conductor-reservations'] })
    },
  })

  const handlePassenger = async (action: 'sube' | 'baja') => {
    const current = localPassengers ?? 0
    if (action === 'sube') setLocalPassengers(current + 1)
    if (action === 'baja' && current > 0) setLocalPassengers(current - 1)
    try {
      const { data } = await api.patch('/routes/conductor/passengers', { action })
      setLocalPassengers(data.passengers_aboard)
    } catch (err: any) {
      setLocalPassengers(current)
      alert(err?.response?.data?.detail ?? 'Error al actualizar pasajeros')
    }
  }

  const replyMutation = useMutation({
    mutationFn: (message: string) =>
      api.post('/routes/conductor/messages/reply', { message }),
    onSuccess: () => {
      setReplyText('')
      queryClient.invalidateQueries({ queryKey: ['conductor-messages'] })
    },
  })

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

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

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl
                          px-4 py-3 text-xs text-red-400">
            Error al cargar rutas. Verifica tu conexion.
          </div>
        )}

        {activeRoute && (
          <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-4">

            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-teal-400 font-medium uppercase tracking-wider mb-0.5">
                  Ruta en curso
                </p>
                <p className="text-base font-semibold text-white">
                  {activeRoute.route_name}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-teal-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
                Activa
              </span>
            </div>

            {gpsError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg
                              px-3 py-2 text-xs text-red-400 mb-3">
                ⚠️ {gpsError}
              </div>
            )}
            {!gpsError && (
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
                Enviando ubicacion cada 4 segundos
              </div>
            )}

            {/* Contador de pasajeros */}
            <div className="bg-slate-800/50 rounded-xl p-4 mb-3">
              <p className="text-xs text-slate-400 text-center mb-3 uppercase
                            tracking-wider font-medium">
                Pasajeros a bordo
              </p>
              <div className="flex items-center justify-center gap-6">
                <button
                  disabled={(localPassengers ?? 0) <= 0}
                  onClick={() => handlePassenger('baja')}
                  className="w-14 h-14 rounded-full bg-slate-700 border border-slate-600
                             text-white text-2xl font-bold hover:bg-red-500/20
                             hover:border-red-500/50 disabled:opacity-30 active:scale-95
                             transition flex items-center justify-center"
                >−</button>
                <div className="text-center">
                  <p className="text-5xl font-bold text-white leading-none">
                    {localPassengers ?? 0}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">pasajeros</p>
                </div>
                <button
                  onClick={() => handlePassenger('sube')}
                  className="w-14 h-14 rounded-full bg-slate-700 border border-slate-600
                             text-white text-2xl font-bold hover:bg-teal-500/20
                             hover:border-teal-500/50 active:scale-95
                             transition flex items-center justify-center"
                >+</button>
              </div>
            </div>

            {/* Panel de reservas */}
            <div className="bg-slate-800/50 rounded-xl p-4 mb-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider
                            font-medium mb-3 flex items-center gap-2">
                🎫 Reservas de puestos
                {reservations.length > 0 && (
                  <span className="bg-amber-500 text-slate-950 text-xs font-bold
                                   px-1.5 py-0.5 rounded-full">
                    {reservations.length}
                  </span>
                )}
              </p>
              {reservations.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-2">
                  Sin reservas activas
                </p>
              ) : (
                <div className="space-y-2">
                  {reservations.map((r: Reservation) => (
                    <div key={r.id} className="bg-slate-700 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="text-xs font-semibold text-white">
                            {r.passenger_name} · {r.seats} puesto{r.seats > 1 ? 's' : ''}
                          </p>
                          {r.pickup_note && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              📍 {r.pickup_note}
                            </p>
                          )}
                          {r.pickup_lat && r.pickup_lng && (
                            <a href={`https://maps.google.com/?q=${r.pickup_lat},${r.pickup_lng}`}
                               target="_blank" rel="noreferrer"
                               className="text-xs text-teal-400 underline">
                              Ver ubicacion en mapa
                            </a>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-lg border
                          ${r.status === 'confirmada'
                            ? 'text-teal-400 bg-teal-400/10 border-teal-400/30'
                            : 'text-amber-400 bg-amber-400/10 border-amber-400/30'}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {r.status === 'pendiente' && (
                          <>
                            <button
                              onClick={() => reservationMutation.mutate({ id: r.id, status: 'confirmada' })}
                              disabled={reservationMutation.isPending}
                              className="flex-1 py-1.5 text-xs text-teal-400 font-medium
                                         border border-teal-500/30 rounded-lg
                                         hover:bg-teal-500/10 disabled:opacity-40 transition">
                              Confirmar
                            </button>
                            <button
                              onClick={() => reservationMutation.mutate({ id: r.id, status: 'rechazada' })}
                              disabled={reservationMutation.isPending}
                              className="flex-1 py-1.5 text-xs text-red-400
                                         border border-red-500/30 rounded-lg
                                         hover:bg-red-500/10 disabled:opacity-40 transition">
                              Rechazar
                            </button>
                          </>
                        )}
                        {r.status === 'confirmada' && (
                          <button
                            onClick={() => reservationMutation.mutate({ id: r.id, status: 'abordó' })}
                            disabled={reservationMutation.isPending}
                            className="w-full py-1.5 text-xs text-white font-medium
                                       bg-teal-500 rounded-lg hover:bg-teal-400
                                       disabled:opacity-40 transition">
                            Marcar como abordado ✓
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Panel de mensajes */}
            <div className="bg-slate-800/50 rounded-xl p-4 mb-3">
              <p className="text-xs text-slate-400 uppercase tracking-wider
                            font-medium mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
                Mensajes de pasajeros
                {messages.length > 0 && (
                  <span className="bg-teal-500 text-slate-950 text-xs font-bold
                                   px-1.5 py-0.5 rounded-full">
                    {messages.length}
                  </span>
                )}
              </p>
              {messages.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-2">Sin mensajes aun</p>
              ) : (
                <div className="space-y-2 max-h-36 overflow-y-auto mb-3">
                  {messages.map((msg: Message) => (
                    <div key={msg.id}
                         className={`rounded-lg px-3 py-2 text-xs
                           ${msg.sender === 'conductor'
                             ? 'bg-teal-500/10 border border-teal-500/20 text-teal-300 ml-4'
                             : 'bg-slate-700 text-slate-200'}`}>
                      <span className="font-medium">
                        {msg.sender === 'conductor' ? 'Tu' : '👤 Pasajero'}:
                      </span>{' '}
                      {msg.message}
                    </div>
                  ))}
                  <div ref={messagesEndRef}/>
                </div>
              )}
              <div className="flex gap-1.5 flex-wrap mb-2">
                {QUICK_REPLIES.map(reply => (
                  <button key={reply}
                    onClick={() => replyMutation.mutate(reply)}
                    disabled={replyMutation.isPending}
                    className="text-xs px-2 py-1 bg-slate-700 border border-slate-600
                               rounded-lg text-slate-300 hover:text-teal-400
                               hover:border-teal-500/50 disabled:opacity-40 transition">
                    {reply}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg
                             px-3 py-1.5 text-xs text-white placeholder-slate-500
                             focus:outline-none focus:ring-1 focus:ring-teal-500"
                  placeholder="Escribe una respuesta..."
                  value={replyText}
                  maxLength={140}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && replyText.trim())
                      replyMutation.mutate(replyText.trim())
                  }}
                />
                <button
                  disabled={!replyText.trim() || replyMutation.isPending}
                  onClick={() => replyMutation.mutate(replyText.trim())}
                  className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400
                             disabled:opacity-40 text-slate-950 font-semibold
                             rounded-lg text-xs transition">
                  Enviar
                </button>
              </div>
            </div>

            {/* Boton finalizar */}
            {deactivatingId === activeRoute.id ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Confirmar fin de servicio?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeactivatingId(null)}
                    className="flex-1 py-2 text-sm border border-slate-700
                               rounded-lg text-slate-400 hover:bg-slate-800 transition">
                    Cancelar
                  </button>
                  <button
                    disabled={deactivateMutation.isPending}
                    onClick={() => deactivateMutation.mutate({
                      routeId: activeRoute.id, reason: 'Fin de turno',
                    })}
                    className="flex-1 py-2 text-sm bg-red-500/20 border border-red-500/40
                               rounded-lg text-red-400 font-medium hover:bg-red-500/30
                               disabled:opacity-50 transition">
                    {deactivateMutation.isPending ? 'Finalizando...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setDeactivatingId(activeRoute.id)}
                className="w-full py-2.5 text-sm bg-red-500/15 border border-red-500/30
                           rounded-xl text-red-400 font-medium hover:bg-red-500/25 transition">
                Finalizar servicio
              </button>
            )}
          </div>
        )}

        {!activeRoute && (
          <button
            onClick={() => navigate('/driver/routes/new')}
            className="w-full py-3 border border-teal-500/30 rounded-xl
                       text-sm text-teal-400 font-medium hover:bg-teal-500/10 transition">
            + Crear nueva ruta
          </button>
        )}
                {/* Toggle modo taxi */}
        {!activeRoute && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-white">Modo de servicio</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {taxiMode
                    ? 'Apareces en el mapa de solicitudes de taxi'
                    : 'Activa para recibir solicitudes de taxi'}
                </p>
              </div>
              <button
                disabled={taxiModeMutation.isPending}
                onClick={() => taxiModeMutation.mutate(!taxiMode)}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200
                  ${taxiMode ? 'bg-teal-500' : 'bg-slate-700'}
                  disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                  transition-transform duration-200
                  ${taxiMode ? 'translate-x-6' : 'translate-x-0.5'}`}/>
              </button>
            </div>

            {/* Modo taxi activo */}
            {taxiMode && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                <div className="flex items-center gap-2 text-xs text-teal-400 mb-3">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
                  Disponible para viajes — GPS activo
                </div>

                {/* Viaje activo */}
                {activeTaxiTrip ? (
                  <TaxiTripPanel
                    tripId={activeTaxiTrip}
                    onComplete={() => {
                      setActiveTaxiTrip(null)
                      queryClient.invalidateQueries({ queryKey: ['driver-taxi-mode'] })
                    }}
                  />
                ) : (
                  <TaxiPendingRequests
                    onAccept={(tripId) => setActiveTaxiTrip(tripId)}
                  />
                )}
              </div>
            )}
          </div>
        )}
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">
            Mis rutas
          </p>
          {isLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-24 bg-slate-800 animate-pulse rounded-xl"/>
              ))}
            </div>
          )}
          {!isLoading && routes.length === 0 && (
            <div className="text-center py-12 text-slate-600 text-sm">
              No tienes rutas creadas aun
            </div>
          )}
          <div className="space-y-3">
            {routes.map(route => {
              const st = STATUS_LABEL[route.status] ?? STATUS_LABEL.pausada
              return (
                <div key={route.id}
                     className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {route.route_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        ${route.base_fare.toLocaleString()} · {route.estimated_duration_min} min
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-lg
                                     border ml-2 shrink-0 ${st.color}`}>
                      {st.label}
                    </span>
                  </div>
                  {route.status === 'pausada' && !activeRoute && (
                    <button
                      disabled={activatingId !== null}
                      onClick={() => activateMutation.mutate(route.id)}
                      className="w-full py-2 text-sm bg-teal-500 hover:bg-teal-400
                                 disabled:opacity-50 text-slate-950 font-semibold
                                 rounded-lg transition">
                      {activatingId === route.id ? 'Activando...' : 'Iniciar servicio'}
                    </button>
                  )}
                  {route.status === 'pausada' && activeRoute && (
                    <p className="text-xs text-slate-600 text-center">
                      Finaliza la ruta activa primero
                    </p>
                  )}
                  {route.status === 'archivada' && (
                    <p className="text-xs text-slate-600 text-center">Ruta archivada</p>
                  )}
                  <button
                    onClick={() => navigate(`/driver/routes/${route.id}/schedules`)}
                    className="w-full py-2 text-xs text-slate-400 border border-slate-700
                               rounded-lg hover:bg-slate-800 hover:text-teal-400
                               transition mt-2">
                    🕐 Gestionar horarios
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}