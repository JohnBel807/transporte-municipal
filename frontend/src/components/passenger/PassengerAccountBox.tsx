import { useEffect, useState } from 'react'
import { useAuthStore } from '../../store/authStore'

const API = import.meta.env.VITE_API_URL ?? 'https://api.velezyricaurte.com'

function subFromToken(token: string): string {
  try { return JSON.parse(atob(token.split('.')[1])).sub ?? '' } catch { return '' }
}

export function PassengerAccountBox() {
  const { isAuthenticated, user, accessToken, login, logout } = useAuthStore()
  const isPassenger = isAuthenticated && user?.role === 'pasajero'

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Si la sesion ya es de pasajero, mostrar el nombre real desde el servidor.
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  useEffect(() => {
    if (!isPassenger || !accessToken) return
    fetch(`${API}/auth/passenger/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.full_name) setFullName(d.full_name) })
      .catch(() => {})
  }, [isPassenger, accessToken])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const path = mode === 'login' ? 'login' : 'register'
      const body = mode === 'login'
        ? { phone, pin }
        : { full_name: name.trim(), phone, pin }
      const res = await fetch(`${API}/auth/passenger/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = data.detail
        throw new Error(Array.isArray(d) ? (d[0]?.msg ?? 'Revisa los datos') : (d ?? 'No se pudo completar'))
      }
      login({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: {
          userId: subFromToken(data.access_token),
          fullName: name.trim() || 'Pasajero',
          role: 'pasajero',
        },
      })
      setPin('')
    } catch (err: any) {
      setError(err.message ?? 'Error de conexión')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-teal-500'

  if (isPassenger) {
    return (
      <div className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-sm">
        <span className="text-slate-300">Hola, {fullName || 'pasajero'}</span>
        <button onClick={logout} className="text-xs text-red-400">Cerrar sesión</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        {(['login', 'register'] as const).map(m => (
          <button key={m} type="button" onClick={() => { setMode(m); setError(null) }}
            className={`py-2 rounded-xl border text-xs font-semibold
              ${mode === m ? 'bg-teal-500/15 border-teal-500/50 text-teal-400'
                           : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
            {m === 'login' ? 'Ya tengo cuenta' : 'Crear cuenta'}
          </button>
        ))}
      </div>

      {mode === 'register' && (
        <input className={field} value={name} onChange={e => setName(e.target.value)}
          maxLength={60} placeholder="Tu nombre" required />
      )}
      <input className={field} value={phone} onChange={e => setPhone(e.target.value)}
        inputMode="tel" placeholder="Celular (ej. 3001234567)" required />
      <input className={field} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric" type="password" placeholder="PIN de 4 números" required />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button type="submit" disabled={busy}
        className="w-full py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-bold rounded-xl text-sm">
        {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : 'Crear mi cuenta'}
      </button>
      <p className="text-[11px] text-slate-500">
        No pedimos correo ni contraseña. Tu PIN protege tu historial de reservas.
      </p>
    </form>
  )
}