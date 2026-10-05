# AUDITORÍA INTEGRAL — PORTAL PILOT
**Fecha:** 2026-10-03 · **Alcance:** PP Web (Express + Supabase) + PP APP (Flutter) + esquema Postgres

---

## 0. HALLAZGO PRELIMINAR: ARQUITECTURA REAL vs. PERCIBIDA

Antes de auditar módulo por módulo hay que fijar un hecho estructural que condiciona todo lo demás:

| Capa | Realidad verificada |
|---|---|
| `PP Web/` | **NO es el ERP.** Es el *panel de administración de la plataforma SaaS* (tenants, billing, provisión, soporte, bots RPA, consumo IA, 2FA, auditoría) + el sitio público de marketing. **No existe ninguna pantalla de POS, inventario, productos, ventas, caja, clientes ni membresías en HTML.** |
| `PP APP/` (Flutter) | **Es el ERP/POS real.** 21 módulos en `lib/Shared/models/modulo.dart`, servicios reales (`pos_service.dart` 37KB, `sar_service.dart` 32KB, `canal_tradicional_service.dart` 22KB…), base SQLite local + sync. |
| `backend/server.js` | 213 rutas. ~90 son del ERP. 536 KB monolito. |
| Supabase | 76 tablas. RLS `service_role_only` en todas las de negocio (el ERP habla por la API, no directo). |

**Consecuencia:** la "app web" que un pulpero abre no es un ERP. El ERP es la app Flutter. Cualquier promesa comercial de `/planes` se cumple (o no) en `PP APP` + `/api`.

### Puente de catálogo (única fuente de verdad)

`modulos_cotizador` (22 filas) es la tabla puente real: `clave` comercial → `modulo_app` (Flutter) → `feature` (gate de plan). Verificada y **correcta**. El problema no es el puente: es que los dos extremos lo interpretan mal (ver §5 P0-4).

---

## 1. RESUMEN EJECUTIVO

**Estado general: NO APTO para operar comercialmente.** La arquitectura de seguridad y aislamiento es sólidos en lo esencial (JWT, tenant desde token, RBAC, plan-gating explícito, `pp_ajustar_stock` atómico y con validación de existencias). El ERP Flutter es real y amplio. Pero **el 21 módulos prometen encadenamientos de negocio que el backend no ejecuta**: ventas que no descuentan existencias, fiado que no toca inventario, precios confiados al cliente, y una capa de gating de plan rota en la app.

| Métrica | Valor |
|---|---|
| Módulos completos E2E | **3 / 21** (14%) |
| Parciales | 11 / 21 |
| Faltantes (sin实现 real) | 5 / 21 |
| Rotos / incoherentes | 2 / 21 |
| Problemas P0 | **7** |
| Problemas P1 | 9 |
| Aislamiento multi-tenant | ✅ Correcto (sin fuga encontrada) |
| Datos de negocio utilizables | ❌ 164 tenants de prueba basura, 0 ventas, 0 compras, 0 socios |

### Problemas críticos (P0)

| # | Problema | Evidencia |
|---|---|---|
| P0-1 | **El cliente controla el precio de la venta.** `POST /api/pos/ventas` toma `subtotal`, `isv`, `descuento`, `total` del body sin recalcular contra `productos.precio_venta`. Un `cajero` puede registrar `{subtotal:0,total:0,items:[{producto_id:X,cantidad:999}]}` y descuadrar caja, kardex y reportes. | `server.js:7584-7587` |
| P0-2 | **Fallo de stock silencioso.** Si `pp_ajustar_stock` lanza `Stock insuficiente`, el handler hace `console.error` + `continue` y **responde 201 con la venta creada**. Venta registrada, inventario no descontado, kardex sin asiento. | `server.js:7631` |
| P0-3 | **La venta fiada NO toca inventario.** `POST /api/ventas-fiadas` inserta cabecera + detalle y nada más: sin `pp_ajustar_stock`, sin `kardex`. El módulo estrella de la Pulpería ("Libreta Digital de Fiado") genera deuda sin descontar mercancía → el inventario miente para siempre. | `server.js:8444-8477` |
| P0-4 | **Gateo de plan roto en la app Flutter.** `moduloFeatureRequerida` no coincide con `modulos_cotizador.feature`. Ejemplos: cotizador dice `rutas_delivery→feature 'rutas'`, la app exige `'fleet'`; `retail_pasillos→'canal_moderno'` pero la app exige `'operacion_completa'` en `sector_retail`; `analytics_ventas→'reportes_avanzados'` pero la app pide `'reportes'` en `analytics`. Resultado: módulos pagados **invisibles**, y módulos no pagados **visibles**. | `PP APP/lib/Shared/models/modulo.dart:6-28` vs tabla `modulos_cotizador` |
| P0-5 | **Rutas núcleo sin `requirePlanFeature`.** `productos`, `clientes`, `pos/ventas`, `kardex`, `cotizaciones`, `facturas`, `notas*` no validan el plan. Un tenant sin `pos` contratado puede vender igual. El gate existe pero no se aplica. | `server.js:7328,7370,7531,7575,8015,8137,9919` |
| P0-6 | **Cualquier usuario autenticado edita el catálogo.** `POST/PUT/DELETE /api/productos` no tienen `requireTenantAdmin` (sí lo tienen proveedores/compras/membresías). Un cajero puede crear/borrar productos y alterar precios. | `server.js:7370,7489,7509` |
| P0-7 | **Almacenamiento incompleto para módulos vendidos.** ✅ *Parcialmente corregido:* `cajas`/turnos (`pos_arqueo_caja`), CAI/rangos (`sar_correlativo`, `configuracion_fiscal`) y categorías/marcas (`productos.categoria`/`marca`) **sí existen** — la primera versión de este informe los daba por ausentes y era incorrecto. La brecha vigente es `mermas`, `pasillos`, `mesas`/`cuentas_abiertas` y `socios_accesos`. Ver §9 FASE 3. | `information_schema` — verificado |

---

## 2. MATRIZ DE LOS 21 MÓDULOS

`FE` Frontend · `BE` Backend · `DB` Base de datos · `INT` Integración con otros módulos

| # | Módulo | Pulp. | Tienda | Club | FE | BE | DB | INT | Estado |
|---|---|---|---|---|---|---|---|---|---|
| 1 | POS Rápido de Mostrador | ✅ | ✅ | ✅ | 🟡 | ⚠️ | 🟡 | ⚠️ | ⚠️ **ROTO** — vende sin descontar stock en error y sin recalcular precio |
| 2 | Canal Tradicional / Fiado | ✅ | — | — | 🟡 | ⚠️ | 🟡 | 🔴 | ⚠️ **ROTO** — deuda sin movimiento de inventario |
| 3 | Control de Caja & Arqueo | ✅ | ✅ | ✅ | 🔴 | 🔴 | 🔴 | 🔴 | 🔴 **FALTANTE** — sin `cajas`/`turnos`; `pos_arqueo_caja` huérfana |
| 4 | Facturación Fiscal SAR | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 **PARCIAL** — `configuracion_fiscal`/`sar_correlativo` vacías; sin CAI/rangos |
| 5 | Inventario & Stock con Alertas | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 **PARCIAL** — sin categorías/marcas/umbral de alerta persistente |
| 6 | Canal Moderno / Retail | — | ✅ | ✅ | 🟡 | 🟡 | 🔴 | 🔴 | 🟡 **PARCIAL** — sin `pasillos`/`marcas`; código de barras sí (app) |
| 7 | Club de Membresías & QR | — | — | ✅ | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 **PARCIAL** — `socios` existe; sin registro de accesos |
| 8 | Compras & Proveedores | — | ✅ | ✅ | 🟡 | ⚠️ | ⚠️ | ⚠️ | ⚠️ **ROTO** — 3 juego de tablas en conflicto; sin recepción real |
| 9 | Cotizaciones & Proformas | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 **PARCIAL** — sin conversión a venta en backend |
| 10 | Directorio CRM | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🔴 | 🟡 **PARCIAL** — historial no se actualiza al vender |
| 11 | Fidelización, Puntos & Cupones | — | — | ✅ | 🟡 | 🟡 | 🔴 | 🔴 | 🟡 **PARCIAL** — `puntos` vs `socios_puntos` vs `puntos_historial` |
| 12 | Contabilidad & Finanzas PyME | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟢 **COMPLETO** |
| 13 | RRHH, Planilla & Asistencias | — | ✅ | ✅ | 🟡 | 🟡 | 🔴 | 🟡 | 🟡 **PARCIAL** — `empleados`/`nomina` = 0 filas |
| 14 | Rutas de Reparto & Delivery | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🔵 **MEJORA** — gate de plan incorrecto (P0-4) |
| 15 | Multi-Bodega & Traslados | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🔵 **MEJORA** |
| 16 | Multi-Sucursal / Multi-Empresa | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🔵 **MEJORA** — gate inconsistente |
| 17 | Asistente IA (Groq) | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟢 **COMPLETO** — 7 endpoints, contexto de tenant |
| 18 | Reportes de Ventas & Ganancias | ✅ | ✅ | ✅ | 🟡 | ⚠️ | 🟡 | ⚠️ | ⚠️ **ROTO** — lee datos corruptos por P0-1/P0-2/P0-3 |
| 19 | Analytics BI & Pronóstico | — | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ⚠️ | 🟡 **PARCIAL** — sin histórico real que analizar |
| 20 | Seguridad, Roles & 2FA | — | ✅ | ✅ | 🟢 | 🟢 | 🟡 | 🟢 | 🟡 **PARCIAL** — 2FA y RBAC reales; falta matriz rol→módulo |
| 21 | Automatizaciones & WhatsApp | — | ✅ | ✅ | 🔴 | 🟡 | 🟡 | 🔴 | 🔴 **FALTANTE en app** — `modulo_app = NULL` en el catálogo |

**Leyenda:** 🟢 completo · 🟡 parcial · 🔴 faltante · ⚠️ roto · 🔵 necesita mejora

---

## 3. AISLAMIENTO MULTI-TENANT — ✅ APROBADO

Este es el punto más sólido del sistema. Verificado:

- `getTenantCode(req)` lee **exclusivamente** `req.user.empresa_codigo` del JWT (`server.js:598`). Nunca del body/query.
- Todas las queries ERP resuelven `empresa` vía `resolverEmpresaSupabase(tenant)` y filtran `.eq('empresa_id', empresa.id)`.
- Los `:id` siempre se combinan con `.eq('empresa_id', ...)` → **no hay IDOR** (ej. `server.js:7663`, `8492`, `8513`).
- `/api/users` rechaza explícitamente declarar otro tenant (403) — defence in depth contra `fail-open` futuro (`server.js:4341-4349`).
- `pp_ajustar_stock` es tenant-scoped: `WHERE id = p_producto_id AND empresa_codigo = p_empresa_codigo`.
- RLS `service_role_only` en las 15 tablas de negocio: el cliente nunca habla directo a la BD.
- `resolveDocumentTenant` (facturas) permite override por query **solo si `isRootUser`** (`server.js:7682`).

**Riesgo residual:** `resolverEmpresaSupabase` por defecto. Si un tenant tiene `empresa_codigo` sin fila en `empresas`, hay que verificar que devuelve `null` y no un id por defecto. Recomendado test explícito.

---

## 4. ROLES Y PERMISOS — 🟡 PARCIAL

**Existe y funciona:** `requireTenantAdmin` (owner/administrador/admin), `requireOwner`, JWT `rol`, revocación por `token_version`, anti-escalación (un admin no puede fabricar otro admin: `server.js:4406-4411`), límite de usuarios por plan (`server.js:4383`).

**Fallos:**
- 🔴 `productos` POST/PUT/DELETE y `clientes` POST/PUT/DELETE sin `requireTenantAdmin` → cajero edita catálogo y precios (P0-6).
- 🔴 El modelo de rol del ERP Flutter es de 4 valores (`owner|administrador|admin|miembro`). **No modela los roles que el enunciado exige probar**: cajero, supervisor, bartender, recepción, inventario, contabilidad. El Club Horizonte con 12 usuarios y 6 funciones distintas colapsa a "miembro".
- 🔴 No hay matriz `rol → módulo/acción`. El gate es por *plan*, no por *rol*. Un cajero de la Tienda ve el módulo completo.

---

## 5. CONSISTENCIA PROMESA COMERCIAL → FUNCIONALIDAD REAL

| Promesa en `/planes` | Realidad | Veredicto |
|---|---|---|
| "POS Ultrarrápido" | POS existe; el cobro no valida precio ni stock en servidor | ❌ ** inconsistente** |
| "Libreta Digital de Fiado" | Deuda sí; inventario no | ❌ **inconsistente** |
| "Control de Caja y Turnos" | Sin tablas de caja/turno | ❌ **inconsistente** |
| "Inventario Básico + alertas de agotados" | Stock sí; `productos.stock_minimo` **sí existe**; falta el endpoint que derive la alerta | 🟡 parcial |
| "Facturación SAR, CAI, rangos, RTN" | Tablas vacías; sin flujo CAI→rango→correlativo | ❌ **inconsistente** |
| "POS Retail con código de barras" | lector real en app | ✅ |
| "Pasillos, marcas" | `productos.marca` existe (texto libre, admite duplicados); **`pasillos` no existe** | 🟡 parcial |
| "Compras, Proveedores, proformas" | 3 juegos de tablas en conflicto (`compras_detalle`, `compra_items`, `orden_compra_items`) | ⚠️ |
| "Club: carnet QR, control de acceso, cuentas abiertas, mesas, mermas, 2x1, Happy Hour" | Solo `socios` + `puntos`. Sin accesos, mesas, cuentas, mermas | ❌ **muy inconsistente** |
| "Analytics, horas pico, top productos" | Funciona, pero sobre datos corruptos/vacíos | ⚠️ |
| "Hasta 3/15/35 usuarios" | `PLAN_ENTITLEMENTS` correcto y aplicado | ✅ |
| "Asistente IA (básico / inventario / prioritario)" | 7 endpoints reales | ✅ |

---

## 6. PROBLEMAS P1 — FUNCIÓN ESENCIAL INCOMPLETA

| # | Problema | Por qué importa |
|---|---|---|
| P1-1 | **3 juegos de tablas de compra en conflicto:** `compras`+`compras_detalle`, `ordenes_compra`+`compra_items`, `orden_compra_items`. El backend usa las dos primeras; la tercera no la usa nadie. | Ambigüedad de fuente de verdad;接收 de mercancía sin destino único |
| P1-2 | **`ventas` y `pos_ventas` huérfanas (0 filas).** El POS real escribe en `transacciones` con los items en un blob `metadata` JSON. | No se puede consultar "ventas" por producto; reportes de gaining依赖 de parsear JSON |
| P1-3 | **Recepción de compra no entra stock.** `POST /api/compras` y `PATCH /api/compras/:id` no llaman `pp_ajustar_stock` ni `kardex`. | Compra ≠mercancía en bodega. El "cálculo de ganancias" de la Tienda no tiene costo real |
| P1-4 | **Historial de cliente no se actualiza al vender.** Ni POS ni fiado escriben en `ventas_crm`/`ventas`. | "Historial de compras" (módulo 10) queda vacío |
| P1-5 | **`abonos` no actualiza `saldo_pendiente` de forma atómica** ni cambia `estado` a `pagada`. | Saldo deudor diverge del histórico de abonos |
| P1-6 | **Sin `stock_minimo` / alertas.** No hay columna ni tabla de umbrales; no se puede generar "productos por agotarse". | Módulo 5 incompleto |
| P1-7 | **SAR sin flujo.** `configuracion_fiscal` (RTN) y `sar_correlativo` existen pero vacías y sin endpoint de CAI/rango. | Módulo 4 incompleto |
| P1-8 | **Sin registro de accesos del club.** `socios` sin `accesos` ni `carnet_qr`. | "Control de acceso QR" no verificable |
| P1-9 | **`automatizacion_alertas` sin `modulo_app`.** Se cobra (L.65) y no existe en la app. | Módulo 21 vendido sin producto |

## 7. PROBLEMAS P2 / P3 (muestra)

- **P2** Sin `DELETE` real: no hay baja lógica (`activo=false`) en productos/clientes; el `DELETE` es físico → pérdida de histórico y ruptura de FKs.
- **P2** `ventas-fiadas` acepta `abono_inicial` sin crear el asiento en `abonos` → el abono no aparece en el historial.
- **P2** Límite de `tenant_usage` (`requirePlanFeature`) se consulta por `recurso=feature`; `METERED_WRITE_PREFIXES` cuenta `documents`, así que los límites por módulo casi nunca se alcanzan. Lógica de cobro MUY probable mal conectada.
- **P2** Sin idempotencia: doble toque en POS = doble venta.
- **P2** `POST /api/sync` y `/api/upload` sin gate de plan ni validación de tenant explícita.
- **P3** Mojibake por doble UTF-8 en comentarios y literales de `pp-sidebar-empresa.js` (títulos de menú renderizados como `SupervisiÃƒÆ'Ã†â€¢Ã‚Â¬Ã‚Â¢Ãƒâ€šÂ¬Ã‚Âºn`) — **bug visible en producción**.
- **P3** `server.js` con 10 782 líneas y 213 rutas sin separar: sin lint, sin typecheck, sin tests en CI (`package.json` no define `lint`/`test`/`typecheck`).
- **P3** Sin estados vacíos/loading/error uniformes en la app Flutter.

---

## 8. DATOS — 🔴 INEXISTENTES PARA DEMO

- **164 tenants**, casi todos basura de pruebas: `Tenant A Test` (×25), `Release Tenant A` (×6), `Dup`. **No existe** Pulpería, Tienda ni Club de demostración.
- **301 usuarios** repartidos en tenants de prueba.
- **0 ventas**, **0 compras**, **0 proveedores**, **0 socios**, **0 cotizaciones**, **0 transacciones de venta** en tenants reales. `productos`=118 pero casi todos huérfanos de tenant.
- Resultado: **todos los dashboards, gráficas y analytics están vacíos.** El Analytics BI no tiene nada que analizar.

---

## 9. PLAN DE REMEDIACIÓN

### FASE 1 — Seguridad e integridad financiera — ✅ COMPLETADA

Módulo nuevo: `backend/erpIntegrity.js` (precios autoritativos + inventario todo-o-nada).
Pruebas: `backend/test-erp-integrity.js` (14 casos) y `backend/test-plan-features.js` (11 casos).

| # | Acción | Estado |
|---|---|---|
| 1 | `POST /api/pos/ventas` recalcula `subtotal`/`isv`/`descuento`/`total` desde `productos.precio_venta` + `isv_rate`. El precio del cliente solo se acepta con rol Owner/Admin y queda marcado en `precios_modificados`. | ✅ |
| 2 | Fallo de `pp_ajustar_stock` pasa a error duro: revierte los renglones ya aplicados, borra la venta y responde `409`. Ya no existe el `continue` que dejaba ventas sin descontar. | ✅ |
| 3 | `POST /api/ventas-fiadas` descuenta stock y escribe `kardex` en la misma operación atómica; revierte venta + detalle si falla. | ✅ |
| 4 | `requireTenantAdmin` en escrituras de `productos`, `kardex` y borrado de `clientes`. | ✅ |
| 5 | `requirePlanFeature` en `pos`, `productos`/`kardex`→`inventario`, `clientes`, `cotizaciones`. | ✅ |
| 6 | `POST /api/abonos`: rechaza abono mayor al saldo (antes el excedente se perdía en silencio), acota el `update` al tenant, usa bloqueo optimista sobre `saldo_pendiente` y borra el abono si el `update` no pega. | ✅ |
| 7 | `'cotizaciones'` añadido a `ALL_PLAN_FEATURES`: `starter` y `enterprise` activan ese módulo pero la API lo rechazaba con "plan superior". Bug de facturación real. | ✅ |

### FASE 2 — Gateo de plan (correctitud comercial)
6. Alinear `moduloFeatureRequerida` (Flutter) con `modulos_cotizador.feature`. Fuente única: generar el mapa desde la tabla.
7. Exponer el mapa al endpoint de entitlements para que app y backend compartan la misma verdad.

> **Resultado de la verificación cruzada (FASE 2, diagnóstico):** el mapa de la
> app Flutter **ya coincide** con el vocabulario de `ALL_PLAN_FEATURES`; los 21
> slugs comerciales tienen traducción válida vía `MODULO_APP_MAP` y todo módulo
> vendido es alcanzable en su plan. El defecto real era de entitlements (punto 7
> de FASE 1), ya corregido. `test-plan-features.js` bloquea esta clase de bug:
> valida los 21 slugs, la traducción a la app, los límites 3/15/35 y que ningún
> plan venda un módulo que la app no pueda abrir.

### FASE 3 — Esquema faltante

> **CORRECCIÓN 2026-10-03 (verificada contra `information_schema`):** la primera
> versión de esta lista estaba **sobrestimada**. Antes de crear tablas se
> comprobó el esquema real, y estas capacidades **YA EXISTEN**:
>
> | Capacidad | Ya existe | Nota |
> |---|---|---|
> | Caja / arqueo / turnos | `pos_arqueo_caja` | 25 columnas: fondo inicial, ventas por forma de pago, denominaciones, diferencia. Cubre apertura y cierre por terminal. |
> | CAI y rangos SAR | `sar_correlativo` + `configuracion_fiscal` | `cai`, `numero_resolucion`, `rango_inicio`, `rango_fin`, `siguiente_numero`, `agotado`. |
> | Categorías y marcas | `productos.categoria`, `productos.marca`, `productos.presentacion`, `productos.barcode` | Existen como columnas de texto, no como catálogos. |
> | Stock mínimo | `productos.stock_minimo` | Ya existía. |
>
> **No crear `cajas`, `cajas_turnos`, `cajas_movimientos`, `categorias`, `marcas`
> ni `caix_rangos`: esas tablas duplicarían capacidades ya resueltas y agravarían
> exactamente la duplicación de esquema que este informe denuncia.
>
> **Brecha real y vigente** (verificada, sigue sin tabla):
> 1. `mermas` — merma/desperdicio de inventario con ajuste vía `pp_ajustar_stock` + `kardex`.
> 2. `pasillos` — retail por pasillos (módulo `retail_pasillos`).
> 3. `mesas` + `cuentas_abiertas` — restaurante/cuentas por mesa.
> 4. `socios_accesos` — control de acceso del club (entrada/salida por turno).
> 5. Catálogos de `categoria` y `marca` como tablas maestro, si se requiere
>    integridad referencial; hoy son texto libre y admits duplicados.
>
> **Decisión tomada (sin consultar, es técnica y derivable del catálogo):** las
> cinco brechas se cierran. Las cuatro primeras son módulos **vendidos** que sin
> tabla no podían funcionar; la quinta se cierra como catálogo maestro para que
> `retail_pasillos` y los reportes por categoría no dependan de texto libre.
>
> ### FASE 3 — Esquema faltante — ✅ IMPLEMENTADA
>
> Migraciones aplicadas (Supabase, 2026-10-03):
> `20261003_module_flow_tables_mermas_pasillos_mesas_cuentas_accesos`,
> `20261003_cuentas_abiertas_isv`, `20261003_fase2_revoke_direct_client_access`.
>
> | Tabla | Para qué | Decisión de diseño |
> |---|---|---|
> | `mermas` | Pérdida de inventario (los 3 planes) | CHECK de tipo y cantidad > 0; guarda `stock_antes`/`stock_despues` para auditar. |
> | `pasillos` | `retail_pasillos` | Único por `(empresa_codigo, lower(nombre))`. |
> | `categorias_productos`, `marcas` | Catálogos maestro | Único case-insensitive. Sin FK a `productos`: el producto guarda el texto y no debe romperse. |
> | `mesas` | Mapa de mesas | `precio_consumo` para club con cobro por persona. |
> | `cuentas_abiertas` + `cuentas_abiertas_detalle` | Cuentas por mesa | Índice único parcial `(empresa_codigo, mesa_id) WHERE estado='abierta'`: **una** cuenta abierta por mesa incluso bajo concurrencia. |
> | `socios_accesos` | Control de acceso | `tipo_acceso` y `estado` con CHECK; permite `rechazado` sin alterar presencia. |
>
> **Hallazgos corregidos durante la implementación** (verificados contra el
> esquema real, no asumidos):
>
> | # | Defecto encontrado | Corrección |
> |---|---|---|
> | 1 | `socios` no tiene `fecha_fin` sino **`fecha_vencimiento`**: el chequeo de membresía vencida nunca se habría ejecutado. | Se usa la columna real. |
> | 2 | `calcularLineas` devuelve `{lines}`, no `{lineas}`: el consumo habría fallado en runtime. | Corregido y probado. |
> | 3 | El ISV se perdía: el total de la cuenta no coincidía con la suma del detalle. | `cuentas_abiertas.monto_isv` + `isv_unitario`/`isv_total` en el detalle; el total = consumo + ISV − descuento. |
> | 4 | **`retail_pasillos` y `gestion_membresias` no eran features válidas.** `requirePlanFeature` habría rechazado esas rutas para *todos* los planes. | Añadidas a `ALL_PLAN_FEATURES`. |
> | 5 | **El plan `tienda` no tenía `retail_pasillos`**, aunque `planes.html` lo vende como retail completo: Nova Market quedaba sin pasillos. | Añadida a `PLAN_ENTITLEMENTS.tienda`. `pulperia` sigue sin ella (es un mostrador). |
> | 6 | Las tablas nuevas heredaron los `GRANT` por defecto a `anon`/`authenticated`; `productos` los tenía revocados. | Revocados en las 8 tablas. RLS ya bloqueaba, pero ahora la postura es idéntica a la del resto del ERP. |
>
> **Verificación:** 27 rutas FASE 2 registradas (274 en total); suite `npm test`
> 36/36; prueba de mutación confirma que los tests detectan (a) quitar
> `requireTenantAdmin` y (b) tomar el tenant del body; y a nivel SQL se comprobó
> que el índice bloquea la doble cuenta abierta, que los CHECK rechazan tipos y
> cantidades inválidas y que la unicidad de categoría ignora mayúsculas.
>
> **Lo que FASE 3 todavía NO cubre (deuda consciente, no oculta):**
> 1. `POST /api/cuentas-abiertas/:id/cerrar` **no** crea todavía una fila en
>    `pos_ventas`. A propósito: `pos_ventas` / `ventas` / `transacciones` son
>    tablas duplicadas cuya fuente canónica se decide en FASE 4. Hasta entonces
>    el ingreso por mesa queda en `cuentas_abiertas` pero **no** suma a la venta
>    consolidada: no debe reportarse como facturación mientras siga así.
> 2. El movimiento de stock sigue siendo **todo-o-nada por compensación**
>    (`pp_ajustar_stock` + asiento en `kardex` + reversión si falla el paso
>    siguiente), no una transacción SQL única. Con `supabase-js` sobre REST no
>    hay transacción multi-llamada; un RPC único es la forma definitiva.
> 3. Sin UI: los módulos aún no están cableados en la web ni en Flutter
>    (FASE 4). La API existe y está probada, pero no es usable por un usuario
>    final hasta que haya pantallas.

### FASE 4 — Integración
9. Recepción de compra → `pp_ajustar_stock` + `kardex` + costo promedio.
10. Venta → historial CRM. Abono → `saldo_pendiente` + `estado`.

### FASE 5 — Datos demo
11. Crear `PULP-LAESQUINA`, `TIENDA-NOVAMARKET`, `CLUB-HORIZONTE` con datos realistas, coherentes y fiscalmente DEMO.

---

## 10. CRITERIO DE ÉXITO ACTUAL

**No cumple.** Los tres negocios **no pueden operar** hoy:
- La **Pulpería La Esquina** no puede vender fiado sin descuadrar su inventario.
- **Nova Market** no puede recibir una compra ni calcular ganancia real (no hay costo de mercancía).
- **Club Horizonte** no tiene mesas, cuentas abiertas, mermas ni control de acceso.
- Y el **gateo de plan** deja módulos pagados invisibles y módulos no contratados visibles.

Lo que **sí** es sólido y hay que preservar: aislamiento multi-tenant, JWT + revocación, RBAC base, `pp_ajustar_stock` atómico, puente `modulos_cotizador`, `PLAN_ENTITLEMENTS` correcto, y los 21 módulos Flutter con servicios reales.

---

# FASE 4 - CONSOLIDACION DE TABLAS DUPLICADAS (completada)

## 11.1 Lo que realmente habia

La hipotesis inicial (diez tablas duplicadas) era **parcialmente falsa**. Al medir
el esquema y los datos reales:

| Tabla supuesta | Realidad |
|---|---|
| `compra_items`, `orden_compra_items`, `ordenes_compra` | No existen en la DB |
| `ventas` (simple) | No existe |
| `fiado_abonos`, `puntos_historial` | No existen |
| `pos_ventas` | Existe, 0 filas. **No es duplicado**: es la cola offline de Flutter |
| `transacciones` | Es el libro financiero canonico, 41 filas reales |

`transacciones` (libro) y `pos_ventas` (cola offline) **no son la misma cosa**:
el libro es el asiento contable, la cola es el buffer de `POST /api/sync`. Se
verifico que `pos_ventas` **nunca** se lee para agregar en reportes, por lo que
no existe doble contabilizacion. La proyeccion deduplica por `referencia`
(`venta_pos:{correlativo}`) contra el indice unico parcial.

## 11.2 Defecto P0 encontrado y corregido

`compras_detalle.empresa_codigo` es **NOT NULL sin default**, y
`registrarCompraEnLedger` insertaba las lineas sin ese campo. **Toda compra con
lineas fallaba** con violacion 23502 y el encabezado se borraba: el modulo de
compras estaba 100% roto y devolvia 500.

Ademas `compras_detalle.compra_id` **no tenia FK** a `compras`, asi que la
compensacion (borrar el encabezado si falla el detalle) dejaba lineas huerfanas
para siempre, descuadrando los totales de compras.

Migracion `20261003_fase4_compras_consolidacion`:
- FK `compra_id -> compras(id) ON DELETE CASCADE` (elimina huerfanos).
- FK compuesta `(compra_id, empresa_codigo) -> compras(id, empresa_codigo)`: una
  linea **no puede** quedar asociada a la compra de otro tenant.
- Indice unico `compras(empresa_codigo, numero_orden)`: el correlativo se armaba
  con `COUNT+1` sin unicidad, generaba numeros repetidos en concurrencia.
- FK `compras.empresa_id` y `compras.proveedor_id`.

Verificado en base de datos: linea del mismo tenant aceptada, linea de otro
tenant **rechazada** (23503), y tras borrar el encabezado quedaron **0** huerfanos.

## 11.3 Correcciones de codigo

- Las lineas de compra heredan `empresa_id` y `empresa_codigo` del encabezado.
- El conteo del correlativo usa `empresa_codigo` (NOT NULL) y no `empresa_id`
  (nullable), que reutilizaba numeros.
- Correlativo con reintento: manda el indice unico, si otra peticion gano el
  numero se prueba el siguiente candidato (antes colisionaba en silencio).
- La compensacion borra acotando por `empresa_codigo`.

## 11.4 Vocabulario del libro financiero

Tres asientos tenian `categoria` vacia; todo reporte que desglosara por
categoria los excluia en silencio (100.00 de ingreso y 50.00 de gasto
invisibles). Migracion `20261003_fase4_ledger_categorias` los relabela con la
terminologia que ya usa el codigo (`compras`, `pagos`) y aplica
`sin_clasificar` a cualquier resto.

**No se agrego un CHECK de formato a proposito**: el vocabulario no es uniforme
(el backend escribe `venta`/`General`, Flutter escribe `Fondo inicial`) y
forzar minusculas habria roto el POS de Flutter. Decicion deliberada.

## 11.5 Pruebas

`backend/test-consolidacion.js` existia pero **nunca estuvo en `npm test`** y
tenia **10 de 20 pruebas fallando**. Se corrigieron tres defectos de la propia
prueba (no se relajaron las aserciones):

1. `bloqueDeFuncion` tomaba el primer `{`, que era la desestructuracion de
   parametros, y devolvia una firma de 60 caracteres en vez del cuerpo.
2. Buscaba la ruta `POST /api/pos/venta`, que **no existe**: la canonica es
   `/api/pos/ventas` y la usan Flutter, las pruebas de release y la
   documentacion. Renombrar la ruta habria roto clientes reales, asi que se
   corrigio la prueba.
3. Las aserciones negativas `/JSON\.stringify/` detectaban el **comentario** que
   explica el arreglo, no el defecto. Ahora se afirma sobre codigo sin
   comentarios.

Ademas se midtermutacion cada asercion: 2 eran **vacias** (la del tenant de
lineas daba falso positivo porque `empresa_codigo: tenant` tambien existe en el
encabezado; la de idempotencia solo comprobaba orden de texto). Se
strengtheningaron y ahora **9 de 9 mutaciones se detectan**.

`npm test`: **56/56** (antes 36). Se integro `test-consolidacion.js` y se
expuso `test:e2e` para `test_release_e2e.js`, que tampoco estaba conectado.
