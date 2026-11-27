-- ============================================================================
-- HARDENING COMPLETO DE SUPABASE — Portal Pilot
-- 1) Políticas RLS service_role_only en las 4 tablas de campañas
-- 2) Revocar privilegios residuales de PUBLIC/anon/authenticated en tablas,
--    vistas, secuencias y funciones de public (+ DEFAULT PRIVILEGES)
-- 3) Activar security_invoker = true en public.v_fuentes_canonicas
-- 4) Cerrar INSERT anónimo/público en storage.objects y limitar tamaño/MIME
--    en los buckets uploads, productos y portal-pilot-assets
-- 5) Alinear descripción de plan personalizado ("catálogo de 23")
-- ============================================================================

-- 1) Tablas de campañas: RLS activo + política explícita service_role_only
DO $$
DECLARE
  t text;
  r record;
  campaign_tables text[] := ARRAY[
    'campanas',
    'campana_destinatarios',
    'campana_eventos',
    'email_suppression'
  ];
BEGIN
  FOREACH t IN ARRAY campaign_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only',
      t
    );
  END LOOP;
END $$;

-- 2) Defensa en profundidad: revocar privilegios en esquema public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Evitar que futuras tablas/secuencias/funciones hereden grants a anon/authenticated
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Re-otorgar lectura pública exclusivamente en el catálogo de precios/módulos
GRANT SELECT ON public.planes, public.plan_features, public.plan_limits, public.plan_modulos, public.modulos_cotizador
  TO anon, authenticated;

-- Reafirmar privilegios completos para el backend (service_role)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 3) Vista v_fuentes_canonicas con security_invoker = true
DO $$
BEGIN
  IF to_regclass('public.v_fuentes_canonicas') IS NOT NULL THEN
    ALTER VIEW public.v_fuentes_canonicas SET (security_invoker = true);
  END IF;
END $$;

-- 4) Hardening de Storage: solo lectura pública (SELECT); subidas vía backend (service_role)
DROP POLICY IF EXISTS "politica upload 1va6avm_0" ON storage.objects;
DROP POLICY IF EXISTS "public_productos 1hmvp5f_1" ON storage.objects;
DROP POLICY IF EXISTS "public_storage_insert" ON storage.objects;

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
WHERE id IN ('uploads', 'productos', 'portal-pilot-assets');

-- 5) Alinear copy de catálogo en public.planes (21 -> 23 módulos)
UPDATE public.planes
SET descripcion = REPLACE(descripcion, 'catálogo de 21', 'catálogo de 23')
WHERE clave = 'personalizado'
  AND descripcion LIKE '%catálogo de 21%';
