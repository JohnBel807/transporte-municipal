import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

const DAYS = [
  { key: 'lunes',     label: 'Lunes' },
  { key: 'martes',    label: 'Martes' },
  { key: 'miercoles', label: 'Miércoles' },
  { key: 'jueves',    label: 'Jueves' },
  { key: 'viernes',   label: 'Viernes' },
  { key: 'sabado',    label: 'Sábado' },
  { key: 'domingo',   label: 'Domingo' },
]

interface Schedule {
  id:             string
  day_of_week:    string
  departure_time: string
  arrival_time:   string | null
  is_active:      boolean
}

const inputCls = `bg-slate-800 border border-slate-700 rounded-lg px-3 py-2
  text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition`

export function DriverSchedulePage() {
  const { routeId } = useParams<{ routeId: string }>()
  const navigate    = useNavigate()
  const queryClient = useQueryClient()

  const [day,       setDay]       = useState('lunes')
  const [departure, setDeparture] = useState('06:00')
  const [arrival,   setArrival]   = useState('')

  const { data: schedules = [], isLoading } = useQuery<Schedule[]>({
    queryKey: ['schedules', routeId],
    queryFn:  async () => {
      const { data } = await api.get(`/routes/${routeId}/schedules`)
      return data
    },
  })

  const addMutation = useMutation({
    mutationFn: () => api.post(`/routes/${routeId}/schedules`, {
      day_of_week:    day,
      departure_time: departure,
      arrival_time:   arrival || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', routeId] })
      setArrival('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (scheduleId: string) =>
      api.delete(`/routes/${routeId}/schedules/${scheduleId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['schedules', routeId] }),
  })

  const byDay = DAYS.map(d => ({
    ...d,
    schedules: schedules.filter(s => s.day_of_week === d.key),
  }))

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-4 py-4
                         flex items-center gap-3 shrink-0">
        <button onClick={() => navigate('/conductor')}
          className="text-slate-500 hover:text-white transition text-lg">
          ←
        </button>
        <div>
          <h1 className="text-sm font-semibold">Horarios de la ruta</h1>
          <p className="text-xs text-slate-500">
            Define cuándo opera este servicio
          </p>
        </div>
      </header>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">

        {/* Formulario agregar */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-teal-400 uppercase
                        tracking-wider mb-3">
            Agregar horario
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Día</label>
              <select className={`${inputCls} w-full`}
                value={day} onChange={e => setDay(e.target.value)}>
                {DAYS.map(d => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Hora de salida
              </label>
              <input type="time" className={`${inputCls} w-full`}
                value={departure}
                onChange={e => setDeparture(e.target.value)}/>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Hora de llegada (opcional)
              </label>
              <input type="time" className={`${inputCls} w-full`}
                value={arrival}
                onChange={e => setArrival(e.target.value)}/>
            </div>
          </div>
          <button
            disabled={addMutation.isPending}
            onClick={() => addMutation.mutate()}
            className="w-full py-2.5 bg-teal-500 hover:bg-teal-400
                       disabled:opacity-50 text-slate-950 font-semibold
                       rounded-lg text-sm transition"
          >
            {addMutation.isPending ? 'Guardando…' : '+ Agregar horario'}
          </button>
        </section>

        {/* Lista por día */}
        {isLoading && (
          <div className="h-32 bg-slate-800 animate-pulse rounded-xl"/>
        )}

        {!isLoading && schedules.length === 0 && (
          <div className="text-center py-8 text-slate-600 text-sm">
            No hay horarios definidos.<br/>
            Agrega el primero arriba.
          </div>
        )}

        {byDay.filter(d => d.schedules.length > 0).map(d => (
          <div key={d.key}
               className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-800">
              <p className="text-xs font-semibold text-slate-300">{d.label}</p>
            </div>
            {d.schedules.map(s => (
              <div key={s.id}
                   className="flex items-center justify-between px-4 py-3
                              border-b border-slate-800 last:border-0">
                <div>
                  <p className="text-sm font-medium text-white">
                    {s.departure_time.slice(0, 5)}
                    {s.arrival_time && (
                      <span className="text-slate-500">
                        {' → '}{s.arrival_time.slice(0, 5)}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(s.id)}
                  className="text-xs text-red-400 hover:text-red-300
                             disabled:opacity-40 transition px-2 py-1">
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}