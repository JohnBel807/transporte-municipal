import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface Trip {
  id:               string
  started_at:       string
  ended_at:         string
  duration_min:     number
  total_passengers: number
  province:         string
  route_name:       string
  base_fare:        number
  driver_name:      string
  plate:            string
  vehicle_type:     string
  waypoints_covered: number
}

interface HistoryData {
  days:    number
  totals:  { total_trips: number; total_passengers: number; avg_duration_min: number }
  trips:   Trip[]
}

function exportCSV(trips: Trip[]) {
  const header = 'Fecha,Ruta,Conductor,Placa,Pasajeros,Duración (min),Provincia'
  const rows   = trips.map(t => [
    new Date(t.started_at).toLocaleString('es-CO'),
    t.route_name,
    t.driver_name,
    t.plate,
    t.total_passengers,
    Math.round(t.duration_min),
    t.province,
  ].join(','))
  const csv  = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `historial_viajes_${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function TripHistoryPage() {
  const navigate = useNavigate()
  const [days, setDays] = useState(7)

  const { data, isLoading } = useQuery<HistoryData>({
    queryKey: ['trip-history', days],
    queryFn:  async () => {
      const { data } = await api.get(`/admin/reports/history?days=${days}`)
      return data
    },
  })

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4
                         flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')}
            className="text-slate-500 hover:text-white transition text-lg">←</button>
          <div>
            <h1 className="text-sm font-semibold">Historial de viajes</h1>
            <p className="text-xs text-slate-500">
              {data?.totals.total_trips ?? 0} viajes en los últimos {days} días
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-lg
                       px-3 py-1.5 text-sm text-white focus:outline-none
                       focus:ring-2 focus:ring-teal-500"
          >
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          {data && data.trips.length > 0 && (
            <button
              onClick={() => exportCSV(data.trips)}
              className="px-3 py-1.5 text-sm text-teal-400 font-medium
                         border border-teal-500/30 rounded-lg
                         hover:bg-teal-500/10 transition"
            >
              Exportar CSV
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">

        {/* Totales */}
        {data && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-teal-400">
                {data.totals.total_trips}
              </p>
              <p className="text-xs text-slate-500 mt-1">Viajes totales</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">
                {data.totals.total_passengers}
              </p>
              <p className="text-xs text-slate-500 mt-1">Pasajeros</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">
                {data.totals.avg_duration_min} min
              </p>
              <p className="text-xs text-slate-500 mt-1">Duración media</p>
            </div>
          </div>
        )}

        {/* Lista */}
        {isLoading && (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-20 bg-slate-800 animate-pulse rounded-xl"/>
            ))}
          </div>
        )}

        {!isLoading && data?.trips.length === 0 && (
          <div className="text-center py-16 text-slate-600 text-sm">
            No hay viajes registrados en este período.<br/>
            Los viajes se registran cuando el conductor finaliza una ruta.
          </div>
        )}

        <div className="space-y-2">
          {(data?.trips ?? []).map(trip => (
            <div key={trip.id}
                 className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {trip.route_name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {trip.driver_name} · {trip.plate}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(trip.started_at).toLocaleString('es-CO', {
                      day: '2-digit', month: 'short',
                      hour: '2-digit', minute: '2-digit'
                    })}
                    {' → '}
                    {new Date(trip.ended_at).toLocaleString('es-CO', {
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-white">
                    {trip.total_passengers} pas.
                  </p>
                  <p className="text-xs text-slate-500">
                    {Math.round(trip.duration_min)} min
                  </p>
                  <p className="text-xs text-slate-500">{trip.province}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}