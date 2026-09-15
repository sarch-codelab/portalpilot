# RELEASE_v1.0.7 — Portal Pilot

| Campo | Valor |
|---|---|
| **Versión** | `1.0.7` |
| **Fecha** | 2026-09-15 |
| **Commit web** | `ef0383c6aa891aea940113ddeca0be1ba59fb8ee` (PP Web) |
| **Commit app** | `269663436d87ead597eb8b5af87bcfa3e52ba101` (PP APP) |
| **Deployment** | `portal-pilot-25ls93wmt-josephsanchez-5437s-projects.vercel.app` — alias `https://portal-pilot.vercel.app` — readyState **READY** |
| **Tag** | `v1.0.7` (apunta al commit desplegado) |
| **Estado** | **READY — RELEASE FROZEN** |

## Cambios (v1.0.7)
Release de **consolidación / freeze** sobre la baseline v1.0.6 (declarada READY). Sin funcionalidades nuevas.

- Versionado coherente: `pubspec.yaml` `0.1.7+4` → `1.0.7+5`; versión visible (`launch_screen.dart`) `v1.0.0` → `v1.0.7`; manifest de backup (`backup_manager.dart`) `1.0.0` → `1.0.7`; `package.json` web `1.0.0` → `1.0.7`.
- `CHANGELOG.md` creado (Keep a Changelog).
- `GO_LIVE_FINAL_REPORT.md` actualizado (estructura de release §27), conservando la evidencia de la baseline v1.0.6.
- Secret scan de repos: sin exposiciones; claves únicamente como variables de entorno en Vercel.
- Higiene de repo: `.venv/` añadido a `.gitignore` (entorno local, no forma parte del release).
- La baseline v1.0.6 quedó congelada con tag local `v1.0.6`.

## Tests (v1.0.7)
| Suite | Resultado |
|---|---|
| Release E2E | 70/70 (producción) |
| Portales | 41/41 |
| Bloques | 29/29 |
| Seguridad | 30/30 |
| Schema (check_schema.js) | PASS |
| AI Smoke (Groq real + metering) | PASS |
| Flutter test | 40/40 |
| Flutter analyze | 0 errores (223 infos, sin nuevos) |
| Build Windows release | PASS (`PortalPilotWorkspace.exe`) |
| SMTP | **SEND PASS** (8/8) — recepción en buzón = confirmación humana pendiente |
| Verificación post-deploy (health, login, registro, clientes, productos, ventas-crm, facturas, IA chat, POS, logout) | PASS |

## Pendientes operacionales
- **CI/GitHub**: el push de rama mantiene `refusing to allow a Personal Access Token to create or update workflow ... without workflow scope`. No es blocker de producto: `CI publication blocked by GitHub PAT workflow scope`.
- **Confirmación humana**: entrega de correos SMTP en buzón `portalpilot.hn@gmail.com` (inbox/spam).
- Hardening opcional de headers web (`X-Frame-Options`, `X-Content-Type-Options`, CSP) — backlog.

## Transición
La baseline **v1.0.7** queda congelada como referencia estable de producción. Cualquier funcionalidad nueva entra en `v1.1.x` sin modificar silenciosamente este baseline.