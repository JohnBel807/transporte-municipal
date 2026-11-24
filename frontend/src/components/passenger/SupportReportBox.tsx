import { useState } from 'react'

const API = import.meta.env.VITE_API_URL ?? 'https://api.velezyricaurte.com'

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'tarifa',    label: '💵 Tarifa' },
  { key: 'conductor', label: '🚕 Conductor' },
  { key: 'seguridad', label: '⚠️ Seguridad' },
  { key: 'app',       label: '📱 App' },
  { key: 'otro',      label: '• Otro' },
]

/** Caja de reporte para la pestaña Ajustes del pasajero. No requiere cuenta. */
export function SupportReportBox() {
  const [open, setOpen]       = useState(false)
  const [category, setCat]    = useState('otro')
  const [message, setMessage] = useState('')
  const [name, setName]       = useState('')
  const [phone, setPhone]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (message.trim().length < 3) { setError('Escribe tu mensaje'); return }
    setBusy(true)
    try {
      const res = await fetch(`${API}/support/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: message.trim(),
          reporter_name:  name.trim() || null,
          reporter_phone: phone.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('No se pudo enviar')
      setDone(true)
      setMessage(''); setName(''); setPhone(''); setCat('otro')
    } catch {
      setError('No se pudo enviar. Revisa tu conexión.')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-teal-500'

  if (done) {
    return (
      <div className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-3 text-sm text-teal-400">
        ✅ Gracias, recibimos tu reporte.
        <button onClick={() => setDone(false)} className="block mt-1 text-xs text-slate-500 hover:text-teal-400">
          Enviar otro
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-sm text-slate-300">
        Reportar un problema <span>›</span>
      </button>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCat(c.key)}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition
              ${category === c.key ? 'text-teal-400 border-teal-500/50 bg-teal-500/15'
                                   : 'text-slate-400 border-slate-700'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} rows={3}
        placeholder="Cuéntanos qué pasó" className={field} />
      <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
        placeholder="Tu nombre (opcional)" className={field} />
      <input value={phone} onChange={e => setPhone(e.target.value)} maxLength={20} inputMode="tel"
        placeholder="Tu celular (opcional)" className={field} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setOpen(false)}
          className="px-4 py-2.5 text-sm text-slate-400 border border-slate-700 rounded-xl hover:bg-slate-800">
          Cancelar
        </button>
        <button onClick={submit} disabled={busy}
          className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-bold rounded-xl text-sm">
          {busy ? 'Enviando…' : 'Enviar reporte'}
        </button>
      </div>
    </div>
  )
}