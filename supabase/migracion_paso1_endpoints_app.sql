-- ═══════════════════════════════════════════════════════════════════════
-- PASO 1: tablas que la APP (Workspace) necesita y que el servidor web
-- (portal-pilot.vercel.app) aún no tenía. Idempotente: se puede ejecutar
-- varias veces sin causar errores. PEGAR ENTERO en el SQL Editor de Supabase.
-- ═══════════════════════════════════════════════════════════════════════

-- Transacciones (contabilidad / flujo de caja). Ya está definida en las
-- migraciones; IF NOT EXISTS la deja intacta si existe.
CREATE TABLE IF NOT EXISTS public.transacciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_transacciones_empresa ON public.transacciones (empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_transacciones_fecha ON public.transacciones (fecha);

-- Cotizaciones de venta (módulo Comercial de la app)
CREATE TABLE IF NOT EXISTS public.cotizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  correlativo VARCHAR(50),
  cliente_nombre VARCHAR(200),
  cliente_rtn VARCHAR(20),
  items JSONB DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) DEFAULT 0,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'activa',
  notas TEXT,
  sucursal_id UUID,
  creado_por VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_empresa ON public.cotizaciones (empresa_codigo);

-- Órdenes de compra (módulo Compras de la app)
CREATE TABLE IF NOT EXISTS public.ordenes_compra (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  empresa_codigo TEXT NOT NULL,
  usuario_id UUID,
  correlativo VARCHAR(50),
  proveedor_nombre VARCHAR(200),
  proveedor_rtn VARCHAR(20),
  items JSONB DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) DEFAULT 0,
  isv NUMERIC(12,2) DEFAULT 0,
  descuento NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'pendiente',
  notas TEXT,
  bodega_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_empresa ON public.ordenes_compra (empresa_codigo);

-- Notas del tenant (pares clave/datos JSON usados por los widgets de la app)
CREATE TABLE IF NOT EXISTS public.notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  empresa_codigo TEXT NOT NULL,
  clave VARCHAR(200) NOT NULL,
  datos JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_codigo, clave)
);
CREATE INDEX IF NOT EXISTS idx_notas_empresa ON public.notas (empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_notas_clave ON public.notas (clave);