-- Portal Pilot: soporte para detalle de facturas imprimibles.
ALTER TABLE public.facturas
  ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '[]'::jsonb;