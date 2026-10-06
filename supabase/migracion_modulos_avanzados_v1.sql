-- =====================================================================
-- MIGRACIÓN: módulos avanzados reales (contabilidad, rrhh, fiscal_advanced,
-- crm_advanced, multi_empresa)
--
-- CONTEXTO / POR QUÉ ESTE ARCHIVO
-- Las pantallas Flutter de estos 5 módulos mostraban listas hardcoded en
-- memoria (datos de ejemplo) o SharedPreferences locales sin backend:
--   - Contabilidad: leía prefs 'transacciones'; /api/transacciones sin gate
--   - RRHH: leía prefs 'empleados' / 'recibos_nomina', sin sync
--   - FiscalAdvanced, CRMAdvanced, MultiEmpresa: listas de ejemplo en memoria
-- Eso significaba cobrar por módulos que se perdían al cerrar la app y que
-- cualquier tenant podía abrir. Esta migración crea el almacenamiento real;
-- los gates de plan se aplican en backend/server.js (requirePlanFeature).
--
-- CONVENCIONES (heredadas de proveedores/compras):
--   id uuid PK default gen_random_uuid()
--   empresa_codigo text NOT NULL   (scope multi-tenant)
--   empresa_id uuid NULL
--   timestamps created_at / updated_at
--   'sincronizado' no se usa: la app escribe directo por API.
--
-- IDEMPOTENCIA: todo es CREATE TABLE IF NOT EXISTS. Se puede re-ejecutar.
-- Las columnas añadidas a empleados/nomina usan IF NOT EXISTS para no romper
-- instalaciones donde ya existan.
-- =====================================================================

-- =====================================================================
-- 1. CONTABILIDAD  (módulo 'contabilidad')
--    Plan de cuentas + asientos + cierre mensual + conciliación bancaria.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cuentas_contables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  codigo        text NOT NULL,              -- 1101, 2101... catálogo simplificado
  nombre        text NOT NULL,
  tipo          text NOT NULL DEFAULT 'activo',  -- activo | pasivo | patrimonio | ingreso | gasto
  padre_codigo  text,                       -- jerarquía del plan de cuentas
  nivel         integer NOT NULL DEFAULT 1,
  naturaleza    text NOT NULL DEFAULT 'deudora', -- deudora | acreedora
  saldo         numeric NOT NULL DEFAULT 0,
  activa        boolean NOT NULL DEFAULT true,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, codigo)
);

CREATE INDEX IF NOT EXISTS idx_cuentas_contables_empresa
  ON public.cuentas_contables (empresa_codigo);

CREATE TABLE IF NOT EXISTS public.asientos_contables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  usuario_id    uuid,
  numero        integer NOT NULL,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  concepto      text NOT NULL,
  referencia    text,
  periodo       text NOT NULL,              -- YYYY-MM, derivado de fecha
  estado        text NOT NULL DEFAULT 'borrador', -- borrador | contabilizado | anulado
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, numero)
);

CREATE INDEX IF NOT EXISTS idx_asientos_contables_empresa_periodo
  ON public.asientos_contables (empresa_codigo, periodo);

CREATE TABLE IF NOT EXISTS public.asientos_contables_detalle (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id    uuid NOT NULL REFERENCES public.asientos_contables(id) ON DELETE CASCADE,
  empresa_codigo text NOT NULL,
  cuenta_codigo text NOT NULL,
  cuenta_nombre text,
  debe          numeric NOT NULL DEFAULT 0,
  haber         numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (debe >= 0 AND haber >= 0)
);

CREATE INDEX IF NOT EXISTS idx_asientos_detalle_asiento
  ON public.asientos_contables_detalle (asiento_id);

CREATE TABLE IF NOT EXISTS public.cierres_contables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  periodo       text NOT NULL,              -- YYYY-MM
  fecha_cierre  date,
  ingresos      numeric NOT NULL DEFAULT 0,
  egresos       numeric NOT NULL DEFAULT 0,
  utilidad      numeric NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'abierto', -- abierto | cerrado
  cerrado_por   text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, periodo)
);

CREATE TABLE IF NOT EXISTS public.conciliaciones_bancarias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  cuenta_bancaria text NOT NULL DEFAULT 'general',
  periodo       text NOT NULL,              -- YYYY-MM
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  saldo_libro   numeric NOT NULL DEFAULT 0,
  saldo_banco   numeric NOT NULL DEFAULT 0,
  diferencia    numeric NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'pendiente', -- pendiente | conciliada
  conciliado_por text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, cuenta_bancaria, periodo)
);

-- =====================================================================
-- 2. RRHH  (módulo 'rrhh')
--    empleados y nomina YA EXISTEN (ver migracion_esquemas_rrhh_sar_sync.sql)
--    y están vacías. Se reutilizan y se les AGREGAN las columnas que el
--    cálculo de nómina.gob.hn necesita pero no existían.
-- =====================================================================

ALTER TABLE public.empleados
  ADD COLUMN IF NOT EXISTS bonificaciones  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_extra      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deducciones      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banco            text,
  ADD COLUMN IF NOT EXISTS cuenta_bancaria  text,
  ADD COLUMN IF NOT EXISTS email            text,
  ADD COLUMN IF NOT EXISTS telefono         text,
  ADD COLUMN IF NOT EXISTS direccion        text,
  ADD COLUMN IF NOT EXISTS notas            text;

ALTER TABLE public.nomina
  ADD COLUMN IF NOT EXISTS horas_extra      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inpcafam         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonos            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comentarios      text;

-- Índice de apoyo para listar por empresa (las dos tablas son de uso creciente).
CREATE INDEX IF NOT EXISTS idx_empleados_empresa_codigo
  ON public.empleados (empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_nomina_empresa_periodo
  ON public.nomina (empresa_codigo, anio, mes);

-- =====================================================================
-- 3. FISCAL_ADVANCED  (módulo 'fiscal_advanced')
--    Retenciones (ISR/IVA) y documentos de facturación electrónica (SAR).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.retenciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  tipo          text NOT NULL DEFAULT 'ISR',   -- ISR | IVA | IUE | GH
  proveedor     text NOT NULL,
  proveedor_rtn text,
  tipo_personeria text NOT NULL DEFAULT 'personeria_juridica', -- juridica | persona_natural
  monto_base    numeric NOT NULL DEFAULT 0,
  porcentaje    numeric NOT NULL DEFAULT 0,
  monto         numeric NOT NULL DEFAULT 0,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  periodo_fiscal text NOT NULL,                -- YYYY-MM, se llena en backend
  estado        text NOT NULL DEFAULT 'registrada', -- registrada | declarada | pagada
  comprobante   text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retenciones_empresa_periodo
  ON public.retenciones (empresa_codigo, periodo_fiscal);

CREATE TABLE IF NOT EXISTS public.documentos_sar (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  factura_id    uuid,
  serie         text,
  correlativo   text,
  cae           text,
  receptor_nombre text,
  receptor_rtn  text,
  total         numeric NOT NULL DEFAULT 0,
  estado_sar    text NOT NULL DEFAULT 'pendiente', -- pendiente | aceptado | rechazado
  fecha_envio   timestamptz,
  respuesta_sar text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documentos_sar_empresa
  ON public.documentos_sar (empresa_codigo);

-- =====================================================================
-- 4. CRM_ADVANCED  (módulo 'crm_advanced')
--    Leads/oportunidades, campañas, segmentos y programas de fidelización.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  usuario_id    uuid,
  nombre        text NOT NULL,
  contacto      text,
  telefono      text,
  email         text,
  origen        text,                         -- facebook, referido, walked-in...
  etapa         text NOT NULL DEFAULT 'nuevo', -- nuevo | contacto | propuesta | negociacion | ganado | perdido
  valor_estimado numeric NOT NULL DEFAULT 0,
  probabilidad  numeric NOT NULL DEFAULT 0,   -- 0-100
  fecha_cierre_esperada date,
  perdido_motivo text,
  notas         text,
  estado        text NOT NULL DEFAULT 'activo', -- activo | archivado
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_empresa
  ON public.crm_leads (empresa_codigo);

CREATE TABLE IF NOT EXISTS public.crm_campanas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  nombre        text NOT NULL,
  canal         text NOT NULL DEFAULT 'whatsapp', -- whatsapp | facebook | email | sms | presencial
  segmento      text,
  fecha_inicio  date NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin     date,
  presupuesto   numeric NOT NULL DEFAULT 0,
  invertido     numeric NOT NULL DEFAULT 0,
  objetivo      text,
  resultados    text,
  estado        text NOT NULL DEFAULT 'planeada', -- planeada | activa | finalizada | cancelada
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campanas_empresa
  ON public.crm_campanas (empresa_codigo);

CREATE TABLE IF NOT EXISTS public.crm_segmentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  nombre        text NOT NULL,
  descripcion   text,
  criterios     jsonb NOT NULL DEFAULT '{}'::jsonb, -- reglas tipo {ultima_compra_dias: 30, minimo: 500}
  total_clientes integer NOT NULL DEFAULT 0,
  activa        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, nombre)
);

CREATE TABLE IF NOT EXISTS public.crm_fidelizacion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  nombre        text NOT NULL,
  tipo          text NOT NULL DEFAULT 'puntos',  -- puntos | descuento | cashback
  puntos_por_lemp numeric NOT NULL DEFAULT 1,
  minimo_canje  numeric NOT NULL DEFAULT 100,
  valor_punto   numeric NOT NULL DEFAULT 1,
  vigencia_dias integer NOT NULL DEFAULT 365,
  estado        text NOT NULL DEFAULT 'activo',  -- activo | inactivo
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, nombre)
);

-- =====================================================================
-- 5. MULTI_EMPRESA  (módulo 'multi_empresa')
--    Filiales/holding, tipos de cambio y consolidado financiero.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.empresas_filiares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,               -- empresa Dueña (padre del grupo)
  empresa_id    uuid,
  codigo        text NOT NULL,
  nombre        text NOT NULL,
  rtn           text,
  actividad     text,
  pais          text NOT NULL DEFAULT 'HN',
  ciudad        text,
  direccion     text,
  telefono      text,
  email         text,
  participacion numeric NOT NULL DEFAULT 100, -- % de participación
  estado        text NOT NULL DEFAULT 'activa', -- activa | inactiva
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, codigo)
);

CREATE INDEX IF NOT EXISTS idx_empresas_filiares_empresa
  ON public.empresas_filiares (empresa_codigo);

CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  moneda        text NOT NULL DEFAULT 'USD',
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  tasa          numeric NOT NULL,
  fuente        text NOT NULL DEFAULT 'manual', -- manual | bcn
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, moneda, fecha)
);

CREATE TABLE IF NOT EXISTS public.consolidados_financieros (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo text NOT NULL,
  empresa_id    uuid,
  periodo       text NOT NULL,                -- YYYY-MM
  ingresos      numeric NOT NULL DEFAULT 0,
  egresos       numeric NOT NULL DEFAULT 0,
  utilidad      numeric NOT NULL DEFAULT 0,
  activos       numeric NOT NULL DEFAULT 0,
  pasivos       numeric NOT NULL DEFAULT 0,
  patrimonio    numeric NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'calculado', -- calculado | congelado
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_codigo, periodo)
);

-- =====================================================================
-- 6. PLAN DE CUENTAS POR DEFECTO (Honduras /Régimen de INFOFIN)
--    Se siembra al crear la empresa para que "Libros Contables" no arranque
--    vacío. Idempotente por el UNIQUE (empresa_codigo, codigo).
-- =====================================================================
INSERT INTO public.cuentas_contables (empresa_codigo, codigo, nombre, tipo, padre_codigo, nivel, naturaleza)
VALUES
  ('__default__', '1000', 'Activos',                                  'activo',     NULL,        1, 'deudora'),
  ('__default__', '1100', 'Efectivo en caja',                         'activo',     '1000',      2, 'deudora'),
  ('__default__', '1110', 'Cuentas bancarias',                        'activo',     '1000',      2, 'deudora'),
  ('__default__', '1120', 'Cuentas por cobrar',                       'activo',     '1000',      2, 'deudora'),
  ('__default__', '1130', 'Inventario',                               'activo',     '1000',      2, 'deudora'),
  ('__default__', '1200', 'Propiedad, planta y equipo',               'activo',     '1000',      2, 'deudora'),
  ('__default__', '2000', 'Pasivos',                                  'pasivo',     NULL,        1, 'acreedora'),
  ('__default__', '2100', 'Proveedores por pagar',                    'pasivo',     '2000',      2, 'acreedora'),
  ('__default__', '2110', 'Retenciones por pagar',                    'pasivo',     '2000',      2, 'acreedora'),
  ('__default__', '2200', 'Préstamos por pagar',                      'pasivo',     '2000',      2, 'acreedora'),
  ('__default__', '3000', 'Patrimonio',                               'patrimonio', NULL,        1, 'acreedora'),
  ('__default__', '3100', 'Capital social',                           'patrimonio', '3000',      2, 'acreedora'),
  ('__default__', '3200', 'Utilidades acumuladas',                    'patrimonio', '3000',      2, 'acreedora'),
  ('__default__', '4000', 'Ingresos',                                 'ingreso',    NULL,        1, 'acreedora'),
  ('__default__', '4100', 'Ventas',                                   'ingreso',    '4000',      2, 'acreedora'),
  ('__default__', '4200', 'Otros ingresos',                           'ingreso',    '4000',      2, 'acreedora'),
  ('__default__', '5000', 'Gastos y costos',                          'gasto',      NULL,        1, 'deudora'),
  ('__default__', '5100', 'Costo de ventas',                         'gasto',      '5000',      2, 'deudora'),
  ('__default__', '5200', 'Gastos de personal',                       'gasto',      '5000',      2, 'deudora'),
  ('__default__', '5300', 'Gastos operativos',                        'gasto',      '5000',      2, 'deudora'),
  ('__default__', '5400', 'Impuestos y retenciones',                   'gasto',      '5000',      2, 'deudora')
ON CONFLICT (empresa_codigo, codigo) DO NOTHING;