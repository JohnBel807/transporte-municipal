# Guía de Despliegue — Transporte Municipal

## Prerequisitos

- Cuenta en Railway (plan Starter o superior)
- Railway CLI: `npm install -g @railway/cli`
- Docker Desktop (para builds locales)

---

## Primer despliegue

### 1. Preparar el repositorio

```bash
# Asegurarse de que .env no está en el repo
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore
echo "!.env.template" >> .gitignore
```

### 2. Crear el proyecto en Railway

```bash
railway login
railway init
# Seleccionar "Empty Project"
```

### 3. Añadir el plugin de PostgreSQL

```bash
railway add --plugin postgresql
```

Luego en el dashboard de Railway, conectar el plugin al servicio backend.
Railway inyectará `$DATABASE_URL` automáticamente.

### 4. Configurar secretos en Railway Dashboard

Variables → Add Variable (una por una, no usar archivos):

```
JWT_SECRET_KEY      → python -c "import secrets; print(secrets.token_hex(64))"
METRICS_TOKEN       → python -c "import secrets; print(secrets.token_hex(32))"
DATABASE_URL        → copiado del plugin de Postgres (ya inyectado automáticamente)
DATABASE_URL_SYNC   → igual que DATABASE_URL pero con postgresql:// en lugar de postgresql+asyncpg://
```

### 5. Habilitar PostGIS (una sola vez)

```bash
# Conectar a la BD de Railway
railway run psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS postgis;"
railway run psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;"
```

### 6. Desplegar

```bash
railway up
```

Railway ejecuta:
1. `docker build` usando `deploy/backend/Dockerfile`
2. `releaseCommand`: `alembic upgrade head` (migraciones)
3. Arranca el servidor

---

## Despliegues posteriores (CI/CD)

Railway detecta pushes a `main` automáticamente.
El flujo en cada push:

```
git push main
    │
    ▼
Railway build (Docker cache)
    │
    ▼
Release command: alembic upgrade head
    │  ← si falla, el deploy se cancela (BD segura)
    ▼
Nuevo contenedor arranca
    │
    ▼
Health check pasa → tráfico redirigido
    │
    ▼
Contenedor anterior eliminado
```

### Protección ante migraciones que rompen compatibilidad

Si la migración requiere downtime (ej: DROP COLUMN), usar el patrón
expand-contract:

```
Deploy 1: Añadir columna nueva (expand)   → código soporta ambas
Deploy 2: Migrar datos
Deploy 3: Eliminar columna antigua (contract)
```

---

## Añadir una zona nueva

```bash
# 1. Insertar en la BD (sin re-desplegar)
railway run psql $DATABASE_URL << 'EOF'
INSERT INTO zones (slug, name, center_lat, center_lng, default_zoom, ...)
VALUES ('garcia_rovira', 'García Rovira', 6.55, -72.75, 11, ...);
EOF

# 2. Si quiere una instancia frontend dedicada para esa zona:
railway service create frontend-garcia-rovira
railway variables set VITE_MAP_REGION=garcia_rovira \
    --service frontend-garcia-rovira
railway up --service frontend-garcia-rovira
```

---

## Verificar el despliegue

```bash
# Health check
curl https://api.tu-dominio.railway.app/health

# Métricas (requiere METRICS_TOKEN)
curl -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.tu-dominio.railway.app/metrics

# Verificar migraciones aplicadas
railway run alembic current
railway run alembic history --verbose
```

---

## Rollback

```bash
# Ver los últimos despliegues
railway deployments

# Revertir al despliegue anterior
railway rollback

# Si la migración ya se aplicó y necesitas revertirla:
railway run alembic downgrade -1
```
