import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface Route {
  id:                   string
  route_name:           string
  status:               string
  base_fare:            number
  estimated_duration_min: number
  driver_name:          string
  driver_phone:         string
  avg_rating:           number
  plate:                string
  vehicle_type:         string
  capacity:             number
  zone_name:            string
  waypoint_count:       number
  passengers_aboard:    number
  speed_kmh:            number
  last_signal:          string
}

const STATUS = {
  activa:    { label: 'Activa',    color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  pausada:   { label: 'Pausada',   color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  archivada: { label: 'Archivada', color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
}

export function RoutesListPage() {
  const navigate    = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter]   = useState<string>('all')
  const [search, setSearch]   = useState('')
  const [confirm, setConfirm] = useState<{ id: string; name: string; action: string } | null>(null)

  const { data: routes = [], isLoading } = useQuery<Route[]>({
    queryKey: ['admin-routes', filter],
    queryFn:  async () => {
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const { data } = await api.get(`/admin/routes${params}`)
      return data
    },
    refetchInterval: 15_000,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/admin/routes/${id}/status`, { status }),
    onSuccess: () => {
      setConfirm(null)
      queryClient.invalidateQueries({ queryKey: ['admin-routes'] })
    },
  })

  const filtered = routes.filter(r =>
    r.route_name.toLowerCase().includes(search.toLowerCase()) ||
    r.driver_name.toLowerCase().includes(search.toLowerCase()) ||
    r.plate?.toLowerCase().includes(search.toLowerCase())
  )

  const counts = {
    all:       routes.length,
    activa:    routes.filter(r => r.status === 'activa').length,
    pausada:   routes.filter(r => r.status === 'pausada').length,
    archivada: routes.filter(r => r.status === 'archivada').length,
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4
                         flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')}
            className="text-slate-500 hover:text-white transition text-lg">←</button>
          <div>
            <h1 className="text-sm font-semibold">Rutas</h1>
            <p className="text-xs text-slate-500">
              {counts.activa} activas · {counts.pausada} pausadas · {counts.archivada} archivadas
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">

        {/* Filtros */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'activa', 'pausada', 'archivada'] as const).map(f => (
            <button key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition
                ${filter === f
                  ? 'bg-teal-500/20 border-teal-500/40 text-teal-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
              {f === 'all' ? `Todas (${counts.all})` :
               f === 'activa' ? `Activas (${counts.activa})` :
               f === 'pausada' ? `Pausadas (${counts.pausada})` :
               `Archivadas (${counts.archivada})`}
            </button>
          ))}
        </div>

        {/* Buscador */}
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded-xl
                     px-4 py-3 text-sm text-white placeholder-slate-500
                     focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
          placeholder="Buscar por nombre, conductor o placa…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {/* Lista */}
        {isLoading && (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="h-28 bg-slate-800 animate-pulse rounded-xl"/>
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-600 text-sm">
            No hay rutas con ese filtro
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(route => {
            const st = STATUS[route.status as keyof typeof STATUS] ?? STATUS.pausada
            return (
              <div key={route.id}
                   className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold text-white truncate">
                        {route.route_name}
                      </p>
                      <span className={`text-xs font-medium px-2 py-0.5
                                       rounded-lg border ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {route.driver_name} · {route.plate} · {route.zone_name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-white">
                      ${Number(route.base_fare).toLocaleString('es-CO')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {route.estimated_duration_min} min
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-sm font-bold text-white">
                      {route.waypoint_count}
                    </p>
                    <p className="text-xs text-slate-500">Paradas</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className="text-sm font-bold text-white">
                      {route.capacity}
                    </p>
                    <p className="text-xs text-slate-500">Capacidad</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className={`text-sm font-bold ${
                      route.status === 'activa' ? 'text-teal-400' : 'text-slate-500'
                    }`}>
                      {route.status === 'activa' ? route.passengers_aboard : '—'}
                    </p>
                    <p className="text-xs text-slate-500">Pasajeros</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-2 text-center">
                    <p className={`text-sm font-bold ${
                      route.status === 'activa' ? 'text-white' : 'text-slate-500'
                    }`}>
                      {route.status === 'activa' ? `${route.speed_kmh} km/h` : '—'}
                    </p>
                    <p className="text-xs text-slate-500">Velocidad</p>
                  </div>
                </div>

                {/* Acciones */}
                {route.status !== 'archivada' && (
                  <div className="pt-3 border-t border-slate-800 flex gap-2">
                    {route.status === 'activa' && (
                      confirm?.id === route.id ? (
                        <div className="flex gap-2 w-full">
                          <button onClick={() => setConfirm(null)}
                            className="flex-1 py-1.5 text-xs text-slate-400
                                       border border-slate-700 rounded-lg
                                       hover:bg-slate-800 transition">
                            Cancelar
                          </button>
                          <button
                            disabled={statusMutation.isPending}
                            onClick={() => statusMutation.mutate({
                              id: route.id, status: 'pausada'
                            })}
                            className="flex-1 py-1.5 text-xs text-amber-400
                                       font-medium border border-amber-500/40
                                       rounded-lg hover:bg-amber-500/10
                                       disabled:opacity-40 transition">
                            Confirmar pausa
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirm({
                            id: route.id,
                            name: route.route_name,
                            action: 'pausar'
                          })}
                          className="px-4 py-1.5 text-xs text-amber-400
                                     border border-amber-500/30 rounded-lg
                                     hover:bg-amber-500/10 transition">
                          Pausar ruta
                        </button>
                      )
                    )}
                    {route.status === 'pausada' && (
                      <button
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({
                          id: route.id, status: 'archivada'
                        })}
                        className="px-4 py-1.5 text-xs text-slate-400
                                   border border-slate-700 rounded-lg
                                   hover:bg-slate-800 transition">
                        Archivar ruta
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}