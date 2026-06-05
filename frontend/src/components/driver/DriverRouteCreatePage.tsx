import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface Waypoint {
  sequence_order:     number
  place_name:         string
  latitude:           number
  longitude:          number
  is_terminal:        boolean
  estimated_wait_min: number
}

interface RouteForm {
  route_name:             string
  description:            string
  base_fare:              number
  estimated_duration_min: number
  tolerance_m:            number
  waypoints:              Waypoint[]
}

const EMPTY_WAYPOINT = (): Waypoint => ({
  sequence_order:     0,
  place_name:         '',
  latitude:           0,
  longitude:          0,
  is_terminal:        false,
  estimated_wait_min: 0,
})

const inputCls = `w-full bg-slate-800 border border-slate-700 rounded-lg
  px-3 py-2.5 text-sm text-white placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-teal-500 transition`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

export function DriverRouteCreatePage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<RouteForm>({
    route_name:             '',
    description:            '',
    base_fare:              3200,
    estimated_duration_min: 30,
    tolerance_m:            300,
    waypoints: [
      { ...EMPTY_WAYPOINT(), sequence_order: 0, is_terminal: true },
      { ...EMPTY_WAYPOINT(), sequence_order: 1, is_terminal: true },
    ],
  })

  const setField = (k: keyof RouteForm, v: any) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const setWaypoint = (idx: number, k: keyof Waypoint, v: any) =>
    setForm(prev => {
      const wps = [...prev.waypoints]
      wps[idx] = { ...wps[idx], [k]: v }
      return { ...prev, waypoints: wps }
    })

  const addWaypoint = () =>
    setForm(prev => ({
      ...prev,
      waypoints: [
        ...prev.waypoints.slice(0, -1),
        { ...EMPTY_WAYPOINT(), sequence_order: prev.waypoints.length - 1 },
        { ...prev.waypoints[prev.waypoints.length - 1],
          sequence_order: prev.waypoints.length },
      ],
    }))

  const removeWaypoint = (idx: number) => {
    if (form.waypoints.length <= 2) return
    setForm(prev => {
      const wps = prev.waypoints
        .filter((_, i) => i !== idx)
        .map((w, i) => ({ ...w, sequence_order: i }))
      return { ...prev, waypoints: wps }
    })
  }

  const mutation = useMutation({
    mutationFn: (data: RouteForm) => api.post('/routes/', data),
    onSuccess: () => {
      alert('Ruta creada correctamente')
      navigate('/conductor')
    },
    onError: (err: any) =>
      alert(err?.response?.data?.detail ?? 'Error al crear la ruta'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      ...form,
      base_fare:              Number(form.base_fare),
      estimated_duration_min: Number(form.estimated_duration_min),
      tolerance_m:            Number(form.tolerance_m),
      waypoints: form.waypoints.map(w => ({
        ...w,
        latitude:           Number(w.latitude),
        longitude:          Number(w.longitude),
        estimated_wait_min: Number(w.estimated_wait_min),
      })),
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-4 py-4
                         flex items-center gap-3">
        <button onClick={() => navigate('/conductor')}
          className="text-slate-500 hover:text-white transition text-lg">
          ←
        </button>
        <div>
          <h1 className="text-sm font-semibold">Nueva Ruta</h1>
          <p className="text-xs text-slate-500">Define el recorrido</p>
        </div>
      </header>

      <div className="max-w-lg mx-auto p-4">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Datos generales */}
          <section className="bg-slate-900 border border-slate-800
                              rounded-xl p-5 space-y-4">
            <h2 className="text-xs font-semibold text-teal-400 uppercase
                           tracking-wider">
              Información general
            </h2>
            <Field label="Nombre de la ruta">
              <input className={inputCls} required
                value={form.route_name} placeholder="Ej: Barbosa - Vélez"
                onChange={e => setField('route_name', e.target.value)}/>
            </Field>
            <Field label="Descripción (opcional)">
              <input className={inputCls}
                value={form.description} placeholder="Descripción breve"
                onChange={e => setField('description', e.target.value)}/>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarifa base (COP)">
                <input className={inputCls} type="number" required
                  value={form.base_fare} min={500}
                  onChange={e => setField('base_fare', e.target.value)}/>
              </Field>
              <Field label="Duración estimada (min)">
                <input className={inputCls} type="number" required
                  value={form.estimated_duration_min} min={1} max={480}
                  onChange={e => setField('estimated_duration_min', e.target.value)}/>
              </Field>
            </div>
          </section>

          {/* Paradas */}
          <section className="bg-slate-900 border border-slate-800
                              rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-teal-400 uppercase
                             tracking-wider">
                Paradas ({form.waypoints.length})
              </h2>
              <button type="button" onClick={addWaypoint}
                className="text-xs text-teal-400 hover:text-teal-300
                           border border-teal-500/30 rounded-lg px-3 py-1.5
                           hover:bg-teal-500/10 transition">
                + Agregar parada
              </button>
            </div>

            <p className="text-xs text-slate-500">
              La primera y última parada son terminales.
              Las coordenadas las encuentras en Google Maps
              (clic derecho → "¿Qué hay aquí?").
            </p>

            {form.waypoints.map((wp, idx) => {
              const isFirst = idx === 0
              const isLast  = idx === form.waypoints.length - 1
              const terminal = isFirst || isLast

              return (
                <div key={idx}
                     className={`rounded-xl p-4 border space-y-3
                       ${terminal
                         ? 'bg-teal-500/5 border-teal-500/20'
                         : 'bg-slate-800/50 border-slate-700/50'}`}>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400">
                      {isFirst ? '🟢 Inicio' : isLast ? '🔴 Final' : `📍 Parada ${idx}`}
                    </span>
                    {!terminal && (
                      <button type="button" onClick={() => removeWaypoint(idx)}
                        className="text-xs text-red-400 hover:text-red-300
                                   transition">
                        Eliminar
                      </button>
                    )}
                  </div>

                  <Field label="Nombre del lugar">
                    <input className={inputCls} required
                      value={wp.place_name}
                      placeholder={isFirst ? 'Terminal de salida' : isLast ? 'Terminal de llegada' : 'Nombre de la parada'}
                      onChange={e => setWaypoint(idx, 'place_name', e.target.value)}/>
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Latitud">
                      <input className={inputCls} type="number"
                        step="0.000001" required
                        value={wp.latitude || ''}
                        placeholder="6.013"
                        onChange={e => setWaypoint(idx, 'latitude', e.target.value)}/>
                    </Field>
                    <Field label="Longitud">
                      <input className={inputCls} type="number"
                        step="0.000001" required
                        value={wp.longitude || ''}
                        placeholder="-73.677"
                        onChange={e => setWaypoint(idx, 'longitude', e.target.value)}/>
                    </Field>
                  </div>

                  <Field label="Tiempo de espera (min)">
                    <input className={inputCls} type="number"
                      value={wp.estimated_wait_min} min={0} max={60}
                      onChange={e => setWaypoint(idx, 'estimated_wait_min', e.target.value)}/>
                  </Field>
                </div>
              )
            })}
          </section>

          {/* Error */}
          {mutation.isError && (
            <div className="bg-red-500/10 border border-red-500/30
                            rounded-xl px-4 py-3 text-red-400 text-sm">
              {(mutation.error as any)?.response?.data?.detail
                ?? 'Error al crear la ruta'}
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-3 pb-6">
            <button type="button" onClick={() => navigate('/conductor')}
              className="flex-1 py-3 border border-slate-700 rounded-xl
                         text-sm text-slate-400 hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 py-3 bg-teal-500 hover:bg-teal-400
                         disabled:opacity-50 text-slate-950 font-semibold
                         rounded-xl text-sm transition">
              {mutation.isPending ? 'Creando…' : 'Crear ruta'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}