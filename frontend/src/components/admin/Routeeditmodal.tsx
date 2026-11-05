import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { api } from '../../services/apiClient'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Wp {
  place_name: string; latitude: number; longitude: number
  is_terminal: boolean; estimated_wait_min: number
}
interface Detail {
  id: string; route_name: string; description: string | null; base_fare: number
  estimated_duration_min: number; status: string; tolerance_m: number
  driver_name: string; waypoints: Wp[]
}

function Clicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onPick(e.latlng.lat, e.latlng.lng) } })
  return null
}

const inp = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500'

export function RouteEditModal({ routeId, onClose }: { routeId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Detail | null>(null)
  const [sel, setSel] = useState(0)

  const { data } = useQuery<Detail>({
    queryKey: ['admin-route-detail', routeId],
    queryFn: async () => (await api.get(`/admin/routes/${routeId}`)).data,
  })
  useEffect(() => { if (data) setForm({ ...data, description: data.description ?? '' }) }, [data])

  const locked = form?.status === 'activa'

  const save = useMutation({
    mutationFn: () => api.put(`/admin/routes/${routeId}`, {
      route_name: form!.route_name, description: form!.description ?? '',
      base_fare: Number(form!.base_fare),
      estimated_duration_min: Number(form!.estimated_duration_min),
      tolerance_m: Number(form!.tolerance_m),
      waypoints: locked ? null : form!.waypoints.map(w => ({
        ...w, latitude: Number(w.latitude), longitude: Number(w.longitude),
        estimated_wait_min: Number(w.estimated_wait_min),
      })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-routes'] })
      onClose()
    },
    onError: (e: any) => alert(JSON.stringify(e?.response?.data?.detail ?? 'No se pudo guardar')),
  })

  if (!form) return null
  const set = (k: keyof Detail, v: any) => setForm({ ...form, [k]: v })
  const setWp = (i: number, patch: Partial<Wp>) =>
    set('waypoints', form.waypoints.map((w, j) => (j === i ? { ...w, ...patch } : w)))
  const addWp = () => {
    const last = form.waypoints[form.waypoints.length - 1]
    const wps = [...form.waypoints]
    wps.splice(wps.length - 1, 0, { place_name: '', latitude: last.latitude, longitude: last.longitude, is_terminal: false, estimated_wait_min: 0 })
    set('waypoints', wps); setSel(wps.length - 2)
  }
  const removeWp = (i: number) => {
    if (form.waypoints.length <= 2) return
    set('waypoints', form.waypoints.filter((_, j) => j !== i)); setSel(0)
  }
  const pts = form.waypoints.map(w => [Number(w.latitude), Number(w.longitude)] as [number, number])
  const center = pts[sel] ?? pts[0] ?? [5.93, -73.62]

  return (
    <div className="fixed inset-0 z-[2000] bg-black/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Editar ruta</h2>
            <p className="text-xs text-slate-500">Conductor: {form.driver_name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        <input className={inp} value={form.route_name} onChange={e => set('route_name', e.target.value)} placeholder="Nombre" />
        <input className={inp} value={form.description ?? ''} onChange={e => set('description', e.target.value)} placeholder="Descripción" />
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-slate-400">Tarifa
            <input className={inp} type="number" value={form.base_fare} onChange={e => set('base_fare', e.target.value)} /></label>
          <label className="text-xs text-slate-400">Duración (min)
            <input className={inp} type="number" value={form.estimated_duration_min} onChange={e => set('estimated_duration_min', e.target.value)} /></label>
          <label className="text-xs text-slate-400">Tolerancia (m)
            <input className={inp} type="number" disabled={locked} value={form.tolerance_m} onChange={e => set('tolerance_m', e.target.value)} /></label>
        </div>

        {locked ? (
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            La ruta está activa: puedes cambiar nombre, tarifa y duración. Para modificar las paradas, primero pausa la ruta.
          </p>
        ) : (
          <>
            <div style={{ height: 240 }}>
              <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }} className="rounded-xl" key={routeId}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                <Clicker onPick={(lat, lng) => setWp(sel, { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) })} />
                <Polyline positions={pts} pathOptions={{ color: '#2dd4bf' }} />
                {pts.map((p, i) => <Marker key={i} position={p} opacity={i === sel ? 1 : 0.55} eventHandlers={{ click: () => setSel(i) }} />)}
              </MapContainer>
            </div>
            <p className="text-[11px] text-slate-500">Selecciona una parada y toca el mapa para moverla.</p>
            <div className="space-y-2">
              {form.waypoints.map((w, i) => (
                <div key={i} onClick={() => setSel(i)}
                  className={`rounded-xl border p-2 space-y-2 ${i === sel ? 'border-teal-500/50 bg-teal-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
                  <div className="flex gap-2">
                    <input className={inp} value={w.place_name} placeholder={`Parada ${i + 1}`}
                      onChange={e => setWp(i, { place_name: e.target.value })} />
                    <button type="button" onClick={() => removeWp(i)} disabled={form.waypoints.length <= 2}
                      className="px-3 text-red-400 border border-red-500/30 rounded-lg disabled:opacity-30">✕</button>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input className={inp} type="number" step="any" value={w.latitude} onChange={e => setWp(i, { latitude: Number(e.target.value) })} />
                    <input className={inp} type="number" step="any" value={w.longitude} onChange={e => setWp(i, { longitude: Number(e.target.value) })} />
                    <label className="text-[11px] text-slate-300 flex items-center gap-1 shrink-0">
                      <input type="checkbox" checked={w.is_terminal || i === 0 || i === form.waypoints.length - 1}
                        disabled={i === 0 || i === form.waypoints.length - 1}
                        onChange={e => setWp(i, { is_terminal: e.target.checked })} /> Terminal
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addWp}
                className="w-full py-2 text-xs border border-slate-700 rounded-lg text-teal-400 hover:bg-slate-800">
                + Agregar parada intermedia
              </button>
            </div>
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-slate-700 rounded-xl text-slate-400">Cancelar</button>
          <button disabled={save.isPending || form.route_name.trim().length < 3} onClick={() => save.mutate()}
            className="flex-1 py-2.5 text-sm bg-teal-500 text-slate-950 font-semibold rounded-xl disabled:opacity-40">
            {save.isPending ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}