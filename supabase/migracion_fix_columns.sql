-- ============================================================================
-- MIGRACIÓN: FIX COLUMNAS CRÍTICAS FALTANTES
-- Portal Pilot — Supabase
-- ============================================================================
-- Este script agrega columnas que server.js utiliza pero que no existen
-- en el schema actual. Ejecutar DESPUÉS de migracion_supabase_produccion.sql
-- y migracion_tablas_faltantes.sql.
-- ============================================================================

-- 1. AGREGAR `rol_global` a `usuarios`
--    server.js consulta esta columna en 13+ lugares pero no existe en la tabla.
--    Se crea con DEFAULT 'operador' y se backfilla desde la columna `rol`.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_global VARCHAR(50) DEFAULT 'operador';

UPDATE usuarios
SET rol_global = rol
WHERE rol_global IS NULL OR rol_global = 'operador';

-- 2. AGREGAR `metadata` a `transacciones`
--    server.js lee/escribe esta columna JSONB pero no existe en la tabla.
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 3. AGREGAR COLUMNAS FALTANTES A `support_tickets`
--    El endpoint de AI soporte en server.js lee `asunto` y `empresa_id`,
--    que no existen en la tabla original.

--    3a. `asunto`: resumen corto del ticket
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS asunto VARCHAR(200);

--    3b. `empresa_id`: FK lógica a la empresa (no restricción FK explícita
--        para evitar errores 23503 con auth.users, igual que el resto del schema)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS empresa_id UUID;

--    3c. Backfill: generar `asunto` a partir de los primeros 200 caracteres del `mensaje`
UPDATE support_tickets
SET asunto = LEFT(mensaje, 200)
WHERE asunto IS NULL AND mensaje IS NOT NULL;

-- ============================================================================
-- FIN — Todas las operaciones usan IF NOT EXISTS para ser idempotentes.
-- ============================================================================
