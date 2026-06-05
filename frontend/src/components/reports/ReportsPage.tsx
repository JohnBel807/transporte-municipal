/**
 * ReportsPage.tsx
 * Vista de reportes de movilidad por fecha y provincia.
 */
import { useState }      from 'react'
import { useNavigate }   from 'react-router-dom'
import { useMobilityReport } from '../../hooks/useDashboard'
import { RouteDemandsRow, VehicleDayRow } from '../../types/api'

function today() {
  return new Date().toISOString().split('T')[0]
}

function Badge({ children, color = 'gray' }: {
  children: React.ReactNode
  color?: 'teal' | 'amber' | 'gray' | 'purple'
}) {
  const colors = {
    teal:   'bg-teal-500/10 text-teal-400 border-teal-500/20',
    amber:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    gray:   'bg-slate-700/60 text-slate-400 border-slate-600/40',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium
                      border ${colors[color]}`}>
      {children}
    </span>
  )
}

function RouteRow({ route, rank }: { route: RouteDemandsRow; rank: number }) {
  const peakLabel = `${route.peak_hour}:00–${route.peak_hour + 1}:00`
  return (
    <tr className="border-t border-slate-800 hover:bg-slate-800/40 transition">
      <td className="px-4 py-3 text-slate-500 text-sm w-8">{rank}</td>
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-white">{route.route_name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{route.province}</p>
      </td>
      <td className="px-4 py-3 text-sm text-white text-right font-medium">
        {route.total_trips}
      </td>
      <td className="px-4 py-3 text-sm text-white text-right">
        {route.total_passengers.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-slate-300 text-right">
        {route.avg_passengers.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right">
        <Badge color="amber">{peakLabel}</Badge>
      </td>
      <td className="px-4 py-3 text-sm text-slate-400 text-right">
        {route.avg_duration_min} min
      </td>
    </tr>
  )
}

function VehicleRow({ vehicle }: { vehicle: VehicleDayRow }) {
  return (
    <tr className="border-t border-slate-800 hover:bg-slate-800/40 transition">
      <td className="px-4 py-3">
        <p className="text-sm font-semibold text-white font-mono">{vehicle.plate}</p>
        <p className="text-xs text-slate-500 mt-0.5 capitalize">{vehicle.vehicle_type}</p>
      </td>
      <td className="px-4 py-3 text-sm text-slate-300">{vehicle.driver_name}</td>
      <td className="px-4 py-3 text-sm text-white text-right font-medium">
        {vehicle.trips_today}
      </td>
      <td className="px-4 py-3 text-sm text-white text-right">
        {vehicle.total_passengers.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-slate-300 text-right">
        {vehicle.total_distance_km.toFixed(1)} km
      </td>
      <td className="px-4 py-3 text-sm text-slate-400 text-right">
        {vehicle.active_hours.toFixed(1)} h
      </td>
      <td className="px-4 py-3 text-right">
        <Badge color={vehicle.province === 'Vélez' ? 'teal' : 'purple'}>
          {vehicle.province}
        </Badge>
      </td>
    </tr>
  )
}

export function ReportsPage() {
  const navigate  = useNavigate()
  const [date, setDate]         = useState(today())
  const [province, setProvince] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useMobilityReport(date, province)

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">

      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center
                         justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-slate-500 hover:text-white transition p-1"
          >
            ←
          </button>
          <h1 className="text-sm font-semibold text-white">
            Reportes de Movilidad
          </h1>
        </div>

        {/* Filtros */}
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                       text-sm text-white focus:outline-none focus:ring-1
                       focus:ring-teal-500"
          />
          <select
            value={province ?? ''}
            onChange={(e) => setProvince(e.target.value || null)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5
                       text-sm text-white focus:outline-none focus:ring-1
                       focus:ring-teal-500"
          >
            <option value="">Todas las provincias</option>
            <option value="Vélez">Vélez</option>
            <option value="Ricaurte">Ricaurte</option>
          </select>
          <button
            onClick={() => refetch()}
            className="px-4 py-1.5 bg-teal-500 hover:bg-teal-400 text-slate-950
                       font-semibold text-sm rounded-lg transition"
          >
            Actualizar
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">

        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-slate-800 animate-pulse rounded-xl"/>
            ))}
          </div>
        )}

        {isError && (
          <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl
                          text-red-400 text-center">
            Error al cargar el reporte. Verifica la conexión.
          </div>
        )}

        {data && (
          <>
            {/* KPIs ejecutivos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total viajes', value: data.totals.total_trips },
                { label: 'Total pasajeros', value: Number(data.totals.total_passengers).toLocaleString() },
                { label: 'Vehículos activos', value: data.totals.total_vehicles },
                { label: 'Ruta más demandada', value: data.totals.most_demanded_route ?? '—', small: true },
              ].map(({ label, value, small }) => (
                <div key={label}
                     className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                    {label}
                  </p>
                  <p className={`font-bold text-white ${small ? 'text-sm' : 'text-2xl'}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Tabla de rutas */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">
                  Rutas por demanda
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ordenadas por total de pasajeros · {date}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Ruta</th>
                      <th className="px-4 py-3 text-right">Viajes</th>
                      <th className="px-4 py-3 text-right">Pasajeros</th>
                      <th className="px-4 py-3 text-right">Prom/viaje</th>
                      <th className="px-4 py-3 text-right">Hora pico</th>
                      <th className="px-4 py-3 text-right">Duración</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_routes.map((r: RouteDemandsRow, i: number) => (
                      <RouteRow key={r.route_id} route={r} rank={i + 1}/>
                    ))}
                    {data.top_routes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-600 text-sm">
                          Sin datos para la fecha seleccionada
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabla de vehículos */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-semibold text-white">
                  Resumen por vehículo
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Actividad del día · ordenado por número de viajes
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Vehículo</th>
                      <th className="px-4 py-3 text-left">Conductor</th>
                      <th className="px-4 py-3 text-right">Viajes</th>
                      <th className="px-4 py-3 text-right">Pasajeros</th>
                      <th className="px-4 py-3 text-right">Distancia</th>
                      <th className="px-4 py-3 text-right">Horas activo</th>
                      <th className="px-4 py-3 text-right">Provincia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vehicles_summary.map((v: VehicleDayRow) => (
                      <VehicleRow key={v.vehicle_id} vehicle={v}/>
                    ))}
                    {data.vehicles_summary.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-600 text-sm">
                          Sin actividad registrada
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
