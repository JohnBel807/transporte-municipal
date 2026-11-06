import { useState } from 'react'

const API = import.meta.env.VITE_API_URL ?? 'https://api.velezyricaurte.com'

interface Props {
  routeId: string
  routeName?: string
  seatsAvailable: number
  baseFare?: number
  /** Posición del pasajero (opcional): se envía como punto de recogida */
  pickup?: [number, number] | null
}

export function ReservationBox({ routeId, routeName, seatsAvailable, baseFare, pickup }: Props) {
  const [name, setName]   = useState(() => { try { return localStorage.getItem('veri_pax_name') ?? '' } catch { return '' } })
  const [seats, setSeats] = useState(1)
  const [note, setNote]   = useState('')
  const [useGps, setUseGps] = useState(true)
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const full = seatsAvailable <= 0
  const max  = Math.max(1, Math.min(6, seatsAvailable))

  async function submit() {
    setError(null)
    if (!name.trim()) { setError('Escribe tu nombre'); return }
    setBusy(true)
    try {
      try { localStorage.setItem('veri_pax_name', name.trim()) } catch {}
      const res = await fetch(`${API}/routes/public/${routeId}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passenger_name: name.trim(),
          seats,
          pickup_lat: useGps && pickup ? pickup[0] : null,
          pickup_lng: useGps && pickup ? pickup[1] : null,
          pickup_note: note.trim() || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo reservar')
      setDone(data.message ?? 'Reserva enviada. El conductor fue notificado.')
    } catch (e: any) {
      setError(e.message ?? 'Error al reservar')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="px-4 py-3 border-t border-slate-800">
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-3 text-sm text-teal-400">
          ✅ {done}
        </div>
        <button onClick={() => { setDone(null); setNote('') }}
          className="mt-2 text-xs text-slate-500 hover:text-teal-400">
          Hacer otra reserva
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-t border-slate-800 space-y-2">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        🎫 Reservar puesto{routeName ? ` — ${routeName}` : ''}
      </p>

      {full ? (
        <p className="text-xs text-red-400">Este colectivo va lleno por ahora.</p>
      ) : (
        <>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
            placeholder="Tu nombre"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5
                       text-sm text-white placeholder-slate-500 outline-none focus:border-teal-500" />

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Puestos</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setSeats(s => Math.max(1, s - 1))} disabled={seats <= 1}
                className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 text-white
                           disabled:opacity-40 active:scale-95">−</button>
              <span className="w-4 text-center text-sm font-semibold text-white">{seats}</span>
              <button onClick={() => setSeats(s => Math.min(max, s + 1))} disabled={seats >= max}
                className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 text-white
                           disabled:opacity-40 active:scale-95">+</button>
            </div>
          </div>

          <input value={note} onChange={e => setNote(e.target.value)} maxLength={140}
            placeholder="Dónde te recoge (opcional): esquina, tienda…"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5
                       text-sm text-white placeholder-slate-500 outline-none focus:border-teal-500" />

          {pickup && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={useGps} onChange={e => setUseGps(e.target.checked)} />
              Usar mi ubicación como punto de recogida
            </label>
          )}

          {baseFare ? (
            <p className="text-xs text-slate-500">
              Valor por puesto: ${Number(baseFare).toLocaleString('es-CO')} · se paga al conductor
            </p>
          ) : null}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={submit} disabled={busy}
            className="w-full py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-60
                       text-slate-950 font-bold rounded-xl text-sm transition active:scale-[0.98]">
            {busy ? 'Reservando…' : `Reservar ${seats} puesto${seats > 1 ? 's' : ''}`}
          </button>
        </>
      )}
    </div>
  )
}