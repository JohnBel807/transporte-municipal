/**
 * regions.ts — configuración multi-región del mapa
 *
 * Cada región define:
 *   · center: coordenadas iniciales del mapa
 *   · zoom: nivel de zoom por defecto
 *   · bounds: límites máximos del mapa (evitar que el admin
 *             navegue a zonas irrelevantes)
 *   · label: nombre para la UI
 *
 * La región activa se resuelve en este orden de precedencia:
 *   1. Variable de entorno VITE_MAP_REGION (CI / Docker)
 *   2. localStorage 'admin_map_region' (preferencia guardada del admin)
 *   3. DEFAULT_REGION (fallback hardcoded)
 *
 * Para agregar una nueva región:
 *   1. Añadir entrada en REGIONS
 *   2. Establecer VITE_MAP_REGION=nueva_clave en el .env del despliegue
 *   → Sin tocar ningún componente
 */

export interface RegionConfig {
  id:       string
  label:    string
  center:   [number, number]   // [lat, lng] — orden que usa Leaflet
  zoom:     number
  minZoom:  number
  maxZoom:  number
  bounds?:  [[number, number], [number, number]]  // SW, NE
  tileUrl:  string             // permite tile layers distintos por región
}

export const REGIONS: Record<string, RegionConfig> = {
  velez_ricaurte: {
    id:      'velez_ricaurte',
    label:   'Vélez & Ricaurte',
    center:  [5.90, -73.90],
    zoom:    11,
    minZoom: 9,
    maxZoom: 17,
    bounds:  [[5.45, -74.30], [6.15, -73.50]],
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },

  bogota: {
    id:      'bogota',
    label:   'Bogotá D.C.',
    center:  [4.711, -74.072],
    zoom:    12,
    minZoom: 10,
    maxZoom: 18,
    bounds:  [[4.45, -74.25], [4.85, -73.99]],
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },

  medellin: {
    id:      'medellin',
    label:   'Medellín',
    center:  [6.244, -75.581],
    zoom:    13,
    minZoom: 11,
    maxZoom: 18,
    bounds:  [[6.10, -75.72], [6.40, -75.45]],
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },

  // Plantilla para añadir regiones nuevas sin tocar componentes:
  // nueva_ciudad: {
  //   id:     'nueva_ciudad',
  //   label:  'Nueva Ciudad',
  //   center: [LAT, LNG],
  //   zoom:   12,
  //   minZoom: 9,
  //   maxZoom: 18,
  //   tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  // },
}

export const DEFAULT_REGION = 'velez_ricaurte'

/**
 * Resuelve la región activa con el orden de precedencia documentado arriba.
 * Devuelve siempre un RegionConfig válido — nunca undefined.
 */
export function resolveActiveRegion(): RegionConfig {
  const fromEnv     = import.meta.env.VITE_MAP_REGION as string | undefined
  const fromStorage = typeof localStorage !== 'undefined'
                        ? localStorage.getItem('admin_map_region') ?? ''
                        : ''

  const key = (fromEnv || fromStorage || DEFAULT_REGION).trim()
  return REGIONS[key] ?? REGIONS[DEFAULT_REGION]
}

/**
 * Persiste la preferencia del admin en localStorage.
 * Útil cuando el admin cambia de región desde la UI.
 */
export function saveRegionPreference(regionId: string): void {
  if (REGIONS[regionId]) {
    localStorage.setItem('admin_map_region', regionId)
  }
}
