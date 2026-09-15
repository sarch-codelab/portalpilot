# GO_LIVE_FINAL_REPORT — Portal Pilot (v1.0.7)

## RELEASE
- **Version:** `1.0.7`
- **Environment:** `Production`
- **URL:** `https://portal-pilot.vercel.app`
- **Commit:** `ef0383c6aa891aea940113ddeca0be1ba59fb8ee` (PP Web) / `269663436d87ead597eb8b5af87bcfa3e52ba101` (PP APP)
- **Deployment:** `portal-pilot-25ls93wmt-josephsanchez-5437s-projects.vercel.app` — readyState READY (alias `portal-pilot.vercel.app`)
- **Tag:** `v1.0.7`

---

## TEST RESULTS

| Suite | Result |
| --- | --- |
| Release E2E | 70 passed / 0 failed |
| Portales | 41 OK / 0 FALLOS |
| Bloques | 29 OK / 0 FALLOS |
| Seguridad | 30 OK / 0 FALLOS |
| Schema | PASS |
| AI Smoke | PASS (Groq real + metering) |
| Flutter | 40/40 |
| Analyze | 0 errores |
| Production Health | PASS (health/login/registro/clientes/productos/ventas-crm/facturas/IA/POS/logout) |

---

## CHANGES

Release de **consolidacion / freeze** de la baseline v1.0.6 (READY). Sin funcionalidades nuevas.

- **Fixed (versionado):** pubspec.yaml 0.1.7+4 -> 1.0.7+5; launch_screen.dart v1.0.0 -> v1.0.7; backup_manager.dart app_version 1.0.0 -> 1.0.7; package.json web 1.0.0 -> 1.0.7.
- **Infrastructure:** CHANGELOG.md creado; RELEASE_v1.0.7.md creado; tag de congelamiento v1.0.6 (baseline) y tag de release v1.0.7; .venv/ en .gitignore.
- **Security:** secret scan de repos sin exposiciones; claves solo en variables de entorno de Vercel.

---

## KNOWN OPERATIONAL ITEMS

- CI: `CI publication blocked by GitHub PAT workflow scope` (push de rama rechazado; tag local creado).
- `HUMAN MAILBOX CONFIRMATION`: recepcion de correos SMTP (SEND PASS 8/8) en buzon portalpilot.hn@gmail.com.
- Hardening opcional de headers web (X-Frame-Options, X-Content-Type-Options, CSP) — backlog.

---

## RELEASE DECISION

# READY

---

# BASELINE v1.0.6 — Go-Live anterior (evidencia conservada)
# GO_LIVE_FINAL_REPORT — Portal Pilot

> Fecha: 2026-09-14/15 · Producto: **Portal Pilot** (web + Flutter) · Entorno: **PRODUCCIÓN** (`https://portal-pilot.vercel.app`)

## FINAL RELEASE DECISION: **READY** ✅

Evidencia real en producción sobre el último build desplegado completa la misión `GO_LIVE_FINAL_TOTAL`. No queda ningún BLOQUEADOR técnico de producto.
Pendientes operacionales (ver §7) no condicionan el lanzamiento del software.

---

## 1. Resultado de suites (producción, último build)

| Suite | Resultado |
|---|---|
| `test_release_e2e.js` (TEST_BASE prod) | ✅ **70 passed / 0 failed** |
| `test_portales_v2.js` | ✅ **41 OK / 0 FALLOS** |
| `test_bloques.js` | ✅ **29 OK / 0 FALLOS** |
| `test_seguridad_ataque.js` | ✅ **30 OK / 0 FALLOS** |
| `test_ai_smoke.js` | ✅ **PASS** — Groq real `openai/gpt-oss-20b`, respuesta correcta, usage en `ai_usage_log` (tokens 110, coste 0.000032 USD) |
| `check_schema.js` | ✅ Tablas/columnas verificadas en Supabase prod (incl. `transacciones.usuario_id`, `ai_usage_log`, `ventas_crm`) |
| Flutter `flutter analyze` | ✅ 0 errores |
| Flutter `flutter test` | ✅ 40/40 |
| Probeta CRUD `/api/ventas-crm` | ✅ 13/13 (POST→GET→PATCH estado+monto→resumen→DELETE→DB limpio→normalización tenant) |
| Probes funcionales extendidos | ✅ transacciones sin `metodo_pago` → 201; TIGO `L.0.00` (starter/HNL); `clientes` expone `limite_credito` y `saldo_pendiente`; `GET /api/clientes` resuelve tenant; registro normaliza `empresaCodigo` a UPPER |

## 2. Incidentes detectados y corregidos en esta sesión (evidencia, no inventados)

1. **IA — falso bloqueador resuelto**: el 401 previo correspondía a una clave antigua; `GROQ_API_KEY` actual funciona (`/api/ai/chat` 200, LLM real). Se mejoró `logAIUsage` (created_at explícito + reintento + fallos no bloquean respuesta) y se corrigió el smoke (columnas reales `model/tokens_total/cost_estimated`). IA + metering funcionan de extremo a extremo.
2. **Ventas CRM era mock local (SharedPreferences)**: se construyó el backend real — tabla `ventas_crm` (migración aplicada en prod con RLS por `empresa_codigo`) + rutas `GET/POST /api/ventas-crm`, `GET /api/ventas-crm/resumen`, `PATCH/DELETE :id` con aislamiento por tenant + auditoría. Flutter (`venta_form.dart`, `ventas_home.dart`) ahora usa `ApiService.instance` y ya **no persiste ventas en preferencias locales**.
3. **Case-sensitivity del tenant**: `resolverEmpresaSupabase` normalizaba a UPPERCASE pero el registro guardaba `empresaCodigo` tal cual → cualquier tenant con código mixto recibía `404 Empresa no encontrada` en **todas** las rutas scoped (clientes, transacciones, etc.). Corregido en origen: `/api/registro` normaliza el código a UPPER (únicos) y el resolver tolera datos legacy. Regresión completa verde tras el fix.
4. **API `transacciones` 500 sin `metodo_pago`**: el handler insertaba `''` que viola el CHECK del DB; ahora envía `null` cuando no se provee (NULL pasa la constraint). Regresión verde.

## 3. Estado funcional principal
- **Moneda operativa HNL** (§12): `/api/plans` → `moneda: HNL`, `precio_mensual_hnl: 0` (starter). Web: **botón único "Facturación mensual · en Lempiras (HNL)"**, sin toggle anual, subtítulos fijos ("Todos los módulos incluidos" / "Enterprise"). Precios L1,499 / L4,999. Verificado en vivo con Playwright (sin residuos de "−15%" / "descuento anual").
- **TIGO Money**: referencia POST genera `L.0.00` para starter (HNL) e instrucciones correctas.
- **Seguridad `saved_password` (Flutter)**: purgado al cargar, flujo biométrico ya no inyecta/guarda contraseña en claro; 40/40 tests.
- **Seguridad extra (web/API)**: sin leaks de secretos en HTML raíz; errores de validación sin stack traces; 404 JSON (no HTML); CORS no refleja `Origin`+credentials externos; `Strict-Transport-Security` presente. `test_seguridad_ataque` 30/30.
- **Docs**: 0 menciones residuales de "proyecto educativo/demo/prototipo".
- **Performance**: raíz 80ms, `/api/health` 86ms, `/api/plans` 383ms (TTFB, Vercel serverless).

## 4. Despliegues
- Producción actualizada (último request: vercel --prod, `readyState: READY`, alias `https://portal-pilot.vercel.app`) — incluye rutas ventas-crm, fixes de case-sensitivity, metodo_pago, moneda HNL y logAIUsage.
- Migración Supabase `crear_ventas_crm_pipeline` aplicada en prod (`ugadesptdtbrzczxjtdx`).

## 5. Momentos de evidencia almacenados
Suites y probetas: `test_release_e2e.js`, `test_portales_v2.js`, `test_bloques.js`, `test_seguridad_ataque.js`, `test_ai_smoke.js`, `check_schema.js`, probeta `ventas-crm` (13/13), probes funcionales extendidos — todos contra producción. Reporte previo: `GO_LIVE_REPORT.md`.

## 6. Notas / observaciones (no bloqueantes)
- `transacciones.usuario_id` existe (nullable) pero el POST no propaga el usuario actual → oportunidad futura de auditoría de autoría, no afecta funcionalidad.
- Headers opcionales de hardening ausentes: `X-Frame-Options`, `X-Content-Type-Options`, `referrer-policy`, CSP → recomendación de hardening, no blocker.
- CORS `Access-Control-Allow-Origin: *` en GET (sin cookies; auth vía header Bearer) → aceptable, se puede restringir a orígenes propios si se desea.

## 7. Pendientes operacionales (fuera del alcance técnico de producto)
- **CI/push**: el PAT de GitHub no tiene scope `workflow` (commits locales `0bf091d`, `b35305d`) → `CI BLOCKED — GitHub credential lacks workflow scope`. Solución: regenerar token con scope `workflow` y `git push`.
- **SMTP**: envíos marcados como éxito requieren **confirmación humana** de recepción en el buzón del owner.
- Hardening de headers opcional (opcional, en backlog).

## 8. Conclusión
Portal Pilot queda **READY** para usuarios reales: funcionalidad crítica, seguridad, IA con metering y el nuevo pipeline de Ventas CRM verificados con evidencia en producción, con regresión completa verde tras cada corrección. Los únicos pendientes son operacionales (credencial CI y confirmación humana de correo).