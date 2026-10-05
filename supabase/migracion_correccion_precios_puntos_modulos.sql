-- ═══════════════════════════════════════════════════════════════════════
-- Corrección de 3 rotas de producción + 2 embeds rotos.
--
-- Aplicadas en producción como:
--   corregir_precios_puntos_tenant_modulos
--   embeds_postgrest_fks
--
-- Contexto: auditoría de los 3 usuarios reales no-root
-- (Amy Fajardo, QA Chat, Joseph Sanchez).
-- ═══════════════════════════════════════════════════════════════════════


-- ═══ 1) socios_puntos ═══════════════════════════════════════════════════
-- No existía. El endpoint actualizaba el saldo de public.socios y SOLO
-- DESPUÉS insertaba el movimiento; como el insert fallaba, el saldo cambiaba
-- sin asiento y el 500 invite a reintentar (descuento doble).
CREATE TABLE IF NOT EXISTS public.socios_puntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_codigo TEXT NOT NULL,
  empresa_id UUID,
  socio_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('acumular','canjear')),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  puntos_anteriores INTEGER NOT NULL DEFAULT 0,
  puntos_nuevos INTEGER NOT NULL DEFAULT 0,
  referencia TEXT DEFAULT '',
  notas TEXT DEFAULT '',
  usuario TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_socios_puntos_socio
  ON public.socios_puntos (empresa_codigo, socio_id, created_at DESC);

ALTER TABLE public.socios_puntos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "socios_puntos_service_role_only" ON public.socios_puntos;
CREATE POLICY "socios_puntos_service_role_only" ON public.socios_puntos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.socios_puntos FROM anon, authenticated;
GRANT ALL ON public.socios_puntos TO service_role;

-- Movimiento de puntos ATÓMICO. FOR UPDATE serializa canjes simultáneos.
CREATE OR REPLACE FUNCTION public.socios_mover_puntos(
  p_empresa_codigo TEXT,
  p_empresa_id     UUID,
  p_socio_id       UUID,
  p_tipo           TEXT,
  p_cantidad       INTEGER,
  p_referencia     TEXT DEFAULT '',
  p_notas          TEXT DEFAULT '',
  p_usuario        TEXT DEFAULT ''
)
RETURNS TABLE (
  movimiento_id      UUID,
  puntos_anteriores  INTEGER,
  puntos_nuevos      INTEGER
)
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_id        UUID;
  v_actuales  INTEGER;
  v_nuevos    INTEGER;
  v_mov       UUID;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('acumular','canjear') THEN
    RAISE EXCEPTION 'tipo debe ser acumular o canjear';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  SELECT s.id, COALESCE(s.puntos_acumulados, 0)
    INTO v_id, v_actuales
  FROM public.socios s
  WHERE s.id = p_socio_id
    AND s.empresa_codigo = p_empresa_codigo
    AND (p_empresa_id IS NULL OR s.empresa_id = p_empresa_id)
  FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Socio no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF p_tipo = 'acumular' THEN
    v_nuevos := v_actuales + p_cantidad;
  ELSE
    IF v_actuales < p_cantidad THEN
      RAISE EXCEPTION 'Puntos insuficientes. Disponibles: %', v_actuales;
    END IF;
    v_nuevos := v_actuales - p_cantidad;
  END IF;

  UPDATE public.socios
     SET puntos_acumulados = v_nuevos,
         updated_at = NOW()
   WHERE id = v_id;

  INSERT INTO public.socios_puntos
    (empresa_codigo, empresa_id, socio_id, tipo, cantidad,
     puntos_anteriores, puntos_nuevos, referencia, notas, usuario)
  VALUES
    (p_empresa_codigo, p_empresa_id, v_id, p_tipo, p_cantidad,
     v_actuales, v_nuevos, COALESCE(p_referencia,''), COALESCE(p_notas,''),
     COALESCE(p_usuario,''))
  RETURNING id INTO v_mov;

  RETURN QUERY SELECT v_mov, v_actuales, v_nuevos;
END;
$fn$;

REVOKE ALL ON FUNCTION public.socios_mover_puntos(TEXT,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.socios_mover_puntos(TEXT,UUID,UUID,TEXT,INTEGER,TEXT,TEXT,TEXT) TO service_role;


-- ═══ 2) tenant_modulos ══════════════════════════════════════════════════
-- No existía. Venía de migracion_planes_honduras_v2.sql (nunca aplicada).
-- El alta desde el cotizador perdía los módulos sin avisar porque Supabase
-- NO lanza excepción en un upsert fallido: devuelve { error }, que el
-- try/catch no capturaba.
--
-- DDL idéntico al de migracion_planes_honduras_v2.sql para que aplicar esa
-- migración más adelante siga siendo idempotente.
CREATE TABLE IF NOT EXISTS public.tenant_modulos (
  empresa_codigo TEXT NOT NULL,
  modulo_clave TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  origen TEXT DEFAULT 'plan',            -- plan | cotizador | owner | admin
  asignado_por TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa_codigo, modulo_clave)
);

CREATE INDEX IF NOT EXISTS idx_tenant_modulos_empresa
  ON public.tenant_modulos (empresa_codigo, activo);

ALTER TABLE public.tenant_modulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_modulos_service_role_only" ON public.tenant_modulos;
CREATE POLICY "tenant_modulos_service_role_only" ON public.tenant_modulos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.tenant_modulos FROM anon, authenticated;
GRANT ALL ON public.tenant_modulos TO service_role;


-- ═══ 3) Foreign keys para los embeds de PostgREST ═══════════════════════
-- El proyecto no usaba foreign keys (solo 6 en todo el schema), pero el
-- backend hace 2 embeds que las necesitan:
--   server.js:8120  kardex.select('*, productos(nombre, codigo, barcode)')
--   server.js:9108  socios.select('*, planes_membresia(...)')
-- Sin FK, PostgREST no puede relacionar y ambos endpoints devuelven 500.
--
-- Verificado antes de aplicar: 0 filas huérfanas en ambos lados.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kardex_producto_id_fkey' AND conrelid = 'public.kardex'::regclass
  ) THEN
    ALTER TABLE public.kardex
      ADD CONSTRAINT kardex_producto_id_fkey
      FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'socios_plan_id_fkey' AND conrelid = 'public.socios'::regclass
  ) THEN
    ALTER TABLE public.socios
      ADD CONSTRAINT socios_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.planes_membresia(id) ON DELETE SET NULL;
  END IF;
END $$;


-- ═══ Notas de la corrección en server.js ════════════════════════════════
-- · 'productos_precios' -> 'productos_precio' (la tabla real es en singular).
--   El POST además usaba columnas inexistentes: empresa_id, lista_id,
--   precio_descuento y updated_at. Esquema real: empresa_codigo,
--   lista_precio_id, precio_minimo.
-- · El GET de precios ya no embebe listas_precios(nombre): ahora cruza a mano.
-- · GET /api/membresias/socios/:id/puntos validaba el tenant y ahora además
--   acota la consulta por empresa_codigo (antes cualquier usuario autenticado
--   con el feature 'puntos' podía leer el libro de otro tenant por UUID).
-- · POST de puntos usa el RPC socios_mover_puntos (saldo + asiento atómicos).
--
-- Riesgo residual conocido: productos_precio, kardex y socios_puntos pueden
-- apuntar a una fila de otro tenant (no hay FK compuesta por empresa_codigo).
-- Las lecturas están acotadas por tenant en el backend, pero la integridad
-- entre tenants no está garantizada a nivel de base de datos.