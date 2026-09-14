# Portal Pilot — Estado Real del Backend (Fuente de Verdad Técnica)
> Actualizado: 2026-09-14. Este documento describe el estado **verificado** del
> backend (`PP Web/backend/server.js`), no el deseado. Cada afirmación fue
> comprobada contra el código y contra pruebas HTTP ejecutadas.

---

## 1. API única (decisión de arquitectura)

`PP Web/backend/server.js` (≈8.800 líneas, ~130 rutas `/api/*`) es la **única API canónica**.

- La app Flutter (`PP APP`) consume `https://portal-pilot.vercel.app` (verificado en
  `lib/Shared/services/api_service.dart` y `db_service.dart`).
- Los portales web (`pp/`, `empresa/`) consumen el mismo servidor.
- `PP APP/api/[...slug].js` es **legacy sin consumidor** (ver CONSOLIDACION_API.md). No se elimina,
  pero no se replica ninguna ruta nueva allí. La app NO usa `/api/ai/groq`.

## 2. Cadena de seguridad (obligatoria en cada ruta)

```
Flutter/Web → API → Authentication → Authorization → Tenant scope → Plan entitlement → DB
```

| Capa | Implementación |
|---|---|
| Autenticación | `authenticate`: JWT firmado con `JWT_SECRET`, **verifica `token_version` contra DB** (caché 30s por usuario) → `401 SESSION_REVOKED` si fue revocado |
| Autorización global | `requireRoot` (pp/*: ROOT/superadmin del código o rol) |
| Autorización tenant | `requireTenantAdmin` (owner/admin) · `requireOwner` (owner/ceo) · `isTrueOwner` (acciones críticas) |
| Scope de tenant | `effectiveTenantCode`: el código SIEMPRE sale del JWT; lo que envíe el cliente se ignora salvo para ROOT. `withTenantScope` obliga el filtro `empresa_codigo` |
| Plan entitlement | `requirePlanFeature(feature)`: consulta entitlements (DB → tablas `planes`/`plan_features`/`plan_limits` con fallback a constantes) + límites server-side contra `tenant_usage` |
| Trial vencido | Middleware global: escrituras → `403 TRIAL_EXPIRED` (modo solo lectura). Whitelist: auth, pago, export |
| Rate limiting | login 5/15min · recuperación 5/15min · alertas 10/15min · **confirmar-pago 30/hora** |

## 3. Revocación de sesiones (token_version) — FUNCIONAL

1. Login firma JWT con `token_version: N` (versión actual del usuario).
2. `POST /api/users/:id/revoke-sessions` incrementa `usuarios.token_version` y limpia la caché.
3. `authenticate` compara la versión del token contra la DB → token viejo = `401 SESSION_REVOKED`.
4. Re-login emite token con la versión vigente.
Verificado por `test_seguridad_ataque.js` (revocación + operación + re-login).

## 4. Sesiones reales

- Login registra en `tenant_sessions` (IP, dispositivo, ubicación aprox.).
- `GET /api/empresa/sessions` (owner/admin): sesiones del tenant, con join a usuarios.
- `GET /api/users/:id/sessions`: sesiones **reales** del usuario (antes devolvía registros simulados; corregido).
- `DELETE /api/empresa/sessions/:id`: revoca una sesión concreta (propia siempre; ajena solo Owner).

## 5. Plan Engine y usage metering

- Fuentes: tablas `planes`, `plan_features`, `plan_limits` (editables desde pp) con fallback a
  constantes locales si la tabla no existe.
- Planes canónicos: `starter` (trial 15 días), `business`, `enterprise` (+ `custom`).
- Trial: si `plan=starter` y `created_at` supera 15 días → estado `expired` (solo lectura).
- Metering: `registrarUsoTenant(tenant, recurso, cantidad)` → RPC `incrementar_tenant_uso`
  (atómico, upsert on conflict) con fallback de lectura+upsert.
- Recursos medidos: `ai_tokens`, `api_requests`, `storage`, `users`, `documents`, `automations`.
- Escrituras operativas (productos, facturas, POS, sync, etc.) incrementan `documents` vía hook de
  respuesta (solo 2xx; nunca bloquea).
- Límite IA server-side: `assertAiTokenBudget` se ejecuta ANTES de llamar al proveedor → si el tenant
  agotó `ai_tokens` del mes, responde `429 AI_TOKEN_LIMIT_REACHED` sin gastar del proveedor.
- Endpoints: `GET/POST /api/tenant/usage` (tenant) · `GET /api/usage` (ROOT, global).

## 6. Billing

- Tabla `subscriptions` (estado del ciclo): `trial | active | expired | cancelled | suspended`,
  `trial_ends_at`, `current_period_*`, `cancel_at_period_end`, `proveedor_pago`.
- `GET /api/tenant/subscription`: estado formal desde `subscriptions` (fallback derivado de tenant).
- `POST /api/confirmar-pago`: valida plan, aplica el nuevo estado `active` al tenant y a
  `subscriptions`, registra `billing_payments`, audita el intento (`pago_confirmado_intento`) y el
  pago (`pago_confirmado`). Público (el flujo de pago ocurre sin sesión) pero con rate-limit 30/h.
- Cambiar plan vía `PUT /api/tenants/:id` está BLOQUEADO para no-ROOT (se audita el intento): el plan
  solo cambia por pago confirmado o por ROOT.

## 7. AI Gateway

- Proxy único server-side: `/api/ai/chat|vision|barcode/:code|dashboard|pos/analyze|pos/upsell|crm/customer|support`
  → `callAIGateway` → Groq → fallback OpenRouter. Claves SOLO en el servidor (`GROQ_API_KEY`,
  `OPENROUTER_API_KEY`).
- Modelos corregidos: chat/fast `openai/gpt-oss-20b`; **vision `meta-llama/llama-4-scout-17b-16e-instruct`**
  (el ID anterior `qwen/qwen3.6-27b` no existe en Groq y degradaba TODA la ruta vision al fallback).
- Logging por llamada en `ai_usage_log`: tenant, usuario, provider, modelo, función, tokens in/out/total,
  coste estimado, duración, éxito/error. Además suma `ai_tokens` y `api_requests` en `tenant_usage`.
- `requirePlanFeature('ia')` + presupuesto mensual (`assertAiTokenBudget`).
- Consulta: `GET /api/ai/usage` y `/api/ai/costs` (ROOT global; tenant solo lo suyo), `/api/ai/limits`
  (tenant), `/api/ai/providers` (ROOT, sin exponer claves).

## 8. Email (SMTP)

- Config **100% por entorno**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
  (compatibles `EMAIL_USER`/`EMAIL_PASS`). `EMAIL_FROM` opcional.
- Punto único de envío `enviarCorreo()`: si faltan credenciales lanza error con código
  `SMTP_NOT_CONFIGURED` → el backend responde `503` con mensaje accionable (nunca silencio).
- `/api/diagnostico` reporta si SMTP y proveedores IA están configurados.
- `/api/test-email` solo fuera de producción.

## 9. Registro unificado (sin usuarios huérfanos)

- Flujo canónico: `registrov2.html` → `POST /api/registro` → el backend crea la cuenta en Supabase Auth
  **y** el perfil en `usuarios` con el MISMO id (más tenant, suscripción y auditoría).
- El viejo signUp client-side de `login.html`/`js/login.js` fue deshabilitado (creaba usuarios Auth
  huérfanos con id distinto al perfil, imposibles de usar para login).
- `GET /api/config` ya no expone la URL del proyecto (respuesta neutra por compatibilidad).

## 10. Protección de áreas (server-side)

- `protectPortalArea`: sin sesión no se sirve NI el HTML de `pp/` ni `empresa/`.
  - `pp/*` solo ROOT. `empresa/*` solo Owner/Admin/ROOT (**Member → redirect a descarga del Workspace**).
  - Cookie httpOnly `pp_session` + fallback `Authorization: Bearer`.

## 11. Endpoints de producto (Anexo B del blueprint) — TODOS EXISTEN

`/api/auth/status` · `/api/tenant/usage` (GET/POST) · `/api/usage` · `/api/ai/usage|costs|providers|limits`
· `/api/plans` · `/api/plans/:id/features` (GET/PUT, ROOT) · `/api/auditoria` (ROOT) · `/api/bots` (ROOT)
· `/api/analytics` (ROOT) · `/api/tenant/subscription` · `/api/empresa/entitlements|roles|modules|sessions|
billing/documents|security/events|activity|profile|support/tickets|integrations` · `requireOwner`.

## 12. Esquema Supabase (producción verificada)

Migración `consolidated_pending_backend_objects` aplicada (2026-09-14). Verificación automática:
`node backend/check_schema.js` — TODAS las comprobaciones en verde:
`usuarios.token_version`, `tenant_sessions`, `seguridad_eventos`, `tenant_integrations`,
`api_keys.clave_prefix`, `planes`, `plan_features`, `plan_limits`, `tenant_usage`, `subscriptions`,
`ai_usage_log`, `billing_payments`, RPC `incrementar_tenant_uso`, `tenants.area/tamano`.

## 13. Variables de entorno (producción: Vercel → PP Web)

| Variable | Uso | Estado |
|---|---|---|
| `JWT_SECRET` | firmar JWT | ✅ definida |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | DB | ✅ definidas |
| `GROQ_API_KEY` | IA (primario) | ⚠️ configurable — si falta, fallback a OpenRouter o 503 controlado |
| `OPENROUTER_API_KEY` | IA (fallback) | ⚠️ opcional |
| `SMTP_HOST/PORT/SECURE/USER/PASS` (o `EMAIL_USER/PASS`) | email | ⚠️ **PENDIENTE del propietario** — sin esto, correos devuelven 503 SMTP_NOT_CONFIGURED |
| `EMAIL_FROM` | remitente | opcional (default SMTP_USER) |
| `FRONTEND_URL` | CORS allowlist | opcional en prod (defaults correctos) |

Nunca en el cliente: service keys, JWT secret, claves de proveedor IA/SMTP.

## 14. Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| `503 SMTP_NOT_CONFIGURED` | Faltan credenciales SMTP | Definir variables y redeploy |
| `401 SESSION_REVOKED` | El usuario revocó sus sesiones | Re-login (esperado) |
| `429 AI_TOKEN_LIMIT_REACHED` | Cuota mensual IA agotada | Upgrade de plan o esperar periodo |
| `403 TRIAL_EXPIRED` | Trial 15 días vencido | Pagar plan (`pay_plan.html` → confirmar-pago) |
| `403 PLAN_LIMIT` / `PLAN_USER_LIMIT` / `PLAN_LIMIT_REACHED` | Feature o límite del plan | Upgrade |
| `429` en login | Rate limit 5/15min | Esperar ventana |
| Correos no llegan pero API responde | SMTP mal configurado | Revisar `/api/diagnostico` (ROOT) |

## 15. Auditoría de release (2026-09-14)

Resultados de la auditoría de release con suites E2E (test_release_e2e.js, 69 checks),
seguridad (test_seguridad_ataque.js, 30), bloques (test_bloques.js, 29) y portales
(test_portales_v2.js, 41) — **169/169 en verde** contra Supabase productivo.

Correcciones aplicadas durante el release audit:

| # | Severidad | Hallazgo | Fix |
|---|---|---|---|
| 1 | ALTO | `POST /api/confirmar-pago` solo leía `empresaCodigo` (camelCase): pagos enviados como `empresa_codigo` no activaban el plan | Acepta ambos formatos; además invalida `_entitlementsCache` para que el read-only por trial expirado se levante al instante |
| 2 | MEDIO | `POST /api/enviar-codigo-verificacion`, `/api/support-ticket` y `/api/tigo-money-reference` eran públicos sin rate-limit (email-bombing) | Nuevo `emailLimiter` (10/hora por IP); verificado 429 en la 11ª petición |
| 3 | MEDIO | Cobro de la caché de entitlements (TTL 30s) retrasaba hasta 30s la reactivación post-pago | Invalidación explícita en el pago |

Verificaciones de la auditoría (sin cambios de código):

- **Matriz E2E de cliente real**: registro → onboarding → login → dashboard →
  usuarios → productos → clientes → factura → nota de crédito → venta POS →
  consumo (`tenant_usage`) → auditoría. Cada paso persiste en DB productiva.
- **Aislamiento multi-tenant vía HTTP**: A→A permitido; A→B y B→A rechazados (403).
- **RBAC**: ROOT (global, plan, diagnóstico, auditoría), OWNER (sin auto-escalada
  de plan, sin borrar tenant), ADMIN (sin cambiar plan, sin borrar tenant),
  MEMBER (opera workspace; bloqueado en usuarios/admin/pagos).
- **Trial/billing**: trial expirado → escritura 403 `TRIAL_EXPIRED` + lectura OK;
  pago → reactivación inmediata de escrituras + subscription `active`.
- **Usage**: operación fallida (400) no incrementa consumo; escrituras exitosas
  incrementan `documents` vía hook de respuesta (sin doble contabilización).
- **API sweep (204 rutas)**: sin rutas operativas sin auth; 7 públicas revisadas
  individualmente (3 con token interno, 2 con limiter propio, 2 ahora con limiter).
- **Web**: CTAs de landing → `registrov2.html`; redirect post-login por rol con
  enforcement server-side; `404.html` configurada.
- **Flutter**: apunta a la API central (`portal-pilot.vercel.app`); cero referencias
  al dispatcher legacy `api/[...slug].js`; 40/40 tests; analyze sin errores.

## 16. CI

`.github/workflows/ci.yml` ejecuta: sintaxis del backend, verificación de esquema
(`check_schema.js`), suites HTTP (`test_bloques`, `test_portales_v2`,
`test_seguridad_ataque` vía `workflow_dispatch` contra entorno provisionado) y
Flutter (`analyze --no-fatal-infos` + `test`). Los secrets necesarios:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_BASE` (opcional).
