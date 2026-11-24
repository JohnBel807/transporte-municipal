import { useThemeStore } from '../../store/themeStore'
import { PassengerAccountBox } from '../passenger/PassengerAccountBox'
import { SupportReportBox } from '../passenger/SupportReportBox'

interface Props {
  isAuthenticated: boolean
  userName?: string
  role?: string
  onGoPanel: () => void
  onLogin: () => void
  onLogout: () => void
}

export function SettingsPanel({ isAuthenticated, userName, role, onGoPanel, onLogin, onLogout }: Props) {
  const { theme, setTheme } = useThemeStore()
  const row = 'w-full flex items-center justify-between px-4 py-3.5 rounded-2xl bg-slate-800 border border-slate-700 text-sm'

  // Conductor y admin tienen panel propio; el pasajero gestiona su cuenta en la caja de abajo.
  const isStaff = isAuthenticated && (role === 'conductor' || role === 'admin')

  return (
    <div className="p-4 space-y-3 pb-6">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Apariencia</p>
      <div className="grid grid-cols-2 gap-2">
        {([['light', '☀️ Claro'], ['dark', '🌙 Oscuro']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTheme(k)}
            className={`py-3 rounded-2xl border text-sm font-semibold transition active:scale-95
              ${theme === k ? 'bg-teal-500/15 border-teal-500/50 text-teal-400'
                            : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
            {label}
          </button>
        ))}
      </div>

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-2">Cuenta</p>
      {isStaff ? (
        <>
          <div className={row}>
            <span className="text-slate-300">{userName ?? 'Usuario'}</span>
            <span className="text-xs text-slate-500 capitalize">{role}</span>
          </div>
          <button onClick={onGoPanel} className={`${row} text-teal-400 font-semibold`}>
            Ir a mi panel <span>›</span>
          </button>
          <button onClick={onLogout} className={`${row} text-red-400`}>
            Cerrar sesión <span>↪</span>
          </button>
        </>
      ) : (
        <>
          {/* Registro / ingreso de pasajero (celular + PIN) */}
          <PassengerAccountBox />
          <button onClick={onLogin}
            className="w-full text-center text-xs text-slate-500 hover:text-teal-400 pt-1">
            ¿Eres conductor o administrador? Ingresa aquí
          </button>
        </>
      )}

      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider pt-2">Acerca de</p>
      <div className={row}>
        <span className="text-slate-300">VERI · Vélez &amp; Ricaurte</span>
        <span className="text-xs text-slate-500">Transporte municipal</span>
      </div>

      {/* Botón / caja de reporte del pasajero */}
      <SupportReportBox />
    </div>
  )
}