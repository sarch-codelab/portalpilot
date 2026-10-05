-- ═══════════════════════════════════════════════════════════════════════
-- Integridad referencial entre tenants + ajuste de stock atómico.
--
-- Aplicada en producción como: integridad_tenant_y_stock_atomico
-- (paridad de repo reconstruida desde la base — idempotente).
--
-- Problema 1: el proyecto casi no usa foreign keys, así que una fila podía
--   apuntar a un producto/lista/socio de OTRO negocio. No se puede añadir una
--   FK compuesta por (empresa_codigo, id) sin cambiar los PK de las tablas
--   referenciadas, así que se valida con un trigger BEFORE INSERT/UPDATE.
-- Problema 2: el stock se leía y luego se escribía en pasos separados
--   (leer → calcular → update) desde varios endpoints. Dos ventas simultáneas
--   podían sobrevender (lost update). Se expone una RPC que bloquea la fila
--   con FOR UPDATE y ajusta el stock de forma atómica.
--
-- Riesgo residual documentado: el trigger cubre INSERT/UPDATE, no DELETE.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══ 1) pp_validar_ref_tenant — rechaza referencias cruzadas de negocio ═══
CREATE OR REPLACE FUNCTION public.pp_validar_ref_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_ref_tenant text;
BEGIN
  IF TG_TABLE_NAME = 'kardex' AND NEW.producto_id IS NOT NULL THEN
    SELECT empresa_codigo INTO v_ref_tenant FROM public.productos WHERE id = NEW.producto_id;
    IF v_ref_tenant IS NOT NULL AND v_ref_tenant IS DISTINCT FROM NEW.empresa_codigo THEN
      RAISE EXCEPTION 'El producto referenciado pertenece a otro negocio' USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'productos_precio' THEN
    IF NEW.producto_id IS NOT NULL THEN
      SELECT empresa_codigo INTO v_ref_tenant FROM public.productos WHERE id = NEW.producto_id;
      IF v_ref_tenant IS NOT NULL AND v_ref_tenant IS DISTINCT FROM NEW.empresa_codigo THEN
        RAISE EXCEPTION 'El producto referenciado pertenece a otro negocio' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.lista_precio_id IS NOT NULL THEN
      SELECT empresa_codigo INTO v_ref_tenant FROM public.listas_precios WHERE id = NEW.lista_precio_id;
      IF v_ref_tenant IS NOT NULL AND v_ref_tenant IS DISTINCT FROM NEW.empresa_codigo THEN
        RAISE EXCEPTION 'La lista de precios referenciada pertenece a otro negocio' USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'socios_puntos' AND NEW.socio_id IS NOT NULL THEN
    SELECT empresa_codigo INTO v_ref_tenant FROM public.socios WHERE id = NEW.socio_id;
    IF v_ref_tenant IS NOT NULL AND v_ref_tenant IS DISTINCT FROM NEW.empresa_codigo THEN
      RAISE EXCEPTION 'El socio referenciado pertenece a otro negocio' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- ═══ 2) Triggers por tabla ════════════════════════════════════════════════
DROP TRIGGER IF EXISTS pp_kardex_ref_tenant ON public.kardex;
CREATE TRIGGER pp_kardex_ref_tenant
  BEFORE INSERT OR UPDATE ON public.kardex
  FOR EACH ROW EXECUTE FUNCTION pp_validar_ref_tenant();

DROP TRIGGER IF EXISTS pp_precios_ref_tenant ON public.productos_precio;
CREATE TRIGGER pp_precios_ref_tenant
  BEFORE INSERT OR UPDATE ON public.productos_precio
  FOR EACH ROW EXECUTE FUNCTION pp_validar_ref_tenant();

DROP TRIGGER IF EXISTS pp_puntos_ref_tenant ON public.socios_puntos;
CREATE TRIGGER pp_puntos_ref_tenant
  BEFORE INSERT OR UPDATE ON public.socios_puntos
  FOR EACH ROW EXECUTE FUNCTION pp_validar_ref_tenant();


-- ═══ 3) pp_ajustar_stock — ajuste atómico con bloqueo de fila ═════════════
CREATE OR REPLACE FUNCTION public.pp_ajustar_stock(
  p_empresa_codigo text,
  p_producto_id    uuid,
  p_delta          integer
)
RETURNS TABLE(anterior integer, nuevo integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_ant integer;
BEGIN
  SELECT COALESCE(stock_actual, 0) INTO v_ant
  FROM public.productos
  WHERE id = p_producto_id AND empresa_codigo = p_empresa_codigo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_ant + p_delta < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %', v_ant;
  END IF;

  UPDATE public.productos
     SET stock_actual = v_ant + p_delta,
         updated_at = NOW()
   WHERE id = p_producto_id AND empresa_codigo = p_empresa_codigo;

  RETURN QUERY SELECT v_ant, v_ant + p_delta;
END;
$function$;


-- ═══ 4) Permisos (espejo del ACL real en producción) ══════════════════════
-- pp_ajustar_stock: sin acceso PUBLIC; execute para roles Supabase.
REVOKE ALL ON FUNCTION public.pp_ajustar_stock(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pp_ajustar_stock(text, uuid, integer)
  TO anon, authenticated, service_role;

-- pp_validar_ref_tenant: función de trigger; conserva el EXECUTE por defecto
-- (PUBLIC) observado en producción, más los roles Supabase.
GRANT EXECUTE ON FUNCTION public.pp_validar_ref_tenant()
  TO anon, authenticated, service_role;
