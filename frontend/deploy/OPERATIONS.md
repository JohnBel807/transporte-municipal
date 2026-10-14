# Runbook de Operaciones — Transporte Municipal

**Audiencia:** Equipo de operaciones, administradores de sistema, ingenieros de guardia.
**Propósito:** Procedimientos paso a paso para las operaciones más frecuentes y críticas.
**Convención:** Los bloques marcados con ⚠️ requieren confirmación antes de ejecutar en producción.

---

## Índice

1. [Agregar una nueva zona (provincia)](#1-agregar-una-nueva-zona-provincia)
2. [Interpretar y responder a `ETAConfidenceDegraded`](#2-interpretar-y-responder-a-etaconfidencedegraded)
3. [Rollback de emergencia](#3-rollback-de-emergencia)
4. [Referencia rápida de comandos](#4-referencia-rápida-de-comandos)

---

## 1. Agregar una nueva zona (provincia)

### Cuándo ejecutar este procedimiento

Cuando la organización decide extender el servicio a una nueva provincia.
Tiempo estimado: 45–90 minutos dependiendo de la disponibilidad del shapefile.

### Precondiciones

- [ ] Acceso a Railway CLI autenticado (`railway whoami`)
- [ ] Acceso a la BD de producción (`railway run psql $DATABASE_URL`)
- [ ] Shapefile o GeoJSON de la provincia desde el DANE o fuente oficial
- [ ] Coordenadas del centro geográfico de la zona (Google Maps sirve)
- [ ] Decisión tomada sobre tarifa base y tolerancia de ruta (con el equipo de negocio)

---

### Paso 1 — Validar que la geometría es correcta antes de tocar producción

Nunca cargar un polígono sin verificarlo localmente primero.
Un polígono malformado hace que `ST_Within` devuelva siempre falso,
bloqueando la activación de rutas en toda la zona.

```bash
# Instalar ogr2ogr si no está disponible
brew install gdal   # macOS
apt-get install gdal-bin  # Ubuntu

# Verificar que el GeoJSON es válido y está en WGS84 (EPSG:4326)
ogrinfo -al -so nueva_zona.geojson

# La salida debe mostrar:
#   Geometry: Multi Polygon
#   SRS WKT: GEOGCS["WGS 84" ...
# Si muestra otro SRS, reproyectar:
ogr2ogr -t_srs EPSG:4326 nueva_zona_wgs84.geojson nueva_zona.geojson
```

```sql
-- Verificar en una BD local antes de producción
-- El resultado debe ser TRUE para coordenadas conocidas dentro de la zona
SELECT ST_IsValid(
    ST_GeomFromGeoJSON('{ "type": "Polygon", "coordinates": [...] }')
);
-- Debe devolver: t

-- Verificar que un punto conocido cae dentro del polígono
SELECT ST_Within(
    ST_MakePoint(-73.677, 6.013),  -- coordenadas del centro
    ST_GeomFromGeoJSON('...')
);
-- Debe devolver: t
```

---

### Paso 2 — Insertar la zona en la base de datos

```sql
-- Conectar a producción
-- railway run psql $DATABASE_URL

BEGIN;

-- 2a. Insertar la cabecera de la zona (sin geometría todavía)
INSERT INTO zones (
    slug,
    name,
    country_code,
    timezone,
    locale,
    currency,
    center_lat,
    center_lng,
    default_zoom,
    max_route_tolerance_m,
    max_active_routes,
    driver_inactivity_min,
    default_base_fare,
    enforce_geofencing,
    is_active,
    launched_at,
    metadata
)
VALUES (
    'garcia_rovira',                    -- slug: minúsculas, sin espacios, único
    'Provincia de García Rovira',       -- nombre completo para la UI
    'CO',
    'America/Bogota',
    'es-CO',
    'COP',
    6.5500,                             -- latitud del centro
    -72.7500,                           -- longitud del centro
    11,                                 -- zoom inicial del mapa (9-13 según extensión)
    350,                                -- metros de tolerancia para matching de rutas
    100,                                -- máximo de rutas activas simultáneas
    5,                                  -- minutos sin GPS antes de marcar conductor inactivo
    3500.00,                            -- tarifa base en COP
    TRUE,                               -- aplicar geofencing al activar rutas
    FALSE,                              -- is_active = FALSE hasta cargar la geometría
    NULL,                               -- launched_at: se setea en el Paso 4
    '{"contact_email": "ops@garcia-rovira.gov.co"}'
)
ON CONFLICT (slug) DO NOTHING;

-- Verificar que se insertó
SELECT id, slug, name, is_active FROM zones WHERE slug = 'garcia_rovira';

COMMIT;
```

---

### Paso 3 — Cargar la geometría del polígono

```sql
-- Opción A: desde GeoJSON (recomendada si tienes el archivo)
BEGIN;

UPDATE zones
SET geom = ST_Multi(
    ST_GeomFromGeoJSON(
        -- Pegar aquí el contenido del campo "geometry" del GeoJSON
        -- (solo el objeto geometry, no el Feature completo)
        '{
            "type": "Polygon",
            "coordinates": [
                [[-72.50, 6.30], [-73.00, 6.30], [-73.00, 6.80],
                 [-72.50, 6.80], [-72.50, 6.30]]
            ]
        }'
    )
)::GEOMETRY(MULTIPOLYGON, 4326)
WHERE slug = 'garcia_rovira';

-- El trigger trg_zone_update_bbox recalcula el bbox automáticamente.
-- Verificar que quedó correcto:
SELECT
    slug,
    ST_AsText(ST_Centroid(geom))        AS centroid_calculado,
    ST_Area(geom::GEOGRAPHY) / 1e6      AS area_km2,
    ST_AsText(bbox)                     AS bbox
FROM zones
WHERE slug = 'garcia_rovira';

-- El centroid_calculado debe ser cercano al center_lat/center_lng del Paso 2.
-- area_km2 debe ser razonable para la provincia (consultar Wikipedia si dudas).

COMMIT;


-- Opción B: desde un archivo shapefile local (requiere acceso al servidor)
-- ogr2ogr -f "PostgreSQL" PG:"$DATABASE_URL_SYNC" nueva_zona_wgs84.geojson \
--     -nln zones_import -t_srs EPSG:4326
-- UPDATE zones SET geom = ST_Multi(wkb_geometry)
-- FROM zones_import WHERE zones_import.nombre = 'García Rovira';
```

---

### Paso 4 — Verificar el geofencing antes de activar

```sql
-- Probar con coordenadas conocidas DENTRO de la zona
SELECT
    name,
    ST_Within(
        ST_MakePoint(-72.75, 6.55)::GEOMETRY,  -- punto dentro de García Rovira
        geom
    ) AS punto_interior_ok,
    ST_Within(
        ST_MakePoint(-74.07, 4.71)::GEOMETRY,  -- Bogotá — debe ser FALSE
        geom
    ) AS bogota_excluida_ok
FROM zones
WHERE slug = 'garcia_rovira';

-- Resultado esperado:
-- punto_interior_ok: t
-- bogota_excluida_ok: f
```

Si cualquier resultado es incorrecto, **no continuar**. Revisar el polígono.

---

### Paso 5 — Activar la zona

```sql
-- Solo ejecutar si el Paso 4 pasó correctamente
BEGIN;

UPDATE zones
SET
    is_active   = TRUE,
    launched_at = NOW()
WHERE slug = 'garcia_rovira';

COMMIT;

-- Confirmar
SELECT slug, is_active, launched_at FROM zones WHERE slug = 'garcia_rovira';
```

---

### Paso 6 — Desplegar el frontend para la nueva zona

```bash
# Si la zona comparte frontend con las existentes (selector de región en la UI):
# No requiere nuevo despliegue — la zona ya aparece desde la BD.

# Si quieres una URL dedicada para esta provincia (recomendado):
railway service create frontend-garcia-rovira

railway variables set \
    VITE_MAP_REGION=garcia_rovira \
    VITE_API_URL=https://api.tu-dominio.railway.app \
    --service frontend-garcia-rovira

railway up --service frontend-garcia-rovira
```

---

### Paso 7 — Crear los usuarios administradores de la zona

```sql
-- Crear el admin local de García Rovira
BEGIN;

INSERT INTO users (
    email, phone, password_hash, full_name,
    role, is_active, zone_id
)
SELECT
    'admin@garcia-rovira.gov.co',
    '+573011234567',
    -- Generar hash con: python -c "from passlib.context import CryptContext;
    --   print(CryptContext(['bcrypt']).hash('PASSWORD_TEMPORAL'))"
    '$2b$12$REEMPLAZAR_CON_HASH_REAL',
    'Admin García Rovira',
    'admin',
    TRUE,
    id
FROM zones WHERE slug = 'garcia_rovira';

COMMIT;
```

```bash
# Comunicar la contraseña temporal por canal seguro (no por email ni Slack)
# El admin debe cambiarla en el primer login
```

---

### Paso 8 — Verificación final

```bash
# Verificar que la zona aparece en el dashboard global
curl -s -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
     https://api.tu-dominio.railway.app/admin/dashboard \
     | python3 -m json.tool | grep garcia_rovira

# Verificar las métricas de la nueva zona
curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.tu-dominio.railway.app/metrics \
     | grep garcia_rovira
# Debe aparecer vehicles_active{zone_slug="garcia_rovira"} 0
# (0 vehículos es correcto — la zona acaba de abrirse)
```

### Lista de verificación post-lanzamiento

- [ ] Polígono validado (`ST_IsValid = t`, punto interior = `t`, Bogotá = `f`)
- [ ] `is_active = TRUE` en la tabla `zones`
- [ ] Frontend desplegado con `VITE_MAP_REGION=garcia_rovira`
- [ ] Admin local creado y contraseña comunicada de forma segura
- [ ] Métricas aparecen en `/metrics` con `zone_slug="garcia_rovira"`
- [ ] Al menos un conductor de prueba puede registrarse y activar una ruta

---

## 2. Interpretar y responder a `ETAConfidenceDegraded`

### Qué significa esta alerta

```
ALERT: ETAConfidenceDegraded
zone_slug: garcia_rovira
value: 0.73  (73% de ETAs con confianza "estimada")
for: 15m
```

El sistema calcula el ETA usando tres capas de confianza:

| Confianza | Fuente | Condición |
|-----------|--------|-----------|
| `alta` | Velocidad GPS actual del vehículo | `speed_kmh > 3` |
| `media` | Historial del segmento (≥5 muestras) | Conductor detenido, hay historial |
| `estimada` | Velocidad base por hora del día | Sin historial suficiente |

Esta alerta se dispara cuando **más del 60% de los ETAs** en la zona
usan la capa `estimada` durante 15 minutos continuos.

Los pasajeros ven `±4 min` en lugar de `~4 min` o `4 min`,
pero el sistema funciona correctamente — la alerta es de **calidad**,
no de disponibilidad.

---

### Árbol de decisión para diagnosticar la causa

```
¿La zona fue lanzada hace menos de 2 semanas?
│
├── SÍ → Causa: historial insuficiente (esperado)
│         → Ir a: Respuesta A — Zona nueva
│
└── NO → ¿La alerta apareció de forma abrupta?
          │
          ├── SÍ → Causa: posible pérdida de datos históricos
          │         → Ir a: Respuesta B — Degradación repentina
          │
          └── NO → ¿La alerta solo ocurre en ciertas horas?
                    │
                    ├── SÍ → Causa: horario sin cobertura histórica
                    │         → Ir a: Respuesta C — Hora pico nueva
                    │
                    └── NO → Causa: conductores nuevos en segmentos nuevos
                              → Ir a: Respuesta A — con foco en segmentos
```

---

### Respuesta A — Zona nueva o segmentos sin historial (lo más común)

**Diagnóstico:** confirmar cuántas muestras tiene el segmento más transitado.

```sql
-- Identificar segmentos con historial insuficiente
SELECT
    rw_from.place_name                  AS desde,
    rw_to.place_name                    AS hasta,
    ssh.hour_of_day                     AS hora,
    ssh.avg_speed_kmh,
    ssh.sample_count,
    CASE
        WHEN ssh.sample_count >= 20 THEN 'Confianza alta'
        WHEN ssh.sample_count >= 5  THEN 'Confianza media'
        ELSE                             'Sin historial'
    END                                 AS estado
FROM segment_speed_history ssh
JOIN route_segments     rs      ON rs.route_id  = ssh.route_id
                                AND rs.seq_from  = ssh.seq_from
JOIN route_waypoints    rw_from ON rw_from.id   = rs.from_waypoint
JOIN route_waypoints    rw_to   ON rw_to.id     = rs.to_waypoint
JOIN colectivo_routes   cr      ON cr.id        = ssh.route_id
JOIN zones              z       ON z.id         = cr.zone_id
WHERE z.slug = 'garcia_rovira'
  AND ssh.hour_of_day = EXTRACT(HOUR FROM NOW())::INT
ORDER BY ssh.sample_count ASC
LIMIT 20;
```

**Umbral para pasar a confianza media:** 5 muestras por segmento por hora del día.
Con 3 viajes diarios por ruta, cada segmento necesita ~2 días para tener 5 muestras
en la misma franja horaria.

**Acciones para acelerar el calentamiento del modelo:**

1. **Incentivo a conductores en la zona nueva.** Comunicar que los
   primeros 20 conductores que completen 3 viajes en García Rovira
   reciben una bonificación. Los viajes generan muestras de velocidad
   que el trigger `trg_speed_observation` registra automáticamente.

2. **Inyección de velocidades base si hay datos históricos externos.**
   Si el municipio tiene datos de velocidad media por vía (estudios de
   tráfico, datos de Google Maps Platform), se pueden insertar directamente:

```sql
-- Insertar velocidades base como semilla del historial
-- Usar sample_count = 3 para que se combinen con observaciones reales
-- sin dominar el promedio
INSERT INTO segment_speed_history (
    route_id, seq_from, seq_to,
    hour_of_day, day_of_week,
    avg_speed_kmh, sample_count
)
SELECT
    rs.route_id,
    rs.seq_from,
    rs.seq_to,
    h.hour,
    d.dow,
    CASE
        WHEN h.hour BETWEEN 7  AND 9  THEN 14.0  -- hora pico mañana
        WHEN h.hour BETWEEN 12 AND 14 THEN 20.0  -- mediodía
        WHEN h.hour BETWEEN 17 AND 19 THEN 13.0  -- hora pico tarde
        WHEN h.hour BETWEEN 22 AND 5  THEN 30.0  -- madrugada
        ELSE 22.0                                 -- resto del día
    END,
    3  -- sample_count bajo: las observaciones reales lo irán ajustando
FROM route_segments rs
JOIN colectivo_routes cr ON cr.id = rs.route_id
JOIN zones z ON z.id = cr.zone_id
CROSS JOIN generate_series(0, 23) AS h(hour)
CROSS JOIN generate_series(0, 6)  AS d(dow)
WHERE z.slug = 'garcia_rovira'
ON CONFLICT (route_id, seq_from, seq_to, hour_of_day, day_of_week)
DO NOTHING;  -- no sobreescribir observaciones reales existentes
```

3. **Monitorear la mejora.** La alerta debe resolverse sola a medida
   que los viajes se acumulen. Hacer seguimiento diario:

```bash
# Ver evolución del porcentaje de ETAs con confianza estimada
curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.tu-dominio.railway.app/metrics \
     | grep eta_confidence_total
```

**Cuándo escalar:** si después de 2 semanas con tráfico normal la alerta
persiste por encima del 40%, revisar si el trigger `trg_speed_observation`
está registrando observaciones correctamente (ver diagnóstico en Respuesta B).

---

### Respuesta B — Degradación repentina en zona establecida

Indica posible corrupción o pérdida de datos históricos.

```sql
-- ¿Cuántas observaciones se registraron hoy vs. ayer?
SELECT
    DATE(observed_at)   AS fecha,
    COUNT(*)            AS observaciones,
    AVG(speed_kmh)      AS velocidad_media
FROM segment_speed_observations sso
JOIN route_segments rs ON rs.route_id = sso.route_id
JOIN colectivo_routes cr ON cr.id = rs.route_id
JOIN zones z ON z.id = cr.zone_id
WHERE z.slug = 'garcia_rovira'
  AND observed_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(observed_at)
ORDER BY fecha DESC;
```

Si el conteo de hoy es significativamente menor que el de días anteriores:

```sql
-- Verificar si el trigger trg_speed_observation está activo
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'route_live_state'::regclass
  AND tgname  = 'trg_speed_observation';
-- tgenabled debe ser 'O' (Origin) — si es 'D' (Disabled), el trigger está desactivado

-- Reactivar si fue desactivado accidentalmente
ALTER TABLE route_live_state ENABLE TRIGGER trg_speed_observation;
```

---

### Respuesta C — Hora pico nueva sin cobertura histórica

Ocurre cuando se introduce un horario de servicio en una franja horaria
que antes no tenía cobertura (ej: servicio nocturno nuevo).

```sql
-- Ver qué horas tienen menos de 5 muestras en los segmentos principales
SELECT
    hour_of_day,
    COUNT(*) FILTER (WHERE sample_count < 5)    AS segmentos_sin_historial,
    COUNT(*) FILTER (WHERE sample_count >= 5)   AS segmentos_con_historial,
    AVG(sample_count)                           AS muestras_promedio
FROM segment_speed_history ssh
JOIN colectivo_routes cr ON cr.id = ssh.route_id
JOIN zones z ON z.id = cr.zone_id
WHERE z.slug = 'garcia_rovira'
GROUP BY hour_of_day
ORDER BY segmentos_sin_historial DESC;
```

**Acción:** insertar velocidades base para la nueva franja horaria
usando el mismo INSERT del punto 2 de la Respuesta A, limitado a las
horas sin cobertura.

---

### Cuándo cerrar la alerta manualmente

La alerta se resuelve automáticamente cuando el porcentaje de ETAs
`estimada` cae por debajo del 60% durante más de 15 minutos.
No requiere intervención manual para cerrarse, pero sí para
acelerar el proceso si el impacto en usuarios es significativo.

---

## 3. Rollback de emergencia

### Niveles de rollback — elegir el mínimo necesario

```
Nivel 1: Rollback de código (Railway)          — 2 minutos, sin riesgo de datos
Nivel 2: Rollback de migración (Alembic)       — 5-15 minutos, riesgo bajo
Nivel 3: Rollback de datos (snapshot de BD)    — 20-60 minutos, riesgo medio
Nivel 4: Rollback completo (código + BD)       — 30-90 minutos, último recurso
```

Siempre intentar el nivel más bajo antes de escalar al siguiente.

---

### Nivel 1: Rollback de código en Railway

Usar cuando: el nuevo código tiene un bug crítico pero la migración de BD
es compatible con la versión anterior (la mayoría de los casos).

```bash
# Ver el historial de despliegues
railway deployments list

# Identificar el último despliegue estable (el anterior al actual)
# La salida muestra: ID, fecha, estado, commit hash

# Revertir al despliegue anterior
railway rollback --deployment DEPLOYMENT_ID

# Verificar que el rollback fue exitoso
curl https://api.tu-dominio.railway.app/health
# Debe devolver: {"status": "ok", "version": "VERSION_ANTERIOR"}
```

**Tiempo estimado:** 2-3 minutos.
**Riesgo para los datos:** ninguno — solo cambia el código en ejecución.
**Cuándo NO usar este nivel:** si la migración que se desplegó
es incompatible hacia atrás (añadió una columna NOT NULL sin default,
renombró una columna, etc.).

---

### Nivel 2: Rollback de migración con Alembic

Usar cuando: la migración de BD causó el problema y necesitas revertirla
manteniendo la versión anterior del código.

```bash
# ⚠️ CONFIRMAR antes de ejecutar en producción
# Verificar qué migración está aplicada actualmente
railway run alembic current
# Muestra: a1b2c3d4e5f6 (head)

# Ver el historial de migraciones para identificar la anterior
railway run alembic history --verbose
# Muestra:
#   a1b2c3d4e5f6 -> (current) add_garcia_rovira_zone
#   0000000000000 -> (previous) initial_schema

# Revertir UNA migración
railway run alembic downgrade -1

# Verificar que quedó en la revisión correcta
railway run alembic current
# Debe mostrar: 0000000000000

# Hacer rollback del código también (para que coincida con el schema)
railway rollback --deployment DEPLOYMENT_ID_ANTERIOR
```

**Tiempo estimado:** 5-15 minutos dependiendo del volumen de datos.
**Riesgo para los datos:** bajo si `downgrade()` está bien implementado.
Para migraciones que eliminan columnas o tablas, los datos de esas
columnas se pierden permanentemente.

**Antes de ejecutar, revisar qué hace el `downgrade()`:**

```bash
# Ver el SQL que se ejecutará sin aplicarlo
railway run alembic downgrade -1 --sql
# Revisar el output cuidadosamente antes de proceder
```

---

### Nivel 3: Restaurar un snapshot de la base de datos

Usar cuando: los datos están corruptos y no hay forma de recuperarlos
con `alembic downgrade`. Implica pérdida de datos desde el snapshot.

```bash
# ⚠️ CONFIRMAR con el equipo técnico y negocio antes de ejecutar
# Este procedimiento causa ~20-60 minutos de downtime

# Paso 1: poner la aplicación en modo mantenimiento
# En Railway: cambiar la variable de entorno
railway variables set APP_ENV=maintenance --service backend
# El endpoint /health devuelve 503, Railway detiene el tráfico

# Paso 2: listar los snapshots disponibles en Railway
railway postgres backups list
# Muestra: ID, fecha, tamaño

# Paso 3: identificar el snapshot inmediatamente anterior al incidente
# Elegir el más reciente ANTES de que ocurriera el problema

# Paso 4: restaurar
# ⚠️ IRREVERSIBLE — los datos posteriores al snapshot se pierden
railway postgres restore --backup BACKUP_ID

# Paso 5: verificar integridad básica
railway run psql $DATABASE_URL << 'EOF'
SELECT
    (SELECT COUNT(*) FROM users)            AS total_users,
    (SELECT COUNT(*) FROM colectivo_routes) AS total_routes,
    (SELECT COUNT(*) FROM trips)            AS total_trips,
    (SELECT MAX(created_at) FROM trips)     AS ultimo_viaje_registrado;
EOF

# Paso 6: re-aplicar las migraciones HASTA la versión pre-incidente
railway run alembic upgrade REVISION_ID_SEGURA

# Paso 7: restaurar el tráfico
railway variables set APP_ENV=production --service backend
```

**Tiempo estimado:** 20-60 minutos.
**Pérdida de datos:** todos los datos desde el snapshot hasta el incidente.
Comunicar a negocio cuántos viajes/registros se perderán antes de proceder.

---

### Nivel 4: Rollback completo (código + BD)

Usar cuando: tanto el código como los datos están en un estado inconsistente
y necesitas volver a un punto totalmente estable conocido.

Este nivel combina los niveles 2 y 3 en orden específico:

```bash
# Orden correcto: primero detener, luego revertir BD, luego revertir código

# 1. Activar modo mantenimiento (detener escrituras nuevas)
railway variables set APP_ENV=maintenance --service backend
railway variables set APP_ENV=maintenance --service frontend

# 2. Documentar el estado actual antes de cambiar nada
railway run psql $DATABASE_URL -c "SELECT version();"
railway run alembic current
railway deployments list | head -5

# 3. Restaurar la BD al snapshot (Nivel 3, pasos 2-5)

# 4. Hacer rollback del código (Nivel 1)
railway rollback --deployment DEPLOYMENT_ID_ESTABLE

# 5. Verificar que código y schema son compatibles
railway run alembic current
# Debe coincidir con la revisión esperada para esa versión del código

# 6. Restaurar tráfico gradualmente
railway variables set APP_ENV=production --service backend
# Esperar 5 minutos y verificar /health y /metrics
railway variables set APP_ENV=production --service frontend
```

---

### Post-mortem: qué hacer después de cualquier rollback

Independientemente del nivel de rollback ejecutado:

1. **Documentar el incidente** con hora de inicio, hora de resolución,
   causa raíz y acciones tomadas. Usar el template en `docs/incident-template.md`.

2. **Revisar por qué los tests no detectaron el problema** y añadir
   el caso de prueba que habría capturado el bug.

3. **Verificar que el trigger de Alembic en la migración problemática
   tiene un `downgrade()` correcto** antes de re-intentar el despliegue.

4. **Comunicar a los administradores de zona** si hubo pérdida de datos,
   indicando exactamente qué registros se perdieron y el rango de tiempo.

---

## 4. Referencia rápida de comandos

```bash
# ── Estado del sistema ────────────────────────────────────────────────────────
railway run alembic current                        # migración activa
railway run alembic history --verbose              # historial completo
railway deployments list                           # últimos despliegues
curl $API_URL/health                               # health check

# ── Métricas ──────────────────────────────────────────────────────────────────
curl -H "Authorization: Bearer $METRICS_TOKEN" \
     $API_URL/metrics | grep eta_confidence        # confianza de ETAs
curl -H "Authorization: Bearer $METRICS_TOKEN" \
     $API_URL/metrics | grep vehicles_active       # vehículos por zona
curl -H "Authorization: Bearer $METRICS_TOKEN" \
     $API_URL/metrics | grep ws_connections        # conexiones WebSocket

# ── Base de datos ─────────────────────────────────────────────────────────────
railway run psql $DATABASE_URL                     # consola SQL
railway postgres backups list                      # snapshots disponibles

# ── Zonas ─────────────────────────────────────────────────────────────────────
# Ver todas las zonas activas
railway run psql $DATABASE_URL -c \
    "SELECT slug, name, is_active, launched_at FROM zones ORDER BY launched_at;"

# Desactivar una zona de emergencia (sin borrar datos)
railway run psql $DATABASE_URL -c \
    "UPDATE zones SET is_active = FALSE WHERE slug = 'zona_problema';"

# ── Conductores ───────────────────────────────────────────────────────────────
# Ver conductores activos en una zona
railway run psql $DATABASE_URL -c \
    "SELECT u.full_name, d.status, d.avg_rating
     FROM drivers d JOIN users u ON u.id = d.user_id
     JOIN zones z ON z.id = u.zone_id
     WHERE z.slug = 'garcia_rovira' AND d.status = 'disponible';"

# ── Rollback rápido ───────────────────────────────────────────────────────────
railway rollback                                   # último despliegue estable
railway run alembic downgrade -1                   # una migración atrás
railway run alembic downgrade -1 --sql             # previsualizar sin ejecutar
```

---

*Última actualización: 2025-06-03*
*Próxima revisión programada: 2025-09-03*
*Responsable: Equipo de Operaciones — Transporte Municipal*
