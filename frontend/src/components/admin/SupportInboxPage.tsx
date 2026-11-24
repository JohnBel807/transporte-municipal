import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

type Status = 'abierto' | 'en_proceso' | 'resuelto' | 'cerrado'

interface Ticket {
  id: string
  reporter_name: string | null
  reporter_phone: string | null
  trip_id: string | null
  category: string
  message: string
  status: Status
  admin_note: string | null
  created_at: string
  updated_at: string
}
interface SupportResponse {
  summary: Record<Status, number>
  tickets: Ticket[]
}

const STATUS_PILL: Record<Status, { label: string; color: string }> = {
  abierto:    { label: 'Abierto',    color: 'text-amber-400 bg-amber-400/10 border-amber-400/30' },
  en_proceso: { label: 'En proceso', color: 'text-teal-400 bg-teal-400/10 border-teal-400/30' },
  resuelto:   { label: 'Resuelto',   color: 'text-slate-300 bg-slate-400/10 border-slate-400/30' },
  cerrado:    { label: 'Cerrado',    color: 'text-slate-500 bg-slate-800 border-slate-700' },
}
const CAT_LABEL: Record<string, string> = {
  tarifa: '💵 Tarifa', conductor: '🚕 Conductor', seguridad: '⚠️ Seguridad', app: '📱 App', otro: '• Otro',
}
const FILTERS: Array<{ key: Status | 'todos'; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'abierto', label: 'Abiertos' },
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'resuelto', label: 'Resueltos' },
  { key: 'cerrado', label: 'Cerrados' },
]

export function SupportInboxPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Status | 'todos'>('abierto')
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery<SupportResponse>({
    queryKey: ['admin-support', filter],
    queryFn: async () => {
      const { data } = await api.get('/admin/support', {
        params: filter === 'todos' ? {} : { status: filter },
      })
      return data
    },
    refetchInterval: 30_000,
  })

  const update = useMutation({
    mutationFn: (p: { id: string; body: { status?: Status; admin_note?: string } }) =>
      api.patch(`/admin/support/${p.id}`, p.body),
    onSuccess: () => {
      setNoteFor(null); setNote('')
      queryClient.invalidateQueries({ queryKey: ['admin-support'] })
    },
    onError: () => alert('No se pudo actualizar el reporte'),
  })

  const s = data?.summary
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-slate-500 hover:text-white transition text-lg">←</button>
          <div>
            <h1 className="text-sm font-semibold">Soporte</h1>
            <p className="text-xs text-slate-500">
              {s ? `${s.abierto} abiertos · ${s.en_proceso} en proceso` : 'Cargando…'}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition
                ${filter === f.key ? 'text-teal-400 border-teal-500/40 bg-teal-500/10'
                                   : 'text-slate-400 border-slate-700 hover:bg-slate-800'}`}>
              {f.label}
              {f.key !== 'todos' && s ? ` (${s[f.key]})` : ''}
            </button>
          ))}
        </div>

        {isLoading && [1,2,3].map(i => <div key={i} className="h-24 bg-slate-800 animate-pulse rounded-xl"/>)}
        {!isLoading && (data?.tickets.length ?? 0) === 0 && (
          <div className="text-center py-16 text-slate-600 text-sm">No hay reportes en este estado</div>
        )}

        {data?.tickets.map(t => (
          <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-slate-400">{CAT_LABEL[t.category] ?? t.category}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-lg border ${STATUS_PILL[t.status].color}`}>
                  {STATUS_PILL[t.status].label}
                </span>
              </div>
              <span className="text-xs text-slate-600 shrink-0">
                {new Date(t.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </div>

            <p className="text-sm text-slate-200 mb-2 whitespace-pre-wrap">{t.message}</p>
            <p className="text-xs text-slate-500 mb-3">
              {t.reporter_name || 'Anónimo'}{t.reporter_phone ? ` · ${t.reporter_phone}` : ''}
              {t.trip_id ? ` · viaje ${t.trip_id.slice(0, 8)}…` : ''}
            </p>

            {t.admin_note && (
              <p className="text-xs text-teal-300 bg-teal-500/10 border border-teal-500/20 rounded-lg px-3 py-2 mb-3">
                Nota: {t.admin_note}
              </p>
            )}

            {noteFor === t.id ? (
              <div className="flex gap-2 mb-3">
                <input value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
                  placeholder="Nota interna…"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"/>
                <button onClick={() => setNoteFor(null)}
                  className="px-3 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800">Cancelar</button>
                <button disabled={!note.trim() || update.isPending}
                  onClick={() => update.mutate({ id: t.id, body: { admin_note: note.trim() } })}
                  className="px-3 py-1.5 text-xs text-teal-400 border border-teal-500/40 rounded-lg hover:bg-teal-500/10 disabled:opacity-40">Guardar nota</button>
              </div>
            ) : (
              <button onClick={() => { setNoteFor(t.id); setNote(t.admin_note ?? '') }}
                className="text-xs text-slate-400 hover:text-teal-400 mb-3 block">✎ Nota interna</button>
            )}

            <div className="flex gap-2 flex-wrap pt-3 border-t border-slate-800">
              {(['abierto','en_proceso','resuelto','cerrado'] as Status[])
                .filter(st => st !== t.status)
                .map(st => (
                  <button key={st} disabled={update.isPending}
                    onClick={() => update.mutate({ id: t.id, body: { status: st } })}
                    className="px-3 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg hover:bg-slate-800 disabled:opacity-40">
                    → {STATUS_PILL[st].label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}