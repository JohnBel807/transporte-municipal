import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface Driver {
  driver_id:        string
  user_id:          string
  full_name:        string
  email:            string
  phone:            string
  is_active:        boolean
  driver_type:      string
  license_number:   string
  license_category: string
  driver_status:    string
  avg_rating:       number
  total_trips:      number
  is_verified:      boolean
  zone_name:        string
  plate:            string
  brand:            string
  model:            string
  year:             number
  capacity:         number
  vehicle_type:     string
  active_routes:    number
  paused_routes:    number
  archived_routes:  number
}

const TYPE_LABEL: Record<string, string> = {
  colectivo:  'Colectivo',
  taxi:       'Taxi',
  particular: 'Particular',
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  disponible: { label: 'Disponible', color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  ocupado:    { label: 'En servicio', color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  inactivo:   { label: 'Inactivo',   color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
}

export function DriversListPage() {
  const navigate     = useNavigate()
  const queryClient  = useQueryClient()
  const [search, setSearch]         = useState('')
  const [confirmBlock, setConfirmBlock] = useState<Driver | null>(null)
  const [blockReason, setBlockReason]   = useState('')

  const { data: drivers = [], isLoading } = useQuery<Driver[]>({
    queryKey: ['admin-drivers'],
    queryFn:  async () => {
      const { data } = await api.get('/admin/drivers')
      return data
    },
    refetchInterval: 30_000,
  })

  const blockMutation = useMutation({
    mutationFn: ({ driverId, action, reason }: { driverId: string; action: string; reason: string }) =>
      api.patch(`/admin/drivers/${driverId}/status`, { action, reason }),
    onSuccess: () => {
      setConfirmBlock(null)
      setBlockReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-drivers'] })
    },
  })

  const filtered = drivers.filter(d =>
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    d.email.toLowerCase().includes(search.toLowerCase()) ||
    d.plate?.toLowerCase().includes(search.toLowerCase()) ||
    d.license_number.toLowerCase().includes(search.toLowerCase())
  )

  const active   = drivers.filter(d => d.is_active).length
  const inactive = drivers.filter(d => !d.is_active).length
  const onRoute  = drivers.filter(d => d.driver_status === 'ocupado').length

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4
                         flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')}
            className="text-slate-500 hover:text-white transition text-lg">
            ←
          </button>
          <div>
            <h1 className="text-sm font-semibold">Conductores</h1>
            <p className="text-xs text-slate-500">
              {active} activos · {onRoute} en servicio · {inactive} bloqueados
            </p>
          </div>
        </div>
        <button onClick={() => navigate('/drivers/new')}
          className="px-4 py-2 text-sm text-teal-400 font-medium
                     border border-teal-500/30 rounded-xl
                     hover:bg-teal-500/10 transition">
          + Nuevo conductor
        </button>
      </header>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Buscador */}
        <input
          className="w-full bg-slate-800 border border-slate-700 rounded-xl
                     px-4 py-3 text-sm text-white placeholder-slate-500
                     focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
          placeholder="Buscar por nombre, email, placa o licencia…"
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
            {search ? 'No se encontraron conductores' : 'No hay conductores registrados'}
          </div>
        )}

        <div className="space-y-3">
          {filtered.map(driver => {
            const st = STATUS_LABEL[driver.driver_status] ?? STATUS_LABEL.inactivo
            return (
              <div key={driver.driver_id}
                   className={`bg-slate-900 border rounded-xl p-5
                     ${!driver.is_active
                       ? 'border-red-500/20 opacity-60'
                       : 'border-slate-800'}`}>

                <div className="flex items-start justify-between gap-4">
                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold text-white">
                        {driver.full_name}
                      </p>
                      <span className={`text-xs font-medium px-2 py-0.5
                                       rounded-lg border ${st.color}`}>
                        {st.label}
                      </span>
                      {!driver.is_active && (
                        <span className="text-xs font-medium px-2 py-0.5
                                         rounded-lg border text-red-400
                                         bg-red-400/10 border-red-400/30">
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mb-3">
                      {driver.email} · {driver.phone}
                    </p>

                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-slate-800 rounded-lg p-2 text-center">
                        <p className="text-base font-bold text-white">
                          {driver.total_trips}
                        </p>
                        <p className="text-xs text-slate-500">Viajes</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-2 text-center">
                        <p className="text-base font-bold text-white">
                          ★ {Number(driver.avg_rating).toFixed(1)}
                        </p>
                        <p className="text-xs text-slate-500">Rating</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-2 text-center">
                        <p className="text-base font-bold text-teal-400">
                          {driver.active_routes}
                        </p>
                        <p className="text-xs text-slate-500">Rutas activas</p>
                      </div>
                      <div className="bg-slate-800 rounded-lg p-2 text-center">
                        <p className="text-base font-bold text-slate-400">
                          {driver.paused_routes}
                        </p>
                        <p className="text-xs text-slate-500">Pausadas</p>
                      </div>
                    </div>
                  </div>

                  {/* Vehículo */}
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-white">
                      {driver.plate ?? '—'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {driver.brand} {driver.model} {driver.year}
                    </p>
                    <p className="text-xs text-slate-500">
                      {TYPE_LABEL[driver.driver_type]} · {driver.capacity} pas.
                    </p>
                    <p className="text-xs text-slate-500">
                      Lic. {driver.license_number}
                    </p>
                  </div>
                </div>

                {/* Acciones */}
                <div className="mt-4 pt-3 border-t border-slate-800 flex gap-2">
                  {driver.is_active ? (
                    confirmBlock?.driver_id === driver.driver_id ? (
                      <div className="flex-1 flex gap-2 items-center">
                        <input
                          className="flex-1 bg-slate-800 border border-slate-700
                                     rounded-lg px-3 py-1.5 text-xs text-white
                                     placeholder-slate-500 focus:outline-none
                                     focus:ring-1 focus:ring-red-500"
                          placeholder="Motivo del bloqueo (mín. 10 caracteres)…"
                          value={blockReason}
                          onChange={e => setBlockReason(e.target.value)}
                        />
                        <button
                          onClick={() => setConfirmBlock(null)}
                          className="px-3 py-1.5 text-xs text-slate-400
                                     border border-slate-700 rounded-lg
                                     hover:bg-slate-800 transition">
                          Cancelar
                        </button>
                        <button
                          disabled={blockReason.length < 10 || blockMutation.isPending}
                          onClick={() => blockMutation.mutate({
                            driverId: driver.driver_id,
                            action:   'bloquear',
                            reason:   blockReason,
                          })}
                          className="px-3 py-1.5 text-xs text-red-400 font-medium
                                     border border-red-500/40 rounded-lg
                                     hover:bg-red-500/10 disabled:opacity-40
                                     transition">
                          Confirmar bloqueo
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setConfirmBlock(driver); setBlockReason('') }}
                        className="px-4 py-1.5 text-xs text-red-400 font-medium
                                   border border-red-500/30 rounded-lg
                                   hover:bg-red-500/10 transition">
                        Bloquear
                      </button>
                    )
                  ) : (
                    <button
                      disabled={blockMutation.isPending}
                      onClick={() => blockMutation.mutate({
                        driverId: driver.driver_id,
                        action:   'desbloquear',
                        reason:   'Reactivación por admin',
                      })}
                      className="px-4 py-1.5 text-xs text-teal-400 font-medium
                                 border border-teal-500/30 rounded-lg
                                 hover:bg-teal-500/10 disabled:opacity-40
                                 transition">
                      Desbloquear
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}