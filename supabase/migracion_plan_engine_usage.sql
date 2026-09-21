-- ═══════════════════════════════════════════════════════════════════
-- PORTAL PILOT — PLAN ENGINE & USAGE METERING (Bloque 1)
-- Tablas: planes, plan_features, plan_limits, tenant_usage, subscriptions
-- Idempotente (puede ejecutarse varias veces sin error).
-- ═══════════════════════════════════════════════════════════════════

-- 1) PLANES (catálogo canónico de planes)
CREATE TABLE IF NOT EXISTS planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL UNIQUE,                 -- starter | business | enterprise | custom
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  precio_mensual_usd NUMERIC(10,2) DEFAULT 0,
  precio_anual_usd NUMERIC(10,2) DEFAULT 0,
  max_users INTEGER DEFAULT 5,
  max_companies INTEGER DEFAULT 1,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) PLAN_FEATURES (features habilitadas por plan)
CREATE TABLE IF NOT EXISTS plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  UNIQUE (plan_id, feature)
);

-- 3) PLAN_LIMITS (límites por recurso del plan; recurso = ai_tokens|storage|automatizaciones|api_requests|documents|users)
CREATE TABLE IF NOT EXISTS plan_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  recurso TEXT NOT NULL,                      -- ai_tokens | storage | automatizaciones | api_requests | documents | users
  maximo NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad TEXT DEFAULT '',
  UNIQUE (plan_id, recurso)
);

-- 4) TENANT_USAGE (metering por tenant y periodo YYYY-MM)
CREATE TABLE IF NOT EXISTS tenant_usage (
  empresa_codigo TEXT NOT NULL,
  recurso TEXT NOT NULL,          -- ai_tokens | api_requests | storage | users | documents | automations
  periodo TEXT NOT NULL,          -- YYYY-MM
  cantidad NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa_codigo, recurso, periodo)
);

-- 5) SUBSCRIPTIONS (estado de suscripción por tenant)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL UNIQUE,
  plan_id UUID REFERENCES planes(id),
  estado TEXT NOT NULL DEFAULT 'trial',        -- trial | active | expired | cancelled | suspended
  trial_started_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  proveedor_pago TEXT DEFAULT '',              -- stripe | paypal | tigo_money | manual
  external_subscription_id TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de apoyo
CREATE INDEX IF NOT EXISTS idx_tenant_usage_periodo ON tenant_usage(periodo);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_recurso ON tenant_usage(recurso);
CREATE INDEX IF NOT EXISTS idx_subscriptions_empresa ON subscriptions(empresa_codigo);

-- ═══════════════════════════════════════════════════════════════════
-- RPC: incrementar_tenant_uso (incremento atómico de contador)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION incrementar_tenant_uso(
  p_empresa_codigo TEXT,
  p_recurso TEXT,
  p_periodo TEXT,
  p_cantidad NUMERIC
) RETURNS VOID AS $$
BEGIN
  INSERT INTO tenant_usage (empresa_codigo, recurso, periodo, cantidad, updated_at)
  VALUES (p_empresa_codigo, p_recurso, p_periodo, COALESCE(p_cantidad, 0), NOW())
  ON CONFLICT (empresa_codigo, recurso, periodo)
  DO UPDATE SET cantidad = tenant_usage.cantidad + COALESCE(p_cantidad, 0),
                updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- SEEDS: planes canónicos y sus features/límites
-- ═══════════════════════════════════════════════════════════════════
-- Starter (trial 15 días; pipeline de datos + IA básica)
INSERT INTO planes (clave, nombre, descripcion, precio_mensual_usd, precio_anual_usd, max_users, max_companies, orden)
VALUES ('starter', 'Starter', 'Prueba de 15 días con toda la plataforma para evaluar. Al vencer, modo solo lectura.', 0, 0, 5, 1, 1)
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, max_users = EXCLUDED.max_users, max_companies = EXCLUDED.max_companies, orden = EXCLUDED.orden;

INSERT INTO planes (clave, nombre, descripcion, precio_mensual_usd, precio_anual_usd, max_users, max_companies, orden)
VALUES ('business', 'Business', 'Operación completa para PYMES: inventario, facturación, IA, roles y reportes.', 29, 290, 50, 3, 2)
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, max_users = EXCLUDED.max_users, max_companies = EXCLUDED.max_companies, orden = EXCLUDED.orden;

INSERT INTO planes (clave, nombre, descripcion, precio_mensual_usd, precio_anual_usd, max_users, max_companies, orden)
VALUES ('enterprise', 'Enterprise', 'Ilimitado: multiempresa, seguridad avanzada, soporte dedicado 24/7.', 99, 990, 200, 5, 3)
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, max_users = EXCLUDED.max_users, max_companies = EXCLUDED.max_companies, orden = EXCLUDED.orden;

INSERT INTO planes (clave, nombre, descripcion, precio_mensual_usd, precio_anual_usd, max_users, max_companies, orden)
VALUES ('custom', 'Custom', 'Plan a medida para corporativos.', 0, 0, 9999, 9999, 4)
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, max_users = EXCLUDED.max_users, max_companies = EXCLUDED.max_companies, orden = EXCLUDED.orden;

-- Features/límites por plan (solo si no existen, para respetar ediciones manuales)
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature
FROM planes p
CROSS JOIN (VALUES
  ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_admin'), ('reportes'),
  ('ia'), ('roles'), ('auditoria'), ('pos'), ('clientes'), ('proveedores'), ('compras'),
  ('precios'), ('promociones'), ('canal_tradicional'), ('rutas'), ('cobros')
) AS f(feature)
WHERE p.clave = 'starter'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature
FROM planes p
CROSS JOIN (VALUES
  ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_admin'), ('reportes'),
  ('ia'), ('roles'), ('auditoria'), ('pos'), ('clientes'), ('proveedores'), ('compras'),
  ('precios'), ('promociones'), ('canal_tradicional'), ('fiado'), ('rutas'), ('cobros'),
  ('reportes_basicos')
) AS f(feature)
WHERE p.clave = 'business'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature
FROM planes p
CROSS JOIN (VALUES
  ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_admin'), ('reportes'),
  ('ia'), ('ia_avanzada'), ('roles'), ('auditoria'), ('seguridad_avanzada'), ('api_keys'),
  ('pos'), ('clientes'), ('proveedores'), ('compras'), ('precios'), ('promociones'),
  ('canal_tradicional'), ('fiado'), ('rutas'), ('cobros'), ('membresias'), ('socios'),
  ('puntos'), ('automation'), ('fleet'), ('multiempresa'), ('sucursales'), ('transferencias')
) AS f(feature)
WHERE p.clave = 'enterprise'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature
FROM planes p
CROSS JOIN (VALUES ('all_features'))
AS f(feature)
WHERE p.clave = 'custom'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

-- Límites por recurso (matching PLAN_LIMITS de server.js)
INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad
FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 100000, 'tokens'),
  ('users', 5, 'usuarios'),
  ('automatizaciones', 2, 'bots'),
  ('storage', 5, 'GB'),
  ('api_requests', 10000, 'req/mes'),
  ('documents', 100, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'starter'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad
FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 2000000, 'tokens'),
  ('users', 50, 'usuarios'),
  ('automatizaciones', 15, 'bots'),
  ('storage', 100, 'GB'),
  ('api_requests', 100000, 'req/mes'),
  ('documents', 5000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'business'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad
FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 10000000, 'tokens'),
  ('users', 200, 'usuarios'),
  ('automatizaciones', 50, 'bots'),
  ('storage', 500, 'GB'),
  ('api_requests', 1000000, 'req/mes'),
  ('documents', 100000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'enterprise'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad
FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 99999999, 'tokens'),
  ('users', 9999, 'usuarios'),
  ('automatizaciones', 9999, 'bots'),
  ('storage', 9999, 'GB'),
  ('api_requests', 99999999, 'req/mes'),
  ('documents', 99999999, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'custom'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

-- ═══════════════════════════════════════════════════════════════════
-- RLS: tenant_usage y subscriptions solo el service_role (backend);
-- planes/plan_features/plan_limits lectura pública (catálogo).
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "planes_public_read" ON planes;
  CREATE POLICY "planes_public_read" ON planes FOR SELECT USING (true);
  DROP POLICY IF EXISTS "plan_features_public_read" ON plan_features;
  CREATE POLICY "plan_features_public_read" ON plan_features FOR SELECT USING (true);
  DROP POLICY IF EXISTS "plan_limits_public_read" ON plan_limits;
  CREATE POLICY "plan_limits_public_read" ON plan_limits FOR SELECT USING (true);
  DROP POLICY IF EXISTS "tenant_usage_service_role" ON tenant_usage;
  CREATE POLICY "tenant_usage_service_role" ON tenant_usage FOR ALL TO service_role USING (true);
  DROP POLICY IF EXISTS "subscriptions_service_role" ON subscriptions;
  CREATE POLICY "subscriptions_service_role" ON subscriptions FOR ALL TO service_role USING (true);
END $$;

-- Grants de seguridad (por defecto postgrest usa role anon; restringimos escrituras)
REVOKE ALL ON tenant_usage, subscriptions FROM anon, authenticated;
GRANT SELECT ON planes, plan_features, plan_limits, tenant_usage, subscriptions TO anon;
GRANT ALL ON tenant_usage, subscriptions TO service_role;
GRANT ALL ON planes, plan_features, plan_limits TO service_role;