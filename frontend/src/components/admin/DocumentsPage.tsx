import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

type DocStatus = 'vigente' | 'por_vencer' | 'vencido' | 'sin_dato'

interface Doc {
  expiry: string | null
  status: DocStatus
  days_left: number | null
}
interface DriverDocs {
  driver_id: string
  full_name: string
  phone: string
  driver_type: string
  plate: string | null
  vehicle_id: string | null
  overall: DocStatus
  documents: { licencia: Doc; soat: Doc; tecnomecanica: Doc }
}
interface DocsResponse {
  warn_days: number
  summary: Record<DocStatus, number>
  drivers: DriverDocs[]
}

const PILL: Record<DocStatus, { label: string; color: string }> = {
  vigente:    { label: 'Vigente',    color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  por_vencer: { label: 'Por vencer', color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  vencido:    { label: 'Vencido',    color: 'text-red-400 bg-red-400/10 border-red-400/30' },
  sin_dato:   { label: 'Sin dato',   color: 'text-slate-400 bg-slate-400/10 border-slate-400/30' },
}
const DOC_LABEL = { licencia: 'Licencia', soat: 'SOAT', tecnomecanica: 'Tecnomecánica' } as const
type DocKey = keyof typeof DOC_LABEL

function daysText(d: Doc): string {
  if (d.status === 'sin_dato') return 'Sin fecha registrada'
  if (d.days_left === null) return ''
  if (d.days_left < 0) return `Venció hace ${Math.abs(d.days_left)} día(s)`
  if (d.days_left === 0) return 'Vence hoy'
  return `Vence en ${d.days_left} día(s)`
}

export function DocumentsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [onlyProblem, setOnlyProblem] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<{ license_expiry: string; soat_expiry: string; tecnomecanica_expiry: string }>(
    { license_expiry: '', soat_expiry: '', tecnomecanica_expiry: '' })

  const { data, isLoading } = useQuery<DocsResponse>({
    queryKey: ['admin-documents', onlyProblem],
    queryFn: async () => {
      const { data } = await api.get('/admin/documents', {
        params: { warn_days: 30, ...(onlyProblem ? { only: 'problem' } : {}) },
      })
      return data
    },
    refetchInterval: 60_000,
  })

  const save = useMutation({
    mutationFn: (p: { id: string; body: Record<string, string | null> }) =>
      api.patch(`/admin/documents/${p.id}`, p.body),
    onSuccess: () => {
      setEditing(null)
      queryClient.invalidateQueries({ queryKey: ['admin-documents'] })
    },
    onError: () => alert('No se pudieron guardar las fechas'),
  })

  function startEdit(d: DriverDocs) {
    setEditing(d.driver_id)
    setForm({
      license_expiry:       d.documents.licencia.expiry ?? '',
      soat_expiry:          d.documents.soat.expiry ?? '',
      tecnomecanica_expiry: d.documents.tecnomecanica.expiry ?? '',
    })
  }
  function submit(id: string) {
    const body: Record<string, string | null> = {
      license_expiry:       form.license_expiry || null,
      soat_expiry:          form.soat_expiry || null,
      tecnomecanica_expiry: form.tecnomecanica_expiry || null,
    }
    save.mutate({ id, body })
  }

  const s = data?.summary
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-slate-500 hover:text-white transition text-lg">←</button>
          <div>
            <h1 className="text-sm font-semibold">Documentos de conductores</h1>
            <p className="text-xs text-slate-500">
              {s ? `${s.vencido} vencidos · ${s.por_vencer} por vencer · ${s.sin_dato} sin dato · ${s.vigente} al día` : 'Cargando…'}
            </p>
          </div>
        </div>
        <button onClick={() => setOnlyProblem(v => !v)}
          className={`px-4 py-2 text-sm font-medium border rounded-xl transition
            ${onlyProblem ? 'text-amber-400 border-amber-500/40 bg-amber-500/10'
                          : 'text-slate-400 border-slate-700 hover:bg-slate-800'}`}>
          {onlyProblem ? 'Ver todos' : 'Solo con problemas'}
        </button>
      </header>

      <div className="flex-1 p-6 space-y-3 overflow-y-auto">
        {isLoading && [1,2,3].map(i => <div key={i} className="h-28 bg-slate-800 animate-pulse rounded-xl"/>)}
        {!isLoading && (data?.drivers.length ?? 0) === 0 && (
          <div className="text-center py-16 text-slate-600 text-sm">
            {onlyProblem ? 'Ningún conductor con documentos por vencer o vencidos' : 'No hay conductores registrados'}
          </div>
        )}

        {data?.drivers.map(d => (
          <div key={d.driver_id}
               className={`bg-slate-900 border rounded-xl p-5
                 ${d.overall === 'vencido' ? 'border-red-500/30'
                   : d.overall === 'por_vencer' ? 'border-amber-500/30' : 'border-slate-800'}`}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-sm font-semibold text-white">{d.full_name}</p>
                <p className="text-xs text-slate-500">{d.phone} · {d.plate ?? 'sin vehículo'}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-lg border ${PILL[d.overall].color}`}>
                {PILL[d.overall].label}
              </span>
            </div>

            {editing === d.driver_id ? (
              <div className="space-y-2">
                {(['license_expiry','soat_expiry','tecnomecanica_expiry'] as const).map((k, i) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-28">{Object.values(DOC_LABEL)[i]}</span>
                    <input type="date" value={form[k]}
                      onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-500"/>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditing(null)}
                    className="px-3 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800">Cancelar</button>
                  <button disabled={save.isPending} onClick={() => submit(d.driver_id)}
                    className="px-3 py-1.5 text-xs text-teal-400 font-medium border border-teal-500/40 rounded-lg hover:bg-teal-500/10 disabled:opacity-40">
                    Guardar fechas
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(Object.keys(DOC_LABEL) as DocKey[]).map(key => {
                  const doc = d.documents[key]
                  return (
                    <div key={key} className="bg-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-300">{DOC_LABEL[key]}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PILL[doc.status].color}`}>
                          {PILL[doc.status].label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{daysText(doc)}</p>
                    </div>
                  )
                })}
              </div>
            )}

            {editing !== d.driver_id && (
              <button onClick={() => startEdit(d)}
                className="mt-3 text-xs text-teal-400 hover:text-teal-300">✎ Editar fechas</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}