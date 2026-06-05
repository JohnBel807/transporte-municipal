import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface DriverForm {
  full_name:        string
  email:            string
  phone:            string
  password:         string
  driver_type:      string
  license_number:   string
  license_category: string
  zone_slug:        string
  plate:            string
  brand:            string
  model:            string
  year:             number
  capacity:         number
  color:            string
  vehicle_type:     string
}

const EMPTY: DriverForm = {
  full_name: '', email: '', phone: '', password: '',
  driver_type: 'colectivo', license_number: '', license_category: 'C2',
  zone_slug: 'velez', plate: '', brand: '', model: '',
  year: 2020, capacity: 20, color: '', vehicle_type: 'bus',
}

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

const inputCls = `w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5
  text-sm text-white placeholder-slate-500
  focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition`

const selectCls = `${inputCls} cursor-pointer`

export function DriverRegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<DriverForm>(EMPTY)

  const set = (k: keyof DriverForm, v: string | number) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const mutation = useMutation({
    mutationFn: (data: DriverForm) => api.post('/admin/drivers', data),
    onSuccess: () => {
      alert('Conductor registrado correctamente')
      navigate('/dashboard')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({ ...form, year: Number(form.year), capacity: Number(form.capacity) })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="text-slate-500 hover:text-white transition text-lg"
        >←</button>
        <div>
          <h1 className="text-sm font-semibold">Registrar Conductor</h1>
          <p className="text-xs text-slate-500">Nuevo conductor y vehículo</p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="space-y-8">

          {/* Datos personales */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-teal-400 mb-4">
              Datos personales
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nombre completo">
                <input className={inputCls} required value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                  placeholder="Carlos Rodríguez"/>
              </Field>
              <Field label="Teléfono">
                <input className={inputCls} required value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  placeholder="+573001234567"/>
              </Field>
              <Field label="Correo electrónico">
                <input className={inputCls} type="email" required value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="conductor@correo.com"/>
              </Field>
              <Field label="Contraseña inicial">
                <input className={inputCls} type="password" required value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="Mínimo 6 caracteres"/>
              </Field>
            </div>
          </section>

          {/* Datos del conductor */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-teal-400 mb-4">
              Licencia y zona
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Número de licencia">
                <input className={inputCls} required value={form.license_number}
                  onChange={e => set('license_number', e.target.value)}
                  placeholder="LIC-001"/>
              </Field>
              <Field label="Categoría">
                <select className={selectCls} value={form.license_category}
                  onChange={e => set('license_category', e.target.value)}>
                  <option value="B1">B1</option>
                  <option value="B2">B2</option>
                  <option value="B3">B3</option>
                  <option value="C1">C1</option>
                  <option value="C2">C2</option>
                  <option value="C3">C3</option>
                </select>
              </Field>
              <Field label="Tipo de servicio">
                <select className={selectCls} value={form.driver_type}
                  onChange={e => set('driver_type', e.target.value)}>
                  <option value="colectivo">Colectivo</option>
                  <option value="taxi">Taxi</option>
                  <option value="particular">Particular</option>
                </select>
              </Field>
              <Field label="Zona operativa">
                <select className={selectCls} value={form.zone_slug}
                  onChange={e => set('zone_slug', e.target.value)}>
                  <option value="velez">Provincia de Vélez</option>
                  <option value="ricaurte">Provincia de Ricaurte</option>
                </select>
              </Field>
            </div>
          </section>

          {/* Vehículo */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-sm font-semibold text-teal-400 mb-4">
              Vehículo
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Placa">
                <input className={inputCls} required value={form.plate}
                  onChange={e => set('plate', e.target.value.toUpperCase())}
                  placeholder="ABC123"/>
              </Field>
              <Field label="Tipo de vehículo">
                <select className={selectCls} value={form.vehicle_type}
                  onChange={e => set('vehicle_type', e.target.value)}>
                  <option value="bus">Bus</option>
                  <option value="van">Van</option>
                  <option value="sedan">Sedan</option>
                  <option value="moto">Moto</option>
                </select>
              </Field>
              <Field label="Marca">
                <input className={inputCls} required value={form.brand}
                  onChange={e => set('brand', e.target.value)}
                  placeholder="Chevrolet"/>
              </Field>
              <Field label="Modelo">
                <input className={inputCls} required value={form.model}
                  onChange={e => set('model', e.target.value)}
                  placeholder="NPR"/>
              </Field>
              <Field label="Año">
                <input className={inputCls} type="number" required
                  value={form.year} min={2000} max={2030}
                  onChange={e => set('year', Number(e.target.value))}/>
              </Field>
              <Field label="Capacidad (pasajeros)">
                <input className={inputCls} type="number" required
                  value={form.capacity} min={1} max={60}
                  onChange={e => set('capacity', Number(e.target.value))}/>
              </Field>
              <Field label="Color">
                <input className={inputCls} required value={form.color}
                  onChange={e => set('color', e.target.value)}
                  placeholder="Blanco"/>
              </Field>
            </div>
          </section>

          {/* Error */}
          {mutation.isError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3
                            text-red-400 text-sm">
              {(mutation.error as any)?.response?.data?.detail ?? 'Error al registrar el conductor'}
            </div>
          )}

          {/* Botones */}
          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/dashboard')}
              className="flex-1 py-3 border border-slate-700 rounded-xl text-sm
                         text-slate-400 hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50
                         text-slate-950 font-semibold rounded-xl text-sm transition">
              {mutation.isPending ? 'Registrando…' : 'Registrar conductor'}
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}