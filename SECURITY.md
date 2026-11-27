# Política de Seguridad — Portal Pilot

© 2026 Portal Pilot. Todos los derechos reservados.

La seguridad de los datos empresariales, fiscales (SAR) y de facturación de cada organización es nuestra máxima prioridad.

---

## Versiones Soportadas

| Versión / Rama | Estado de Soporte |
| --- | --- |
| `main` (`v1.0.7+`) | ✅ Soportada con actualizaciones de seguridad |
| `< 1.0.7` | ❌ Sin soporte |

---

## Cómo Reportar una Vulnerabilidad

**Por favor, no reportes vulnerabilidades de seguridad mediante issues públicos en GitHub.**

Si descubres un fallo de seguridad, fuga potencial de datos o comportamiento inesperado:

1. Envía un correo con los detalles a **seguridad@portalpilot.hn** (copia a **legal@portalpilot.hn**).
2. Incluye:
   - Descripción clara del problema e impacto potencial.
   - Pasos reproducibles, endpoint/ruta afectada o captura/POC.
   - Evita acceder, modificar o exfiltrar datos reales de otros tenants durante la verificación.
3. Tiempos estimados de atención:
   - **Confirmación de recepción**: dentro de las primeras **48 horas**.
   - **Evaluación y plan de mitigación**: dentro de **5 días hábiles**.
   - **Parche en producción**: priorizado según severidad (críticas/altas de forma inmediata).

---

## Controles de Seguridad Implementados

### Aislamiento Multi-Tenant y Base de Datos (Supabase)
- **RLS estricto (`service_role_only`)**: todas las tablas operativas y de negocio tienen Row Level Security habilitado con acceso restringido exclusivamente al backend (`SUPABASE_SERVICE_ROLE_KEY`).
- **Privilegios revocados**: `anon`, `authenticated` y `PUBLIC` no poseen permisos de lectura ni escritura directa en tablas operativas, vistas ni RPCs de `public` (`ALTER DEFAULT PRIVILEGES` activo); únicamente conservan `SELECT` de solo lectura en el catálogo público de planes (`planes`, `plan_features`, `plan_limits`, `plan_modulos`, `modulos_cotizador`).
- **Vistas seguras**: `empresas_filiales` y `v_fuentes_canonicas` operan con `security_invoker = true`.
- **Storage endurecido**: los buckets `uploads`, `productos` y `portal-pilot-assets` bloquean subidas anónimas directas (`INSERT` solo vía backend con `service_role`), con límite de **10 MB** y validación MIME exclusiva de imágenes (`jpeg`, `png`, `webp`, `gif`).

### Autenticación, Sesiones y Cifrado
- **JWT firmado (`HS256`) + `token_version`**: verificación obligatoria de versión de token para revocación inmediata de sesiones ante cambio de contraseña o compromiso.
- **2FA (TOTP)** con códigos de respaldo y validación en `/api/login/2fa`.
- **Registro protegido**: verificación previa por código OTP al correo antes de crear cuenta y límite de plan `starter` en el registro público.
- **Passwords**: hash con `bcryptjs` (mínimo 8 caracteres).
- **Integraciones**: secretos almacenados cifrados con AES-256-GCM (`INTEGRATION_ENCRYPTION_KEY`) y verificación de estado OAuth2 firmado.
- **Webhooks de pago**: validación de firma/secreto (`BILLING_WEBHOOK_SECRET`) en confirmación de pagos.

### API, Transporte y Cliente Web
- **Integridad ERP (`backend/erpIntegrity.js`)**: cálculo autoritativo de precios, impuestos ISV y descuentos en servidor, más movimientos atómicos de stock (`kardex`) sin confiar en totales del cliente.
- **Helmet CSP, CORS estricto en producción** y **rate limiting** en autenticación (`loginLimiter`), recuperación, correos y confirmaciones de pago.
- **Protección de áreas privadas (`pp/` y `empresa/`)**: guard server-side por cookie `HttpOnly` + verificación de rol/tenant (`ROOT` vs empresa).
- **Bloqueo de recursos internos**: rutas `/backend/`, `/scripts/`, `/supabase/`, `*.sql`, `*.md`, `/.env*` y plantillas internas bloqueadas para no servirse como estáticos.
- **Cero secretos en el código**: credenciales alojadas únicamente en variables de entorno de Vercel y GitHub Actions.
