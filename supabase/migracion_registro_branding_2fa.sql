-- ============================================================================
-- Migración: branding del registro (paso 4) + modelo de negocio del paso 2
-- Idempotente: se puede ejecutar varias veces sin efectos secundarios.
-- Aplícala en Supabase (SQL Editor) ANTES de desplegar el backend.
-- ============================================================================

-- 1) Marca de agua de la empresa (paso 4)
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- 2) Modelo de negocio y tamaño (paso 2 + onboarding de la app).
--    `area` es el campo que consume getModulesForAreaAndPlan() en el backend
--    para decidir qué módulos se activan. Debe aceptar los valores:
--      'Pulpería / Mercadito' | 'Tienda / Supermercado' | 'Club / Membresía'
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS tamano TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS sector TEXT;

-- 3) Banner del perfil del owner (paso 4)
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS banner_perfil_url TEXT;

-- 4) Verificación: confirma que las columnas quedaron disponibles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'banner_url'
  ) THEN
    RAISE EXCEPTION 'Fallo: public.tenants.banner_url no existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'area'
  ) THEN
    RAISE EXCEPTION 'Fallo: public.tenants.area no existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'banner_perfil_url'
  ) THEN
    RAISE EXCEPTION 'Fallo: public.usuarios.banner_perfil_url no existe';
  END IF;
END $$;

SELECT 'migracion_registro_branding_2fa aplicada' AS resultado;
