-- ═══════════════════════════════════════════════════════════════════
-- PORTAL PILOT — MIGRACIÓN: PANELES ADMIN PP (tandas 12, 13 y 16)
-- Tablas nuevas que alimentan las páginas del panel admin /pp:
--   1. incidentes          → pp/incidentes_tenant.html
--   2. documentos_tenant   → pp/validacion_tenant.html (KYC Honduras)
--   3. reglas_alertas      → pp/reglas_alertas.html (umbrales automáticos)
--
-- IDEMPOTENTE: puede ejecutarse varias veces sin daño.
-- No elimina datos ni columnas. Riesgo: BAJO.
-- Ejecutar en Supabase SQL Editor del proyecto de PRODUCCIÓN.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) INCIDENTES (fallas puntuales reportadas por clientes) ───────
CREATE TABLE IF NOT EXISTS public.incidentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT,
  severidad VARCHAR(20) NOT NULL DEFAULT 'media',   -- critica | alta | media | baja
  estado VARCHAR(20) NOT NULL DEFAULT 'abierta',    -- abierta | en_progreso | resuelta | cerrada
  responsable VARCHAR(120),
  resolucion TEXT,
  reportado_por VARCHAR(200),                       -- quién lo reportó (opcional)
  resuelta_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidentes_empresa
  ON public.incidentes(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidentes_estado
  ON public.incidentes(estado, created_at DESC);

-- ── 2) DOCUMENTOS_TENANT (KYC / documentación legal) ───────────────
CREATE TABLE IF NOT EXISTS public.documentos_tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  tipo VARCHAR(60) NOT NULL,                        -- rtn | escritura_constitutiva | representante_legal | permiso_operacion | matricula_comerciante | contrato | otro
  numero VARCHAR(100),                              -- RTN, folio, tomo, etc.
  url TEXT,                                         -- enlace al archivo digitalizado (Storage)
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobado | rechazado
  notas TEXT,
  validado_por UUID,
  validado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documentos_tenant_empresa
  ON public.documentos_tenant(empresa_codigo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_tenant_estado
  ON public.documentos_tenant(estado);

-- ── 3) REGLAS_ALERTAS (umbrales automáticos) ───────────────────────
CREATE TABLE IF NOT EXISTS public.reglas_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(40) NOT NULL,                        -- uso_plan | ticket_sla | renovacion_proxima | fallos_bot | logins_fallidos
  umbral NUMERIC(12,2) NOT NULL DEFAULT 1,
  nombre VARCHAR(150),
  severidad VARCHAR(20) NOT NULL DEFAULT 'critical', -- info | warning | critical
  activo BOOLEAN DEFAULT true,
  ultima_evaluacion TIMESTAMPTZ,
  ultima_coincidencia TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reglas_alertas_activo
  ON public.reglas_alertas(activo);

-- ═══════════════════════════════════════════════════════════════════
-- RLS: los datos los lee/escribe el backend con service_role.
-- El acceso anónimo queda bloqueado (ninguna política para anon/authenticated).
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.incidentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reglas_alertas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "incidentes_service" ON public.incidentes;
CREATE POLICY "incidentes_service" ON public.incidentes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "documentos_tenant_service" ON public.documentos_tenant;
CREATE POLICY "documentos_tenant_service" ON public.documentos_tenant
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "reglas_alertas_service" ON public.reglas_alertas;
CREATE POLICY "reglas_alertas_service" ON public.reglas_alertas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
-- DATOS SEMILLA: reglas por defecto (solo si la tabla quedó vacía)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO public.reglas_alertas (tipo, umbral, nombre, severidad, activo)
SELECT 'uso_plan', 80, 'Uso > 80% del plan', 'warning', true
WHERE NOT EXISTS (SELECT 1 FROM public.reglas_alertas WHERE tipo = 'uso_plan');

INSERT INTO public.reglas_alertas (tipo, umbral, nombre, severidad, activo)
SELECT 'ticket_sla', 8, 'Ticket sin respuesta > 8h', 'critical', true
WHERE NOT EXISTS (SELECT 1 FROM public.reglas_alertas WHERE tipo = 'ticket_sla');

INSERT INTO public.reglas_alertas (tipo, umbral, nombre, severidad, activo)
SELECT 'renovacion_proxima', 15, 'Renovación en < 15 días', 'info', true
WHERE NOT EXISTS (SELECT 1 FROM public.reglas_alertas WHERE tipo = 'renovacion_proxima');

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (opcional): descomentar para validar tras ejecutar
-- SELECT 'incidentes' t, count(*) FROM incidentes
-- UNION ALL SELECT 'documentos_tenant', count(*) FROM documentos_tenant
-- UNION ALL SELECT 'reglas_alertas', count(*) FROM reglas_alertas;
-- ═══════════════════════════════════════════════════════════════════
