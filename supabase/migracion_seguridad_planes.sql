-- Portal Pilot: planes, roles y 2FA persistente.
-- Ejecutar una vez en Supabase SQL Editor antes de desplegar el backend.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS limite_usuarios INTEGER;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS limite_empresas INTEGER;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS funciones_plan JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS two_factor_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_empresa_codigo_activo
  ON public.usuarios(empresa_codigo, activo);

-- Normaliza los tres planes comercializados. Los límites se vuelven a calcular
-- en el backend, por lo que estos valores sólo sirven como persistencia y auditoría.
-- NOTA: El UPDATE recalcula SIEMPRE para corregir tenants con valores antiguos (25/250).
UPDATE public.tenants
SET limite_usuarios = CASE lower(COALESCE(plan, 'starter'))
  WHEN 'starter' THEN 5
  WHEN 'business' THEN 15
  WHEN 'enterprise' THEN 999999
  ELSE 5
END,
limite_empresas = CASE lower(COALESCE(plan, 'starter'))
  WHEN 'starter' THEN 1
  WHEN 'business' THEN 3
  WHEN 'enterprise' THEN 999999
  ELSE 1
END;
