import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useAuthStore } from '../../store/authStore'

const API = import.meta.env.VITE_API_URL ?? 'https://api.velezyricaurte.com'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ActiveRoute {
  route_id:         string
  route_name:       string
  base_fare:        number
  lat:              number
  lng:              number
  heading:          number
  speed_kmh:        number
  passengers_aboard: number
  capacity:         number
  seats_available:  number
  next_stop:        string
  eta_seconds:      number
  signal_status:    string
  province:         string
}

interface Waypoint {
  id:             string
  sequence_order: number
  place_name:     string
  latitude:       number
  longitude:      number
  is_terminal:    boolean
  distance_m:     number
  eta_minutes:    number | null
  already_passed: boolean
}

interface NearbyDriver {
  driver_id:    string
  full_name:    string
  avg_rating:   number
  plate:        string
  brand:        string
  model:        string
  vehicle_type: string
  distance_km:  number
  eta_min:      number
}

interface TaxiTrip {
  trip_id:        string
  status:         string
  estimated_fare?: { fare_total: number; km: number; minutes: number }
}

// ── Iconos Leaflet ────────────────────────────────────────────────────────────

function makeColectivoIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="background:#1e293b;border:1px solid ${color};color:${color};
                  font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;
                  white-space:nowrap;box-shadow:0 2px 8px #0006;
                  max-width:120px;overflow:hidden;text-overflow:ellipsis">${label}</div>
      <div style="width:10px;height:10px;background:${color};border:2px solid #0f172a;
                  border-radius:50%;box-shadow:0 0 0 3px ${color}44"></div>
    </div>`,
    iconSize:  [120, 32],
    iconAnchor:[60, 32],
  })
}

function makeTaxiIcon(name: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="background:#1e293b;border:1px solid #fbbf24;color:#fbbf24;
                  font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;
                  white-space:nowrap">🚕 ${name.split(' ')[0]}</div>
      <div style="width:10px;height:10px;background:#fbbf24;border:2px solid #0f172a;
                  border-radius:50%;box-shadow:0 0 0 3px #fbbf2444"></div>
    </div>`,
    iconSize:  [80, 30],
    iconAnchor:[40, 30],
  })
}

function makePassengerIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:#6366f1;
                         border:2px solid #0f172a;border-radius:50%;
                         box-shadow:0 0 0 4px #6366f133"></div>`,
    iconSize:  [14, 14],
    iconAnchor:[7, 7],
  })
}

// ── Componente principal ──────────────────────────────────────────────────────

export function PassengerPage() {
  const navigate    = useNavigate()
  const { isAuthenticated, user } = useAuthStore()

  const [tab, setTab]             = useState<'colectivos' | 'taxi'>('colectivos')
  const [routes, setRoutes]       = useState<ActiveRoute[]>([])
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [watching, setWatching]   = useState<Record<string, boolean>>({})
  const [notified, setNotified]   = useState<Set<string>>(new Set())
  const [messages, setMessages]   = useState<any[]>([])
  const [msgInput, setMsgInput]   = useState('')
  const [statusBadge, setStatusBadge] = useState('Cargando...')

  // Taxi
  const [taxiStep, setTaxiStep]         = useState<'form' | 'searching' | 'trip'>('form')
  const [taxiOrigin, setTaxiOrigin]     = useState('')
  const [taxiDest, setTaxiDest]         = useState('')
  const [taxiName, setTaxiName]         = useState('')
  const [taxiPhone, setTaxiPhone]       = useState('')
  const [taxiLuggage, setTaxiLuggage]   = useState(false)
  const [taxiAC, setTaxiAC]             = useState(false)
  const [activeTripId, setActiveTripId] = useState<string | null>(null)
  const [tripStatus, setTripStatus]     = useState<any>(null)
  const [fareEstimate, setFareEstimate] = useState<any>(null)
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([])
  const [passengerPos, setPassengerPos] = useState<[number,number] | null>(null)
  const [locating, setLocating]         = useState(false)

  const msgPollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const tripPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── GPS pasajero ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setPassengerPos([pos.coords.latitude, pos.coords.longitude]),
        () => setPassengerPos([5.9333, -73.6167]),
        { enableHighAccuracy: true }
      )
    }
  }, [])

  // ── Función para obtener la ubicación actual ─────────────────────────────────
  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización')
      return
    }
    setLocating(true)
    setTaxiOrigin('Obteniendo ubicación...')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setPassengerPos([lat, lng])

        // Intentar obtener nombre de la calle con reverse geocoding
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es`
          )
          const data = await res.json()
          const addr = data.address
          const label = [
            addr.road,
            addr.suburb ?? addr.neighbourhood ?? addr.village ?? addr.town ?? addr.city,
          ].filter(Boolean).join(', ')
          setTaxiOrigin(label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        } catch {
          setTaxiOrigin(`${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        }
        setLocating(false)
      },
      () => {
        setTaxiOrigin('')
        alert('No se pudo obtener tu ubicación. Verifica los permisos.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // ── Fetch rutas activas ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchRoutes()
    const interval = setInterval(fetchRoutes, 10_000)
    return () => clearInterval(interval)
  }, [])

  async function fetchRoutes() {
    try {
      const res = await fetch(`${API}/routes/public/active`)
      if (!res.ok) return
      const data = await res.json()
      setRoutes(data)
      setStatusBadge(data.length > 0 ? `${data.length} en línea` : 'Sin servicio')
    } catch {}
  }

  // ── Seleccionar ruta ────────────────────────────────────────────────────────
  async function selectRoute(routeId: string | null) {
    setSelectedRoute(routeId)
    setWaypoints([])
    setMessages([])
    if (msgPollRef.current) clearInterval(msgPollRef.current)
    if (!routeId) return

    // Cargar paradas
    try {
      const res = await fetch(`${API}/routes/public/${routeId}/waypoints`)
      if (res.ok) setWaypoints(await res.json())
    } catch {}

    // Cargar mensajes y arrancar polling
    fetchMessages(routeId)
    msgPollRef.current = setInterval(() => fetchMessages(routeId), 5_000)
  }

  async function fetchMessages(routeId: string) {
    try {
      const res = await fetch(`${API}/routes/public/${routeId}/messages`)
      if (res.ok) setMessages(await res.json())
    } catch {}
  }

  async function sendMessage() {
    if (!selectedRoute || !msgInput.trim()) return
    try {
      await fetch(`${API}/routes/public/${selectedRoute}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgInput.trim() }),
      })
      setMsgInput('')
      fetchMessages(selectedRoute)
    } catch {}
  }

  // ── Taxi ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === 'taxi') loadNearbyDrivers()
  }, [tab, passengerPos])

  async function loadNearbyDrivers() {
    const [lat, lng] = passengerPos ?? [5.9333, -73.6167]
    try {
      const res = await fetch(
        `${API}/taxi/drivers/nearby?lat=${lat}&lng=${lng}&radius_km=10`
      )
      if (res.ok) setNearbyDrivers(await res.json())
    } catch {}
  }

  async function requestTaxi() {
    if (activeTripId) { alert('Ya tienes un viaje activo'); return }
    if (!taxiOrigin)  { alert('Escribe tu punto de recogida'); return }
    if (!taxiDest)    { alert('Escribe tu destino'); return }

    const [lat, lng] = passengerPos ?? [5.9333, -73.6167]
    try {
      const res = await fetch(`${API}/taxi/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_lat: lat, origin_lng: lng,
          origin_address: taxiOrigin,
          dest_lat: lat, dest_lng: lng,
          dest_address: taxiDest,
          passenger_name:  taxiName  || 'Pasajero',
          passenger_phone: taxiPhone || '',
          has_luggage: taxiLuggage,
          has_ac:      taxiAC,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setActiveTripId(data.trip_id)
      setFareEstimate(data.estimated_fare)
      setTaxiStep('searching')

      // Polling para detectar aceptación
      tripPollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${API}/taxi/trips/${data.trip_id}/status`)
          const d = await r.json()
          if (d.status !== 'solicitado') {
            clearInterval(tripPollRef.current!)
            setTaxiStep('trip')
            setTripStatus(d)
          }
        } catch {}
      }, 5_000)
    } catch (err: any) {
      alert(err.message || 'Error al solicitar taxi')
    }
  }

  async function cancelTaxi() {
    if (activeTripId) {
      try {
        await fetch(`${API}/taxi/trips/${activeTripId}/cancel`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Cancelado por pasajero' }),
        })
      } catch {}
    }
    if (tripPollRef.current) clearInterval(tripPollRef.current)
    setTaxiStep('form')
    setActiveTripId(null)
    setFareEstimate(null)
    setTripStatus(null)
  }

  // ── Notificaciones ──────────────────────────────────────────────────────────
  async function toggleWatch(waypointId: string) {
    if (watching[waypointId]) {
      setWatching(prev => { const n = {...prev}; delete n[waypointId]; return n })
      return
    }
    if ('Notification' in window && Notification.permission !== 'granted') {
      await Notification.requestPermission()
    }
    setWatching(prev => ({ ...prev, [waypointId]: true }))
  }

  // Check alertas
  useEffect(() => {
    const interval = setInterval(() => {
      waypoints.forEach(wp => {
        if (!watching[wp.id] || notified.has(wp.id) || wp.already_passed) return
        if (wp.eta_minutes !== null && wp.eta_minutes <= 2) {
          if (Notification.permission === 'granted') {
            new Notification(`🚌 Colectivo llegando a ${wp.place_name}`, {
              body: `Llega en aprox. ${Math.ceil(wp.eta_minutes)} minuto(s)`,
            })
          }
          setNotified(prev => new Set([...prev, wp.id]))
        }
      })
    }, 15_000)
    return () => clearInterval(interval)
  }, [waypoints, watching, notified])

  // ── Helpers UI ──────────────────────────────────────────────────────────────
  function seatsClass(seats: number, cap: number) {
    const p = seats / cap
    return p > 0.3 ? 'seats-ok' : p > 0 ? 'seats-few' : 'seats-full'
  }
  function seatsLabel(seats: number) {
    return seats <= 0 ? 'Lleno' : seats === 1 ? '1 puesto' : `${seats} puestos`
  }
  function etaLabel(sec: number) {
    if (!sec || sec <= 0) return ''
    return sec < 60 ? `${sec}s` : `${Math.ceil(sec / 60)} min`
  }

  const selectedRouteData = routes.find(r => r.route_id === selectedRoute)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col"
         style={{ height: '100dvh' }}>

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3
                         flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <img src="/logo-veri.png" alt="VERI Logo" className="w-8 h-8 object-contain rounded-lg" />
          <div>
          <h1 className="text-sm font-semibold">VERI</h1>
            <p className="text-xs text-slate-500">Vélez &amp; Ricaurte</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-1 rounded-full border
            ${routes.length > 0
              ? 'text-teal-400 bg-teal-400/10 border-teal-400/30'
              : 'text-slate-500 bg-slate-800 border-slate-700'}`}>
            {statusBadge}
          </span>
          {isAuthenticated ? (
            <button
              onClick={() => navigate(user?.role === 'conductor' ? '/conductor' : '/dashboard')}
              className="text-xs px-2 py-1 text-teal-400 border border-teal-500/30
                         rounded-lg hover:bg-teal-500/10 transition">
              Mi panel
            </button>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="text-xs px-2 py-1 text-slate-400 border border-slate-700
                         rounded-lg hover:bg-slate-800 transition">
              Ingresar
            </button>
          )}
        </div>
      </header>

      {/* Mapa */}
      <div style={{ height: '210px', flexShrink: 0 }}>
        <MapContainer
          center={passengerPos ?? [5.9333, -73.6167]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap"
          />

          {/* Posición del pasajero */}
          {passengerPos && (
            <Marker position={passengerPos} icon={makePassengerIcon()}>
              <Popup>Tu ubicación</Popup>
            </Marker>
          )}

          {/* Colectivos activos */}
          {tab === 'colectivos' && routes.map(r => {
            const color = r.signal_status === 'live'  ? '#2dd4bf' :
                          r.signal_status === 'stale' ? '#fbbf24' : '#f87171'
            return (
              <Marker key={r.route_id}
                position={[r.lat, r.lng]}
                icon={makeColectivoIcon(color, r.route_name)}
                eventHandlers={{ click: () => selectRoute(r.route_id) }}>
                <Popup>
                  <div style={{ fontSize: 13 }}>
                    <b>{r.route_name}</b><br/>
                    {r.passengers_aboard}/{r.capacity} pas. · {r.speed_kmh} km/h<br/>
                    → {r.next_stop}
                  </div>
                </Popup>
              </Marker>
            )
          })}

          {/* Taxis disponibles */}
          {tab === 'taxi' && nearbyDrivers.map(d => (
            <Marker key={d.driver_id}
              position={passengerPos ?? [5.9333, -73.6167]}
              icon={makeTaxiIcon(d.full_name)}>
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <b>{d.full_name}</b><br/>
                  {d.plate} · {d.brand} {d.model}<br/>
                  ★ {d.avg_rating.toFixed(1)} · {d.distance_km.toFixed(1)} km<br/>
                  ETA ~{d.eta_min} min
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Conductor del viaje activo */}
          {tab === 'taxi' && tripStatus?.driver?.lat && (
            <Marker
              position={[tripStatus.driver.lat, tripStatus.driver.lng]}
              icon={makeTaxiIcon(tripStatus.driver.name ?? 'Conductor')}>
              <Popup>{tripStatus.driver.name}</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Panel inferior */}
      <div className="flex-1 bg-slate-900 border-t border-slate-800
                    flex flex-col overflow-hidden">

        {/* Tabs */}
        <div className="flex border-b border-slate-800 shrink-0">
          {(['colectivos', 'taxi'] as const).map(t => (
            <button key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-semibold transition
                border-b-2 ${tab === t
                  ? 'text-teal-400 border-teal-400'
                  : 'text-slate-500 border-transparent hover:text-slate-300'}`}>
              {t === 'colectivos' ? '🚌 Colectivos' : '🚕 Taxi'}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Pestaña Colectivos ── */}
          {tab === 'colectivos' && (
            <div>
              {routes.length === 0 && (
                <div className="text-center py-10 text-slate-600 text-sm">
                  No hay colectivos en servicio<br/>
                  <span className="text-2xl mt-2 block">🕐</span>
                </div>
              )}

              {/* Lista de rutas */}
              {routes.map(r => (
                <div key={r.route_id}
                     onClick={() => selectRoute(selectedRoute === r.route_id ? null : r.route_id)}
                     className={`px-4 py-3 border-b border-slate-800 cursor-pointer
                       transition hover:bg-slate-800
                       ${selectedRoute === r.route_id
                         ? 'bg-teal-500/5 border-l-2 border-l-teal-500'
                         : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">
                      {r.route_name}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5
                                       rounded-lg border
                        ${r.seats_available > 0
                          ? 'text-teal-400 bg-teal-400/10 border-teal-400/30'
                          : r.seats_available > 0
                            ? 'text-amber-400 bg-amber-400/10 border-amber-400/30'
                            : 'text-red-400 bg-red-400/10 border-red-400/30'}`}>
                      {seatsLabel(r.seats_available)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    → {r.next_stop}
                    {r.eta_seconds ? ` · llega en ${etaLabel(r.eta_seconds)}` : ''}
                    {' · '}${Number(r.base_fare).toLocaleString('es-CO')}
                  </p>
                </div>
              ))}

              {/* Paradas de ruta seleccionada */}
              {selectedRoute && (
                <div className="border-t-2 border-teal-500/20">
                  <div className="flex items-center justify-between
                                  px-4 py-2 bg-slate-800/50">
                    <span className="text-xs font-semibold text-teal-400 uppercase
                                     tracking-wider">
                      Paradas — {selectedRouteData?.route_name}
                    </span>
                    <button onClick={() => selectRoute(null)}
                      className="text-slate-500 hover:text-white text-xs">
                      ✕
                    </button>
                  </div>

                  {waypoints.map(wp => (
                    <div key={wp.id}
                         className={`flex items-center gap-3 px-4 py-2.5
                           border-b border-slate-800
                           ${wp.already_passed ? 'opacity-40' : ''}`}>
                      <div className={`w-2.5 h-2.5 rounded-full border-2 shrink-0
                        ${wp.is_terminal
                          ? 'bg-teal-400 border-teal-400'
                          : wp.already_passed
                            ? 'border-slate-600'
                            : 'border-teal-400'}`}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-200">
                          {wp.place_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {wp.already_passed ? 'Ya pasó' :
                           wp.eta_minutes !== null
                             ? `~${Math.ceil(wp.eta_minutes)} min`
                             : wp.distance_m
                               ? `${(wp.distance_m/1000).toFixed(1)} km`
                               : 'Sin datos'}
                        </p>
                      </div>
                      {!wp.already_passed && (
                        <button
                          onClick={() => toggleWatch(wp.id)}
                          className={`text-xs px-2 py-1 rounded-lg border
                            transition font-semibold
                            ${watching[wp.id]
                              ? 'bg-teal-400 text-slate-950 border-teal-400'
                              : 'text-slate-500 border-slate-700 hover:border-teal-400 hover:text-teal-400'}`}>
                          {watching[wp.id] ? '🔔' : '🔕 Avisar'}
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Mensajes */}
                  <div className="px-4 py-3 border-t border-slate-800">
                    <p className="text-xs font-semibold text-slate-400 uppercase
                                  tracking-wider mb-2">
                      📨 Mensaje al conductor
                    </p>
                    <div className="space-y-1.5 max-h-24 overflow-y-auto mb-2">
                      {messages.length === 0 ? (
                        <p className="text-xs text-slate-600">Sin mensajes aún</p>
                      ) : messages.map((m: any) => (
                        <div key={m.id}
                             className={`text-xs px-2 py-1.5 rounded-lg
                               ${m.sender === 'conductor'
                                 ? 'bg-teal-500/10 text-teal-300 ml-4'
                                 : 'bg-slate-800 text-slate-300'}`}>
                          <span className="font-medium">
                            {m.sender === 'conductor' ? '🚌' : '👤'}:
                          </span>{' '}{m.message}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mb-2">
                      {['Espereme 🙏','Paquete 📦','2 personas 👥'].map(q => (
                        <button key={q} onClick={() => setMsgInput(q)}
                          className="text-xs px-2 py-1 bg-slate-800 border border-slate-700
                                     rounded-lg text-slate-400 hover:text-teal-400
                                     hover:border-teal-500/50 transition">
                          {q}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 bg-slate-800 border border-slate-700
                                   rounded-lg px-3 py-1.5 text-xs text-white
                                   placeholder-slate-500 focus:outline-none
                                   focus:ring-1 focus:ring-teal-500"
                        placeholder="Escribe un mensaje..."
                        value={msgInput}
                        maxLength={140}
                        onChange={e => setMsgInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendMessage()}
                      />
                      <button onClick={sendMessage}
                        className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400
                                   text-slate-950 font-semibold rounded-lg
                                   text-xs transition">
                        Enviar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Pestaña Taxi ── */}
          {tab === 'taxi' && (
            <div className="p-4">

              {taxiStep === 'form' && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white">
                    🚕 Solicitar taxi
                  </p>
                  {nearbyDrivers.length > 0 && (
                    <p className="text-xs text-teal-400">
                      {nearbyDrivers.length} taxi(s) disponible(s) cerca
                    </p>
                  )}
                  {nearbyDrivers.length === 0 && (
                    <p className="text-xs text-slate-500">
                      No hay taxis disponibles en este momento
                    </p>
                  )}
                  <div className="relative">
                    <input
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg
                                px-3 py-2.5 pr-24 text-sm text-white placeholder-slate-500
                                focus:outline-none focus:ring-1 focus:ring-teal-500"
                      placeholder="📍 ¿Dónde estás?"
                      value={taxiOrigin}
                      onChange={e => setTaxiOrigin(e.target.value)}
                    />
                    <button
                      onClick={useCurrentLocation}
                      disabled={locating}
                      className="absolute right-1 top-1 bottom-1 px-2 text-xs
                                bg-teal-500/20 text-teal-400 border border-teal-500/30
                                rounded-lg hover:bg-teal-500/30 disabled:opacity-50
                                transition whitespace-nowrap">
                      {locating ? '...' : '📍 Mi ubicación'}
                    </button>
                  </div>
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg
                               px-3 py-2.5 text-sm text-white placeholder-slate-500
                               focus:outline-none focus:ring-1 focus:ring-teal-500"
                    placeholder="🏁 ¿A dónde vas?"
                    value={taxiDest}
                    onChange={e => setTaxiDest(e.target.value)}
                  />
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg
                               px-3 py-2.5 text-sm text-white placeholder-slate-500
                               focus:outline-none focus:ring-1 focus:ring-teal-500"
                    placeholder="Tu nombre (opcional)"
                    value={taxiName}
                    onChange={e => setTaxiName(e.target.value)}
                  />
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={taxiLuggage}
                        onChange={e => setTaxiLuggage(e.target.checked)}
                        className="accent-teal-400"/>
                      Equipaje (+$2.000)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={taxiAC}
                        onChange={e => setTaxiAC(e.target.checked)}
                        className="accent-teal-400"/>
                      Aire acondicionado (+$1.000)
                    </label>
                  </div>
                  {fareEstimate && (
                    <div className="bg-slate-800 border border-slate-700
                                    rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-teal-400">
                        ~${fareEstimate.fare_total.toLocaleString('es-CO')}
                      </p>
                      <p className="text-xs text-slate-500">
                        ~{fareEstimate.km.toFixed(1)} km · {fareEstimate.minutes} min
                      </p>
                    </div>
                  )}
                  <button
                    onClick={requestTaxi}
                    className="w-full py-3 bg-teal-500 hover:bg-teal-400
                               text-slate-950 font-bold rounded-xl text-sm transition">
                    Solicitar taxi
                  </button>
                </div>
              )}

              {taxiStep === 'searching' && (
                <div className="text-center py-8 space-y-3">
                  <div className="text-4xl">🔍</div>
                  <p className="text-sm font-semibold text-white">
                    Buscando conductor...
                  </p>
                  <p className="text-xs text-slate-500">
                    Tu solicitud fue enviada. Espera mientras un conductor la acepta.
                  </p>
                  <div className="flex justify-center">
                    <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
                  </div>
                  <button onClick={cancelTaxi}
                    className="w-full py-2.5 border border-slate-700 rounded-xl
                               text-sm text-slate-400 hover:bg-slate-800 transition">
                    Cancelar solicitud
                  </button>
                </div>
              )}

              {taxiStep === 'trip' && tripStatus && (
                <div className="space-y-3">
                  <div className={`text-center py-4 rounded-xl border
                    ${tripStatus.status === 'completado'
                      ? 'bg-teal-500/10 border-teal-500/30'
                      : 'bg-slate-800 border-slate-700'}`}>
                      <p className="text-xs text-slate-400 mb-1">
                      {({
                        aceptado:  'Conductor en camino 🚗',
                        esperando: 'Conductor llegó ⏳',
                        en_curso:  'Viaje en curso 🛣️',
                        completado:'Viaje completado ✅',
                        cancelado: 'Viaje cancelado ❌',
                      } as Record<string, string>)[tripStatus.status] ?? tripStatus.status}
                    </p>
                    {tripStatus.driver && (
                      <p className="text-sm font-semibold text-white">
                        {tripStatus.driver.name} · {tripStatus.driver.plate}
                      </p>
                    )}
                    {tripStatus.status === 'en_curso' && tripStatus.fare_current && (
                      <p className="text-3xl font-black text-white mt-2">
                        ${tripStatus.fare_current.fare_total.toLocaleString('es-CO')}
                      </p>
                    )}
                    {tripStatus.status === 'completado' && tripStatus.fare_total && (
                      <>
                        <p className="text-3xl font-black text-teal-400 mt-2">
                          ${tripStatus.fare_total.toLocaleString('es-CO')}
                        </p>
                        <p className="text-xs text-slate-500">Total del viaje</p>
                      </>
                    )}
                  </div>
                  {tripStatus.status !== 'completado' &&
                   tripStatus.status !== 'cancelado' && (
                    <button onClick={cancelTaxi}
                      className="w-full py-2.5 border border-slate-700 rounded-xl
                                 text-sm text-slate-400 hover:bg-slate-800 transition">
                      Cancelar viaje
                    </button>
                  )}
                  {(tripStatus.status === 'completado' ||
                    tripStatus.status === 'cancelado') && (
                    <button onClick={cancelTaxi}
                      className="w-full py-3 bg-teal-500 hover:bg-teal-400
                                 text-slate-950 font-bold rounded-xl text-sm transition">
                      Nuevo viaje
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}