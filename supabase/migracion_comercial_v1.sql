-- ═══════════════════════════════════════════════════════════════════
-- PORTAL PILOT — MIGRACIÓN COMERCIAL V1
-- Fase de Expansión Funcional y Especialización Comercial
-- ═══════════════════════════════════════════════════════════════════
-- Esta migración agrega tablas para:
--   - Canal Comercial core (sucursales, bodegas, kardex, proveedores, compras, precios, promociones)
--   - Canal Tradicional (fiado, rutas, cobros, pedidos)
--   - Canal Moderno (transferencias multi-sucursal)
--   - Membresías (planes, socios, puntos, renovaciones)
--   - Feature flags por tenant
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. FEATURE FLAGS POR TENANT ────────────────────────────────
-- Permite habilitar/deshabilitar módulos por tenant sin cambiar el plan
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
COMMENT ON TABLE tenant_features IS 'Feature flags específicas por tenant. Override del plan global.';

-- ── 2. SUCURSALES ─────────────────────────────────────────────
-- Multi-branch support para Canal Moderno, usable por cualquier plan
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
  tipo VARCHAR(30) DEFAULT 'tienda', -- tienda, bodega, centro_distribucion
  activa BOOLEAN DEFAULT true,
  es_principal BOOLEAN DEFAULT false,
  latitud NUMERIC(10,7),
  longitud NUMERIC(10,7),
  horario JSONB, -- {"lunes": {"abre": "08:00", "cierra": "17:00"}, ...}
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_codigo, codigo)
);
CREATE INDEX IF NOT EXISTS idx_sucursales_empresa ON sucursales(empresa_codigo);
COMMENT ON TABLE sucursales IS 'Sucursales/locales del negocio. Soporte multi-sucursal.';

-- ── 3. BODEGAS ────────────────────────────────────────────────
-- Almacenes dentro de sucursales
CREATE TABLE IF NOT EXISTS bodegas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  sucursal_id UUID,
  codigo VARCHAR(50) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  tipo VARCHAR(30) DEFAULT 'general', -- general, devoluciones, materia_prima, expedicion
  direccion TEXT,
  activa BOOLEAN DEFAULT true,
  es_principal BOOLEAN DEFAULT false,
  capacidad_maxima INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(empresa_codigo, codigo)
);
CREATE INDEX IF NOT EXISTS idx_bodegas_empresa ON bodegas(empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_bodegas_sucursal ON bodegas(sucursal_id);
COMMENT ON TABLE bodegas IS 'Bodegas/almacenes. Pertenecen a una sucursal.';

-- ── 4. KARDEX (MOVIMIENTOS DE INVENTARIO) ─────────────────────
-- Historial completo de entradas/salidas de cada producto
CREATE TABLE IF NOT EXISTS kardex (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  producto_id UUID NOT NULL,
  bodega_id UUID,
  sucursal_id UUID,
  tipo_movimiento VARCHAR(30) NOT NULL, -- entrada, salida, transferencia, ajuste, devolucion, compra, venta
  cantidad INT NOT NULL,
  cantidad_anterior INT NOT NULL,
  cantidad_nueva INT NOT NULL,
  costo_unitario NUMERIC(12,2),
  referencia_tipo VARCHAR(50), -- compra, venta, transferencia, ajuste
  referencia_id UUID, -- ID de la transacción referenciada
  notas TEXT,
  usuario_id UUID,
  usuario_nombre VARCHAR(150),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kardex_empresa ON kardex(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_producto ON kardex(producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_bodega ON kardex(bodega_id);
CREATE INDEX IF NOT EXISTS idx_kardex_tipo ON kardex(empresa_codigo, tipo_movimiento);
COMMENT ON TABLE kardex IS 'Kardex: historial completo de movimientos de inventario.';

-- ── 5. PROVEEDORES ────────────────────────────────────────────
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
  nivel VARCHAR(20) DEFAULT 'normal', -- preferencial, normal, temporal
  dias_credito INT DEFAULT 0,
  limite_credito NUMERIC(12,2) DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) DEFAULT 0,
  notas TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_empresa ON proveedores(empresa_codigo);
COMMENT ON TABLE proveedores IS 'Proveedores del negocio.';

-- ── 6. COMPRAS ────────────────────────────────────────────────
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
  estado VARCHAR(30) DEFAULT 'pendiente', -- pendiente, recibida, cancelada, parcial
  metodo_pago VARCHAR(50),
  notas TEXT,
  usuario_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compras_empresa ON compras(empresa_codigo, fecha_orden DESC);
CREATE INDEX IF NOT EXISTS idx_compras_estado ON compras(empresa_codigo, estado);
COMMENT ON TABLE compras IS 'Órdenes de compra a proveedores.';

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
COMMENT ON TABLE compras_detalle IS 'Detalle de items en cada orden de compra.';

-- ── 7. LISTA DE PRECIOS ───────────────────────────────────────
-- Soporta múltiples listas (general, mayoreo, menudeo, VIP)
CREATE TABLE IF NOT EXISTS listas_precios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(30) DEFAULT 'general', -- general, mayoreo, menudeo, vip, membresia
  es_default BOOLEAN DEFAULT false,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listas_precios_empresa ON listas_precios(empresa_codigo);
COMMENT ON TABLE listas_precios IS 'Listas de precios múltiples por producto.';

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
CREATE INDEX IF NOT EXISTS idx_productos_precio_lista ON productos_precio(lista_precio_id);
COMMENT ON TABLE productos_precio IS 'Precios por producto por lista.';

-- ── 8. PROMOCIONES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promociones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  tipo VARCHAR(30) NOT NULL, -- porcentaje, monto_fijo, 2x1, 3x2,组合
  valor NUMERIC(12,2) NOT NULL, -- porcentaje o monto
  compra_minima INT DEFAULT 1,
  descuento_maximo NUMERIC(12,2),
  aplica_a VARCHAR(30) DEFAULT 'todos', -- todos, categoria, producto, marca
  aplica_valor VARCHAR(200), -- valor específico según aplica_a
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  activa BOOLEAN DEFAULT true,
  uso_maximo INT, -- null = ilimitado
  uso_actual INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promociones_empresa ON promociones(empresa_codigo, activa);
CREATE INDEX IF NOT EXISTS idx_promociones_fechas ON promociones(fecha_inicio, fecha_fin);
COMMENT ON TABLE promociones IS 'Promociones y descuentos temporales.';

-- ═══════════════════════════════════════════════════════════════════
-- CANAL TRADICIONAL
-- ═══════════════════════════════════════════════════════════════════

-- ── 9. VENTAS FIADAS / CUENTAS POR COBRAR ─────────────────────
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
  estado VARCHAR(30) DEFAULT 'pendiente', -- pendiente, parcial, pagada, vencida, cancelada
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
CREATE INDEX IF NOT EXISTS idx_ventas_fiadas_cliente ON ventas_fiadas(cliente_nombre);
CREATE INDEX IF NOT EXISTS idx_ventas_fiadas_vendedor ON ventas_fiadas(vendedor_id);
COMMENT ON TABLE ventas_fiadas IS 'Ventas a crédito (fiado). Canal Tradicional.';

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
COMMENT ON TABLE ventas_fiadas_detalle IS 'Detalle de items en ventas fiadas.';

-- ── 10. ABONOS / PAGOS DE CUENTAS POR COBRAR ──────────────────
CREATE TABLE IF NOT EXISTS abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  venta_fiada_id UUID NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago VARCHAR(50) DEFAULT 'efectivo', -- efectivo, transferencia, tigo_money, otro
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
COMMENT ON TABLE abonos IS 'Abonos/pagos parciales de ventas fiadas.';

-- ── 11. RUTAS DE VENTA ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rutas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  zona VARCHAR(100),
  vendedor_id UUID,
  vendedor_nombre VARCHAR(150),
  dias_recorrido TEXT[], -- {'lunes','miercoles','viernes'}
  orden_clientes JSONB, -- [{cliente_id, orden, lat, lng}]
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rutas_empresa ON rutas(empresa_codigo);
COMMENT ON TABLE rutas IS 'Rutas de venta para vendedores de campo.';

-- ── 12. VISITAS ───────────────────────────────────────────────
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
  estado VARCHAR(30) DEFAULT 'programada', -- programada, en_camino, completada, omitida, sin_venta
  resultado VARCHAR(30), -- compra, pedido_pendiente, sin_interes, cliente_ausente
  notas TEXT,
  venta_generada_id UUID, -- referencia a ventas_fiadas o facturas
  fecha_programada DATE,
  hora_inicio TIMESTAMPTZ,
  hora_fin TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visitas_empresa ON visitas(empresa_codigo, fecha_programada DESC);
CREATE INDEX IF NOT EXISTS idx_visitas_ruta ON visitas(ruta_id, fecha_programada);
CREATE INDEX IF NOT EXISTS idx_visitas_vendedor ON visitas(vendedor_id);
COMMENT ON TABLE visitas IS 'Visitas de vendedores de ruta a clientes.';

-- ═══════════════════════════════════════════════════════════════════
-- CANAL MODERNO
-- ═══════════════════════════════════════════════════════════════════

-- ── 13. TRANSFERENCIAS ENTRE SUCURSALES ───────────────────────
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
  estado VARCHAR(30) DEFAULT 'pendiente', -- pendiente, en_transito, recibida, cancelada
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
CREATE INDEX IF NOT EXISTS idx_transferencias_origen ON transferencias(sucursal_origen_id);
CREATE INDEX IF NOT EXISTS idx_transferencias_destino ON transferencias(sucursal_destino_id);
COMMENT ON TABLE transferencias IS 'Transferencias de inventario entre sucursales.';

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
COMMENT ON TABLE transferencias_detalle IS 'Detalle de items en transferencias.';

-- ═══════════════════════════════════════════════════════════════════
-- MEMBRESÍAS
-- ═══════════════════════════════════════════════════════════════════

-- ── 14. PLANES DE MEMBRESÍA ───────────────────────────────────
CREATE TABLE IF NOT EXISTS planes_membresia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  precio_mensual NUMERIC(12,2),
  precio_anual NUMERIC(12,2),
  nivel VARCHAR(30) DEFAULT 'bronce', -- bronce, plata, oro, platinum
  descuento_porcentaje NUMERIC(5,2) DEFAULT 0,
  puntos_por_lempira NUMERIC(5,2) DEFAULT 1,
  beneficios JSONB, -- ["descuento_10%", "envio_gratis", "acceso_vip"]
  limite_compras_mensuales INT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_planes_membresia_empresa ON planes_membresia(empresa_codigo);
COMMENT ON TABLE planes_membresia IS 'Planes de membresía/club de compras.';

-- ── 15. SOCIOS / MIEMBROS ─────────────────────────────────────
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
  estado VARCHAR(30) DEFAULT 'activo', -- activo, suspendido, vencido, cancelado
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
CREATE INDEX IF NOT EXISTS idx_socios_plan ON socios(plan_id);
COMMENT ON TABLE socios IS 'Socios/miembros del club de compras.';

-- ── 16. HISTORIAL DE PUNTOS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS puntos_historial (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  socio_id UUID NOT NULL,
  tipo VARCHAR(30) NOT NULL, -- acumulacion, canje, bonificacion, expiracion, ajuste
  puntos INT NOT NULL,
  referencia_tipo VARCHAR(50), -- compra, promocion, manual
  referencia_id UUID,
  descripcion TEXT,
  saldo_anterior INT,
  saldo_nuevo INT,
  usuario_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_puntos_historial_empresa ON puntos_historial(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puntos_historial_socio ON puntos_historial(socio_id, created_at DESC);
COMMENT ON TABLE puntos_historial IS 'Historial de movimientos de puntos de socios.';

-- ── 17. RENOVACIONES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS renovaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  socio_id UUID NOT NULL,
  plan_anterior_id UUID,
  plan_nuevo_id UUID,
  tipo VARCHAR(30) NOT NULL, -- renovacion, upgrade, downgrade, activacion
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
CREATE INDEX IF NOT EXISTS idx_renovaciones_socio ON renovaciones(socio_id);
COMMENT ON TABLE renovaciones IS 'Historial de renovaciones y cambios de plan de membresía.';

-- ═══════════════════════════════════════════════════════════════════
-- EXTENSIONES A TABLAS EXISTENTES
-- ═══════════════════════════════════════════════════════════════════

-- Agregar sucursal_id y bodega_id a productos (para inventario multi-sucursal)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS sucursal_id UUID;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS bodega_id UUID;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_costo_historico NUMERIC(12,2);

-- Agregar sucursal_id a facturas (para ventas por sucursal)
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sucursal_id UUID;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS bodega_id UUID;

-- Agregar sucursal_id a transacciones
ALTER TABLE transacciones ADD COLUMN IF NOT EXISTS sucursal_id UUID;

-- ═══════════════════════════════════════════════════════════════════
-- RLS (Row Level Security)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
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

-- RLS Policies (backend service role — same pattern as existing migrations)
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_tenant_features';
  IF NOT FOUND THEN CREATE POLICY service_role_tenant_features ON tenant_features FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_sucursales';
  IF NOT FOUND THEN CREATE POLICY service_role_sucursales ON sucursales FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_bodegas';
  IF NOT FOUND THEN CREATE POLICY service_role_bodegas ON bodegas FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_kardex';
  IF NOT FOUND THEN CREATE POLICY service_role_kardex ON kardex FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_proveedores';
  IF NOT FOUND THEN CREATE POLICY service_role_proveedores ON proveedores FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_compras';
  IF NOT FOUND THEN CREATE POLICY service_role_compras ON compras FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_compras_detalle';
  IF NOT FOUND THEN CREATE POLICY service_role_compras_detalle ON compras_detalle FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_listas_precios';
  IF NOT FOUND THEN CREATE POLICY service_role_listas_precios ON listas_precios FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_productos_precio';
  IF NOT FOUND THEN CREATE POLICY service_role_productos_precio ON productos_precio FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_promociones';
  IF NOT FOUND THEN CREATE POLICY service_role_promociones ON promociones FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_ventas_fiadas';
  IF NOT FOUND THEN CREATE POLICY service_role_ventas_fiadas ON ventas_fiadas FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_ventas_fiadas_detalle';
  IF NOT FOUND THEN CREATE POLICY service_role_ventas_fiadas_detalle ON ventas_fiadas_detalle FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_abonos';
  IF NOT FOUND THEN CREATE POLICY service_role_abonos ON abonos FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_rutas';
  IF NOT FOUND THEN CREATE POLICY service_role_rutas ON rutas FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_visitas';
  IF NOT FOUND THEN CREATE POLICY service_role_visitas ON visitas FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_transferencias';
  IF NOT FOUND THEN CREATE POLICY service_role_transferencias ON transferencias FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_transferencias_detalle';
  IF NOT FOUND THEN CREATE POLICY service_role_transferencias_detalle ON transferencias_detalle FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_planes_membresia';
  IF NOT FOUND THEN CREATE POLICY service_role_planes_membresia ON planes_membresia FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_socios';
  IF NOT FOUND THEN CREATE POLICY service_role_socios ON socios FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_puntos_historial';
  IF NOT FOUND THEN CREATE POLICY service_role_puntos_historial ON puntos_historial FOR ALL USING (true); END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_policies WHERE policyname = 'service_role_renovaciones';
  IF NOT FOUND THEN CREATE POLICY service_role_renovaciones ON renovaciones FOR ALL USING (true); END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS (auto-update updated_at)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_tenant_features_updated') THEN
    CREATE TRIGGER tr_tenant_features_updated BEFORE UPDATE ON tenant_features FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_sucursales_updated') THEN
    CREATE TRIGGER tr_sucursales_updated BEFORE UPDATE ON sucursales FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_bodegas_updated') THEN
    CREATE TRIGGER tr_bodegas_updated BEFORE UPDATE ON bodegas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_proveedores_updated') THEN
    CREATE TRIGGER tr_proveedores_updated BEFORE UPDATE ON proveedores FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_compras_updated') THEN
    CREATE TRIGGER tr_compras_updated BEFORE UPDATE ON compras FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_listas_precios_updated') THEN
    CREATE TRIGGER tr_listas_precios_updated BEFORE UPDATE ON listas_precios FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_promociones_updated') THEN
    CREATE TRIGGER tr_promociones_updated BEFORE UPDATE ON promociones FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_ventas_fiadas_updated') THEN
    CREATE TRIGGER tr_ventas_fiadas_updated BEFORE UPDATE ON ventas_fiadas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_rutas_updated') THEN
    CREATE TRIGGER tr_rutas_updated BEFORE UPDATE ON rutas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_transferencias_updated') THEN
    CREATE TRIGGER tr_transferencias_updated BEFORE UPDATE ON transferencias FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_planes_membresia_updated') THEN
    CREATE TRIGGER tr_planes_membresia_updated BEFORE UPDATE ON planes_membresia FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_socios_updated') THEN
    CREATE TRIGGER tr_socios_updated BEFORE UPDATE ON socios FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- ÍNDICES ADICIONALES PARA PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_facturas_sucursal ON facturas(sucursal_id) WHERE sucursal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transacciones_sucursal ON transacciones(sucursal_id) WHERE sucursal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_sucursal ON productos(sucursal_id) WHERE sucursal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_bodega ON productos(bodega_id) WHERE bodega_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- RESUMEN
-- ═══════════════════════════════════════════════════════════════════
-- Nuevas tablas: 21
--   tenant_features, sucursales, bodegas, kardex, proveedores,
--   compras, compras_detalle, listas_precios, productos_precio,
--   promociones, ventas_fiadas, ventas_fiadas_detalle, abonos,
--   rutas, visitas, transferencias, transferencias_detalle,
--   planes_membresia, socios, puntos_historial, renovaciones
--
-- Extensiones a tablas existentes: 6 columnas
--   productos: sucursal_id, bodega_id, precio_costo_historico
--   facturas: sucursal_id, bodega_id
--   transacciones: sucursal_id
--
-- RLS: 21 tablas con policies
-- Triggers: 13 auto-update triggers
-- Índices: 35+ índices para performance
-- ═══════════════════════════════════════════════════════════════════
