/**
 * authStore.ts
 *
 * Estado global de autenticación con Zustand.
 *
 * Estrategia de almacenamiento:
 * - Fuente de verdad: memoria (este store)
 * - Persistencia de sesión: sessionStorage
 * → el token desaparece si se cierra la pestaña
 * → immune a XSS de otras pestañas
 *
 * Upgrade path a producción:
 * Reemplazar sessionStorage por httpOnly cookies gestionadas
 * desde el backend. El store en memoria no cambia — solo
 * eliminar las llamadas a sessionStorage y que el navegador
 * envíe la cookie automáticamente en cada request.
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

// Rehidratar desde sessionStorage al cargar la página
function loadSession(): Partial<AuthState> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
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
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      set({ ...session, isAuthenticated: true })
    },

    logout: () => {
      sessionStorage.removeItem(SESSION_KEY)
      set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false })
    },

    setAccessToken: (token: string) => {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) {
        const session = JSON.parse(raw)
        session.accessToken = token
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      }
      set({ accessToken: token })
    },
  }
})