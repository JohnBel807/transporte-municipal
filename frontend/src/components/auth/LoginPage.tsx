/**
 * LoginPage.tsx
 * Pantalla de autenticación del panel de administración.
 */
import { useState } from 'react'
import { useNavigate }  from 'react-router-dom'
import { useMutation }  from '@tanstack/react-query'
import { api }          from '../../services/apiClient'
import { useAuthStore } from '../../store/authStore'

interface LoginPayload { email: string; password: string }
interface LoginResponse {
  access_token:  string
  refresh_token: string
  role:          string
}

async function loginRequest(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', payload)
  return data
}

export function LoginPage() {
  const navigate = useNavigate()
  const login    = useAuthStore((s) => s.login)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  const mutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (data) => {
      if (data.role !== 'admin') {
        mutation.reset()
        alert('Solo los administradores pueden acceder a este panel.')
        return
      }
      // Decodificar nombre del JWT (payload base64)
      const payload = JSON.parse(atob(data.access_token.split('.')[1]))
      login({
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        user: { userId: payload.sub, fullName: payload.name ?? 'Admin', role: 'admin' },
      })
      navigate('/dashboard')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate({ email, password })
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo / Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16
                          bg-teal-500/10 border border-teal-500/30
                          rounded-2xl mb-4">
            <svg className="w-8 h-8 text-teal-400" fill="none" viewBox="0 0 24 24"
                 stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                    d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3
                       0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25
                       4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621
                       0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193
                       2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177
                       v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0
                       00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677
                       m0 4.5v-4.5m0 0h-12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Panel de Administración
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Provincias de Vélez y Ricaurte
          </p>
        </div>

        {/* Card del formulario */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl
                           px-4 py-3 text-white placeholder-slate-500 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-500
                           focus:border-transparent transition"
                placeholder="admin@transporte.gov.co"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-slate-800 border border-slate-700 rounded-xl
                           px-4 py-3 text-white placeholder-slate-500 text-sm
                           focus:outline-none focus:ring-2 focus:ring-teal-500
                           focus:border-transparent transition"
                placeholder="••••••••"
              />
            </div>

            {/* Error */}
            {mutation.isError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl
                              px-4 py-3 text-red-400 text-sm">
                {(mutation.error as Error)?.message ?? 'Credenciales inválidas'}
              </div>
            )}

            <button
              type="submit"
              disabled={mutation.isPending}
              className="w-full bg-teal-500 hover:bg-teal-400 disabled:bg-teal-500/50
                         text-slate-950 font-semibold rounded-xl py-3 text-sm
                         transition-all duration-200 flex items-center justify-center gap-2"
            >
              {mutation.isPending ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Verificando…
                </>
              ) : 'Iniciar sesión'}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Acceso restringido a personal autorizado
        </p>
      </div>
    </div>
  )
}
