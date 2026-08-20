-- ═══════════════════════════════════════════════════════════════════════════
-- PORTAL PILOT — MIGRACIÓN UNIFICADA COMPLETA
-- Ejecutar UNA sola vez en Supabase SQL Editor
-- Contiene: schema base + enterprise + columnas faltantes + comercial
-- 100% idempotente: puede re-ejecutarse sin errores
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 1: EXTENSIONES + FUNCTIONS BASE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION jwt_empresa_codigo()
RETURNS TEXT AS $$
  SELECT NULLIF(auth.jwt() ->> 'empresa_codigo', '');
$$ LANGUAGE SQL STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 2: TABLAS BASE
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1 TENANTS
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(50),
  nombre_empresa VARCHAR(150),
  rtn VARCHAR(20),
  email VARCHAR(100),
  telefono VARCHAR(30),
  direccion TEXT,
  plan VARCHAR(50) DEFAULT 'starter',
  limite_usuarios INT DEFAULT 10,
  estado VARCHAR(20) DEFAULT 'activo',
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Add columns that may be missing if table was created by an older migration
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS limite_empresas INT DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS funciones_plan JSONB DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS referencia_pago TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_codigo_unique ON tenants(codigo);
DROP TRIGGER IF EXISTS trigger_tenants_updated ON tenants;
CREATE TRIGGER trigger_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO tenants (id, codigo, nombre_empresa, rtn, plan, estado)
SELECT gen_random_uuid(), 'ROOT', 'Portal Pilot System Admin', '00000000000000', 'enterprise', 'activo'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE codigo = 'ROOT');

-- 2.2 USUARIOS
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(120),
  password_hash TEXT,
  password TEXT,
  nombre VARCHAR(100),
  apellido VARCHAR(100),
  rol VARCHAR(50) DEFAULT 'admin',
  empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
  empresa_id UUID,
  estado VARCHAR(20) DEFAULT 'activo',
  activo BOOLEAN DEFAULT TRUE,
  avatar_url TEXT,
  foto_perfil_url TEXT,
  telefono VARCHAR(30),
  ultimo_acceso TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Add columns that may be missing if table was created by an older migration
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_global VARCHAR(50) DEFAULT 'operador';
-- Drop any CHECK constraint from prior partial runs that may restrict rol_global values
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_global_check' AND conrelid = 'usuarios'::regclass) THEN
    ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_global_check;
  END IF;
END $$;
UPDATE usuarios SET rol_global = 'operador' WHERE rol_global IS NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS two_factor_confirmed_at TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_id_fkey;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_empresa_id_fkey;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_unique ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_codigo_activo ON usuarios(empresa_codigo, activo);
DROP TRIGGER IF EXISTS trigger_usuarios_updated ON usuarios;
CREATE TRIGGER trigger_usuarios_updated BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO usuarios (id, email, password_hash, password, nombre, rol, empresa_codigo, estado, activo)
SELECT gen_random_uuid(), 'admin@portalpilot.com', '$2a$10$7vN5tDkI46c.r.O0sL7/vOq22gZ6zG98t8vX09Z9/5vG5vG5vG5vG', 'admin123', 'Super Admin Portal Pilot', 'root', 'ROOT', 'activo', true
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'admin@portalpilot.com');
-- Set rol_global separately to avoid CHECK constraint issues
UPDATE usuarios SET rol_global = 'root' WHERE email = 'admin@portalpilot.com';

-- 2.3 NOTIFICACIONES
CREATE TABLE IF NOT EXISTS notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
  usuario_id UUID,
  titulo VARCHAR(150) NOT NULL,
  mensaje TEXT NOT NULL,
  tipo VARCHAR(30) DEFAULT 'info',
  prioridad VARCHAR(20) DEFAULT 'normal',
  leida BOOLEAN DEFAULT FALSE,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2.4 AUDITORÍA
CREATE TABLE IF NOT EXISTS auditoria_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
  usuario_email VARCHAR(120),
  accion VARCHAR(100) NOT NULL,
  modulo VARCHAR(50) NOT NULL,
  detalle TEXT,
  ip_origen VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT now()
);

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
CREATE INDEX IF NOT EXISTS idx_auditoria_empresa ON auditoria(empresa_codigo, created_at DESC);

-- 2.5 CONFIGURACIONES GLOBALES
CREATE TABLE IF NOT EXISTS configuraciones_globales (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL,
  entorno VARCHAR(30) DEFAULT 'production',
  sensible BOOLEAN DEFAULT FALSE,
  descripcion TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'SITE_NAME', 'Portal Pilot Honduras', 'production', false, 'Nombre público del sistema'
WHERE NOT EXISTS (SELECT 1 FROM configuraciones_globales WHERE clave = 'SITE_NAME');
INSERT INTO configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'API_DOMAIN', 'https://portalpilot-app.vercel.app', 'production', false, 'API Serverless'
WHERE NOT EXISTS (SELECT 1 FROM configuraciones_globales WHERE clave = 'API_DOMAIN');

-- 2.6 PLANES DE PAGO
CREATE TABLE IF NOT EXISTS planes_pago (
  id VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  precio_mensual NUMERIC(10,2) NOT NULL,
  precio_anual NUMERIC(10,2) NOT NULL,
  limite_usuarios INT NOT NULL,
  limite_bodegas INT NOT NULL,
  caracteristicas JSONB,
  activo BOOLEAN DEFAULT TRUE
);
INSERT INTO planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'starter', 'Plan Starter', 499.00, 4990.00, 5, 1, '["POS Básico", "Facturación SAR", "1 Bodega"]'
WHERE NOT EXISTS (SELECT 1 FROM planes_pago WHERE id = 'starter');
INSERT INTO planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'business', 'Plan Business', 1499.00, 14990.00, 25, 5, '["POS Avanzado", "IA Integrada", "Multisucursal"]'
WHERE NOT EXISTS (SELECT 1 FROM planes_pago WHERE id = 'business');
INSERT INTO planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'enterprise', 'Plan Enterprise', 4999.00, 49990.00, 250, 50, '["Acceso Ilimitado", "IA Dedicada", "Bots RPA"]'
WHERE NOT EXISTS (SELECT 1 FROM planes_pago WHERE id = 'enterprise');

-- 2.7 SUPPORT TICKETS
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
  nombre VARCHAR(100),
  email VARCHAR(120),
  empresa VARCHAR(150),
  plan VARCHAR(50),
  categoria VARCHAR(50),
  prioridad VARCHAR(20) DEFAULT 'normal',
  mensaje TEXT,
  estado VARCHAR(20) DEFAULT 'open',
  ticket_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Add columns that may be missing if table was created by an older migration
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS asunto VARCHAR(200);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS empresa_id UUID;
CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON support_tickets(email);
CREATE INDEX IF NOT EXISTS idx_support_tickets_estado ON support_tickets(estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_unique_id ON support_tickets(ticket_id) WHERE ticket_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 3: EMPRESAS + USUARIO_MODULOS + TENANT_FEATURES
-- ═══════════════════════════════════════════════════════════════════════════

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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empresas_codigo ON empresas(codigo);
DROP TRIGGER IF EXISTS tr_empresas_updated ON empresas;
CREATE TRIGGER tr_empresas_updated BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS usuario_modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  empresa_id UUID NOT NULL,
  modulo_id VARCHAR(100) NOT NULL,
  rol VARCHAR(50) DEFAULT 'user',
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuario_modulos_usuario ON usuario_modulos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_modulos_empresa ON usuario_modulos(empresa_id);

CREATE TABLE IF NOT EXISTS tenant_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  feature_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_codigo, feature_key)
);
CREATE INDEX IF NOT EXISTS idx_tenant_features_empresa ON tenant_features(empresa_codigo);

-- Sync trigger: auto-create empresa when tenant is created
CREATE OR REPLACE FUNCTION sync_empresa_from_tenant()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO empresas (codigo, nombre, plan, estado)
  VALUES (NEW.codigo, COALESCE(NEW.nombre_empresa, NEW.codigo), COALESCE(NEW.plan, 'starter'), COALESCE(NEW.estado, 'activo'))
  ON CONFLICT (codigo) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    plan = EXCLUDED.plan,
    estado = EXCLUDED.estado,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sync_empresa ON tenants;
CREATE TRIGGER tr_sync_empresa AFTER INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION sync_empresa_from_tenant();

-- Seed empresa for ROOT
INSERT INTO empresas (codigo, nombre, plan, estado)
SELECT 'ROOT', 'Portal Pilot System Admin', 'enterprise', 'activo'
WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'ROOT');

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 4: ENTERPRISE (api_keys, vehiculos, automatizaciones)
-- ═══════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_api_keys_empresa ON api_keys(empresa_codigo);

CREATE TABLE IF NOT EXISTS vehiculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  placa TEXT NOT NULL,
  tipo TEXT DEFAULT 'Camión',
  chofer TEXT DEFAULT '',
  estado TEXT DEFAULT 'disponible',
  combustible INTEGER DEFAULT 100,
  km NUMERIC(12,2) DEFAULT 0,
  ubicacion TEXT DEFAULT '',
  ultimo_movimiento TIMESTAMPTZ,
  fecha_mantenimiento TIMESTAMPTZ,
  notas TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa ON vehiculos(empresa_codigo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_placa_empresa ON vehiculos(empresa_codigo, placa);
DROP TRIGGER IF EXISTS trigger_vehiculos_updated ON vehiculos;
CREATE TRIGGER trigger_vehiculos_updated BEFORE UPDATE ON vehiculos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS automatizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  icono TEXT DEFAULT 'fa-bolt',
  estado TEXT DEFAULT 'inactivo',
  tareas INTEGER DEFAULT 0,
  exito INTEGER DEFAULT 100,
  trigger_flow TEXT DEFAULT '',
  accion TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automatizaciones_empresa ON automatizaciones(empresa_codigo);
DROP TRIGGER IF EXISTS trigger_automatizaciones_updated ON automatizaciones;
CREATE TRIGGER trigger_automatizaciones_updated BEFORE UPDATE ON automatizaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  automatizacion_id UUID,
  agente TEXT DEFAULT '',
  mensaje TEXT NOT NULL,
  nivel TEXT DEFAULT 'info',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_empresa ON automation_runs(empresa_codigo, created_at DESC);

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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_empresa ON automation_rules(empresa_codigo, trigger_type, enabled);
DROP TRIGGER IF EXISTS tr_automation_rules_updated ON automation_rules;
CREATE TRIGGER tr_automation_rules_updated BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 5: COMERCIAL CORE (facturas, transacciones, productos)
-- ═══════════════════════════════════════════════════════════════════════════

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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sucursal_id UUID;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS bodega_id UUID;
CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas(empresa_id, estado);
DROP TRIGGER IF EXISTS tr_facturas_updated ON facturas;
CREATE TRIGGER tr_facturas_updated BEFORE UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  fecha TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS sucursal_id UUID;
CREATE INDEX IF NOT EXISTS idx_transacciones_empresa ON transacciones(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_transacciones_tipo ON transacciones(empresa_id, tipo);

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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Add columns that may be missing if table was created by an older migration
ALTER TABLE productos ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS presentacion VARCHAR(100);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_costo_historico NUMERIC(12,2);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sucursal_id UUID;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS bodega_id UUID;
CREATE INDEX IF NOT EXISTS idx_productos_empresa ON productos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(empresa_id, codigo);
CREATE INDEX IF NOT EXISTS idx_productos_barcode ON productos(empresa_id, barcode);
CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(empresa_id, nombre);
DROP TRIGGER IF EXISTS tr_productos_updated ON productos;
CREATE TRIGGER tr_productos_updated BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5.5 CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  rtn VARCHAR(20),
  email VARCHAR(100),
  telefono VARCHAR(30),
  direccion TEXT,
  limite_credito NUMERIC(12,2) DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) DEFAULT 0,
  notas TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sync BOOLEAN DEFAULT FALSE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre ON clientes(empresa_id, nombre);
CREATE INDEX IF NOT EXISTS idx_clientes_rtn ON clientes(empresa_id, rtn);
DROP TRIGGER IF EXISTS tr_clientes_updated ON clientes;
CREATE TRIGGER tr_clientes_updated BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 6: AI TRACKING
-- ═══════════════════════════════════════════════════════════════════════════

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
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_empresa ON ai_usage_log(empresa_codigo, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_product_scan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  imagen_url TEXT,
  resultado JSONB NOT NULL,
  confianza NUMERIC(5,4),
  producto_sugerido_id UUID,
  creado_como_producto BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 7: SUCURSALES + BODEGAS + KARDEX
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sucursales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  direccion TEXT,
  telefono VARCHAR(30),
  email VARCHAR(100),
  encargado VARCHAR(150),
  tipo VARCHAR(30) DEFAULT 'tienda',
  activa BOOLEAN DEFAULT true,
  es_principal BOOLEAN DEFAULT false,
  latitud NUMERIC(10,7),
  longitud NUMERIC(10,7),
  horario JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_codigo, codigo)
);
CREATE INDEX IF NOT EXISTS idx_sucursales_empresa ON sucursales(empresa_codigo);

CREATE TABLE IF NOT EXISTS bodegas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  sucursal_id UUID,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  tipo VARCHAR(30) DEFAULT 'general',
  direccion TEXT,
  activa BOOLEAN DEFAULT true,
  es_principal BOOLEAN DEFAULT false,
  capacidad_maxima INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_codigo, codigo)
);
CREATE INDEX IF NOT EXISTS idx_bodegas_empresa ON bodegas(empresa_codigo);

CREATE TABLE IF NOT EXISTS kardex (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  producto_id UUID NOT NULL,
  bodega_id UUID,
  sucursal_id UUID,
  tipo_movimiento VARCHAR(30) NOT NULL,
  cantidad INT NOT NULL,
  cantidad_anterior INT NOT NULL,
  cantidad_nueva INT NOT NULL,
  costo_unitario NUMERIC(12,2),
  referencia_tipo VARCHAR(50),
  referencia_id UUID,
  notas TEXT,
  usuario_id UUID,
  usuario_nombre VARCHAR(150),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kardex_empresa ON kardex(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_producto ON kardex(producto_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 8: PROVEEDORES + COMPRAS + PRECIOS + PROMOCIONES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  codigo VARCHAR(50),
  nombre VARCHAR(200) NOT NULL,
  rtn VARCHAR(20),
  telefono VARCHAR(30),
  email VARCHAR(100),
  direccion TEXT,
  contacto_nombre VARCHAR(150),
  contacto_telefono VARCHAR(30),
  nivel VARCHAR(20) DEFAULT 'normal',
  dias_credito INT DEFAULT 0,
  limite_credito NUMERIC(12,2) DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) DEFAULT 0,
  notas TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_empresa ON proveedores(empresa_codigo);

CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  proveedor_id UUID,
  sucursal_id UUID,
  bodega_destino_id UUID,
  numero_orden VARCHAR(50),
  fecha_orden TIMESTAMPTZ DEFAULT now(),
  fecha_recepcion TIMESTAMPTZ,
  subtotal NUMERIC(12,2) DEFAULT 0,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(30) DEFAULT 'pendiente',
  metodo_pago VARCHAR(50),
  notas TEXT,
  usuario_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_empresa ON compras(empresa_codigo, fecha_orden DESC);

CREATE TABLE IF NOT EXISTS compras_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL,
  producto_id UUID,
  codigo VARCHAR(100),
  nombre VARCHAR(200),
  cantidad INT NOT NULL DEFAULT 1,
  costo_unitario NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  cantidad_recibida INT DEFAULT 0,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_detalle_compra ON compras_detalle(compra_id);

CREATE TABLE IF NOT EXISTS listas_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(30) DEFAULT 'general',
  es_default BOOLEAN DEFAULT false,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listas_precios_empresa ON listas_precios(empresa_codigo);

CREATE TABLE IF NOT EXISTS productos_precio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  producto_id UUID NOT NULL,
  lista_precio_id UUID NOT NULL,
  precio NUMERIC(12,2) NOT NULL,
  precio_minimo NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(producto_id, lista_precio_id)
);
CREATE INDEX IF NOT EXISTS idx_productos_precio_producto ON productos_precio(producto_id);

CREATE TABLE IF NOT EXISTS promociones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(30) NOT NULL,
  valor NUMERIC(12,2) NOT NULL,
  compra_minima INT DEFAULT 1,
  descuento_maximo NUMERIC(12,2),
  aplica_a VARCHAR(30) DEFAULT 'todos',
  aplica_valor VARCHAR(200),
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  activa BOOLEAN DEFAULT true,
  uso_maximo INT,
  uso_actual INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promociones_empresa ON promociones(empresa_codigo, activa);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 9: CANAL TRADICIONAL (fiado, abonos, rutas, visitas)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ventas_fiadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  cliente_id UUID,
  cliente_nombre VARCHAR(200) NOT NULL,
  cliente_telefono VARCHAR(30),
  cliente_direccion TEXT,
  cliente_rtn VARCHAR(20),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(30) DEFAULT 'pendiente',
  fecha_venta TIMESTAMPTZ DEFAULT now(),
  fecha_vencimiento TIMESTAMPTZ,
  dias_credito INT DEFAULT 30,
  vendedor_id UUID,
  vendedor_nombre VARCHAR(150),
  ruta_id UUID,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ventas_fiadas_empresa ON ventas_fiadas(empresa_codigo, fecha_venta DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_fiadas_estado ON ventas_fiadas(empresa_codigo, estado);

CREATE TABLE IF NOT EXISTS ventas_fiadas_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venta_fiada_id UUID NOT NULL,
  producto_id UUID,
  codigo VARCHAR(100),
  nombre VARCHAR(200),
  cantidad INT NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ventas_fiadas_detalle_venta ON ventas_fiadas_detalle(venta_fiada_id);

CREATE TABLE IF NOT EXISTS abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  venta_fiada_id UUID NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago VARCHAR(50) DEFAULT 'efectivo',
  referencia VARCHAR(200),
  notas TEXT,
  usuario_id UUID,
  usuario_nombre VARCHAR(150),
  cobrador_id UUID,
  cobrador_nombre VARCHAR(150),
  fecha TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abonos_empresa ON abonos(empresa_codigo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_abonos_venta ON abonos(venta_fiada_id);

CREATE TABLE IF NOT EXISTS rutas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  zona VARCHAR(100),
  vendedor_id UUID,
  vendedor_nombre VARCHAR(150),
  dias_recorrido TEXT[],
  orden_clientes JSONB,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rutas_empresa ON rutas(empresa_codigo);

CREATE TABLE IF NOT EXISTS visitas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  ruta_id UUID,
  vendedor_id UUID,
  vendedor_nombre VARCHAR(150),
  cliente_nombre VARCHAR(200),
  cliente_telefono VARCHAR(30),
  cliente_direccion TEXT,
  latitud NUMERIC(10,7),
  longitud NUMERIC(10,7),
  estado VARCHAR(30) DEFAULT 'programada',
  resultado VARCHAR(30),
  notas TEXT,
  venta_generada_id UUID,
  fecha_programada DATE,
  hora_inicio TIMESTAMPTZ,
  hora_fin TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitas_empresa ON visitas(empresa_codigo, fecha_programada DESC);
CREATE INDEX IF NOT EXISTS idx_visitas_ruta ON visitas(ruta_id, fecha_programada);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 10: CANAL MODERNO (transferencias)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS transferencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  sucursal_origen_id UUID NOT NULL,
  sucursal_destino_id UUID NOT NULL,
  bodega_origen_id UUID,
  bodega_destino_id UUID,
  numero VARCHAR(50),
  fecha TIMESTAMPTZ DEFAULT now(),
  estado VARCHAR(30) DEFAULT 'pendiente',
  motivo TEXT,
  notas TEXT,
  usuario_id UUID,
  usuario_nombre VARCHAR(150),
  recibido_por VARCHAR(150),
  fecha_recepcion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transferencias_empresa ON transferencias(empresa_codigo, fecha DESC);

CREATE TABLE IF NOT EXISTS transferencias_detalle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id UUID NOT NULL,
  producto_id UUID,
  codigo VARCHAR(100),
  nombre VARCHAR(200),
  cantidad_solicitada INT NOT NULL,
  cantidad_enviada INT DEFAULT 0,
  cantidad_recibida INT DEFAULT 0,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transferencias_detalle_trans ON transferencias_detalle(transferencia_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 11: MEMBRESÍAS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS planes_membresia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  precio_mensual NUMERIC(12,2),
  precio_anual NUMERIC(12,2),
  nivel VARCHAR(30) DEFAULT 'bronce',
  descuento_porcentaje NUMERIC(5,2) DEFAULT 0,
  puntos_por_lempira NUMERIC(5,2) DEFAULT 1,
  beneficios JSONB,
  limite_compras_mensuales INT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planes_membresia_empresa ON planes_membresia(empresa_codigo);

CREATE TABLE IF NOT EXISTS socios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  usuario_id UUID,
  numero_socio VARCHAR(50),
  nombre VARCHAR(200) NOT NULL,
  email VARCHAR(100),
  telefono VARCHAR(30),
  direccion TEXT,
  rtn VARCHAR(20),
  fecha_nacimiento DATE,
  genero VARCHAR(20),
  plan_id UUID,
  estado VARCHAR(30) DEFAULT 'activo',
  fecha_inicio TIMESTAMPTZ DEFAULT now(),
  fecha_vencimiento TIMESTAMPTZ,
  renovacion_automatica BOOLEAN DEFAULT true,
  puntos_acumulados INT DEFAULT 0,
  puntos_canjeados INT DEFAULT 0,
  total_compras NUMERIC(12,2) DEFAULT 0,
  total_compras_count INT DEFAULT 0,
  ultima_compra TIMESTAMPTZ,
  notas TEXT,
  foto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_socios_empresa ON socios(empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_socios_numero ON socios(empresa_codigo, numero_socio);
CREATE INDEX IF NOT EXISTS idx_socios_estado ON socios(empresa_codigo, estado);

CREATE TABLE IF NOT EXISTS puntos_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  socio_id UUID NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  puntos INT NOT NULL,
  referencia_tipo VARCHAR(50),
  referencia_id UUID,
  descripcion TEXT,
  saldo_anterior INT,
  saldo_nuevo INT,
  usuario_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_puntos_historial_empresa ON puntos_historial(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puntos_historial_socio ON puntos_historial(socio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS renovaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  socio_id UUID NOT NULL,
  plan_anterior_id UUID,
  plan_nuevo_id UUID,
  tipo VARCHAR(30) NOT NULL,
  monto NUMERIC(12,2) DEFAULT 0,
  metodo_pago VARCHAR(50),
  referencia VARCHAR(200),
  fecha_anterior TIMESTAMPTZ,
  fecha_nueva TIMESTAMPTZ,
  usuario_id UUID,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_renovaciones_empresa ON renovaciones(empresa_codigo, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- PARTE 12: RLS (Row Level Security)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuraciones_globales ENABLE ROW LEVEL SECURITY;
ALTER TABLE planes_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE automatizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_product_scan ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE bodegas ENABLE ROW LEVEL SECURITY;
ALTER TABLE kardex ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE listas_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos_precio ENABLE ROW LEVEL SECURITY;
ALTER TABLE promociones ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_fiadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas_fiadas_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE abonos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas ENABLE ROW LEVEL SECURITY;
ALTER TABLE transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE transferencias_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE planes_membresia ENABLE ROW LEVEL SECURITY;
ALTER TABLE socios ENABLE ROW LEVEL SECURITY;
ALTER TABLE puntos_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE renovaciones ENABLE ROW LEVEL SECURITY;

-- Policies: backend service role (allows all)
DO $$ BEGIN DROP POLICY IF EXISTS p_tenants ON tenants; END $$;
CREATE POLICY p_tenants ON tenants FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_usuarios ON usuarios; END $$;
CREATE POLICY p_usuarios ON usuarios FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_notif ON notificaciones; END $$;
CREATE POLICY p_notif ON notificaciones FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_audit_logs ON auditoria_logs; END $$;
CREATE POLICY p_audit_logs ON auditoria_logs FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_config ON configuraciones_globales; END $$;
CREATE POLICY p_config ON configuraciones_globales FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_planes ON planes_pago; END $$;
CREATE POLICY p_planes ON planes_pago FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_support ON support_tickets; END $$;
CREATE POLICY p_support ON support_tickets FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_empresas ON empresas; END $$;
CREATE POLICY p_empresas ON empresas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_usuario_modulos ON usuario_modulos; END $$;
CREATE POLICY p_usuario_modulos ON usuario_modulos FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_tenant_features ON tenant_features; END $$;
CREATE POLICY p_tenant_features ON tenant_features FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_api_keys ON api_keys; END $$;
CREATE POLICY p_api_keys ON api_keys FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_vehiculos ON vehiculos; END $$;
CREATE POLICY p_vehiculos ON vehiculos FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_auditoria ON auditoria; END $$;
CREATE POLICY p_auditoria ON auditoria FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_auto ON automatizaciones; END $$;
CREATE POLICY p_auto ON automatizaciones FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_auto_runs ON automation_runs; END $$;
CREATE POLICY p_auto_runs ON automation_runs FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_auto_rules ON automation_rules; END $$;
CREATE POLICY p_auto_rules ON automation_rules FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_facturas ON facturas; END $$;
CREATE POLICY p_facturas ON facturas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_trans ON transacciones; END $$;
CREATE POLICY p_trans ON transacciones FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_prod ON productos; END $$;
CREATE POLICY p_prod ON productos FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_ai_usage ON ai_usage_log; END $$;
CREATE POLICY p_ai_usage ON ai_usage_log FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_ai_scan ON ai_product_scan; END $$;
CREATE POLICY p_ai_scan ON ai_product_scan FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_cli ON clientes; END $$;
CREATE POLICY p_cli ON clientes FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_suc ON sucursales; END $$;
CREATE POLICY p_suc ON sucursales FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_bod ON bodegas; END $$;
CREATE POLICY p_bod ON bodegas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_kardex ON kardex; END $$;
CREATE POLICY p_kardex ON kardex FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_prov ON proveedores; END $$;
CREATE POLICY p_prov ON proveedores FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_compras ON compras; END $$;
CREATE POLICY p_compras ON compras FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_compras_det ON compras_detalle; END $$;
CREATE POLICY p_compras_det ON compras_detalle FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_lista_prec ON listas_precios; END $$;
CREATE POLICY p_lista_prec ON listas_precios FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_prod_prec ON productos_precio; END $$;
CREATE POLICY p_prod_prec ON productos_precio FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_promo ON promociones; END $$;
CREATE POLICY p_promo ON promociones FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_fiadas ON ventas_fiadas; END $$;
CREATE POLICY p_fiadas ON ventas_fiadas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_fiadas_det ON ventas_fiadas_detalle; END $$;
CREATE POLICY p_fiadas_det ON ventas_fiadas_detalle FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_abonos ON abonos; END $$;
CREATE POLICY p_abonos ON abonos FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_rutas ON rutas; END $$;
CREATE POLICY p_rutas ON rutas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_visitas ON visitas; END $$;
CREATE POLICY p_visitas ON visitas FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_transf ON transferencias; END $$;
CREATE POLICY p_transf ON transferencias FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_transf_det ON transferencias_detalle; END $$;
CREATE POLICY p_transf_det ON transferencias_detalle FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_planes_memb ON planes_membresia; END $$;
CREATE POLICY p_planes_memb ON planes_membresia FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_socios ON socios; END $$;
CREATE POLICY p_socios ON socios FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_puntos ON puntos_historial; END $$;
CREATE POLICY p_puntos ON puntos_historial FOR ALL USING (true);
DO $$ BEGIN DROP POLICY IF EXISTS p_renov ON renovaciones; END $$;
CREATE POLICY p_renov ON renovaciones FOR ALL USING (true);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('portal-pilot-assets', 'portal-pilot-assets', true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- RESUMEN: 40+ tablas, todas las columnas, RLS, triggers, seeds
-- ═══════════════════════════════════════════════════════════════════════════
