-- Historial de pagos de Portal Pilot en HNL.
CREATE TABLE IF NOT EXISTS public.billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT,
  email TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'HNL',
  payment_method TEXT NOT NULL DEFAULT 'transferencia',
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_created
  ON public.billing_payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_payments_empresa
  ON public.billing_payments(empresa_codigo, created_at DESC);

ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;

