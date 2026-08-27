-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: Tablas faltantes + AI Gateway + Productos
-- Portal Pilot — Supabase
-- ═══════════════════════════════════════════════════════════════

-- 1. EMPRESAS (required by server.js resolverEmpresaSupabase)
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150),
  rtn VARCHAR(20),
  email VARCHAR(100),
  telefono VARCHAR(30),
  direccion TEXT,
  pais VARCHAR(50) DEFAULT 'Honduras',
  plan VARCHAR(30) DEFAULT 'starter',
  estado VARCHAR(20) DEFAULT 'activo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_codigo ON empresas(codigo);

-- 2. USUARIO_MODULOS (per-user module access)
CREATE TABLE IF NOT EXISTS usuario_modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  empresa_id UUID NOT NULL,
  modulo_id VARCHAR(100) NOT NULL,
  rol VARCHAR(50) DEFAULT 'user',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usuario_modulos_usuario ON usuario_modulos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_modulos_empresa ON usuario_modulos(empresa_id);

-- 3. AUTOMATION_RULES (event-driven automation rules)
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  trigger_type VARCHAR(50) NOT NULL,
  conditions JSONB DEFAULT '{}',
  actions JSONB DEFAULT '[]',
  enabled BOOLEAN DEFAULT TRUE,
  execution_count INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_empresa ON automation_rules(empresa_codigo, trigger_type, enabled);

-- 4. FACTURAS (invoices — dashboard + automation)
CREATE TABLE IF NOT EXISTS facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  correlativo VARCHAR(50),
  cliente_nombre VARCHAR(200),
  cliente_rtn VARCHAR(20),
  cliente_email VARCHAR(100),
  subtotal NUMERIC(12,2) DEFAULT 0,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(30) DEFAULT 'emitida',
  tipo_documento VARCHAR(30) DEFAULT 'factura',
  metodo_pago VARCHAR(50),
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(empresa_id, estado);

-- 5. TRANSACCIONES (financial transactions — dashboard)
CREATE TABLE IF NOT EXISTS transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  tipo VARCHAR(30) NOT NULL,
  categoria VARCHAR(100),
  descripcion TEXT,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo_pago VARCHAR(50),
  referencia VARCHAR(200),
  metadata JSONB,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transacciones_empresa ON transacciones(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transacciones_tipo ON transacciones(empresa_id, tipo);

-- 6. PRODUCTOS (products — dashboard + automation + AI inventory)
CREATE TABLE IF NOT EXISTS productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  codigo VARCHAR(100),
  nombre VARCHAR(200) NOT NULL,
  descripcion TEXT,
  categoria VARCHAR(100) DEFAULT 'General',
  unidad_medida VARCHAR(50) DEFAULT 'Unidad',
  imagen_url TEXT,
  precio_compra NUMERIC(12,2) DEFAULT 0,
  precio_venta NUMERIC(12,2) DEFAULT 0,
  stock_actual INTEGER DEFAULT 0,
  stock_minimo INTEGER DEFAULT 0,
  isv_rate NUMERIC(5,2) DEFAULT 15.0,
  exento BOOLEAN DEFAULT FALSE,
  bodega VARCHAR(100) DEFAULT 'General',
  activo BOOLEAN DEFAULT TRUE,
  barcode VARCHAR(100),
  marca VARCHAR(100),
  presentacion VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_productos_empresa ON productos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(empresa_id, codigo);
CREATE INDEX IF NOT EXISTS idx_productos_barcode ON productos(empresa_id, barcode);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(empresa_id, nombre);

-- 7. AI_USAGE_LOG (AI usage tracking per tenant/user)
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  usuario_id UUID,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  funcion VARCHAR(100) NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  cost_estimated NUMERIC(10,6) DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_empresa ON ai_usage_log(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_fecha ON ai_usage_log(created_at DESC);

-- 8. AI_PRODUCT_SCAN (temp results from vision analysis)
CREATE TABLE IF NOT EXISTS ai_product_scan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  imagen_url TEXT,
  resultado JSONB NOT NULL,
  confianza NUMERIC(5,4),
  producto_sugerido_id UUID,
  creado_como_producto BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ RLS Policies ═══

-- empresas: backend service role only
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_empresas" ON empresas FOR ALL USING (true);

-- usuario_modulos: backend service role only
ALTER TABLE usuario_modulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_usuario_modulos" ON usuario_modulos FOR ALL USING (true);

-- automation_rules: JWT-based tenant isolation
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_automation_rules" ON automation_rules FOR ALL
  USING (empresa_codigo = COALESCE(current_setting('request.jwt.claims', true)::json->>'empresa_codigo', ''));

-- facturas: backend service role only
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_facturas" ON facturas FOR ALL USING (true);

-- transacciones: backend service role only
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_transacciones" ON transacciones FOR ALL USING (true);

-- productos: backend service role only
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_productos" ON productos FOR ALL USING (true);

-- ai_usage_log: backend service role only
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY " service_role_ai_usage" ON ai_usage_log FOR ALL USING (true);

-- ═══ Auto-update triggers ═══

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_empresas_updated') THEN
    CREATE TRIGGER tr_empresas_updated BEFORE UPDATE ON empresas
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_facturas_updated') THEN
    CREATE TRIGGER tr_facturas_updated BEFORE UPDATE ON facturas
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_productos_updated') THEN
    CREATE TRIGGER tr_productos_updated BEFORE UPDATE ON productos
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_automation_rules_updated') THEN
    CREATE TRIGGER tr_automation_rules_updated BEFORE UPDATE ON automation_rules
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ═══ Auto-sync: when tenant is created, create empresa record ═══

CREATE OR REPLACE FUNCTION sync_empresa_from_tenant()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO empresas (codigo, nombre, plan, estado)
  VALUES (NEW.codigo, NEW.nombre_empresa, NEW.plan, NEW.estado)
  ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    plan = EXCLUDED.plan,
    estado = EXCLUDED.estado,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_sync_empresa') THEN
    CREATE TRIGGER tr_sync_empresa AFTER INSERT OR UPDATE ON tenants
      FOR EACH ROW EXECUTE FUNCTION sync_empresa_from_tenant();
  END IF;
END $$;

-- ═══ Seed: create empresa records for existing tenants ═══

INSERT INTO empresas (codigo, nombre, plan, estado)
SELECT codigo, nombre_empresa, plan, estado
FROM tenants
ON CONFLICT (codigo) DO NOTHING;
