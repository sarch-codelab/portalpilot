-- ============================================================
-- MIGRACIÓN ENTERPRISE — Portal Pilot Web (CORREGIDA)
-- Tablas: api_keys, vehiculos, auditoria, automatizaciones, automation_runs
-- Ejecutar en Supabase SQL Editor (proyecto de la Web).
--
-- Cambios frente a la versión anterior:
--  1) Idempotente: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--     ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--  2) TODAS las tablas usan `empresa_codigo TEXT NOT NULL` como
--     columna de tenant, SIN FOREIGN KEY rígida a `empresas`/`tenants`
--     (evita el error 42P01 "relation ... does not exist").
--  3) Se conserva `empresa_id UUID` nullable (sin FK) para compatibilidad
--     con flujos que resuelven el UUID de la empresa.
--  4) Las políticas RLS filtran directamente por `empresa_codigo`
--     comparando el claim 'empresa_codigo' del JWT (helper jwt_empresa_codigo()),
--     SIN subconsultas a `empresas` ni `usuarios`.
-- ============================================================

-- ── Helper: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Helper: claim 'empresa_codigo' del JWT (RLS) ────────────
CREATE OR REPLACE FUNCTION jwt_empresa_codigo()
RETURNS TEXT AS $$
  SELECT NULLIF(auth.jwt() ->> 'empresa_codigo', '');
$$ LANGUAGE SQL STABLE;

-- ════════════════════════════════════════════════════════════
-- API KEYS por tenant
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre TEXT NOT NULL,
  clave TEXT NOT NULL,
  ultimo_uso TIMESTAMPTZ,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS empresa_id UUID;

CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON api_keys(empresa_codigo);

-- ════════════════════════════════════════════════════════════
-- FLOTA (vehículos) por tenant
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS vehiculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  placa TEXT NOT NULL,
  tipo TEXT DEFAULT 'Camión',
  chofer TEXT DEFAULT '',
  estado TEXT DEFAULT 'disponible' CHECK (estado IN ('en-ruta', 'disponible', 'alerta', 'taller')),
  combustible INTEGER DEFAULT 100 CHECK (combustible >= 0 AND combustible <= 100),
  km NUMERIC(12,2) DEFAULT 0,
  ubicacion TEXT DEFAULT '',
  ultimo_movimiento TIMESTAMPTZ,
  fecha_mantenimiento TIMESTAMPTZ,
  notas TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS empresa_id UUID;

CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa ON vehiculos(empresa_codigo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_placa_empresa ON vehiculos(empresa_codigo, placa);

DROP TRIGGER IF EXISTS trigger_vehiculos_updated ON vehiculos;
CREATE TRIGGER trigger_vehiculos_updated BEFORE UPDATE ON vehiculos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
-- AUDITORÍA por tenant
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  accion TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  tipo TEXT DEFAULT 'sistema',
  usuario TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS empresa_id UUID;

CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(empresa_codigo, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- AGENTES DE AUTOMATIZACIÓN por tenant
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS automatizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  icono TEXT DEFAULT 'fa-bolt',
  estado TEXT DEFAULT 'inactivo' CHECK (estado IN ('activo', 'inactivo')),
  tareas INTEGER DEFAULT 0,
  exito INTEGER DEFAULT 100,
  trigger_flow TEXT DEFAULT '',
  accion TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE automatizaciones ADD COLUMN IF NOT EXISTS empresa_id UUID;

CREATE INDEX IF NOT EXISTS idx_automatizaciones_empresa ON automatizaciones(empresa_codigo);

DROP TRIGGER IF EXISTS trigger_automatizaciones_updated ON automatizaciones;
CREATE TRIGGER trigger_automatizaciones_updated BEFORE UPDATE ON automatizaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
-- REGISTRO DE EJECUCIONES (logs en vivo)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  automatizacion_id UUID,
  agente TEXT DEFAULT '',
  mensaje TEXT NOT NULL,
  nivel TEXT DEFAULT 'info' CHECK (nivel IN ('success', 'info', 'warn', 'error')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS empresa_id UUID;

CREATE INDEX IF NOT EXISTS idx_automation_runs_empresa ON automation_runs(empresa_codigo, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- RLS: acceso por tenant (el backend usa service role; esto
-- protege la anon key). Filtra por empresa_codigo directo,
-- sin subconsultas a tablas que puedan no existir.
-- ════════════════════════════════════════════════════════════
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE automatizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select ON api_keys;
DROP POLICY IF EXISTS api_keys_all ON api_keys;
CREATE POLICY api_keys_all ON api_keys FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);

DROP POLICY IF EXISTS vehiculos_all ON vehiculos;
CREATE POLICY vehiculos_all ON vehiculos FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);

DROP POLICY IF EXISTS auditoria_all ON auditoria;
CREATE POLICY auditoria_all ON auditoria FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);

DROP POLICY IF EXISTS automatizaciones_all ON automatizaciones;
CREATE POLICY automatizaciones_all ON automatizaciones FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);

DROP POLICY IF EXISTS automation_runs_all ON automation_runs;
CREATE POLICY automation_runs_all ON automation_runs FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);
