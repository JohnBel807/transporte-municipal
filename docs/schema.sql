-- =============================================================================
-- TRANSPORTE MUNICIPAL — SCHEMA COMPLETO
-- Ejecutar en orden. Requiere: CREATE EXTENSION IF NOT EXISTS postgis;
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Zonas (tenant del sistema)
CREATE TABLE zones (
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
    geom GEOMETRY(MULTIPOLYGON, 4326),
    bbox GEOMETRY(POLYGON, 4326),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    launched_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_zones_geom ON zones USING GIST(geom);

-- Zonas operativas (geofencing)
CREATE TABLE operational_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL,
    geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'
);
CREATE INDEX idx_opzones_gist ON operational_zones USING GIST(geom);

-- Usuarios
CREATE TABLE users (
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
CREATE INDEX idx_users_email ON users(email);

-- Pasajeros
CREATE TABLE passengers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    preferred_payment TEXT,
    avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
    total_trips INT NOT NULL DEFAULT 0
);

-- Conductores
CREATE TABLE drivers (
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

-- Vehículos
CREATE TABLE vehicles (
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

-- Rutas de colectivo
CREATE TABLE colectivo_routes (
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
CREATE INDEX idx_routes_driver ON colectivo_routes(driver_id);
CREATE INDEX idx_routes_status ON colectivo_routes(status) WHERE status = 'activa';

-- Waypoints
CREATE TABLE route_waypoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    sequence_order INT NOT NULL,
    place_name TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    geo_point GEOGRAPHY(POINT, 4326),
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    estimated_wait_min INT NOT NULL DEFAULT 0,
    zone_id UUID REFERENCES zones(id)
);
CREATE INDEX idx_waypoints_route ON route_waypoints(route_id, sequence_order);
CREATE INDEX idx_waypoints_gist ON route_waypoints USING GIST(geo_point);

-- Corredores de ruta
CREATE TABLE route_corridors (
    route_id UUID PRIMARY KEY REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    full_linestring GEOMETRY(LINESTRING, 4326) NOT NULL,
    corridor_geom GEOMETRY(POLYGON, 4326) NOT NULL,
    bbox GEOMETRY(POLYGON, 4326) NOT NULL,
    tolerance_m INT NOT NULL DEFAULT 300,
    zone_id UUID REFERENCES zones(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_corridors_gist ON route_corridors USING GIST(corridor_geom);

-- Segmentos de ruta
CREATE TABLE route_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    from_waypoint UUID NOT NULL REFERENCES route_waypoints(id),
    to_waypoint UUID NOT NULL REFERENCES route_waypoints(id),
    seq_from INT NOT NULL,
    seq_to INT NOT NULL,
    geom GEOMETRY(LINESTRING, 4326) NOT NULL,
    distance_m FLOAT NOT NULL,
    CONSTRAINT chk_direction CHECK (seq_to > seq_from)
);
CREATE INDEX idx_segments_route ON route_segments(route_id, seq_from);
CREATE INDEX idx_segments_gist ON route_segments USING GIST(geom);

-- Horarios de ruta
CREATE TABLE route_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    day_of_week TEXT NOT NULL,
    departure_time TIME NOT NULL,
    arrival_time TIME,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Estado en vivo
CREATE TABLE route_live_state (
    route_id UUID PRIMARY KEY REFERENCES colectivo_routes(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id),
    current_position GEOGRAPHY(POINT, 4326) NOT NULL,
    current_segment_seq INT NOT NULL DEFAULT 0,
    heading SMALLINT,
    speed_kmh SMALLINT NOT NULL DEFAULT 0,
    next_waypoint_id UUID REFERENCES route_waypoints(id),
    eta_next_stop_sec INT NOT NULL DEFAULT 0,
    passengers_aboard SMALLINT NOT NULL DEFAULT 0,
    zone_id UUID REFERENCES zones(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_live_gist ON route_live_state USING GIST(current_position);

-- Viajes
CREATE TABLE trips (
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
CREATE INDEX idx_trips_passenger ON trips(passenger_id, status);
CREATE INDEX idx_trips_driver ON trips(driver_id, status);

-- Historial de viajes
CREATE TABLE trip_history (
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
    date DATE GENERATED ALWAYS AS (started_at::DATE) STORED
);
CREATE INDEX idx_th_date_province ON trip_history(date, province);
CREATE INDEX idx_th_zone_date ON trip_history(zone_id, date DESC);

-- Calificaciones
CREATE TABLE ratings (
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

-- Pagos
CREATE TABLE payments (
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

-- Tokens de refresco
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    device_info TEXT,
    ip_address INET,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    rotated_at TIMESTAMPTZ
);
CREATE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_token_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- Suscripciones de pasajeros a rutas
CREATE TABLE passenger_route_subscriptions (
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
CREATE INDEX idx_subs_route_waypoint ON passenger_route_subscriptions(route_id, waypoint_id) WHERE is_active;

-- Notificaciones
CREATE TABLE notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID NOT NULL REFERENCES passengers(id),
    route_id UUID NOT NULL,
    waypoint_id UUID NOT NULL,
    channel TEXT NOT NULL,
    payload JSONB NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historial de velocidad por segmento
CREATE TABLE segment_speed_history (
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

-- Ubicación en tiempo real de conductores
CREATE TABLE drivers_location (
    driver_id UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    position GEOGRAPHY(POINT, 4326) NOT NULL,
    heading SMALLINT,
    speed_kmh SMALLINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drivers_location_gist ON drivers_location USING GIST(position);

-- Acciones de administrador
CREATE TABLE admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES users(id),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vista de rutas activas en tiempo real
CREATE OR REPLACE VIEW active_routes_live AS
SELECT
    cr.id AS route_id, cr.route_name, cr.base_fare,
    rls.current_position,
    ST_X(rls.current_position::GEOMETRY) AS driver_lng,
    ST_Y(rls.current_position::GEOMETRY) AS driver_lat,
    rls.heading, rls.speed_kmh, rls.current_segment_seq,
    rw_next.place_name AS next_stop_name,
    rls.eta_next_stop_sec, rls.passengers_aboard,
    v.capacity, v.capacity - rls.passengers_aboard AS seats_available,
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

-- Función para reconstruir el corredor de una ruta
CREATE OR REPLACE FUNCTION rebuild_route_corridor(p_route_id UUID, p_tolerance_m INT DEFAULT 300)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_line GEOMETRY;
BEGIN
    SELECT ST_MakeLine(geo_point::GEOMETRY ORDER BY sequence_order)
    INTO v_line FROM route_waypoints WHERE route_id = p_route_id;
    IF v_line IS NULL OR ST_NPoints(v_line) < 2 THEN
        RAISE EXCEPTION 'La ruta % necesita al menos 2 waypoints', p_route_id;
    END IF;
    INSERT INTO route_corridors (route_id, full_linestring, corridor_geom, bbox, tolerance_m)
    VALUES (
        p_route_id, v_line,
        ST_Buffer(v_line::GEOGRAPHY, p_tolerance_m)::GEOMETRY,
        ST_Envelope(v_line), p_tolerance_m
    )
    ON CONFLICT (route_id) DO UPDATE
        SET full_linestring = EXCLUDED.full_linestring,
            corridor_geom   = EXCLUDED.corridor_geom,
            bbox            = EXCLUDED.bbox,
            tolerance_m     = EXCLUDED.tolerance_m,
            updated_at      = NOW();
END;
$$;

-- Datos iniciales: zonas operativas
INSERT INTO zones (slug, name, center_lat, center_lng, default_zoom, enforce_geofencing) VALUES
    ('velez',    'Provincia de Vélez',    6.013, -73.677, 12, TRUE),
    ('ricaurte', 'Provincia de Ricaurte', 5.603, -74.105, 12, TRUE)
ON CONFLICT (slug) DO NOTHING;
