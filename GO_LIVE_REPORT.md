# PORTAL PILOT — GO-LIVE FINAL REPORT

> Fecha: 2026-09-14 · Ejecutado con evidencia real, sin resultados simulados.

## RELEASE STATUS

```text
RELEASE CANDIDATE → casi READY
```

Producción desplegada y validada end-to-end (69/69 E2E, 30/30 seguridad). El gate a
**READY** requiere exclusivamente: (1) credenciales IA del propietario y (2) owner
decision sobre flujos que dependen de email.

## PRODUCTION URL

https://portal-pilot.vercel.app — HTTPS OK, `/` 200, `/login` 200, `/registro` 200,
404 personalizada operativa, `/api/health` 200 (`environment: serverless`).

## DEPLOY

| Commit | Repo | Contenido | Estado |
|---|---|---|---|
| `f54cc0d` | portalpilot | hardening go-live + suites E2E + docs | Deployed, Ready |
| `396e55c` | portalpilot | test_ai_smoke | Deployed |
| `3253a92` | portalpilot-app | cliente fino API única + README | Pushed (deploy móvil no aplicado a la tienda) |

Método: integración Git → Vercel. Los workflows de GitHub Actions no pudieron
pushearse (PAT sin scope `workflow`); quedan en disco en ambos repos, listos para
que el owner los suba con una cuenta con scope: `git add .github && git commit && git push`.

## SUPABASE

- Esquema productivo verificado (`check_schema.js` ✓) + introspección MCP directa.
- Drifts ya migradas previamente (`clientes.limite_credito/saldo_pendiente`,
  `transacciones.usuario_id`, `tenant_sessions.user_agent`).
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

**BLOCKED — OWNER CONFIGURATION REQUIRED.**
Smoke test real contra producción: tenant efímero → `/api/ai/chat` → **503
controlado** "Todos los proveedores de IA fallaron o no están configurados".
No hay `GROQ_API_KEY` ni `OPENROUTER_API_KEY` en Vercel. El gateway NO finge
éxito y NO llama a proveedores sin clave. Comportamiento con cuota agotada
(429 pre-llamada) ya verificado previamente con clave real.

## WEB

Landing, login, registro, redirect por rol (server-side), 404, todos los CTAs a
`registrov2.html`. Portales `pp/` y `empresa/` con endpoints reales (41/41).

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
| E2E release (69) | PASS | **PASS** |
| Seguridad ataque (30) | PASS | **PASS** |
| Bloques (29) | PASS | PASS (pre-deploy) |
| Portales (41) | PASS | PASS (pre-deploy) |
| Flutter test (40) | PASS | n/a |
| AI smoke | BLOCKED (503 sin clave) | **BLOCKED (503 sin clave)** |

## FIXES MADE DURING GO-LIVE

1. `loginLimiter.skipSuccessfulRequests` (logins válidos no agotan el límite).
2. Cleanup de log de debug `PAYDEBUG`.
3. Nuevo `backend/test_ai_smoke.js` (llamada real + verificación `ai_usage_log`).

## REMAINING BLOCKERS

1. **IA sin credenciales** en producción → 503 controlado. El resto del producto
   funciona; los endpoints IA responden con error claro.
2. **CI no activado** (limitación de scope del PAT).

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

## FINAL DECISION

**RELEASE CANDIDATE con producción viva y validada.** La brecha hasta READY es
estrictamente de configuración del propietario (claves IA) y confirmación humana
de recepción de email. No quedan defectos de código conocidos abiertos.
