-- ============================================================================
-- Portal Pilot — Cierre de deriva de esquema de sincronización
-- ============================================================================
-- La app escribe 18 tablas por POST /api/sync, pero 8 no existían en la base
-- de producción: los datos se perdían en silencio (POS, arqueo de caja,
-- crédito de cliente, abonos de fiado, items de cotización/orden/compra y
-- configuración fiscal).
--
-- Las 7 primeras copian el DDL ya versionado en PP APP/supabase/ y solo se
-- agrega el cierre de RLS con el patrón de la casa (<tabla>_service_role_only).
-- `pos_ventas` es diseño nuevo: sus columnas salen del payload real que envía
-- POSHome/pos_service.dart y del modelo Drift app_database.g.dart.
--
-- Idempotente: se puede reaplicar sin efectos.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) POS: arqueo de caja, crédito de cliente, abonos de fiado
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_arqueo_caja (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  usuario_id text NOT NULL,
  terminal_id text,
  fecha_apertura timestamptz NOT NULL,
  fecha_cierre timestamptz,
  fondo_inicial numeric(12,2) NOT NULL DEFAULT 0,
  total_ventas_efectivo numeric(12,2) NOT NULL DEFAULT 0,
  total_ventas_tarjeta numeric(12,2) NOT NULL DEFAULT 0,
  total_ventas_transferencia numeric(12,2) NOT NULL DEFAULT 0,
  total_ventas_mixto numeric(12,2) NOT NULL DEFAULT 0,
  total_gastos numeric(12,2) NOT NULL DEFAULT 0,
  total_entradas numeric(12,2) NOT NULL DEFAULT 0,
  total_salidas numeric(12,2) NOT NULL DEFAULT 0,
  sistema_total numeric(12,2) NOT NULL DEFAULT 0,
  conteo_fisico numeric(12,2),
  diferencia numeric(12,2),
  observaciones text,
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  detalle_denominaciones jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_arqueo_empresa_fecha
  ON public.pos_arqueo_caja (empresa_codigo, fecha_apertura DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_arqueo_abierto_terminal
  ON public.pos_arqueo_caja (empresa_codigo, terminal_id)
  WHERE estado = 'abierto';

CREATE TABLE IF NOT EXISTS public.pos_cliente_credito (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  cliente_id text NOT NULL,
  cliente_nombre text,
  limite_credito numeric(12,2) NOT NULL DEFAULT 0,
  saldo_actual numeric(12,2) NOT NULL DEFAULT 0,
  dias_vencimiento integer NOT NULL DEFAULT 30,
  estado text NOT NULL DEFAULT 'activo',
  fecha_ultimo_pago timestamptz,
  monto_ultimo_pago numeric(12,2) NOT NULL DEFAULT 0,
  fecha_ultima_venta timestamptz,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_credito_empresa_saldo
  ON public.pos_cliente_credito (empresa_codigo, saldo_actual DESC);

CREATE TABLE IF NOT EXISTS public.fiado_abonos (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  cliente_id text NOT NULL,
  cliente_nombre text,
  venta_id text,
  factura_id text,
  monto numeric(12,2) NOT NULL CHECK (monto > 0),
  metodo_pago text NOT NULL,
  referencia text,
  notas text,
  usuario_id text,
  fecha timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiado_abonos_empresa_fecha
  ON public.fiado_abonos (empresa_codigo, fecha DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Comercial/retail: líneas de cotización, orden de compra y compra
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cotizacion_items (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  cotizacion_id text NOT NULL,
  producto_id text,
  producto_codigo text,
  producto_nombre text NOT NULL,
  descripcion text,
  cantidad integer NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  descuento numeric(12,2) NOT NULL DEFAULT 0,
  isv_rate numeric(4,2) NOT NULL DEFAULT 15,
  subtotal numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cotizacion_items_parent
  ON public.cotizacion_items (empresa_codigo, cotizacion_id);

CREATE TABLE IF NOT EXISTS public.orden_compra_items (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  orden_compra_id text NOT NULL,
  producto_id text,
  producto_codigo text,
  producto_nombre text NOT NULL,
  descripcion text,
  cantidad integer NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  descuento numeric(12,2) NOT NULL DEFAULT 0,
  isv_rate numeric(4,2) NOT NULL DEFAULT 15,
  subtotal numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orden_compra_items_parent
  ON public.orden_compra_items (empresa_codigo, orden_compra_id);

CREATE TABLE IF NOT EXISTS public.compra_items (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  compra_id text NOT NULL,
  producto_id text,
  producto_codigo text,
  producto_nombre text NOT NULL,
  descripcion text,
  cantidad integer NOT NULL,
  precio_unitario numeric(12,2) NOT NULL,
  descuento numeric(12,2) NOT NULL DEFAULT 0,
  isv_rate numeric(4,2) NOT NULL DEFAULT 15,
  subtotal numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compra_items_parent
  ON public.compra_items (empresa_codigo, compra_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Configuración fiscal compartida entre dispositivos
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.configuracion_fiscal (
  id text PRIMARY KEY,
  empresa_codigo text NOT NULL UNIQUE,
  empresa_id uuid,
  configuracion jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 4) pos_ventas — diseño nuevo
-- ────────────────────────────────────────────────────────────────────────────
-- La app NO envía `id`: el upsert debe resolver por la clave de negocio
-- (empresa_codigo + correlativo) para que un reintento offline no duplique
-- la venta. Por eso el UNIQUE y el conflict target del backend.
-- Sin CHECK en `estado`: los valores los fija la app y un CHECK demasiado
-- estricto convertiría un reintento de sync en un 500.
CREATE TABLE IF NOT EXISTS public.pos_ventas (
  id text PRIMARY KEY DEFAULT ('pv_' || replace(gen_random_uuid()::text, '-', '')),
  empresa_codigo text NOT NULL,
  empresa_id uuid,
  usuario_id text,
  terminal_id text,
  correlativo text NOT NULL,
  cliente_id text,
  cliente_nombre text,
  cliente_rtn text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  descuento numeric(12,2) NOT NULL DEFAULT 0,
  isv_15 numeric(12,2) NOT NULL DEFAULT 0,
  isv_18 numeric(12,2) NOT NULL DEFAULT 0,
  tasa_isv_estandar numeric(5,2) NOT NULL DEFAULT 0.15,
  total numeric(12,2) NOT NULL DEFAULT 0,
  metodo_pago text NOT NULL DEFAULT 'efectivo',
  estado text NOT NULL DEFAULT 'completada',
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, correlativo)
);

CREATE INDEX IF NOT EXISTS idx_pos_ventas_empresa_fecha
  ON public.pos_ventas (empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_ventas_empresa_cliente
  ON public.pos_ventas (empresa_codigo, cliente_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5) updated_at automático (patrón de la casa)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_arqueo_caja','pos_cliente_credito','pos_ventas','configuracion_fiscal'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pp_touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) RLS: solo el service role del backend escribe. El acceso de la app
--    pasa por /api/sync con autenticación y tenant derivado de la sesión,
--    nunca por el cliente de Supabase.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_arqueo_caja','pos_cliente_credito','fiado_abonos',
    'cotizacion_items','orden_compra_items','compra_items',
    'configuracion_fiscal','pos_ventas'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only', t
    );
  END LOOP;
END $$;