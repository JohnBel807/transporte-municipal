-- 006: bandeja de soporte con reportes de usuarios
CREATE TABLE IF NOT EXISTS support_tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_name    TEXT,
    reporter_phone   TEXT,
    reporter_user_id UUID REFERENCES users(id),
    trip_id          UUID,            -- opcional; sin FK (puede ser taxi o colectivo)
    category         TEXT NOT NULL DEFAULT 'otro'
                     CHECK (category IN ('tarifa','conductor','seguridad','app','otro')),
    message          TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'abierto'
                     CHECK (status IN ('abierto','en_proceso','resuelto','cerrado')),
    admin_note       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status, created_at DESC);