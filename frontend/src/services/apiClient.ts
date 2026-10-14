/**
 * apiClient.ts
 *
 * Cliente Axios con interceptor que renueva el access token
 * automáticamente cuando recibe un 401.
 *
 * El conductor (o admin) nunca ve un error de sesión expirada
 * mientras el refresh token siga válido.
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
})

// ── Interceptor de request: adjuntar token ────────────────────────────────

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Interceptor de response: renovar token en 401 ────────────────────────

let isRefreshing = false
let pendingQueue: Array<{
  resolve: (token: string) => void
  reject:  (err: unknown)  => void
}> = []

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    if (error.response?.status !== 401 || original._retried) {
      return Promise.reject(error)
    }

    original._retried = true

    if (isRefreshing) {
      // Encolar requests que llegaron mientras se renovaba el token
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      })
    }

    isRefreshing = true
    const { refreshToken, setAccessToken, logout } = useAuthStore.getState()

    try {
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })

      const newToken: string = data.access_token
      setAccessToken(newToken)

      // Resolver todos los requests encolados
      pendingQueue.forEach(({ resolve }) => resolve(newToken))
      pendingQueue = []

      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)

    } catch (refreshError) {
      pendingQueue.forEach(({ reject }) => reject(refreshError))
      pendingQueue = []
      logout()
      window.location.href = '/login'
      return Promise.reject(refreshError)

    } finally {
      isRefreshing = false
    }
  }
)
