-- PORTAL PILOT — Clave de negocio para el sync idempotente de transferencias.
-- La app no usa UUID local; el backend identifica el encabezado por
-- (empresa_codigo, numero) para no duplicar en reintentos offline.
-- Aplicada en producción como migración `transferencias_numero_unico`.

CREATE UNIQUE INDEX IF NOT EXISTS ux_transferencias_numero
  ON public.transferencias (empresa_codigo, numero)
  WHERE numero IS NOT NULL;
