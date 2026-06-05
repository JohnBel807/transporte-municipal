import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' descarga el SW nuevo en background y lo activa
      // al siguiente reload — el conductor no ve interrupciones
      registerType: 'autoUpdate',

      // Incluir el SW en el build de producción
      injectRegister: 'auto',

      // Archivos que el SW pre-cachea al instalar
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],

      manifest: {
        name: 'Transporte Vélez & Ricaurte',
        short_name: 'TransporteVR',
        description: 'Panel de gestión de transporte municipal para las provincias de Vélez y Ricaurte',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',        // sin barra del navegador — se ve como app nativa
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'        // se adapta al círculo de Android
          }
        ],
        categories: ['transportation', 'utilities'],
        lang: 'es-CO',
        dir: 'ltr'
      },

      workbox: {
        // Estrategia: cache-first para activos estáticos,
        // network-first para llamadas a la API
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Rutas de la API — siempre intentar red primero
        // Si falla (sin conexión), usar la última respuesta cacheada
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.velezyricaurte\.com\/admin\/dashboard/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-dashboard',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 5,   // 5 minutos
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/api\.velezyricaurte\.com\/admin\/reports/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-reports',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60,  // 1 hora
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Tiles del mapa OpenStreetMap — cache agresivo
            // Los tiles no cambian frecuentemente
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30,  // 30 días
              },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],

        // No cachear el endpoint de auth — siempre requiere red
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth/],
      },

      // Página offline personalizada
      devOptions: {
        enabled: false,   // no activar SW en desarrollo local
      },
    }),
  ],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
