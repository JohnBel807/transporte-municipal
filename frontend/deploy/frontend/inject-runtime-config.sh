#!/bin/sh
# Eliminar la configuración por defecto de Nginx
rm -f /etc/nginx/conf.d/default.conf
#!/bin/sh
# inject-runtime-config.sh
#
# Problema que resuelve:
#   Las variables VITE_* se embeben en el bundle durante el BUILD.
#   Si quieres cambiar VITE_MAP_REGION sin reconstruir la imagen
#   (ej: mismo Dockerfile para Vélez y para Ricaurte en Railway),
#   este script genera un archivo runtime-config.js que el HTML
#   carga antes que el bundle de React.
#
# Uso en el código React:
#   const region = window.__RUNTIME_CONFIG__?.MAP_REGION
#               ?? import.meta.env.VITE_MAP_REGION
#               ?? 'velez_ricaurte'
#
# Las variables VITE_* siguen funcionando como fallback.

CONFIG_FILE="/usr/share/nginx/html/runtime-config.js"

cat > "$CONFIG_FILE" <<EOF
window.__RUNTIME_CONFIG__ = {
  API_URL:          "${VITE_API_URL:-}",
  MAP_REGION:       "${VITE_MAP_REGION:-velez_ricaurte}",
  POLL_INTERVAL_MS: ${VITE_POLL_INTERVAL_MS:-3000},
  MAP_TILE_URL:     "${VITE_MAP_TILE_URL:-https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png}",
};
EOF

echo "[inject-runtime-config] Generado runtime-config.js con MAP_REGION=${VITE_MAP_REGION:-velez_ricaurte}"
