import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient'

interface TaxiRequest {
  trip_id:         string
  passenger_name:  string
  origin_address:  string
  dest_address:    string
  estimated_fare:  { fare_total: number; km: number }
  is_night:        boolean
}

export function TaxiPendingRequests({
  onAccept,
}: {
  onAccept: (tripId: string) => void
}) {
  const queryClient = useQueryClient()

  const { data: requests = [] } = useQuery<TaxiRequest[]>({
    queryKey: ['taxi-pending-requests'],
    queryFn: async () => {
      const { data } = await api.get('/taxi/requests/pending')
      return data
    },
    refetchInterval: 5_000,
  })

  const acceptMutation = useMutation({
    mutationFn: (tripId: string) =>
      api.patch(`/taxi/trips/${tripId}/accept`),
    onSuccess: (_, tripId) => {
      onAccept(tripId)
      queryClient.invalidateQueries({ queryKey: ['taxi-pending-requests'] })
    },
    onError: (err: any) =>
      alert(err?.response?.data?.detail ?? 'Error al aceptar'),
  })

  if (requests.length === 0) {
    return (
      <div className="text-center py-4 text-slate-600 text-xs">
        Esperando solicitudes de taxi...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {requests.map(req => (
        <div key={req.trip_id}
             className="bg-slate-800 rounded-lg p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white">
                {req.passenger_name}
                {req.is_night && (
                  <span className="ml-1 text-amber-400">🌙 Nocturno</span>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                📍 {req.origin_address || 'Origen'}
              </p>
              <p className="text-xs text-slate-400 truncate">
                🏁 {req.dest_address || 'Destino'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-teal-400">
                ~${req.estimated_fare?.fare_total?.toLocaleString('es-CO')}
              </p>
              <p className="text-xs text-slate-500">
                ~{req.estimated_fare?.km?.toFixed(1)} km
              </p>
            </div>
          </div>
          <button
            disabled={acceptMutation.isPending}
            onClick={() => acceptMutation.mutate(req.trip_id)}
            className="w-full py-2 bg-teal-500 hover:bg-teal-400
                       disabled:opacity-50 text-slate-950 font-semibold
                       rounded-lg text-xs transition">
            Aceptar viaje
          </button>
        </div>
      ))}
    </div>
  )
}