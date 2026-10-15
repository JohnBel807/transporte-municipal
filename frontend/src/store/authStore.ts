/**
 * authStore.ts
 *
 * Estado global de autenticaciÃ³n con Zustand.
 *
 * Estrategia de almacenamiento:
 * - Fuente de verdad: memoria (este store)
 * - Persistencia de sesiÃ³n: localStorage
 * â†’ el token desaparece si se cierra la pestaÃ±a
 * â†’ immune a XSS de otras pestaÃ±as
 *
 * Upgrade path a producciÃ³n:
 * Reemplazar localStorage por httpOnly cookies gestionadas
 * desde el backend. El store en memoria no cambia â€” solo
 * eliminar las llamadas a localStorage y que el navegador
 * envÃ­e la cookie automÃ¡ticamente en cada request.
 */
import { create } from 'zustand'

const SESSION_KEY = 'admin_session'

interface AdminUser {
  userId:   string
  fullName: string
  role:     string
}

interface AuthState {
  user:         AdminUser | null
  accessToken:  string | null
  refreshToken: string | null
  isAuthenticated: boolean

  // Actions
  login:  (tokens: { accessToken: string; refreshToken: string; user: AdminUser }) => void
  logout: () => void
  setAccessToken: (token: string) => void
}

// Rehidratar desde localStorage al cargar la pÃ¡gina
function loadSession(): Partial<AuthState> {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export const useAuthStore = create<AuthState>((set) => {
  const saved = loadSession()

  return {
    user:            saved.user         ?? null,
    accessToken:     saved.accessToken  ?? null,
    refreshToken:    saved.refreshToken ?? null,
    isAuthenticated: !!saved.accessToken,

    login: ({ accessToken, refreshToken, user }) => {
      const session = { accessToken, refreshToken, user }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      set({ ...session, isAuthenticated: true })
    },

    logout: () => {
      localStorage.removeItem(SESSION_KEY)
      set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
    },

    setAccessToken: (token: string) => {
      const raw = localStorage.getItem(SESSION_KEY)
      if (raw) {
        const session = JSON.parse(raw)
        session.accessToken = token
        localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      }
      set({ accessToken: token })
    },
  }
})