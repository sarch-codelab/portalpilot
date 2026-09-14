-- ═══════════════════════════════════════════════════════════════════════════
-- PORTAL PILOT — MIGRACIÓN PORTALES V2 (Bloques A–O)
-- Idempotente: segura de ejecutar múltiples veces.
--   1) api_keys.clave_prefix  → nunca volver a servir secretos completos
--   2) seguridad_eventos      → eventos de seguridad (cambios sensibles, 2FA)
--   3) tenant_sessions        → sesiones/dispositivos reales por usuario
--   4) tenants: columnas legales/configuración del Portal Empresa
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) API KEYS: prefijo legible + índice ─────────────────────────────────
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS clave_prefix VARCHAR(24);
CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON public.api_keys(empresa_codigo);
COMMENT ON COLUMN public.api_keys.clave_prefix IS 'Prefijo legible (pk_live_xxxxxx). El secreto real SOLO vive como hash SHA-256 en clave.';

-- ── 2) EVENTOS DE SEGURIDAD ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seguridad_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  usuario_email VARCHAR(200),
  evento VARCHAR(80) NOT NULL,          -- login_exitoso, login_fallido, password_changed, 2fa_enabled, 2fa_disabled, session_revoked, api_key_created, api_key_revoked, role_changed, sensitive_change
  severidad VARCHAR(20) DEFAULT 'info', -- info | warning | critical
  ip VARCHAR(60),
  dispositivo TEXT,
  descripcion TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seguridad_eventos_empresa ON public.seguridad_eventos(empresa_codigo, created_at DESC);
ALTER TABLE public.seguridad_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seguridad_eventos_service" ON public.seguridad_eventos;
CREATE POLICY "seguridad_eventos_service" ON public.seguridad_eventos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3) SESIONES POR DISPOSITIVO ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  token_version INTEGER DEFAULT 0,
  ip VARCHAR(60),
  dispositivo TEXT,                      -- "Chrome en Windows"
  ubicacion TEXT,                        -- "Tegucigalpa, Honduras"
  user_agent TEXT,
  ultimo_actividad TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  revocada BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_tenant_sessions_usuario ON public.tenant_sessions(usuario_id, ultimo_actividad DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_sessions_empresa ON public.tenant_sessions(empresa_codigo);
ALTER TABLE public.tenant_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_sessions_service" ON public.tenant_sessions;
CREATE POLICY "tenant_sessions_service" ON public.tenant_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4) TENANTS: información legal + configuración general (Portal Empresa) ─
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS rtn VARCHAR(40);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS telefono VARCHAR(40);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS email_facturacion VARCHAR(200);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS moneda VARCHAR(10) DEFAULT 'HNL';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS formato_fecha VARCHAR(20) DEFAULT 'DD/MM/YYYY';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS idioma VARCHAR(10) DEFAULT 'es';

-- ── 5) CONVERGENCIA DE ESQUEMA (drift detectado en producción) ─────────────
-- La tabla facturas productiva fue creada antes de migracion_unificada_completa
-- y carece de columnas que el backend inserta; esto provocaba 500 en POST
-- /api/facturas. Se añaden de forma idempotente.
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS empresa_codigo TEXT;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS cliente_email VARCHAR(100);
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS isv NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(30) DEFAULT 'factura';
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(50);
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS notas TEXT;
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- El esquema SAR antiguo exigía cai NOT NULL; hoy el correlativo/CAI es
-- opcional y NUNCA debe inventarse desde el backend.
ALTER TABLE public.facturas ALTER COLUMN cai DROP NOT NULL;
ALTER TABLE public.facturas ALTER COLUMN correlativo DROP NOT NULL;
-- CHECK legado de tipo_documento: solo aceptaba valores SAR antiguos y
-- rechazaba los tipos modernos del backend (factura/recibo/nota). Se elimina
-- y se reemplaza por uno compatible con ambos esquemas.
ALTER TABLE public.facturas DROP CONSTRAINT IF EXISTS facturas_tipo_documento_check;
ALTER TABLE public.facturas ADD CONSTRAINT facturas_tipo_documento_check
  CHECK (tipo_documento IS NULL OR tipo_documento IN ('factura', 'recibo', 'nota_credito', 'FAC', '01', 'CCF'));
ALTER TABLE public.recibos ADD COLUMN IF NOT EXISTS empresa_codigo TEXT;
ALTER TABLE public.notas_credito ADD COLUMN IF NOT EXISTS empresa_codigo TEXT;

-- support_tickets.asunto puede faltar según la versión de la tabla
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS asunto VARCHAR(200);

-- usuarios.token_version: revocación de sesiones por usuario (usado por
-- DELETE /api/tenant/sessions/:id y el logout global). Sin esta columna la
-- revocación devolvía 500 en producción.
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;

-- ── 6) INTEGRACIONES POR TENANT (Bloque K) ─────────────────────────────────
-- El catálogo de integraciones disponibles es metadata de la plataforma
-- (constante en el backend); el ESTADO de conexión de cada tenant vive aquí.
CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  integration_key VARCHAR(60) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}'::jsonb,
  connected_by UUID,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_codigo, integration_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_integrations_empresa ON public.tenant_integrations(empresa_codigo);
ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_integrations_service" ON public.tenant_integrations;
CREATE POLICY "tenant_integrations_service" ON public.tenant_integrations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
