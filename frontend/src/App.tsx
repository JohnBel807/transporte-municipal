import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { LoginPage }         from './components/auth/LoginPage'
import { DashboardPage }     from './components/map/DashboardPage'
import { ReportsPage }       from './components/reports/ReportsPage'
import { DriverRegisterPage } from './components/admin/DriverRegisterPage'
import { DriverHomePage }    from './components/driver/DriverHomePage'
import { DriverRouteCreatePage } from './components/driver/DriverRouteCreatePage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 0 } },
})

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function RoleRedirect() {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'conductor') return <Navigate to="/conductor" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login"     element={<LoginPage />} />
          <Route path="/"          element={<RoleRedirect />} />

          <Route path="/driver/routes/new" element={<RequireAuth><DriverRouteCreatePage /></RequireAuth>}/>
          {/* Rutas de administrador */}
          <Route path="/dashboard" element={
            <RequireAuth><DashboardPage /></RequireAuth>
          }/>
          <Route path="/reports"   element={
            <RequireAuth><ReportsPage /></RequireAuth>
          }/>
          <Route path="/drivers/new" element={
            <RequireAuth><DriverRegisterPage /></RequireAuth>
          }/>

          {/* Rutas de conductor */}
          <Route path="/conductor" element={
            <RequireAuth><DriverHomePage /></RequireAuth>
          }/>

          <Route path="*" element={<RoleRedirect />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}