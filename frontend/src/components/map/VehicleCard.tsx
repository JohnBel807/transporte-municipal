/**
 * VehicleCard.tsx
 * Tarjeta de un vehículo activo en el panel lateral del dashboard.
 */
import { LiveVehicle } from '../../types/api'

interface Props {
  vehicle:    LiveVehicle
  isSelected: boolean
  onClick:    () => void
}

const SIGNAL_CONFIG = {
  live:    { dot: 'bg-teal-400 animate-pulse', text: 'text-teal-400',  label: 'En vivo' },
  stale:   { dot: 'bg-amber-400',              text: 'text-amber-400', label: 'Señal débil' },
  offline: { dot: 'bg-red-500',                text: 'text-red-500',   label: 'Sin señal' },
}

function OccupancyBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? 'bg-red-400'
              : pct >= 70 ? 'bg-amber-400'
              : 'bg-teal-400'
  return (
    <div className="w-full bg-slate-700/60 rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

export function VehicleCard({ vehicle, isSelected, onClick }: Props) {
  const signal  = SIGNAL_CONFIG[vehicle.signal_status] ?? SIGNAL_CONFIG.offline
  const etaMin  = Math.ceil(vehicle.eta_seconds / 60)
  const headingLabel = `${vehicle.heading}°`

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all duration-200
                  ${isSelected
                    ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-900/20'
                    : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'
                  }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {vehicle.route_name}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {vehicle.plate} · {vehicle.driver_name}
          </p>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <div className={`w-2 h-2 rounded-full ${signal.dot}`} />
          <span className={`text-xs font-medium ${signal.text}`}>
            {signal.label}
          </span>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <p className="text-lg font-bold text-white leading-none">
            {vehicle.speed_kmh.toFixed(0)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">km/h</p>
        </div>
        <div className="text-center border-x border-slate-700/60">
          <p className="text-lg font-bold text-white leading-none">
            {vehicle.passengers_aboard}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            /{vehicle.capacity} pas.
          </p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white leading-none">
            {etaMin > 0 ? `${etaMin}` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {etaMin > 0 ? 'min ETA' : 'ETA'}
          </p>
        </div>
      </div>

      {/* Barra de ocupación */}
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">Ocupación</span>
          <span className="text-xs text-slate-400 font-medium">
            {vehicle.occupancy_pct}%
          </span>
        </div>
        <OccupancyBar pct={vehicle.occupancy_pct} />
      </div>

      {/* Próxima parada */}
      {vehicle.next_stop && (
        <p className="text-xs text-slate-500 mt-2.5 truncate">
          → {vehicle.next_stop}
        </p>
      )}
    </button>
  )
}
