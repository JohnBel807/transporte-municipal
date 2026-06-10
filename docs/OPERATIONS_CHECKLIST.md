# Checklist de Operaciones — Transporte Vélez & Ricaurte
## Revisión diaria del administrador (5–10 minutos cada mañana)

---

### ✅ Punto 1 — Verificar que el backend responde
**Qué hacer:** Abre `https://api.velezyricaurte.com/health` en el navegador.

**Resultado esperado:**
```json
{"status": "ok", "version": "0.1.0", "env": "production"}
```

**Si falla:** Ve a Railway → servicio backend → Deployments.
Si el último deploy dice "Failed", haz Redeploy.
Si dice "Active" pero no responde, revisa los logs — busca
`Database pool ready`. Si no aparece, el pool de conexiones a
la BD está caído: ve a Railway → Postgres → Restart.

---

### ✅ Punto 2 — Revisar rutas activas en el dashboard
**Qué hacer:** Entra al panel → Centro de Control.
Verifica que las rutas activas del día anterior se desactivaron
(no deben quedar rutas en estado 'activa' de días anteriores).

**Consulta rápida en pgAdmin si hay dudas:**
```sql
SELECT cr.route_name, u.full_name AS conductor,
       rls.updated_at, cr.status
FROM   colectivo_routes cr
JOIN   drivers d ON d.id = cr.driver_id
JOIN   users u ON u.id = d.user_id
LEFT JOIN route_live_state rls ON rls.route_id = cr.id
WHERE  cr.status = 'activa'
ORDER BY rls.updated_at DESC;
```

**Si hay rutas activas sin conductor conectado (updated_at > 30 min):**
Desactivarlas manualmente desde el panel o con:
```sql
UPDATE colectivo_routes SET status = 'pausada', is_public = FALSE
WHERE  status = 'activa'
  AND  id NOT IN (SELECT route_id FROM route_live_state
                  WHERE updated_at > NOW() - INTERVAL '30 minutes');
```

---

### ✅ Punto 3 — Verificar calidad del ETA (ETAConfidenceDegraded)
**Qué hacer:** En Railway → servicio backend → Metrics,
o directamente en el endpoint de métricas:
```
https://api.velezyricaurte.com/metrics
```
(requiere el METRICS_TOKEN en el header Authorization)

**Buscar:**
```
eta_confidence_total{confidence="estimada",...}
eta_confidence_total{confidence="alta",...}
```

**Umbral de alerta:** Si "estimada" supera el 60% del total,
el sistema está usando velocidades genéricas en lugar de
historial real. Ver OPERATIONS.md → Sección 2 para acciones.

**Consulta directa en pgAdmin:**
```sql
SELECT
    z.name AS zona,
    ssh.hour_of_day AS hora,
    COUNT(*) FILTER (WHERE ssh.sample_count < 5)  AS segmentos_sin_historial,
    COUNT(*) FILTER (WHERE ssh.sample_count >= 5) AS segmentos_con_historial
FROM segment_speed_history ssh
JOIN colectivo_routes cr ON cr.id = ssh.route_id
JOIN zones z ON z.id = cr.zone_id
WHERE ssh.hour_of_day = EXTRACT(HOUR FROM NOW())::INT
GROUP BY z.name, ssh.hour_of_day
ORDER BY segmentos_sin_historial DESC;
```

---

### ✅ Punto 4 — Revisar intentos de autenticación fallidos
**Qué hacer:** Buscar picos inusuales de logins fallidos
que puedan indicar intentos de acceso no autorizado.

**Consulta en pgAdmin:**
```sql
-- Tokens revocados o expirados en las últimas 24h
SELECT
    COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revocados,
    COUNT(*) FILTER (WHERE expires_at < NOW()
                     AND revoked_at IS NULL)        AS expirados,
    COUNT(*) FILTER (WHERE revoked_at IS NULL
                     AND expires_at > NOW())        AS activos
FROM refresh_tokens
WHERE issued_at > NOW() - INTERVAL '24 hours';
```

**Señal de alerta:** Más de 20 tokens revocados en 24h
sin que corresponda a un cierre de sesión masivo planificado.
Si hay actividad sospechosa, revocar todas las sesiones:
```sql
UPDATE refresh_tokens SET revoked_at = NOW()
WHERE revoked_at IS NULL;
-- Todos los usuarios deberán iniciar sesión de nuevo
```

---

### ✅ Punto 5 — Verificar espacio en disco y BD
**Qué hacer:** En Railway → servicio Postgres → pestaña Metrics.
Revisar el gráfico de uso de almacenamiento del volumen
`postgres-volume` (límite: 4.9 GB en el plan actual).

**Consulta de tamaño de tablas en pgAdmin:**
```sql
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS tamaño
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

**Tablas que crecen más rápido:** `notification_log`,
`segment_speed_history`, `trip_history`, `refresh_tokens`.

**Mantenimiento mensual recomendado:**
```sql
-- Limpiar notificaciones antiguas (>30 días)
DELETE FROM notification_log WHERE sent_at < NOW() - INTERVAL '30 days';

-- Limpiar refresh tokens expirados
DELETE FROM refresh_tokens
WHERE expires_at < NOW() - INTERVAL '7 days';

-- Limpiar observaciones de velocidad antiguas
DELETE FROM segment_speed_observations
WHERE observed_at < NOW() - INTERVAL '90 days';
```

---

## Semáforo de estado del sistema

| Indicador | 🟢 Normal | 🟡 Atención | 🔴 Crítico |
|-----------|-----------|-------------|------------|
| `/health` | Responde < 200ms | Responde > 1s | No responde |
| ETA estimada | < 30% | 30–60% | > 60% |
| Rutas zombi | 0 | 1–2 | > 2 |
| Tokens revocados 24h | < 5 | 5–20 | > 20 |
| Disco BD | < 60% | 60–80% | > 80% |

---

*Última actualización: Junio 2026*
*Sistema: Transporte Municipal Vélez & Ricaurte*
