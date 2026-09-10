-- Portal Pilot: recibos y notas de credito relacionados con facturas.
CREATE TABLE IF NOT EXISTS public.recibos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  factura_id UUID,
  correlativo VARCHAR(50) NOT NULL,
  cliente_nombre VARCHAR(200) NOT NULL,
  cliente_rtn VARCHAR(20),
  cliente_email VARCHAR(100),
  concepto TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_anterior NUMERIC(12,2) NOT NULL DEFAULT 0,
  saldo_pendiente NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo_pago VARCHAR(50),
  referencia VARCHAR(100),
  estado VARCHAR(30) NOT NULL DEFAULT 'pagado',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recibos_empresa ON public.recibos(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recibos_factura ON public.recibos(factura_id);

CREATE TABLE IF NOT EXISTS public.notas_credito (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  empresa_codigo TEXT NOT NULL,
  factura_id UUID NOT NULL,
  correlativo VARCHAR(50) NOT NULL,
  motivo TEXT NOT NULL,
  tipo_ajuste VARCHAR(50) NOT NULL DEFAULT 'correccion',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  isv NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(30) NOT NULL DEFAULT 'emitida',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_credito_empresa ON public.notas_credito(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notas_credito_factura ON public.notas_credito(factura_id);
