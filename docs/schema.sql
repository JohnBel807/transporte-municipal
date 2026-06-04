-- =============================================================================
-- SCHEMA SIN POSTGIS — compatible con Railway PostgreSQL 18
-- =============================================================================

CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'CO',
    timezone TEXT NOT NULL DEFAULT 'America/Bogota',
    center_lat FLOAT NOT NULL,
    center_lng FLOAT NOT NULL,
    default_zoom INT NOT NULL DEFAULT 12,
    max_route_tolerance_m INT NOT NULL DEFAULT 300,
    default_base_fare NUMERIC(10,2) NOT NULL DEFAULT 3200,
    enforce_geofencing BOOLEAN NOT NULL DEFAULT TRUE,
    bbox_min_lat FLOAT,
    bbox_max_lat FLOAT,
    bbox_min_lng FLOAT,
    bbox_max_lng FLOAT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    launched_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operational_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL,
    min_lat FLOAT NOT NULL DEFAULT -90,
    max_lat FLOAT NOT NULL DEFAULT 90,
    min_lng FLOAT NOT NULL DEFAULT -180,
    max_lng FLOAT NOT NULL DEFAULT 180,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL CHECK (role IN ('pasajero','conductor','admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    zone_id UUID REFERENCES zones(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS passengers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    preferred_payment TEXT,
    avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
    total_trips INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    driver_type TEXT NOT NULL CHECK (driver_type IN ('taxi','particular','colectivo')),
    license_number TEXT NOT NULL UNIQUE,
    license_category TEXT NOT NULL,
    license_expiry DATE,
    status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible','ocupado','inactivo')),
    avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
    total_trips INT NOT NULL DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    zone_id UUID REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    plate TEXT NOT NULL UNIQUE,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    year INT NOT NULL,
    capacity INT NOT NULL,
    color TEXT NOT NULL,
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('sedan','van','bus','moto')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_inspection TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS colectivo_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    route_name TEXT NOT NULL,
    description TEXT,
    base_fare NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pausada' CHECK (status IN ('pausada','activa','archivada')),
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_duration_min INT NOT NULL DEFAULT 30,
    zone_id UUID REFERENCES zones(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_routes_status ON colectivo_routes(status);

CREATE TABLE IF NOT EXISTS route_waypoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    sequence_order INT NOT NULL,
    place_name TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_wait_min INT NOT NULL DEFAULT 0,
    zone_id UUID REFERENCES zones(id)
);
CREATE INDEX IF NOT EXISTS idx_waypoints_route ON route_waypoints(route_id, sequence_order);

CREATE TABLE IF NOT EXISTS route_corridors (
    route_id UUID PRIMARY KEY REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    min_lat FLOAT NOT NULL,
    max_lat FLOAT NOT NULL,
    min_lng FLOAT NOT NULL,
    max_lng FLOAT NOT NULL,
    tolerance_m INT NOT NULL DEFAULT 300,
    zone_id UUID REFERENCES zones(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL,
    departure_time TIME NOT NULL,
    arrival_time TIME,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS route_live_state (
    route_id UUID PRIMARY KEY REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),
    current_lat FLOAT NOT NULL DEFAULT 0,
    current_lng FLOAT NOT NULL DEFAULT 0,
    current_segment_seq INT NOT NULL DEFAULT 0,
    heading SMALLINT,
    speed_kmh SMALLINT NOT NULL DEFAULT 0,
    next_waypoint_id UUID REFERENCES route_waypoints(id),
    eta_next_stop_sec INT NOT NULL DEFAULT 0,
    passengers_aboard SMALLINT NOT NULL DEFAULT 0,
    zone_id UUID REFERENCES zones(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passengers(id),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    colectivo_route_id UUID REFERENCES colectivo_routes(id),
    trip_type TEXT NOT NULL CHECK (trip_type IN ('taxi','particular','colectivo')),
    status TEXT NOT NULL DEFAULT 'solicitado',
    origin_lat FLOAT NOT NULL,
    origin_lng FLOAT NOT NULL,
    origin_address TEXT,
    dest_lat FLOAT NOT NULL,
    dest_lng FLOAT NOT NULL,
    dest_address TEXT,
    fare_amount NUMERIC(10,2),
    payment_method TEXT,
    zone_id UUID REFERENCES zones(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_minutes INT,
    distance_km FLOAT
);
CREATE INDEX IF NOT EXISTS idx_trips_passenger ON trips(passenger_id, status);

CREATE TABLE IF NOT EXISTS trip_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    total_passengers INT NOT NULL DEFAULT 0,
    total_distance_km FLOAT,
    province TEXT,
    waypoints_covered INT,
    avg_speed_kmh FLOAT,
    zone_id UUID REFERENCES zones(id),
    trip_date DATE
);
CREATE INDEX IF NOT EXISTS idx_th_date ON trip_history(trip_date DESC);

CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id),
    rater_id UUID NOT NULL REFERENCES users(id),
    rated_id UUID NOT NULL REFERENCES users(id),
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    zone_id UUID REFERENCES zones(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rating_per_rater_per_trip UNIQUE (trip_id, rater_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id),
    passenger_id UUID NOT NULL REFERENCES passengers(id),
    amount NUMERIC(10,2) NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('efectivo','tarjeta','wallet')),
    status TEXT NOT NULL DEFAULT 'pendiente',
    external_tx_id TEXT,
    zone_id UUID REFERENCES zones(id),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_token_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS passenger_route_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    waypoint_id UUID NOT NULL REFERENCES route_waypoints(id),
    notify_at_sec INT NOT NULL DEFAULT 90,
    channel TEXT NOT NULL DEFAULT 'websocket',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE (passenger_id, route_id, waypoint_id)
);

CREATE TABLE IF NOT EXISTS notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passengers(id),
    route_id UUID NOT NULL,
    waypoint_id UUID NOT NULL,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS segment_speed_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id),
    seq_from INT NOT NULL,
    seq_to INT NOT NULL,
    hour_of_day SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    avg_speed_kmh FLOAT NOT NULL,
    sample_count INT NOT NULL DEFAULT 1,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (route_id, seq_from, seq_to, hour_of_day, day_of_week)
);

CREATE TABLE IF NOT EXISTS drivers_location (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    lat FLOAT NOT NULL DEFAULT 0,
    lng FLOAT NOT NULL DEFAULT 0,
    heading SMALLINT,
    speed_kmh SMALLINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW active_routes_live AS
SELECT
    cr.id AS route_id,
    cr.route_name,
    cr.base_fare,
    rls.current_lng AS driver_lng,
    rls.current_lat AS driver_lat,
    rls.heading,
    rls.speed_kmh,
    rls.current_segment_seq,
    rw_next.place_name AS next_stop_name,
    rls.eta_next_stop_sec,
    rls.passengers_aboard,
    v.capacity,
    v.capacity - rls.passengers_aboard AS seats_available,
    rls.updated_at,
    CASE
        WHEN rls.updated_at > NOW() - INTERVAL '10 seconds' THEN 'live'
        WHEN rls.updated_at > NOW() - INTERVAL '30 seconds' THEN 'stale'
        ELSE 'offline'
    END AS signal_status
FROM colectivo_routes cr
JOIN route_live_state rls ON rls.route_id = cr.id
LEFT JOIN route_waypoints rw_next ON rw_next.id = rls.next_waypoint_id
JOIN drivers d ON d.id = cr.driver_id
JOIN vehicles v ON v.driver_id = d.id AND v.is_active
WHERE cr.status = 'activa'
  AND rls.updated_at > NOW() - INTERVAL '2 minutes';

CREATE OR REPLACE FUNCTION rebuild_route_corridor(p_route_id UUID, p_tolerance_m INT DEFAULT 300)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_min_lat FLOAT; v_max_lat FLOAT;
    v_min_lng FLOAT; v_max_lng FLOAT;
BEGIN
    SELECT MIN(latitude), MAX(latitude), MIN(longitude), MAX(longitude)
    INTO v_min_lat, v_max_lat, v_min_lng, v_max_lng
    FROM route_waypoints WHERE route_id = p_route_id;

    IF v_min_lat IS NULL THEN
        RAISE EXCEPTION 'La ruta % no tiene waypoints', p_route_id;
    END IF;

    INSERT INTO route_corridors (route_id, min_lat, max_lat, min_lng, max_lng, tolerance_m)
    VALUES (p_route_id, v_min_lat, v_max_lat, v_min_lng, v_max_lng, p_tolerance_m)
    ON CONFLICT (route_id) DO UPDATE
        SET min_lat = EXCLUDED.min_lat, max_lat = EXCLUDED.max_lat,
            min_lng = EXCLUDED.min_lng, max_lng = EXCLUDED.max_lng,
            tolerance_m = EXCLUDED.tolerance_m, updated_at = NOW();
END;
$$;

INSERT INTO zones (slug, name, center_lat, center_lng, default_zoom,
                   bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng)
VALUES
    ('velez',    'Provincia de Vélez',    6.013, -73.677, 12, 5.80, 6.20, -73.90, -73.50),
    ('ricaurte', 'Provincia de Ricaurte', 5.603, -74.105, 12, 5.40, 5.80, -74.30, -73.90)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO operational_zones (name, zone_type, min_lat, max_lat, min_lng, max_lng)
VALUES
    ('Vélez',    'provincia', 5.80, 6.20, -73.90, -73.50),
    ('Ricaurte', 'provincia', 5.40, 5.80, -74.30, -73.90);