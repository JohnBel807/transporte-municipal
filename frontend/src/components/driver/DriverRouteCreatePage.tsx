import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/apiClient'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Arreglo de iconos por defecto en Leaflet con React
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Waypoint {
  sequence_order: number
  place_name: string
  latitude: number
  longitude: number
  is_terminal: boolean
  estimated_wait_min: number
}

interface RouteForm {
  route_name: string
  description: string
  base_fare: number
  estimated_duration_min: number
  tolerance_m: number
  waypoints: Waypoint[]
}

// Plantillas de Rutas Frecuentes (Barbosa - Vélez y Región)
const PRESET_TEMPLATES = [
  {
    name: 'Barbosa ⇆ Vélez (Por la Central)',
    description: 'Ruta directa intermunicipal Barbosa - Vélez',
    base_fare: 4500,
    estimated_duration_min: 25,
    tolerance_m: 300,
    waypoints: [
      { sequence_order: 0, place_name: 'Terminal Barbosa', latitude: 5.9333, longitude: -73.6167, is_terminal: true, estimated_wait_min: 5 },
      { sequence_order: 1, place_name: 'Citos / Cruce Chipatá', latitude: 5.9680, longitude: -73.6420, is_terminal: false, estimated_wait_min: 2 },
      { sequence_order: 2, place_name: 'Parque Principal Vélez', latitude: 6.0132, longitude: -73.6735, is_terminal: true, estimated_wait_min: 0 },
    ],
  },
  {
    name: 'Vélez ⇆ Guavatá',
    description: 'Ruta rural Vélez - Guavatá',
    base_fare: 6000,
    estimated_duration_min: 45,
    tolerance_m: 500,
    waypoints: [
      { sequence_order: 0, place_name: 'Plaza Vélez', latitude: 6.0132, longitude: -73.6735, is_terminal: true, estimated_wait_min: 5 },
      { sequence_order: 1, place_name: 'Alto de la Cruz', latitude: 6.0020, longitude: -73.6910, is_terminal: false, estimated_wait_min: 2 },
      { sequence_order: 2, place_name: 'Parque Guavatá', latitude: 5.9650, longitude: -73.7150, is_terminal: true, estimated_wait_min: 0 },
    ],
  },
]

const EMPTY_WAYPOINT = (): Waypoint => ({
  sequence_order: 0,
  place_name: '',
  latitude: 0,
  longitude: 0,
  is_terminal: false,
  estimated_wait_min: 0,
})

const inputCls = `w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 transition`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// Componente para capturar clics en el mapa Leaflet
function MapClickHandler({ onSelectLocation }: { onSelectLocation: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onSelectLocation(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function DriverRouteCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedWpIdx, setSelectedWpIdx] = useState<number>(0)
  const [form, setForm] = useState<RouteForm>({
    route_name: '',
    description: '',
    base_fare: 3500,
    estimated_duration_min: 30,
    tolerance_m: 300,
    waypoints: [
      { ...EMPTY_WAYPOINT(), sequence_order: 0, is_terminal: true },
      { ...EMPTY_WAYPOINT(), sequence_order: 1, is_terminal: true },
    ],
  })

  const setField = (k: keyof RouteForm, v: any) => setForm(prev => ({ ...prev, [k]: v }))

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
        { ...prev.waypoints[prev.waypoints.length - 1], sequence_order: prev.waypoints.length },
      ],
    }))

  const removeWaypoint = (idx: number) => {
    if (form.waypoints.length <= 2) return
    setForm(prev => {
      const wps = prev.waypoints.filter((_, i) => i !== idx).map((w, i) => ({ ...w, sequence_order: i }))
      return { ...prev, waypoints: wps }
    })
  }

  // Cargar ubicación GPS actual en la Parada de Salida
  const handleUseCurrentLocation = (idx: number) => {
    if (!navigator.geolocation) {
      alert('Tu dispositivo no soporta GPS')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setWaypoint(idx, 'latitude', Number(pos.coords.latitude.toFixed(6)))
        setWaypoint(idx, 'longitude', Number(pos.coords.longitude.toFixed(6)))
        if (!form.waypoints[idx].place_name) {
          setWaypoint(idx, 'place_name', 'Mi ubicación actual')
        }
      },
      err => {
        alert(err.code === err.PERMISSION_DENIED ? 'Debes permitir acceso al GPS' : 'No se pudo obtener la ubicación')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Asignar coordenadas al hacer clic en el mapa
  const handleMapClick = (lat: number, lng: number) => {
    setWaypoint(selectedWpIdx, 'latitude', Number(lat.toFixed(6)))
    setWaypoint(selectedWpIdx, 'longitude', Number(lng.toFixed(6)))
  }

  // Aplicar plantilla predefinida
  const applyTemplate = (template: (typeof PRESET_TEMPLATES)[0]) => {
    setForm({
      route_name: template.name,
      description: template.description,
      base_fare: template.base_fare,
      estimated_duration_min: template.estimated_duration_min,
      tolerance_m: template.tolerance_m,
      waypoints: template.waypoints,
    })
  }

  const mutation = useMutation({
    mutationFn: (data: RouteForm) => api.post('/routes/', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-routes'] })
      alert('Ruta creada correctamente')
      navigate('/conductor')
    },
    onError: (err: any) => alert(err?.response?.data?.detail ?? 'Error al crear la ruta'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      ...form,
      base_fare: Number(form.base_fare),
      estimated_duration_min: Number(form.estimated_duration_min),
      tolerance_m: Number(form.tolerance_m),
      waypoints: form.waypoints.map(w => ({
        ...w,
        latitude: Number(w.latitude),
        longitude: Number(w.longitude),
        estimated_wait_min: Number(w.estimated_wait_min),
      })),
    })
  }

  // Centro inicial del mapa (Barbosa / Vélez por defecto)
  const mapCenter: [number, number] = [
    form.waypoints[selectedWpIdx]?.latitude || 5.9333,
    form.waypoints[selectedWpIdx]?.longitude || -73.6167,
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-12">
      {/* Header */}
      <header className="border-b border-slate-800 px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/conductor')} className="text-slate-400 hover:text-white transition text-lg">
            ←
          </button>
          <h1 className="font-semibold text-base">Crear Nueva Ruta de Colectivo</h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Sección de Plantillas Rápidas */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <h2 className="text-xs font-semibold text-teal-400 uppercase tracking-wider mb-3">Cargar Plantilla de Ruta</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PRESET_TEMPLATES.map((tmpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => applyTemplate(tmpl)}
                className="shrink-0 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl px-3 py-2 text-left transition"
              >
                <div className="text-xs font-medium text-white">{tmpl.name}</div>
                <div className="text-[10px] text-slate-400">${tmpl.base_fare} COP</div>
              </button>
            ))}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Información General */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Datos de la Ruta</h2>
            
            <Field label="Nombre de la Ruta">
              <input
                className={inputCls}
                required
                value={form.route_name}
                placeholder="Ej: Barbosa ⇆ Vélez por Citos"
                onChange={e => setField('route_name', e.target.value)}
              />
            </Field>

            <Field label="Descripción / Referencia">
              <input
                className={inputCls}
                value={form.description}
                placeholder="Ej: Pasa por la glorieta y el hospital"
                onChange={e => setField('description', e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarifa Base (COP)">
                <input
                  className={inputCls}
                  type="number"
                  required
                  value={form.base_fare}
                  onChange={e => setField('base_fare', e.target.value)}
                />
              </Field>
              <Field label="Duración Estimada (Min)">
                <input
                  className={inputCls}
                  type="number"
                  required
                  value={form.estimated_duration_min}
                  onChange={e => setField('estimated_duration_min', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* Mapa Interactivo para Selección de Puntos */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Mapa: Toca para ubicar "Parada #{selectedWpIdx + 1}"
              </h2>
            </div>

            <div className="h-64 w-full rounded-xl overflow-hidden border border-slate-700 relative">
              <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapClickHandler onSelectLocation={handleMapClick} />
                {form.waypoints.map(
                  (wp, idx) =>
                    wp.latitude !== 0 && (
                      <Marker key={idx} position={[wp.latitude, wp.longitude]}>
                        <Popup>
                          Parada #{idx + 1}: {wp.place_name || 'Sin nombre'}
                        </Popup>
                      </Marker>
                    )
                )}
              </MapContainer>
            </div>
            <p className="text-[11px] text-slate-500">
              * Selecciona una parada abajo y toca el mapa para asignar su ubicación exacta.
            </p>
          </section>

          {/* Paradas y Puntos de Salida/Llegada */}
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Paradas del Recorrido</h2>
              <button
                type="button"
                onClick={addWaypoint}
                className="text-xs font-medium text-teal-400 hover:text-teal-300 transition"
              >
                + Agregar Parada
              </button>
            </div>

            {form.waypoints.map((wp, idx) => {
              const isFirst = idx === 0
              const isLast = idx === form.waypoints.length - 1
              const isSelected = selectedWpIdx === idx

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedWpIdx(idx)}
                  className={`p-3.5 rounded-xl border transition space-y-3 cursor-pointer ${
                    isSelected ? 'bg-slate-800/90 border-teal-500' : 'bg-slate-950/50 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-teal-400">
                      {isFirst ? '🚩 Salida (Origen)' : isLast ? '🏁 Llegada (Destino)' : `Parada #${idx}`}
                    </span>
                    {!isFirst && !isLast && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          removeWaypoint(idx)
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>

                  <Field label="Nombre del lugar">
                    <input
                      className={inputCls}
                      required
                      value={wp.place_name}
                      placeholder={isFirst ? 'Ej: Parque Principal Barbosa' : isLast ? 'Ej: Plaza de Vélez' : 'Ej: Cruce de Citos'}
                      onChange={e => setWaypoint(idx, 'place_name', e.target.value)}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Latitud">
                      <input
                        className={inputCls}
                        type="number"
                        step="0.000001"
                        required
                        value={wp.latitude || ''}
                        onChange={e => setWaypoint(idx, 'latitude', e.target.value)}
                      />
                    </Field>
                    <Field label="Longitud">
                      <input
                        className={inputCls}
                        type="number"
                        step="0.000001"
                        required
                        value={wp.longitude || ''}
                        onChange={e => setWaypoint(idx, 'longitude', e.target.value)}
                      />
                    </Field>
                  </div>

                  {isFirst && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        handleUseCurrentLocation(idx)
                      }}
                      className="w-full py-2.5 text-xs font-medium text-teal-400 border border-teal-500/30 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 transition flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                        />
                      </svg>
                      Usar mi ubicación GPS actual como origen
                    </button>
                  )}
                </div>
              )
            })}
          </section>

          {/* Botones de Acción */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/conductor')}
              className="flex-1 py-3 border border-slate-700 rounded-xl text-sm text-slate-400 hover:bg-slate-800 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-semibold rounded-xl text-sm transition"
            >
              {mutation.isPending ? 'Guardando...' : 'Guardar Ruta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}