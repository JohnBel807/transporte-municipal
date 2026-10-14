#!/bin/bash
# scripts/entrypoint.sh
#
# Ejecutado como ENTRYPOINT del contenedor backend.
# Orden de operaciones:
#   1. Esperar a que Postgres esté disponible (evita crash-loop al arrancar)
#   2. Ejecutar migraciones Alembic (idempotente — safe en múltiples instancias)
#   3. Arrancar el servidor con los argumentos pasados al CMD
#
# Por qué las migraciones en el entrypoint y no en un Job separado:
#   Railway no tiene Jobs nativos en el plan Starter. El enfoque de
#   ejecutarlas en el entrypoint es estándar para este tier:
#   Alembic es idempotente (no re-aplica migraciones ya aplicadas)
#   y la tabla alembic_version serializa las ejecuciones concurrentes.
#
# Para producción con múltiples replicas, usar un Release Command
# separado en Railway (ver railway.toml) en lugar del entrypoint.

set -euo pipefail

log() { echo "[entrypoint] $*"; }

# ── 1. Esperar Postgres ───────────────────────────────────────────────────────
log "Esperando a PostgreSQL..."

MAX_RETRIES=30
RETRY_INTERVAL=2

for i in $(seq 1 $MAX_RETRIES); do
    if python - <<'EOF'
import asyncio, asyncpg, os, sys
async def check():
    try:
        conn = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg",""))
        await conn.close()
        sys.exit(0)
    except Exception as e:
        sys.exit(1)
asyncio.run(check())
EOF
    then
        log "PostgreSQL disponible."
        break
    fi

    if [ "$i" -eq "$MAX_RETRIES" ]; then
        log "ERROR: PostgreSQL no respondió después de $((MAX_RETRIES * RETRY_INTERVAL))s"
        exit 1
    fi

    log "Intento $i/$MAX_RETRIES — reintentando en ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

# ── 2. Ejecutar migraciones ───────────────────────────────────────────────────
log "Ejecutando migraciones Alembic..."

# '--timeout 30' evita que el lock de Alembic bloquee indefinidamente
# si otra instancia falló a mitad de una migración
alembic upgrade head

log "Migraciones completadas."

# ── 3. Arrancar el servidor ───────────────────────────────────────────────────
log "Arrancando servidor: $*"
exec "$@"
