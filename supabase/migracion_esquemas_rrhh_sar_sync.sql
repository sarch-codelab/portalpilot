-- PORTAL PILOT — Esquemas remotos que la app ya usa en Drift pero no existían
-- en Supabase: empleados, nomina (RRHH) y sar_correlativo (fiscal).
-- Habilita /api/sync para esos módulos (antes respondía 501).
-- Aplicada en producción como migración `esquemas_rrhh_sar_sync`.

CREATE TABLE IF NOT EXISTS public.empleados (
  id TEXT PRIMARY KEY,
  empresa_id UUID,
  empresa_codigo TEXT,
  nombre TEXT NOT NULL,
  identidad TEXT,
  rtn TEXT,
  puesto TEXT,
  departamento TEXT,
  salario_base NUMERIC DEFAULT 0,
  fecha_ingreso TIMESTAMPTZ,
  estado TEXT DEFAULT 'activo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT FALSE,
  last_sync_attempt TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_empleados_empresa ON public.empleados(empresa_codigo);

CREATE TABLE IF NOT EXISTS public.nomina (
  id TEXT PRIMARY KEY,
  empresa_id UUID,
  empresa_codigo TEXT,
  empleado_id TEXT,
  mes INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  salario_base NUMERIC DEFAULT 0,
  bonificaciones NUMERIC DEFAULT 0,
  deducciones NUMERIC DEFAULT 0,
  isss NUMERIC DEFAULT 0,
  rtn NUMERIC DEFAULT 0,
  ihss NUMERIC DEFAULT 0,
  neta NUMERIC DEFAULT 0,
  pagado BOOLEAN DEFAULT FALSE,
  fecha_pago TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT FALSE,
  last_sync_attempt TIMESTAMPTZ,
  UNIQUE (empresa_codigo, empleado_id, mes, anio)
);
CREATE INDEX IF NOT EXISTS idx_nomina_empresa ON public.nomina(empresa_codigo, anio, mes);

CREATE TABLE IF NOT EXISTS public.sar_correlativo (
  id TEXT PRIMARY KEY,
  empresa_id UUID,
  empresa_codigo TEXT,
  tipo_documento TEXT DEFAULT '01',
  cai TEXT,
  numero_resolucion TEXT,
  rango_inicio TEXT,
  rango_fin TEXT,
  fecha_limite_emision TIMESTAMPTZ,
  siguiente_numero INTEGER DEFAULT 1,
  agotado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT FALSE,
  UNIQUE (empresa_codigo, tipo_documento)
);
CREATE INDEX IF NOT EXISTS idx_sar_correlativo_empresa ON public.sar_correlativo(empresa_codigo);

ALTER TABLE public.empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sar_correlativo ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS empleados_service_role ON public.empleados;
  CREATE POLICY empleados_service_role ON public.empleados FOR ALL TO service_role USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS nomina_service_role ON public.nomina;
  CREATE POLICY nomina_service_role ON public.nomina FOR ALL TO service_role USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS sar_correlativo_service_role ON public.sar_correlativo;
  CREATE POLICY sar_correlativo_service_role ON public.sar_correlativo FOR ALL TO service_role USING (true) WITH CHECK (true);
END $$;

GRANT ALL ON public.empleados, public.nomina, public.sar_correlativo TO service_role;
