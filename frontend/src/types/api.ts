// types/api.ts — contratos del backend en TypeScript

export interface LiveVehicle {
  route_id:           string
  route_name:         string
  driver_id:          string
  driver_name:        string
  driver_rating:      number
  plate:              string
  vehicle_type:       string
  lat:                number
  lng:                number
  heading:            number
  speed_kmh:          number
  passengers_aboard:  number
  capacity:           number
  occupancy_pct:      number
  next_stop:          string
  eta_seconds:        number
  signal_status:      'live' | 'stale' | 'offline'
  province:           string
  updated_at:         string
}

export interface DashboardSummary {
  total_active_routes:   number
  total_passengers_now:  number
  avg_occupancy_pct:     number
  routes_by_province:    Record<string, number>
  stale_signals:         number
  vehicles:              LiveVehicle[]
}

export interface RouteDemandsRow {
  route_id:          string
  route_name:        string
  province:          string
  total_trips:       number
  total_passengers:  number
  avg_passengers:    number
  avg_duration_min:  number
  peak_hour:         number
}

export interface VehicleDayRow {
  vehicle_id:        string
  plate:             string
  driver_name:       string
  vehicle_type:      string
  trips_today:       number
  total_passengers:  number
  total_distance_km: number
  active_hours:      number
  province:          string
}

export interface MobilityReport {
  date:              string
  province_filter:   string | null
  top_routes:        RouteDemandsRow[]
  vehicles_summary:  VehicleDayRow[]
  totals:            Record<string, unknown>
}

export interface DriverStatusResponse {
  driver_id:       string
  full_name:       string
  previous_state:  Record<string, unknown>
  current_state:   Record<string, unknown>
  action:          string
  reason:          string
  affected_routes: number
  message:         string
}
