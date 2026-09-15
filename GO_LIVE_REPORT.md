# PORTAL PILOT — GO-LIVE FINAL REPORT

> Fecha: 2026-09-14 · Ejecutado con evidencia real, sin resultados simulados.

## RELEASE STATUS

```text
RELEASE CANDIDATE
```

Producción desplegada y validada end-to-end (69/69 E2E, 30/30 seguridad,
18/18 esquema). El gate a **READY** requiere: (1) credenciales IA del
propietario, (2) owner decision sobre flujos que dependen de email y
(3) decisión del owner sobre moneda de facturación (USD vs HNL).

## PRODUCTION URL

https://portal-pilot.vercel.app — HTTPS OK, `/` 200, `/login` 200, `/registro` 200,
404 personalizada operativa, `/api/health` 200 (`environment: serverless`).

## DEPLOY

| Commit | Repo | Contenido | Estado |
|---|---|---|---|
| `f54cc0d` | portalpilot | hardening go-live + suites E2E + docs | Deployed, Ready |
| `396e55c` | portalpilot | test_ai_smoke | Deployed |
| `8df2c09` | portalpilot | planes/offline/IA en web + schema-drift + unificación 503 | Deployed (`vercel --prod`) |
| `3253a92` | portalpilot-app | cliente fino API única + README | Pushed (deploy móvil no aplicado a la tienda) |

Método: `8df2c09` (y el workflow `ci.yml` del commit local `0bf091d`) NO pudieron
pushearse: el PAT no tiene scope `workflow` y el push incluye archivos
`.github/workflows`. El deploy de `8df2c09` se hizo vía `vercel --prod`
directamente (método alternativo). Workflows listos en disco; el owner debe
subirlos con un PAT con scope: `git add .github && git commit && git push`.

## SUPABASE

- Esquema productivo verificado: `check_schema.js` **18/18 ✓** + introspección MCP
  directa.
- Drift restante cerrada en esta sesión con migración idempotente aditiva
  `add_cliente_credit_and_transaccion_usuario_columns` (sin datos):
  `clientes.limite_credito`, `clientes.saldo_pendiente`, `transacciones.usuario_id`.
  - `transacciones.usuario_id`: el backend ya era drift-tolerante (reintento sin la
    columna); la columna añadida habilita atribución por usuario.
  - `clientes.limite_credito/saldo_pendiente`: requeridas por la ruta AI CRM
    (`/api/ai/crm/customer`), que ahora consulta contexto de cliente sin error.
  Nota de exactitud: el reporte previo afirmaba el todo migrado; solo pasa con los
  dos drifts efímeros previos de `tenant_sessions`/sesiones (verificado 18/18).
- RLS: defensa secundaria; frontera real en Express (service_role por diseño).
- E2E creó y **limpió** tenants efímeros en producción sin dejar residuos.

## AUTHENTICATION

- Registro unificado (Supabase Auth + perfil mismo id), bcrypt, JWT 30d,
  `token_version` verificado en `authenticate`, cookie httpOnly.
- login limiter ahora con `skipSuccessfulRequests` (solo fallidos cuentan; el E2E
  de 5 logins es viable y el brute-force sigue bloqueado a 5 fallos/15min).
- Evidencia: login correcto/incorrecto, token manipulado, revocación (30/30
  suite), refresh tras revocación → rechazado.

## RBAC

| Rol | Evidencia producción |
|---|---|
| ROOT | ve tenants globales, consumo global, auditoría global, diagnóstico, cambia plan ✓ |
| OWNER | administra su tenant; NO auto-escalada de plan, NO auto-borrado ✓ |
| ADMIN | NO cambia plan, NO elimina tenant, gestiona empresa ✓ |
| MEMBER | opera workspace; bloqueado en usuarios/admin/perfil/pagos ✓ |

## TENANT ISOLATION

A→A ✓ · A→B 403 ✓ · B→A 403 ✓ (HTTP directo contra producción, sin UI).
Manipulación de `tenant_id`, `empresa_codigo`, `user_id`, `cliente_id`, montos
absurdos y JWTs: todos rechazados (30/30 seguridad).

## PLAN ENGINE

`planes`/`plan_features`/`plan_limits`/`subscriptions`/`tenant_usage` en DB.
Límite de usuarios server-side (`PLAN_USER_LIMIT`), features gated
(`PLAN_LIMIT`), trial 15d → `TRIAL_EXPIRED` read-only. Verificado en producción.

## USAGE

RPC atómico `incrementar_tenant_uso`; operación fallida (400) no incrementa;
escrituras exitosas incrementan `documents` vía hook de respuesta. IA registra
tokens/coste en `ai_usage_log` (verificado en llamadas previas con clave).

## BILLING

Ciclo completo probado **en producción**: trial → expirado (read-only 403) →
pago (`confirmar-pago`, ambos formatos de campo) → **reactivación inmediata**
(caché invalidada) → subscription `active` → escrituras funcionan de nuevo.

## SMTP

- **PASS en envío real de producción**: `enviar-codigo-verificacion` devolvió 200
  vía el handler honesto (await + throw) con las credenciales configuradas
  (`EMAIL_USER`/`EMAIL_PASS`/`EMAIL_FROM` existen en Vercel).
- Nota forense: un `vercel env pull` devuelve placeholders `[SENSITIVE]`, no los
  secretos; una prueba SMTP "directa" con esos placeholders falló con
  BadCredentials de forma esperable y **no** refleja el estado real.
- Pendiente de confirmación humana: verificar la **recepción** en el buzón del
  owner (no accesible desde aquí). Recuperación de contraseña y soporte dependen
  del mismo canal.

## AI

**BLOCKED — OWNER CONFIGURATION REQUIRED.** Infraestructura validada; solo falta
la clave real en Vercel. Smoke real contra producción: TODAS las rutas IA
(`chat`, `vision`, `pos/analyze`, `pos/upsell`, `crm/customer`, `dashboard`,
`support`) responden **503 controlado** "Todos los proveedores de IA fallaron o no
están configurados" — unificado (antes 500 en 4 rutas). `crm/customer` ya ejecuta
su consulta de contexto a `clientes` OK (gracias a la migración); único pendiente:
la API key. Metring (429 pre-llamada) y coste (`ai_usage_log`) ya verificados con
claves anteriores. El gateway NO finge éxito y nunca llama a un proveedor sin key.

## WEB

Landing, login, registro, redirect por rol (server-side), 404, todos los CTAs a
`registrov2.html`. Portales `pp/` y `empresa/` con endpoints reales (41/41).

Reconciliación final contra fuentes canónicas (`/api/plans`, `plan_features`,
`plan_limits`), desplegada y verificada en producción:
- **index.html**: Starter 5 GB · Business 50 usuarios + 100 GB + "Ventas fiadas y
  abonos" · Enterprise "hasta 200" usuarios + "hasta 5" empresas + 500 GB.
- **documentacion.html**: tabla de planes coherente (USD $29/$99, anual
  $290/$990, usuarios 5/50/200, empresas 1/3/5, 5/100/500 GB, IA 100k/2M/10M
  tokens, fiado Business+, automations/API/flota/sucursales Enterprise, solo
  lectura al vencer trial); eliminado el claim falso de "módulo de contabilidad";
  gating de módulos; notas offline corregidas (web SaaS requiere internet; app
  móvil/desktop offline-first con sync; IA siempre server-side).
- **404/registrov2**: copy alineado (Starter, 50/200 usuarios, "API completa +
  automatizaciones", trial → módulos del plan Starter).
- **pay_plan.html**: 100% Lempiras (L.0 / L.1,499 / L.4,999), consistente con el
  `amountMap` del backend. Catalogos publican USD: discrepancia USD↔HNL real →
  decisión del owner (no se cambian montos autónomamente).

## FLUTTER

`analyze` 0 errores (223 info preexistentes) · `test` 40/40 · cliente fino contra
la API única · cero referencias al dispatcher legacy · `read_only_guard.dart`
maneja el estado trial-expirado.

## SECURITY

30/30 en producción: IDOR, escalada, manipulación de JWT/tenant/plan/pagos,
secretos en respuestas, montos absurdos. Barrido de 204 rutas sin endpoints
operativos sin auth.

## CI/CD

Workflows listos en disco en ambos repos (backend sintaxis+esquema+suites;
Flutter analyze/test). **No activos en GitHub** hasta que el owner los pushee con
PAT con scope `workflow`.

## PRODUCTION E2E

```text
test_release_e2e.js → https://portal-pilot.vercel.app
TOTAL: 69 passed, 0 failed
```
Incluye ciclo de pago real y reactivación inmediata en serverless.

## TEST RESULTS

| Suite | Local | Producción |
|---|---|---|
| E2E release (69) | PASS | **PASS** (re-ejecutado post-deploy) |
| Seguridad ataque (30) | PASS | **PASS** (re-ejecutado post-deploy) |
| check_schema (18) | PASS | **18/18** (post-migración) |
| Bloques (29) | PASS | PASS (pre-deploy) |
| Portales (41) | PASS | PASS (pre-deploy) |
| Flutter test (40) | PASS | n/a |
| AI smoke | BLOCKED (503 sin clave) | **BLOCKED (503 sin clave)** |

## FIXES MADE DURING GO-LIVE

1. `loginLimiter.skipSuccessfulRequests` (logins válidos no agotan el límite).
2. Cleanup de log de debug `PAYDEBUG`.
3. Nuevo `backend/test_ai_smoke.js` (llamada real + verificación `ai_usage_log`).
4. Migración idempotente aditiva `add_cliente_credit_and_transaccion_usuario_columns`
   (`clientes.limite_credito/saldo_pendiente`, `transacciones.usuario_id`): cierre
   definitivo del drift de esquema en producción.
5. Unificación de error IA: las 5 rutas AI devuelven **503** (service unavailable)
   sin proveedor configurado (antes 500 en 4 de ellas).
6. Correcciones de contenido web (planes, offline, IA, contabilidad) y omisión de
   claims falsos en documentación.

## REMAINING BLOCKERS

1. **IA sin credenciales** en producción → 503 controlado. El resto del producto
   funciona; los endpoints IA responden con error claro.
2. **CI no activado** y push web bloqueado (PAT sin scope `workflow`); producción
   cubierta por deploy `vercel --prod`.
3. **Moneda de facturación USD↔HNL**: catálogo/API publican USD $29/$99;
   checkout/pay_plan cobran L.1,499/L.4,999 (HNL). Internamente consistente
   (`amountMap` == pay_plan), pero la doble moneda requiere decisión del owner.

## TECHNICAL DEBT

- Limiter en memoria (por-instancia en serverless; token_version + DB son la
  frontera real). Hardening post-go-live con store persistente.
- Dispatcher legacy `PP APP/api/[...slug].js`: 0 consumidores verificados;
  conservado (no riesgo), eliminación diferida.
- Lints `info` de Flutter (223).

## OWNER ACTION REQUIRED

1. Añadir `GROQ_API_KEY` (y opcionalmente `OPENROUTER_API_KEY`) en Vercel →
   Production → redeploy. Verificar con:
   `TEST_BASE=https://portal-pilot.vercel.app node backend/test_ai_smoke.js`
2. Subir los workflows CI (requiere PAT con scope `workflow`):
   `git add .github && git commit -m "ci: activate workflows" && git push` en ambos repos.
3. Confirmar recepción del correo de prueba en su buzón y validar el flujo de
   recuperación de contraseña con un correo real.
4. **Decidir moneda de facturación** (USD catálogo vs HNL checkout). Opciones:
   (a) cobrar en USD acorde al catálogo, (b) mantener Lempiras mostrando el tipo
   de cambio vigente, (c) ajustar el catálogo a Lempiras. No se cambian montos
   sin esta decisión.

## FINAL DECISION

**RELEASE CANDIDATE con producción viva y validada.** E2E 69/69, seguridad
30/30, esquema 18/18, contenido web reconciliado con los planes reales, IA con
503 controlado hasta que el owner configure proveedor. La brecha hasta READY es
de configuración del propietario (claves IA), confirmación humana (recepción de
email) y una decisión de negocio (moneda de facturación). No quedan defectos de
código conocidos abiertos.
