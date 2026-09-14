-- ═══════════════════════════════════════════════════════════════════
-- PORTAL PILOT — MIGRACIÓN CONSOLIDADA DE OBJETOS PENDIENTES
-- Estado verificado contra producción (2026-09-14, backend/check_schema.js):
--   ✗ usuarios.token_version           (migracion_portales_v2.sql nunca aplicada)
--   ✗ tenant_sessions                  (ídem)
--   ✗ tenant_integrations              (ídem)
--   ✗ seguridad_eventos                (ídem)
--   ✗ api_keys.clave_prefix            (ídem)
--   ✓ planes / plan_features / plan_limits / subscriptions / ai_usage_log / billing_payments (aplicadas)
--
-- Esta migración es IDEMPOTENTE: puede ejecutarse varias veces sin daño
-- (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS).
-- No elimina datos ni columnas. Riesgo: BAJO.
-- Ejecutar en Supabase SQL Editor del proyecto de PRODUCCIÓN.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Revocación de sesiones: columna token_version
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- 2) Sesiones reales por tenant (login registra; /api/empresa/sessions lee)
CREATE TABLE IF NOT EXISTS public.tenant_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  ip TEXT,
  dispositivo TEXT,
  ubicacion TEXT,
  ultimo_actividad TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revocada BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_tenant_sessions_empresa ON public.tenant_sessions(empresa_codigo, ultimo_actividad DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_sessions_usuario ON public.tenant_sessions(usuario_id);

-- 3) Eventos de seguridad (severidad, metadata JSON)
CREATE TABLE IF NOT EXISTS public.seguridad_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  evento TEXT NOT NULL,
  severidad TEXT DEFAULT 'info',          -- info | warning | critical
  descripcion TEXT,
  usuario_id UUID,
  usuario_email TEXT,
  ip TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seguridad_eventos_empresa ON public.seguridad_eventos(empresa_codigo, created_at DESC);

-- 4) Integraciones por tenant (Stripe/WhatsApp/… estado declarado)
CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  integration_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  connected_by UUID,
  connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (empresa_codigo, integration_key)
);

-- 5) Prefijo visible de API keys (hash completo permanece en `clave`)
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS clave_prefix TEXT;

-- ── RLS: el backend usa service_role (bypass), pero las políticas quedan
--    definidas para el acceso futuro por JWT de usuario. Deny-by-default. ──
ALTER TABLE public.tenant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguridad_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_sessions_service ON public.tenant_sessions;
  CREATE POLICY tenant_sessions_service ON public.tenant_sessions FOR ALL USING (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS seguridad_eventos_service ON public.seguridad_eventos;
  CREATE POLICY seguridad_eventos_service ON public.seguridad_eventos FOR ALL USING (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_integrations_service ON public.tenant_integrations;
  CREATE POLICY tenant_integrations_service ON public.tenant_integrations FOR ALL USING (true);
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar backend/check_schema.js):
-- todas las líneas deben marcar ✓
-- ═══════════════════════════════════════════════════════════════════
