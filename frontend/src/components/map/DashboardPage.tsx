import { useState, useEffect } from 'react'
import { useNavigate }   from 'react-router-dom'
import { useMutation }   from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useDashboard }  from '../../hooks/useDashboard'
import { useAuthStore }  from '../../store/authStore'
import { VehicleCard }   from './VehicleCard'
import { LiveVehicle }   from '../../types/api'
import { api }           from '../../services/apiClient'
import { resolveActiveRegion } from '../../config/regions'

const region = resolveActiveRegion()

// Iconos de marcador para Leaflet
const makeIcon = (color: string, label: string) => L.divIcon({
  className: '',
  html: `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="
        background:#1e293b;border:1px solid ${color};
        color:${color};font-size:10px;font-weight:600;
        padding:2px 6px;border-radius:4px;white-space:nowrap;
        box-shadow:0 2px 8px #0006;max-width:120px;
        overflow:hidden;text-overflow:ellipsis;
      ">${label}</div>
      <div style="
        width:10px;height:10px;background:${color};
        border:2px solid #0f172a;border-radius:50%;
        box-shadow:0 0 0 3px ${color}33;
      "></div>
    </div>`,
  iconSize: [120, 32],
  iconAnchor: [60, 32],
})


function FlyToSelected({ vehicle }: { vehicle: LiveVehicle | undefined }) {
  const map = useMap()
  useEffect(() => {
    if (vehicle) map.flyTo([vehicle.lat, vehicle.lng], 14, { duration: 1 })
  }, [vehicle, map])
  return null
}

function StatCard({ label, value, sub, accent = false }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border ${accent ? 'bg-teal-500/10 border-teal-500/30' : 'bg-slate-800/60 border-slate-700/50'}`}>
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? 'text-teal-300' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { logout } = useAuthStore()
  const { data, isLoading, isError } = useDashboard()
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)
  const [blockDriverId, setBlockDriverId] = useState<string | null>(null)
  const [blockReason, setBlockReason]     = useState('')

  const blockMutation = useMutation({
    mutationFn: ({ driverId, reason }: { driverId: string; reason: string }) =>
      api.patch(`/admin/drivers/${driverId}/status`, { action: 'bloquear', reason }),
    onSuccess: () => { setBlockDriverId(null); setBlockReason('') },
  })

  const selectedVehicle = data?.vehicles.find((v) => v.route_id === selectedRoute)

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-teal-500/15 border border-teal-500/30 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Centro de Control</h1>
            <p className="text-xs text-slate-500">{region.label}</p>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          <button onClick={() => navigate('/reports')} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">Reportes</button>
          <button onClick={() => { logout(); navigate('/login') }} className="px-3 py-1.5 text-sm text-slate-500 hover:text-red-400 rounded-lg hover:bg-slate-800 transition">Salir</button>
          <button onClick={() => navigate('/drivers/new')} className="px-3 py-1.5 text-sm text-teal-400 hover:text-teal-300 rounded-lg hover:bg-slate-800 transition">+ Conductor</button>
          <button onClick={() => navigate('/drivers')} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">Conductores</button>
          <button onClick={() => navigate('/history')} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">Historial</button>
          <button onClick={() => navigate('/routes')} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">
  Rutas
</button>
        </nav>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-slate-800 space-y-3">
            {isLoading && !data ? (
              <div className="h-24 bg-slate-800 animate-pulse rounded-xl"/>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Rutas activas" value={data?.total_active_routes ?? 0} accent/>
                  <StatCard label="Pasajeros" value={data?.total_passengers_now ?? 0} sub="ahora"/>
                  <StatCard label="Ocupación media" value={`${data?.avg_occupancy_pct ?? 0}%`}/>
                  <StatCard label="Sin señal" value={data?.stale_signals ?? 0} sub="vehículos"/>
                </div>
                {data?.routes_by_province && (
                  <div className="flex gap-2">
                    {Object.entries(data.routes_by_province).map(([prov, count]) => (
                      <div key={prov} className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 text-center">
                        <p className="text-base font-bold text-white">{count}</p>
                        <p className="text-xs text-slate-500">{prov}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {isError && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">Error al cargar</div>}
            {(data?.vehicles ?? []).map((v) => (
              <VehicleCard key={v.route_id} vehicle={v} isSelected={v.route_id === selectedRoute}
                onClick={() => setSelectedRoute(selectedRoute === v.route_id ? null : v.route_id)}/>
            ))}
            {data?.vehicles.length === 0 && <div className="text-center text-slate-600 text-sm py-12">Sin rutas activas</div>}
          </div>
        </aside>

        <main className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
          <div className="flex-1 min-h-0">
            <MapContainer
              center={region.center}
              zoom={region.zoom}
              minZoom={region.minZoom}
              maxZoom={region.maxZoom}
              maxBounds={region.bounds}
              style={{ height: '100%', width: '100%' }}
              className="rounded-xl border border-slate-700/50"
            >
              <TileLayer
                url={import.meta.env.VITE_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
                attribution={import.meta.env.VITE_MAP_ATTRIBUTION ?? '© OpenStreetMap contributors'}
              />
              <FlyToSelected vehicle={selectedVehicle}/>
              {(data?.vehicles ?? []).map((v) => (
                <Marker
                    key={v.route_id}
                    position={[v.lat, v.lng]}
                    icon={makeIcon(
                      v.signal_status === 'live' ? '#2dd4bf' :
                      v.signal_status === 'stale' ? '#fbbf24' : '#f87171',
                      v.route_name
                    )}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold">{v.route_name}</p>
                      <p>{v.driver_name} · {v.plate}</p>
                      <p>{v.speed_kmh.toFixed(0)} km/h · {v.passengers_aboard}/{v.capacity} pas.</p>
                      <p>→ {v.next_stop} ({Math.ceil(v.eta_seconds/60)} min)</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          {selectedVehicle && (
            <div className="bg-slate-900 border border-slate-700/60 rounded-xl p-5 flex items-start gap-6 shrink-0">
              <div className="flex-1 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Conductor</p>
                  <p className="text-sm font-medium text-white">{selectedVehicle.driver_name}</p>
                  <p className="text-xs text-slate-500">★ {selectedVehicle.driver_rating.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Vehículo</p>
                  <p className="text-sm font-medium text-white">{selectedVehicle.plate}</p>
                  <p className="text-xs text-slate-500 capitalize">{selectedVehicle.vehicle_type}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Próxima parada</p>
                  <p className="text-sm font-medium text-white truncate">{selectedVehicle.next_stop}</p>
                  <p className="text-xs text-slate-500">en {Math.ceil(selectedVehicle.eta_seconds/60)} min</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Provincia</p>
                  <p className="text-sm font-medium text-white">{selectedVehicle.province}</p>
                </div>
              </div>
              {blockDriverId === selectedVehicle.driver_id ? (
                <div className="flex flex-col gap-2 w-56 shrink-0">
                  <input
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    placeholder="Motivo del bloqueo…"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setBlockDriverId(null)} className="flex-1 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800 transition">Cancelar</button>
                    <button
                      disabled={blockReason.length < 10 || blockMutation.isPending}
                      onClick={() => blockMutation.mutate({ driverId: selectedVehicle.driver_id, reason: blockReason })}
                      className="flex-1 py-1.5 text-xs text-red-400 font-medium border border-red-500/40 rounded-lg hover:bg-red-500/10 disabled:opacity-40 transition"
                    >Confirmar</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setBlockDriverId(selectedVehicle.driver_id)}
                  className="shrink-0 px-4 py-2 text-sm text-red-400 font-medium border border-red-500/30 rounded-xl hover:bg-red-500/10 transition">
                  Bloquear conductor
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
