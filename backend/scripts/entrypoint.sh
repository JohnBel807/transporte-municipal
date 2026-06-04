#!/bin/bash
set -euo pipefail
log() { echo "[entrypoint] $*"; }

log "Esperando a PostgreSQL..."
MAX_RETRIES=30
for i in $(seq 1 $MAX_RETRIES); do
    if python -c "
import asyncio, asyncpg, os, sys
async def check():
    try:
        conn = await asyncpg.connect(os.environ['DATABASE_URL'].replace('+asyncpg',''))
        await conn.close(); sys.exit(0)
    except: sys.exit(1)
asyncio.run(check())
" 2>/dev/null; then
        log "PostgreSQL disponible."; break
    fi
    [ "$i" -eq "$MAX_RETRIES" ] && { log "ERROR: PostgreSQL no respondió"; exit 1; }
    log "Intento $i/$MAX_RETRIES..."; sleep 2
done

log "Ejecutando migraciones Alembic..."
alembic upgrade head
log "Migraciones completadas."
log "Arrancando servidor: $*"
exec "$@"
