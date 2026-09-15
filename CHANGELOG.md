# CHANGELOG — Portal Pilot

Formato basado en [Keep a Changelog]. La versión 1.0.7 es una release de **consolidación / freeze** de la baseline v1.0.6 (declarada READY en la misión GO_LIVE_FINAL_TOTAL); no introduce funcionalidades nuevas.

## [v1.0.7] - 2026-09-15

Release de consolidación, versionado y congelamiento de la baseline de producción. Sin funcionalidades nuevas.

### Fixed
- Versionamiento inconsistente de la app Flutter: `pubspec.yaml` `0.1.7+4` -> `1.0.7+5` (build metadata coherente, versionCode incremental).
- Versión visible en `launch_screen.dart` mostrada como `v1.0.0` -> `v1.0.7`.
- Versión del manifest de backup (`backup_manager.dart`, campo `app_version`) `1.0.0` -> `1.0.7`.
- `package.json` (web) `1.0.0` -> `1.0.7` (referencia de versionado del proyecto).

### Infrastructure
- `CHANGELOG.md` creado.
- `RELEASE_v1.0.7.md` y `GO_LIVE_FINAL_REPORT.md` actualizados (estructura §27 de la mission de release).
- Baseline congelada: tag local `v1.0.6`; release tag `v1.0.7` apuntando al commit desplegado.
- CI: publicación de workflows bloqueada por scope del PAT (sin scope `workflow`) — ver sección operacional del release report.

### Security
- Secret scan completo de repos (GROQ_API_KEY, HF_TOKEN, OPENROUTER_API_KEY, SUPABASE_SERVICE_ROLE, JWT, SMTP, bearer tokens): **sin exposiciones**. Claves solo en variables de entorno de Vercel (producción intacta).

### Validation
- Release E2E: 70/70 (producción post-deploy)
- Portales: 41/41
- Bloques: 29/29
- Seguridad: 30/30
- Schema (check_schema.js): PASS
- AI Smoke (Groq real + metering): PASS
- Flutter: 40/40 · Analyze: 0 errores
- Health producción: PASS

## [v1.0.6] - 2026-09-14

Baseline declarada READY (GO_LIVE_FINAL_TOTAL). Ver `GO_LIVE_REPORT.md` y `GO_LIVE_FINAL_REPORT.md` (sección v1.0.6) para evidencia completa: IA Groq real + metering, moneda HNL, pipeline Ventas CRM, fixes case-sensitivity de tenant y metodo_pago de transacciones.