    -- 004: cuentas de pasajero con celular + PIN de 4 digitos
    -- Ejecutar en pgAdmin contra la base de Railway.

    -- Los pasajeros no tienen correo: el email deja de ser obligatorio.
    -- UNIQUE sigue activo; PostgreSQL permite varios NULL.
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

    -- Bloqueo tras intentos fallidos de PIN (protege un PIN de solo 4 digitos).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_pin_attempts INT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

    -- Atribuir reservas a un pasajero registrado (NULL = reserva anonima, como hasta ahora).
    ALTER TABLE seat_reservations ADD COLUMN IF NOT EXISTS passenger_id UUID REFERENCES users(id);
    CREATE INDEX IF NOT EXISTS idx_reservations_passenger ON seat_reservations(passenger_id);
    CREATE INDEX IF NOT EXISTS idx_reservations_created   ON seat_reservations(created_at);