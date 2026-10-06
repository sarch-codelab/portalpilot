-- =====================================================================
-- MIGRACIÓN v2 (SEGURIDAD + CORRECTITUD): módulos avanzados
--
-- CONTEXTO / POR QUÉ ESTE ARCHIVO
-- La v1 creó las 14 tablas y el backend, pero la revisión de seguridad
-- encontró 5 problemas que NO son cosméticos: son datos perdidos y datos
-- que se escapan entre empresas. Nada de esto estaba visible en la app;
-- solo aparece cuando dos negocios usan Portal Pilot al mismo tiempo.
--
-- HALLAZGO 1 — CRÍTICO: RLS desactivado en las 14 tablas nuevas
--   `anon` y `authenticated` tenían privilege SELECT/INSERT/UPDATE/DELETE
--   sobre las 14 tablas y RLS estaba OFF. Con la publishable key (que va
--   dentro del APK y en cualquier request) cualquiera podía leer y
--   modificar la contabilidad, nómina y leads de TODOS los tenants
--   saltándose el backend por completo. El gate de plan y el filtro por
--   empresa_codigo del server NO protegen contra eso: nunca se ejecutaban.
--   Fix: RLS ON + policy service_role_only + REVOKE de anon/authenticated.
--   Se replica el patrón que ya usan empleados/nomina/configuracion_fiscal.
--
-- HALLAZGO 2 — payroll: `nomina.rpv` y `nomina.rap` no existen
--   El cálculo en modulosAvanzadosEndpoints.js escribe `rpv` (aporte
--   patronal 2%) y descuenta RAP (1.5%) del trabajador. Sin esas columnas
--   el INSERT de nómina fallaba en runtime para todos: módulo de planillas
--   roto. Además RPV es una obligación patronal que debe quedar registrada
--   para poder reportarla, no solo calcularla en memoria.
--
-- HALLAZGO 3 — `empleados.id` y `configuracion_fiscal.id` sin default
--   Ambos son text NOT NULL sin DEFAULT. El CRUD genérico inserta sin
--   `id`, así que crear un empleado fallaba con null id, y el primer
--   guardado de configuración fiscal también. Fix: default uuid en texto.
--
-- HALLAZGO 4 — filiales: código de empresa libre = fuga entre tenants
--   `empresas_filiares.codigo` lo escribía el cliente sin validar, y el
--   consolidado hacía `.in('empresa_codigo', codigos)` sobre transacciones.
--   Un tenant podía registrar el código de otro tenant y leer sus cifras.
--   Fix: tabla `empresa_vinculos` con confirmación de AMBAS partes: el
--   padre solicita y el hijo (admin de ese tenant) confirma. El consolidado
--   solo suma filiales con vínculo confirmado.
--
-- HALLAZGO 5 — `documentos_sar.factura_id` es uuid
--   El backend lo trataba como texto libre; un valor no-uuid reventaba el
--   INSERT con 22P02. Se valida en el endpoint (verificar helpers).
--
-- IDEMPOTENCIA: todo es IF NOT EXISTS / DO NOTHING. Re-ejecutable.
-- RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Payroll: columnas que faltaban (HALLAZGO 2)
-- ---------------------------------------------------------------------
-- ISSS/RPV patronal e ISSS/RAP del trabajador. Se guardan por separado
-- porque sirven para distintosto: RAP e ISSS del empleado van al recibo,
-- el IHSS y RPV patronales van a la planilla del patrono.
ALTER TABLE public.nomina
  ADD COLUMN IF NOT EXISTS rap  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rpv  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ihss_empleador numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costo_total_empleador numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.nomina.rap IS 'Deducción RAP del trabajador (1.5% base, tope config)';
COMMENT ON COLUMN public.nomina.isss IS 'Deducción ISSS del trabajador (2.5%)';
COMMENT ON COLUMN public.nomina.ihss IS 'Aporte patronal ISSS (3.1%)';
COMMENT ON COLUMN public.nomina.rpv IS 'Aporte patronal RPV (2%)';
COMMENT ON COLUMN public.nomina.costo_total_empleador IS 'Salario + bonos + aportes patronales';

-- ---------------------------------------------------------------------
-- 2. Defaults de PK en tablas heredadas (HALLAZGO 3)
-- ---------------------------------------------------------------------
-- gen_random_uuid()::text: se conserva el tipo text que ya usan ambas
-- tablas (no se migra a uuid para no romper la app ni los ids locales).
ALTER TABLE public.empleados
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.configuracion_fiscal
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- ---------------------------------------------------------------------
-- 3. Vínculos entre empresas con doble confirmación (HALLAZGO 4)
-- ---------------------------------------------------------------------
-- El consolidado financiero solo puede sumar empresas que HAYAN
-- AUTORIZADO_EXPRESAMENTE a la matriz. Sin esta tabla, "filial" era un
-- string que cualquiera escribía y bastaba para leer los agregados de
-- otra empresa.
CREATE TABLE IF NOT EXISTS public.empresa_vinculos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  padre_codigo   text NOT NULL,
  hija_codigo    text NOT NULL,
  participacion  numeric NOT NULL DEFAULT 100 CHECK (participacion > 0 AND participacion <= 100),
  estado         text NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','confirmado','rechazado')),
  solicitado_por text,
  confirmado_por text,
  confirmado_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (padre_codigo, hija_codigo),
  CHECK (padre_codigo <> hija_codigo)
);

CREATE INDEX IF NOT EXISTS idx_empresa_vinculos_padre
  ON public.empresa_vinculos (padre_codigo, estado);
CREATE INDEX IF NOT EXISTS idx_empresa_vinculos_hija
  ON public.empresa_vinculos (hija_codigo, estado);

COMMENT ON TABLE public.empresa_vinculos IS
  'Autorización bilateral para consolidar datos entre empresas. El padre solicita, el hijo confirma. Solo los vínculos confirmado alimentan el consolidado.';

-- ---------------------------------------------------------------------
-- 4. RLS + revoke en las tablas de módulos avanzados (HALLAZGO 1)
-- ---------------------------------------------------------------------
-- service_role (el backend) conserva acceso total. anon/authenticated
-- pierden TODO privilegio: estas tablas no se consultan desde el cliente,
-- solo a través de /api/* con JWT validado y gate de plan.
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'cuentas_contables', 'asientos_contables', 'asientos_contables_detalle',
    'cierres_contables', 'conciliaciones_bancarias',
    'retenciones', 'documentos_sar',
    'crm_leads', 'crm_campanas', 'crm_segmentos', 'crm_fidelizacion',
    'empresas_filiares', 'tipos_cambio', 'consolidados_financieros',
    'empresa_vinculos'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    -- Policy solo para service_role; con RLS ON y sin policy para anon,
    -- cualquier acceso directo vía PostgREST devuelve 0 filas / 401.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role_only', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t || '_service_role_only', t
    );
  END LOOP;
END $$;

-- Las 3 tablas heredadas ya tenían RLS + policy service_role. Se fija
-- igualmente el revoke para que no dependa de cómo quedaron antes.
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY['empleados','nomina','configuracion_fiscal'];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. Un índice por cada consulta caliente de estos módulos
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_leads_etapa
  ON public.crm_leads (empresa_codigo, etapa);
CREATE INDEX IF NOT EXISTS idx_crm_campanas_estado
  ON public.crm_campanas (empresa_codigo, estado);
CREATE INDEX IF NOT EXISTS idx_documentos_sar_estado
  ON public.documentos_sar (empresa_codigo, estado_sar);
CREATE INDEX IF NOT EXISTS idx_retenciones_tipo
  ON public.retenciones (empresa_codigo, tipo);
CREATE INDEX IF NOT EXISTS idx_tipos_cambio_fecha
  ON public.tipos_cambio (empresa_codigo, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_conciliaciones_periodo
  ON public.conciliaciones_bancarias (empresa_codigo, periodo);
CREATE INDEX IF NOT EXISTS idx_empleados_estado
  ON public.empleados (empresa_codigo, estado);

-- ---------------------------------------------------------------------
-- VERIFICACIÓN (debe devolver 0 filas)
--   select relname, relrowsecurity from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and c.relname in ('cuentas_contables','nomina','crm_leads', ...)
--     and not c.relrowsecurity;
-- =====================================================================