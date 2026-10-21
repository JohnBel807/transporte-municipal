import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface TripStatus {
  trip_id:        string
  status:         string
  passenger_name: string
  fare_current:   { fare_total: number; km: number; minutes: number; fare_breakdown: any } | null
  fare_total:     number | null
}

const ROAD_TYPES = [
  { value: 'pavimentada', label: 'Pavimentada', emoji: '🛣️' },
  { value: 'destapada',   label: 'Destapada',   emoji: '🪨' },
  { value: 'trocha',      label: 'Trocha',       emoji: '🌿' },
]

export function TaxiTripPanel({
  tripId,
  onComplete,
}: {
  tripId:     string
  onComplete: () => void
}) {
  const queryClient = useQueryClient()
  const [roadType, setRoadType] = useState('pavimentada')
  const [confirming, setConfirming] = useState(false)

  const { data: trip } = useQuery<TripStatus>({
    queryKey: ['taxi-trip', tripId],
    queryFn: async () => {
      const { data } = await api.get(`/taxi/trips/${tripId}/status`)
      return data
    },
    refetchInterval: 5_000,
  })

  const arrivedMutation = useMutation({
    mutationFn: () => api.patch(`/taxi/trips/${tripId}/arrived`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['taxi-trip', tripId] }),
  })

  const boardMutation = useMutation({
    mutationFn: () =>
      api.patch(`/taxi/trips/${tripId}/board`, { road_type: roadType }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['taxi-trip', tripId] }),
  })

  const completeMutation = useMutation({
    mutationFn: () => api.patch(`/taxi/trips/${tripId}/complete`),
    onSuccess: () => {
      setConfirming(false)
      onComplete()
    },
    onError: (err: any) =>
      alert(err?.response?.data?.detail ?? 'Error al finalizar'),
  })

  if (!trip) return (
    <div className="h-16 bg-slate-800 animate-pulse rounded-lg"/>
  )

  const STATUS_LABEL: Record<string, string> = {
    aceptado:  'Dirígete al pasajero',
    esperando: 'Esperando al pasajero',
    en_curso:  'Viaje en curso',
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-white">
            {trip.passenger_name}
          </p>
          <p className="text-xs text-teal-400">
            {STATUS_LABEL[trip.status] ?? trip.status}
          </p>
        </div>
        <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"/>
      </div>

      {/* Taxímetro */}
      {trip.status === 'en_curso' && trip.fare_current && (
        <div className="bg-slate-900 rounded-lg p-3 text-center">
          <p className="text-3xl font-bold text-white">
            ${trip.fare_current.fare_total.toLocaleString('es-CO')}
          </p>
          <div className="flex justify-center gap-4 mt-1">
            <span className="text-xs text-slate-500">
              {trip.fare_current.km.toFixed(1)} km
            </span>
            <span className="text-xs text-slate-500">
              {trip.fare_current.minutes} min
            </span>
          </div>
          {/* Desglose */}
          <div className="mt-2 space-y-0.5 text-left">
            {[
              ['Arranque', trip.fare_current.fare_breakdown?.fare_base],
              ['Recorrido', trip.fare_current.fare_breakdown?.fare_km],
              ['Tiempo', trip.fare_current.fare_breakdown?.fare_time],
              ['Recargos', trip.fare_current.fare_breakdown?.fare_surcharges],
            ].map(([label, val]) => val > 0 ? (
              <div key={label as string}
                   className="flex justify-between text-xs text-slate-500">
                <span>{label}</span>
                <span>${(val as number).toLocaleString('es-CO')}</span>
              </div>
            ) : null)}
          </div>
        </div>
      )}

      {/* Acciones según estado */}
      {trip.status === 'aceptado' && (
        <button
          disabled={arrivedMutation.isPending}
          onClick={() => arrivedMutation.mutate()}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-400
                     disabled:opacity-50 text-slate-950 font-semibold
                     rounded-lg text-sm transition">
          Llegué al punto de recogida
        </button>
      )}

      {trip.status === 'esperando' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Tipo de vía:</p>
          <div className="grid grid-cols-3 gap-2">
            {ROAD_TYPES.map(rt => (
              <button key={rt.value}
                onClick={() => setRoadType(rt.value)}
                className={`py-2 text-xs font-medium rounded-lg border transition
                  ${roadType === rt.value
                    ? 'bg-teal-500/20 border-teal-500/50 text-teal-400'
                    : 'bg-slate-700 border-slate-600 text-slate-400'}`}>
                {rt.emoji}<br/>{rt.label}
              </button>
            ))}
          </div>
          <button
            disabled={boardMutation.isPending}
            onClick={() => boardMutation.mutate()}
            className="w-full py-2.5 bg-teal-500 hover:bg-teal-400
                       disabled:opacity-50 text-slate-950 font-semibold
                       rounded-lg text-sm transition">
            Pasajero abordó — Iniciar taxímetro
          </button>
        </div>
      )}

      {trip.status === 'en_curso' && (
        confirming ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 text-center">
              ¿Confirmar fin del viaje?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 py-2 text-sm border border-slate-700
                           rounded-lg text-slate-400 hover:bg-slate-700 transition">
                Cancelar
              </button>
              <button
                disabled={completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
                className="flex-1 py-2 text-sm bg-teal-500 hover:bg-teal-400
                           disabled:opacity-50 text-slate-950 font-semibold
                           rounded-lg transition">
                {completeMutation.isPending ? 'Finalizando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="w-full py-2.5 bg-red-500/15 border border-red-500/30
                       rounded-lg text-red-400 font-medium text-sm
                       hover:bg-red-500/25 transition">
            Finalizar viaje
          </button>
        )
      )}
    </div>
  )
}