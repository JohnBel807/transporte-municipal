import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMapEvents } from 'react-leaflet'
import { api } from '../../services/apiClient'

interface Zone {
  id: string; name: string; municipality: string; province: string
  polygon: [number, number][]; fixed_fare: number; allow_surcharges: boolean
  decree_ref: string | null; priority: number; is_active: boolean
}

const EMPTY = {
  name: '', municipality: '', province: 'velez', fixed_fare: 7000,
  allow_surcharges: false, decree_ref: '', priority: 0, is_active: true,
}

function Clicker({ onAdd }: { onAdd: (p: [number, number]) => void }) {
  useMapEvents({ click(e) { onAdd([e.latlng.lat, e.latlng.lng]) } })
  return null
}

export function FareZonesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState({ ...EMPTY })
  const [points, setPoints] = useState<[number, number][]>([])
  const [editId, setEditId] = useState<string | null>(null)

  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ['fare-zones'],
    queryFn: async () => (await api.get('/admin/fare-zones')).data,
  })

  const reset = () => { setForm({ ...EMPTY }); setPoints([]); setEditId(null) }

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, fixed_fare: Number(form.fixed_fare), priority: Number(form.priority),
        decree_ref: form.decree_ref || null, polygon: points }
      return editId ? api.put(`/admin/fare-zones/${editId}`, body) : api.post('/admin/fare-zones', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fare-zones'] }); reset() },
    onError: (e: any) => alert(JSON.stringify(e?.response?.data?.detail ?? 'Error al guardar')),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/fare-zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fare-zones'] }),
  })

  const edit = (z: Zone) => {
    setEditId(z.id); setPoints(z.polygon)
    setForm({ name: z.name, municipality: z.municipality, province: z.province,
      fixed_fare: z.fixed_fare, allow_surcharges: z.allow_surcharges,
      decree_ref: z.decree_ref ?? '', priority: z.priority, is_active: z.is_active })
  }

  const inp = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500'
  const canSave = form.name.length >= 2 && form.municipality.length >= 2 && points.length >= 3 && Number(form.fixed_fare) > 0

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-sm font-semibold">Tarifas por zona (decretos municipales)</h1>
        <button onClick={() => navigate('/dashboard')} className="text-sm text-slate-400 hover:text-white">← Volver</button>
      </header>
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4">
        <div className="lg:w-80 space-y-3 shrink-0">
          <input className={inp} placeholder="Nombre (ej. Casco urbano Barbosa)" value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className={inp} placeholder="Municipio" value={form.municipality}
            onChange={e => setForm({ ...form, municipality: e.target.value })} />
          <select className={inp} value={form.province} onChange={e => setForm({ ...form, province: e.target.value })}>
            <option value="velez">Provincia de Vélez</option>
            <option value="ricaurte">Provincia de Ricaurte</option>
          </select>
          <input className={inp} type="number" placeholder="Tarifa fija COP" value={form.fixed_fare}
            onChange={e => setForm({ ...form, fixed_fare: Number(e.target.value) })} />
          <input className={inp} placeholder="Decreto / resolución (opcional)" value={form.decree_ref}
            onChange={e => setForm({ ...form, decree_ref: e.target.value })} />
          <input className={inp} type="number" placeholder="Prioridad (mayor gana)" value={form.priority}
            onChange={e => setForm({ ...form, priority: Number(e.target.value) })} />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={form.allow_surcharges}
              onChange={e => setForm({ ...form, allow_surcharges: e.target.checked })} />
            Permitir recargos (nocturno, equipaje, A/C)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={form.is_active}
              onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            Activa
          </label>
          <p className="text-xs text-slate-500">Puntos dibujados: {points.length} (mínimo 3). Haz clic en el mapa.</p>
          <div className="flex gap-2">
            <button onClick={() => setPoints(points.slice(0, -1))} className="flex-1 py-2 text-xs border border-slate-700 rounded-lg">Deshacer punto</button>
            <button onClick={() => setPoints([])} className="flex-1 py-2 text-xs border border-slate-700 rounded-lg">Limpiar</button>
          </div>
          <div className="flex gap-2">
            {editId && <button onClick={reset} className="flex-1 py-2 text-sm border border-slate-700 rounded-lg">Cancelar</button>}
            <button disabled={!canSave || save.isPending} onClick={() => save.mutate()}
              className="flex-1 py-2 text-sm bg-teal-500 text-slate-950 font-semibold rounded-lg disabled:opacity-40">
              {editId ? 'Actualizar' : 'Guardar zona'}
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 min-w-0">
          <div style={{ height: 420 }}>
            <MapContainer center={[5.93, -73.62]} zoom={11} style={{ height: '100%', width: '100%' }} className="rounded-xl">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
              <Clicker onAdd={p => setPoints(prev => [...prev, p])} />
              {zones.filter(z => z.id !== editId).map(z => (
                <Polygon key={z.id} positions={z.polygon}
                  pathOptions={{ color: z.is_active ? '#2dd4bf' : '#64748b', weight: 2 }} />
              ))}
              {points.length >= 3 && <Polygon positions={points} pathOptions={{ color: '#fbbf24' }} />}
              {points.length > 0 && points.length < 3 && <Polyline positions={points} pathOptions={{ color: '#fbbf24' }} />}
              {points.map((p, i) => <CircleMarker key={i} center={p} radius={4} pathOptions={{ color: '#fbbf24' }} />)}
            </MapContainer>
          </div>
          <div className="space-y-2">
            {zones.length === 0 && <p className="text-sm text-slate-600">Aún no hay zonas.</p>}
            {zones.map(z => (
              <div key={z.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{z.name} · ${z.fixed_fare.toLocaleString('es-CO')}</p>
                  <p className="text-xs text-slate-500">{z.municipality} · {z.province}{z.decree_ref ? ` · ${z.decree_ref}` : ''}{z.is_active ? '' : ' · inactiva'}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => edit(z)} className="text-xs px-3 py-1.5 border border-slate-700 rounded-lg">Editar</button>
                  <button onClick={() => { if (confirm('¿Eliminar zona?')) del.mutate(z.id) }}
                    className="text-xs px-3 py-1.5 border border-red-500/30 text-red-400 rounded-lg">Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
