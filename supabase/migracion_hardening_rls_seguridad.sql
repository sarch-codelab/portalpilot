-- ============================================================================
-- HARDENING RLS — Portal Pilot
-- ============================================================================
-- PROBLEMA (auditoría):
--   Las políticas `FOR ALL USING (true)` sin cláusula `TO` aplican al rol
--   PUBLIC, por lo que las claves anon/authenticated de Supabase podían
--   leer y escribir TODAS las tablas (tenants, usuarios, auditoria_logs,
--   configuraciones_globales, etc.) sin pasar por la API.
--
-- SOLUCIÓN:
--   El backend usa la service_role key (que hace bypass de RLS). Por tanto,
--   cada tabla sensible debe tener UNA política accesible SOLO por
--   service_role; cualquier otro rol (anon/authenticated) queda denegado
--   por defecto.
--
-- IMPORTANTE:
--   * Ejecutar en Supabase → SQL Editor.
--   * Idempotente: se puede ejecutar varias veces sin error.
--   * `planes`, `plan_features` y `plan_limits` se dejan intactas porque su
--     lectura pública es intencional (catálogo de precios).
-- ============================================================================

DO $$
DECLARE
  t text;
  r record;
  sensitive_tables text[] := ARRAY[
    -- Núcleo
    'tenants',
    'usuarios',
    'notificaciones',
    'auditoria_logs',
    'configuraciones_globales',
    'planes_pago',
    'support_tickets',
    -- Comercial / inventario
    'empresas',
    'usuario_modulos',
    'tenant_features',
    'clientes',
    'sucursales',
    'bodegas',
    'kardex',
    'proveedores',
    'compras',
    'compras_detalle',
    'listas_precios',
    'productos_precio',
    'promociones',
    'ventas_fiadas',
    'ventas_fiadas_detalle',
    'abonos',
    'rutas',
    'visitas',
    'transferencias',
    'transferencias_detalle',
    'planes_membresia',
    'socios',
    'puntos_historial',
    'renovaciones',
    -- Enterprise / seguridad
    'api_keys',
    'vehiculos',
    'auditoria',
    'automatizaciones',
    'automation_runs',
    'automation_rules',
    'tenant_sessions',
    'seguridad_eventos',
    'tenant_integrations',
    -- Facturación / uso
    'facturas',
    'transacciones',
    'productos',
    'ai_usage_log',
    'ai_product_scan',
    'tenant_usage',
    'subscriptions',
    'billing_payments',
    -- Documentos / escritorio (scoped por jwt_empresa_codigo)
    'cotizaciones',
    'notas',
    'notas_credito',
    'notas_estado',
    'ordenes_compra',
    'recibos',
    'ventas',
    'ventas_crm'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabla % no existe, se omite.', t;
      CONTINUE;
    END IF;

    -- 1) Eliminar toda política previa de la tabla.
    FOR r IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;

    -- 2) Garantizar RLS activo.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- 3) Política única accesible SOLO por service_role.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only',
      t
    );

    RAISE NOTICE 'RLS endurecido en public.%', t;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Defensa en profundidad: revocar privilegios de tabla a roles NO confiables.
-- Aunque RLS ya deniega por defecto, así ningún policy mal creado a futuro
-- reabre el acceso. `service_role` conserva acceso total (bypass de RLS).
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Catálogo de precios: lectura pública intencional.
GRANT SELECT ON public.planes, public.plan_features, public.plan_limits TO anon, authenticated;

-- Reafirmar privilegios del backend.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Verificación: no debe quedar ninguna política sensible con rol PUBLIC.
-- SELECT tablename, policyname, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public' AND roles::text LIKE '%public%'
-- ORDER BY tablename;

-- Fin del script.
