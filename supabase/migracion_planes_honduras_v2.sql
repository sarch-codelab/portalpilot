-- ═══════════════════════════════════════════════════════════════════
-- PORTAL PILOT — PLANES HONDURAS v2 (Pulpería / Tienda / Club / Personalizado)
-- Fuente de negocio: JUSTIFICACION_PRECIOS_HONDURAS.md + planes.html
-- Ejecutar después de migracion_plan_engine_usage.sql (idempotente).
--
-- Qué hace:
--   1) Agrega precios en Lempiras (mensual/anual) al catálogo `planes`.
--   2) Registra los 3 planes verticales + el plan Personalizado (cotizador)
--      y degrada los planes legacy (business/enterprise) a "activo = false".
--   3) Crea el catálogo de los 21 módulos del cotizador (planes.html) con su
--      precio en HNL y una columna informativa `modulo_app`.
--
-- IMPORTANTE sobre `modulo_app`: la traducción OFICIAL cotizador → ids de la
-- app Flutter es la constante MODULO_APP_MAP de PP Web\backend\server.js, que
-- es multi-valora (un módulo del cotizador puede abrir varias pantallas de la
-- app, p.ej. rutas_delivery → supply_chain + canal_tradicional). Lo que se
-- guarda aquí es un solo id representativo, solo para referencia/auditoría;
-- /api/plans y el login de la app usan SIEMPRE MODULO_APP_MAP. Si cambias un
-- módulo de la app, actualiza MODULO_APP_MAP, no esta columna.
--   4) Crea plan_modulos (qué módulos trae cada plan) y tenant_modulos
--      (overrides por empresa: cotizador a la carta y activación del owner).
--   5) Corrige límites de usuarios/empresas para los planes nuevos.
--
-- NOTA DE NOMENCLATURA: los slugs del cotizador (pos_caja, cuentas_por_cobrar,
-- facturacion_sar, ...) NO son los ids de los módulos de la app Flutter
-- (pos, canal_tradicional, facturacion, ...). La columna `modulo_app` es el
-- puente oficial entre ambos mundos; el backend usa ese mapeo para responderle
-- a la app qué módulos mostrar según el plan y la asignación del owner.
--
-- NOTA DE CATÁLOGO: el documento estratégico lista "Soporte y Mesa de Ayuda"
-- (L. 35/mes) como componente #6. En planes.html ese lugar lo ocupa
-- "Analytics BI & Pronóstico" (L. 95/mes) y el soporte queda cubierto por la
-- cuota base de plataforma (L. 150/mes: "soporte técnico en horario hábil").
-- Se registra `soporte_tecnico` con activo = false para conservar el precio
-- documentado sin romper el cotizador de 21 módulos.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 0) Asegurar el catálogo base (por si el Plan Engine aún no se aplicó)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT DEFAULT '',
  precio_mensual_usd NUMERIC(10,2) DEFAULT 0,
  precio_anual_usd NUMERIC(10,2) DEFAULT 0,
  max_users INTEGER DEFAULT 5,
  max_companies INTEGER DEFAULT 1,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE planes ADD COLUMN IF NOT EXISTS precio_mensual_hnl NUMERIC(12,2) DEFAULT 0;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS precio_anual_hnl NUMERIC(12,2) DEFAULT 0;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'HNL';
ALTER TABLE planes ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'fijo';        -- fijo | personalizado | trial | legacy
ALTER TABLE planes ADD COLUMN IF NOT EXISTS trial_dias INTEGER DEFAULT 0;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS modulos_incluidos INTEGER DEFAULT 0;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS descripcion_corta TEXT DEFAULT '';

-- ─────────────────────────────────────────────────────────────────────
-- 1) Planes del modelo Honduras (precios en Lempiras)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO planes (clave, nombre, descripcion, descripcion_corta, precio_mensual_usd, precio_anual_usd,
                    precio_mensual_hnl, precio_anual_hnl, moneda, tipo, trial_dias,
                    max_users, max_companies, modulos_incluidos, orden, activo)
VALUES
  ('pulperia', 'Pulpería / Mercadito',
   'Abarroterías y glorietas de colonia: velocidad de mostrador, libreta de fiado, caja y facturación SAR simplificada.',
   'L. 10 al día. Se paga solo recuperando 1 fiado al mes.',
   12, 120, 299, 2990, 'HNL', 'fijo', 0, 3, 1, 5, 1, TRUE),
  ('tienda', 'Tienda / Supermercado',
   'Supermercados, tiendas de ropa, ferreterías y comercios minoristas con escáner, SAR formal, compras y CRM.',
   'L. 26.60 al día — menos del 0.8% de tus ventas.',
   32, 320, 799, 7990, 'HNL', 'fijo', 0, 15, 1, 8, 2, TRUE),
  ('club', 'Club / Membresía',
   'Bares, discotecas, clubes deportivos y negocios por membresía: QR de socios, barra/mesas, BI y 2FA.',
   'Se cubre con la entrada de 2 socios al mes.',
   56, 560, 1399, 13990, 'HNL', 'fijo', 0, 35, 1, 8, 3, TRUE),
  ('personalizado', 'Personalizado (Cotizador)',
   'Cuota base de plataforma L. 150/mes + los módulos que elijas del catálogo de 21. Descuentos por volumen.',
   'Arma tu plan módulo por módulo.',
   0, 0, 150, 1500, 'HNL', 'personalizado', 0, 15, 1, 0, 4, TRUE),
  ('starter', 'Prueba',
   'Prueba de 15 días con toda la plataforma para evaluar. Al vencer, modo solo lectura.',
   '15 días gratis, sin tarjeta.',
   0, 0, 0, 0, 'HNL', 'trial', 15, 5, 1, 21, 5, TRUE)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  descripcion_corta = EXCLUDED.descripcion_corta,
  precio_mensual_hnl = EXCLUDED.precio_mensual_hnl,
  precio_anual_hnl = EXCLUDED.precio_anual_hnl,
  moneda = EXCLUDED.moneda,
  tipo = EXCLUDED.tipo,
  trial_dias = EXCLUDED.trial_dias,
  max_users = EXCLUDED.max_users,
  max_companies = EXCLUDED.max_companies,
  modulos_incluidos = EXCLUDED.modulos_incluidos,
  orden = EXCLUDED.orden,
  activo = EXCLUDED.activo;

-- Planes legacy: siguen existiendo para tenants antiguos, pero ya no se venden.
UPDATE planes SET activo = FALSE, tipo = 'legacy', orden = 90 WHERE clave = 'business';
UPDATE planes SET activo = FALSE, tipo = 'legacy', orden = 91 WHERE clave = 'enterprise';
UPDATE planes SET activo = FALSE, tipo = 'legacy', orden = 92 WHERE clave = 'custom';

-- ─────────────────────────────────────────────────────────────────────
-- 2) Catálogo de los 21 módulos del cotizador (planes.html)
--    modulo_app = id real del módulo en la app Flutter (null = solo web).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modulos_cotizador (
  clave TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT '',
  descripcion TEXT DEFAULT '',
  icono TEXT DEFAULT 'fa-cube',
  precio_mensual_hnl NUMERIC(10,2) NOT NULL DEFAULT 0,
  precio_anual_hnl NUMERIC(10,2) NOT NULL DEFAULT 0,
  modulo_app TEXT,
  feature TEXT,
  orden INTEGER DEFAULT 0,
  activo BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO modulos_cotizador (clave, nombre, categoria, descripcion, icono, precio_mensual_hnl, precio_anual_hnl, modulo_app, feature, orden, activo)
VALUES
  ('pos_caja', 'POS Rápido de Mostrador', 'Ventas & Cobro',
   'Cobro veloz con teclado sin mouse, ticket térmico y atajos de venta para mostrador.',
   'fa-cash-register', 45, 450, 'pos', 'pos', 1, TRUE),
  ('cuentas_por_cobrar', 'Canal Tradicional / Libreta de Fiado', 'Crédito Barrial',
   'Control de crédito personal de colonia: registro de fiado, deudores y abonos parciales.',
   'fa-book-bookmark', 35, 350, 'canal_tradicional', 'canal_tradicional', 2, TRUE),
  ('control_caja', 'Control de Caja & Arqueo Diario', 'Caja & Efectivo',
   'Aperturas de turno, registro de gastos chicos de caja y arqueo ciego al cierre del día.',
   'fa-vault', 40, 400, 'pos', 'control_caja', 3, TRUE),
  ('cotizaciones', 'Cotizaciones & Proformas PDF', 'Ventas B2B',
   'Genera cotizaciones formales listas para imprimir o enviar por WhatsApp a clientes.',
   'fa-file-lines', 35, 350, 'cotizaciones', 'cotizaciones', 4, TRUE),
  ('crm_clientes', 'Directorio CRM de Clientes', 'Clientes',
   'Historial de compras de cada cliente, número de teléfono, dirección y preferencias.',
   'fa-users', 40, 400, 'crm', 'clientes', 5, TRUE),
  ('facturacion_sar', 'Facturación Fiscal SAR Honduras', 'Tributario & Fiscal',
   'Cumplimiento tributario SAR: CAI, rangos autorizados, fecha límite de emisión y RTN.',
   'fa-file-invoice-dollar', 70, 700, 'facturacion', 'facturacion_sar', 7, TRUE),
  ('inventario_basico', 'Inventario & Stock con Alertas', 'Inventario',
   'Catálogo de productos, existencias actuales y avisos cuando un producto esté por agotarse.',
   'fa-boxes-stacked', 65, 650, 'inventario', 'inventario', 8, TRUE),
  ('retail_pasillos', 'Canal Moderno / Sector Retail', 'Retail & Tienda',
   'Lector de código de barras, organización por pasillos, marcas y promociones de venta.',
   'fa-barcode', 60, 600, 'sector_retail', 'canal_moderno', 9, TRUE),
  ('clientes_proveedores', 'Compras & Proveedores Mayoristas', 'Compras',
   'Registro de compras de mercancía (Leyde, Sula, DIAPA) y cuentas por pagar.',
   'fa-truck-field', 60, 600, 'compras_proveedores', 'compras', 10, TRUE),
  ('fidelizacion_puntos', 'Fidelización, Puntos & Cupones', 'Marketing',
   'Premia a los clientes frecuentes acumulando puntos por compra canjeables por descuentos.',
   'fa-award', 55, 550, 'crm_advanced', 'puntos', 11, TRUE),
  ('reportes_comerciales', 'Reportes de Ventas & Ganancias', 'Estadísticas',
   'Reportes claros de ganancias brutas, productos estrella y ventas diarias por cajero.',
   'fa-chart-pie', 55, 550, 'analytics', 'reportes', 12, TRUE),
  ('seguridad_2fa', 'Seguridad, Roles & 2FA', 'Seguridad',
   'Permisos restringidos para cajeros, doble factor 2FA y auditoría de acciones sensibles.',
   'fa-shield-halved', 50, 500, 'seguridad', 'seguridad_avanzada', 13, TRUE),
  ('automatizacion_alertas', 'Automatizaciones & Alertas WhatsApp', 'Automatización',
   'Envío de resumen diario al dueño por WhatsApp y alertas automáticas de caja descuadrada.',
   'fa-robot', 65, 650, NULL, 'automation', 14, TRUE),
  ('gestion_membresias', 'Club de Membresías & Accesos QR', 'Socios & Club',
   'Control de socios con carnet digital QR, validación de cuotas vigentes y accesos.',
   'fa-id-card', 95, 950, 'membresias', 'membresias', 15, TRUE),
  ('contabilidad_pyme', 'Contabilidad & Finanzas PyME', 'Finanzas',
   'Libro de ingresos y egresos, balance general sencillo y gastos operativos del negocio.',
   'fa-calculator', 85, 850, 'contabilidad', 'operacion_completa', 16, TRUE),
  ('rrhh_planillas', 'RRHH, Planilla & Asistencias', 'Recursos Humanos',
   'Registro de empleados, cálculo quincenal de sueldos, control de turnos y adelantos.',
   'fa-user-check', 85, 850, 'rrhh', 'operacion_completa', 17, TRUE),
  ('rutas_delivery', 'Rutas de Reparto & Delivery Local', 'Logística',
   'Gestión de envíos a domicilio, asignación a motociclistas y cobro contra entrega.',
   'fa-route', 90, 900, 'supply_chain', 'rutas', 18, TRUE),
  ('transferencias_bodega', 'Multi-Bodega & Traslados', 'Inventario Pro',
   'Control de mercancía dividida entre bodega principal y salas de venta con traslados.',
   'fa-warehouse', 85, 850, 'canal_moderno', 'transferencias', 19, TRUE),
  ('multi_sucursal', 'Multi-Sucursal / Multi-Empresa', 'Expansión',
   'Administra varias sucursales o empresas desde un solo portal de manera centralizada.',
   'fa-building', 110, 1100, 'multi_empresa', 'multiempresa', 20, TRUE),
  ('chat_ia_groq', 'Asistente IA Portal Pilot (Groq)', 'Inteligencia Artificial',
   'IA en la nube ultrarrápida para redactar mensajes de cobro, analizar ventas y responder dudas.',
   'fa-brain', 120, 1200, 'chat_ia', 'ia', 21, TRUE),
  ('analytics_ventas', 'Analytics BI & Pronóstico', 'Business Intelligence',
   'Identifica horas pico de venta, estimación de demanda y comportamiento comercial.',
   'fa-chart-line', 95, 950, 'analytics', 'reportes_avanzados', 22, TRUE),
  -- Documentado en el white paper pero cubierto por la cuota base de plataforma:
  ('soporte_tecnico', 'Soporte Técnico y Mesa de Ayuda', 'Plataforma',
   'Incluido en la cuota base de plataforma: atención guiada en horario hábil.',
   'fa-headset', 35, 350, NULL, NULL, 23, FALSE)
ON CONFLICT (clave) DO UPDATE SET
  nombre = EXCLUDED.nombre, categoria = EXCLUDED.categoria, descripcion = EXCLUDED.descripcion,
  icono = EXCLUDED.icono, precio_mensual_hnl = EXCLUDED.precio_mensual_hnl,
  precio_anual_hnl = EXCLUDED.precio_anual_hnl, modulo_app = EXCLUDED.modulo_app,
  feature = EXCLUDED.feature, orden = EXCLUDED.orden, activo = EXCLUDED.activo,
  updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────
-- 3) plan_modulos — qué incluye cada plan (paquetes de planes.html)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_modulos (
  plan_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
  modulo_clave TEXT NOT NULL REFERENCES modulos_cotizador(clave) ON DELETE CASCADE,
  incluido BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (plan_id, modulo_clave)
);

-- Pulpería: 5 módulos
INSERT INTO plan_modulos (plan_id, modulo_clave, incluido)
SELECT p.id, m.clave, TRUE FROM planes p
JOIN (VALUES
  ('pos_caja'), ('cuentas_por_cobrar'), ('control_caja'), ('inventario_basico'), ('facturacion_sar')
) AS m(clave) ON TRUE
WHERE p.clave = 'pulperia'
ON CONFLICT (plan_id, modulo_clave) DO UPDATE SET incluido = TRUE;

-- Tienda: 8 módulos
INSERT INTO plan_modulos (plan_id, modulo_clave, incluido)
SELECT p.id, m.clave, TRUE FROM planes p
JOIN (VALUES
  ('pos_caja'), ('retail_pasillos'), ('control_caja'), ('facturacion_sar'),
  ('inventario_basico'), ('clientes_proveedores'), ('cotizaciones'), ('reportes_comerciales')
) AS m(clave) ON TRUE
WHERE p.clave = 'tienda'
ON CONFLICT (plan_id, modulo_clave) DO UPDATE SET incluido = TRUE;

-- Club: 8 módulos
INSERT INTO plan_modulos (plan_id, modulo_clave, incluido)
SELECT p.id, m.clave, TRUE FROM planes p
JOIN (VALUES
  ('pos_caja'), ('gestion_membresias'), ('control_caja'), ('facturacion_sar'),
  ('inventario_basico'), ('fidelizacion_puntos'), ('seguridad_2fa'), ('analytics_ventas')
) AS m(clave) ON TRUE
WHERE p.clave = 'club'
ON CONFLICT (plan_id, modulo_clave) DO UPDATE SET incluido = TRUE;

-- Prueba (starter): los 21 módulos abiertos durante 15 días de evaluación
INSERT INTO plan_modulos (plan_id, modulo_clave, incluido)
SELECT p.id, m.clave, TRUE FROM planes p
JOIN modulos_cotizador m ON m.activo = TRUE
WHERE p.clave = 'starter'
ON CONFLICT (plan_id, modulo_clave) DO UPDATE SET incluido = TRUE;

-- Personalizado: sin módulos fijos; los define el cotizador (tenant_modulos)
DELETE FROM plan_modulos pm
USING planes p
WHERE pm.plan_id = p.id AND p.clave = 'personalizado';

-- ─────────────────────────────────────────────────────────────────────
-- 4) tenant_modulos — overrides por empresa (cotizador y owner)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_modulos (
  empresa_codigo TEXT NOT NULL,
  modulo_clave TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  origen TEXT DEFAULT 'plan',            -- plan | cotizador | owner | admin
  asignado_por TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (empresa_codigo, modulo_clave)
);
CREATE INDEX IF NOT EXISTS idx_tenant_modulos_empresa ON tenant_modulos(empresa_codigo, activo);

-- ─────────────────────────────────────────────────────────────────────
-- 5) Features del Plan Engine por plan (mismas claves que PLAN_ENTITLEMENTS)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_basica'), ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_consulta'),
  ('pos_basico'), ('pos'), ('clientes'), ('canal_tradicional'), ('fiado'), ('cobros'),
  ('ia'), ('reportes_basicos'), ('control_caja'), ('cotizaciones')
) AS f(feature)
WHERE p.clave = 'pulperia'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_admin'), ('reportes'),
  ('ia'), ('roles'), ('auditoria'), ('pos'), ('clientes'), ('proveedores'), ('compras'),
  ('precios'), ('promociones'), ('canal_moderno'), ('cotizaciones'), ('reportes_basicos'),
  ('control_caja'), ('retail_pasillos')
) AS f(feature)
WHERE p.clave = 'tienda'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

-- Club y Personalizado: operación completa + todas las features del cotizador.
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_basica'), ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_consulta'),
  ('web_admin'), ('pos_basico'), ('pos'), ('clientes'), ('reportes'), ('reportes_basicos'),
  ('reportes_avanzados'), ('proveedores'), ('compras'), ('precios'), ('promociones'),
  ('canal_tradicional'), ('canal_moderno'), ('fiado'), ('rutas'), ('cobros'),
  ('sucursales'), ('transferencias'), ('inventario_multi_sucursal'),
  ('membresias'), ('socios'), ('puntos'), ('roles'), ('auditoria'), ('seguridad_avanzada'),
  ('api_keys'), ('automation'), ('fleet'), ('multiempresa'), ('ia'), ('ia_avanzada')
) AS f(feature)
WHERE p.clave IN ('club', 'personalizado')
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

-- Prueba (starter): plataforma completa durante el trial.
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_basica'), ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_consulta'),
  ('web_admin'), ('pos_basico'), ('pos'), ('clientes'), ('reportes'), ('reportes_basicos'),
  ('reportes_avanzados'), ('proveedores'), ('compras'), ('precios'), ('promociones'),
  ('canal_tradicional'), ('canal_moderno'), ('fiado'), ('rutas'), ('cobros'),
  ('sucursales'), ('transferencias'), ('inventario_multi_sucursal'),
  ('membresias'), ('socios'), ('puntos'), ('roles'), ('auditoria'), ('seguridad_avanzada'),
  ('api_keys'), ('automation'), ('fleet'), ('multiempresa'), ('ia'), ('ia_avanzada')
) AS f(feature)
WHERE p.clave = 'starter'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

-- ─────────────────────────────────────────────────────────────────────
-- 6) Límites de uso por plan (plan_limits)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 250000, 'tokens'), ('users', 3, 'usuarios'), ('automatizaciones', 2, 'bots'),
  ('storage', 10, 'GB'), ('api_requests', 20000, 'req/mes'), ('documents', 1000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'pulperia'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 1000000, 'tokens'), ('users', 15, 'usuarios'), ('automatizaciones', 10, 'bots'),
  ('storage', 50, 'GB'), ('api_requests', 100000, 'req/mes'), ('documents', 5000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'tienda'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 5000000, 'tokens'), ('users', 35, 'usuarios'), ('automatizaciones', 30, 'bots'),
  ('storage', 200, 'GB'), ('api_requests', 500000, 'req/mes'), ('documents', 25000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'club'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 1000000, 'tokens'), ('users', 15, 'usuarios'), ('automatizaciones', 10, 'bots'),
  ('storage', 50, 'GB'), ('api_requests', 100000, 'req/mes'), ('documents', 5000, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'personalizado'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

INSERT INTO plan_limits (plan_id, recurso, maximo, unidad)
SELECT p.id, l.recurso, l.maximo, l.unidad FROM planes p
CROSS JOIN (VALUES
  ('ai_tokens', 150000, 'tokens'), ('users', 5, 'usuarios'), ('automatizaciones', 5, 'bots'),
  ('storage', 5, 'GB'), ('api_requests', 10000, 'req/mes'), ('documents', 500, 'docs')
) AS l(recurso, maximo, unidad)
WHERE p.clave = 'starter'
  AND NOT EXISTS (SELECT 1 FROM plan_limits pl WHERE pl.plan_id = p.id AND pl.recurso = l.recurso);

-- ─────────────────────────────────────────────────────────────────────
-- 7) Límites de usuarios/empresas por plan en tenants
--    (corrige el ELSE 5 de migracion_seguridad_planes.sql, que dejaba a
--     pulpería/tienda/club con 5 usuarios como máximo)
--
--    PROTECCIÓN LEGACY: se usa GREATEST(actual, nuevo) para NUNCA reducir el
--    límite de un tenant existente. Hay tenants `business` con hasta 50
--    usuarios en producción que deben conservarse (el modelo nuevo define 15
--    para business, pero ese valor es solo para altas nuevas).
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.tenants
SET limite_usuarios = GREATEST(COALESCE(limite_usuarios, 0), CASE lower(COALESCE(plan, 'starter'))
  WHEN 'pulperia' THEN 3
  WHEN 'pulpería' THEN 3
  WHEN 'tienda' THEN 15
  WHEN 'club' THEN 35
  WHEN 'personalizado' THEN 15
  WHEN 'starter' THEN 5
  WHEN 'business' THEN 15
  WHEN 'enterprise' THEN 999999
  ELSE 5
END),
limite_empresas = GREATEST(COALESCE(limite_empresas, 0), CASE lower(COALESCE(plan, 'starter'))
  WHEN 'enterprise' THEN 999999
  WHEN 'business' THEN 3
  ELSE 1
END);

-- ─────────────────────────────────────────────────────────────────────
-- 8) RLS y permisos
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE modulos_cotizador ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modulos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "modulos_cotizador_public_read" ON modulos_cotizador;
  CREATE POLICY "modulos_cotizador_public_read" ON modulos_cotizador FOR SELECT USING (true);
  DROP POLICY IF EXISTS "plan_modulos_public_read" ON plan_modulos;
  CREATE POLICY "plan_modulos_public_read" ON plan_modulos FOR SELECT USING (true);
  DROP POLICY IF EXISTS "tenant_modulos_service_role" ON tenant_modulos;
  CREATE POLICY "tenant_modulos_service_role" ON tenant_modulos FOR ALL TO service_role USING (true);
END $$;

REVOKE ALL ON tenant_modulos FROM anon, authenticated;
GRANT SELECT ON modulos_cotizador, plan_modulos TO anon, authenticated;
GRANT ALL ON modulos_cotizador, plan_modulos, tenant_modulos TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 9) Protección de tenants legacy (business / enterprise)
--    Esta migración NUNCA cambia `tenants.plan` de un tenant existente: solo
--    marca los planes legacy como no vendibles (activo = false). Para que la
--    autorización por `plan_features` no degrade a los tenants antiguos, se
--    alinean las features de sus planes con PLAN_ENTITLEMENTS del backend,
--    sin quitar ninguna. (Sección 7 ya protege sus límites con GREATEST.)
-- ─────────────────────────────────────────────────────────────────────

-- business: 19 features = PLAN_ENTITLEMENTS.business
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_admin'), ('reportes'),
  ('ia'), ('roles'), ('auditoria'), ('pos'), ('clientes'), ('proveedores'), ('compras'),
  ('precios'), ('promociones'), ('canal_tradicional'), ('fiado'), ('rutas'), ('cobros'),
  ('reportes_basicos')
) AS f(feature)
WHERE p.clave = 'business'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);

-- enterprise: plataforma completa = ALL_PLAN_FEATURES del backend
INSERT INTO plan_features (plan_id, feature)
SELECT p.id, f.feature FROM planes p
CROSS JOIN (VALUES
  ('operacion_basica'), ('operacion_completa'), ('inventario'), ('facturacion_sar'), ('web_consulta'), ('web_admin'),
  ('pos_basico'), ('pos'), ('clientes'), ('reportes'), ('reportes_basicos'), ('reportes_avanzados'),
  ('proveedores'), ('compras'), ('precios'), ('promociones'),
  ('canal_tradicional'), ('canal_moderno'), ('fiado'), ('rutas'), ('cobros'),
  ('sucursales'), ('transferencias'), ('inventario_multi_sucursal'),
  ('membresias'), ('socios'), ('puntos'),
  ('roles'), ('auditoria'), ('seguridad_avanzada'),
  ('api_keys'), ('automation'), ('fleet'), ('multiempresa'),
  ('ia'), ('ia_avanzada')
) AS f(feature)
WHERE p.clave = 'enterprise'
  AND NOT EXISTS (SELECT 1 FROM plan_features pf WHERE pf.plan_id = p.id AND pf.feature = f.feature);
