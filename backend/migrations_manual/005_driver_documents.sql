-- 005: vencimientos de documentos
-- La licencia ya vive en drivers.license_expiry (DATE).
-- El SOAT y la revision tecnico-mecanica son del vehiculo.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS soat_expiry          DATE;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tecnomecanica_expiry DATE;