CREATE TABLE IF NOT EXISTS fare_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  municipality TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'velez',
  polygon JSONB NOT NULL,
  fixed_fare NUMERIC NOT NULL CHECK (fixed_fare > 0),
  allow_surcharges BOOLEAN NOT NULL DEFAULT FALSE,
  decree_ref TEXT,
  priority INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE particular_trips
  ADD COLUMN IF NOT EXISTS fare_zone_id UUID REFERENCES fare_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fare_fixed NUMERIC;
