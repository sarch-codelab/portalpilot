# DOCUMENTO TÉCNICO — PORTAL PILOT

> **ERP comercial e integral de gestión** para pulperías, abarroterías, supermercados, distribuidoras y cadenas multi-sucursal en Honduras.
> Documento técnico oficial. Versión 1.1.

> **Alcance:** cubre la aplicación multi-plataforma (Flutter/Android/iOS/Web/Windows), la plataforma web de administración (`pp/` y `enterprise/`), el backend Express/Vercel, los endpoints serverless de sincronización de la app y la gestión de tenants en Supabase/NocoDB.

---

## 0. Índice

1. [Identidad Corporativa](#1-identidad-corporativa)
2. [Manual de Estilo y Paleta de Colores](#2-manual-de-estilo-y-paleta-de-colores)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Módulos del Sistema](#4-módulos-del-sistema)
5. [Plataforma Web](#5-plataforma-web)
6. [Endpoints del Backend](#6-endpoints-del-backend)
7. [Gestión de Tenants](#7-gestión-de-tenants)
8. [Sincronización de la App (Serverless)](#8-sincronización-de-la-app-serverless)
9. [Seguridad](#9-seguridad)
10. [Despliegue](#10-despliegue)

---

## 1. Identidad Corporativa

### 1.1 Misión
Potenciar la gestión integral de negocios comerciales (pulperías, supermercados, distribuidoras, cadenas multi-sucursal) mediante una plataforma unificada que integra punto de venta, facturación electrónica SAR, inventario multi-bodega, CRM, recursos humanos, contabilidad y membresías, operando con o sin conexión a internet.

### 1.2 Visión
Convertirse en el estándar de software de gestión empresarial multiplataforma (móvil, web, escritorio) en América Latina, combinando la solidez de aplicaciones nativas con inteligencia artificial y nube para automatizar las operaciones diarias de cada negocio comercial.

### 1.3 Propuesta de Valor
- **Un solo sistema para todo el negocio**: 15+ módulos integrados en una única aplicación multiplataforma (Android, iOS, Web, Windows).
- **Funciona offline**: operación continua con sincronización inteligente cuando hay conexión.
- **IA integrada**: asistente basado en Groq API para análisis de ventas, automatización de RPA y decisiones comerciales.
- **Multiempresa y multi-sucursal**: cada cliente opera bajo su propio `empresa_codigo` con aislamiento total de datos.
- **Seguridad por diseño**: cero llaves de API expuestas en el cliente; todo tráfico sensible pasa por proxy seguro.

---

## 2. Manual de Estilo y Paleta de Colores

### 2.1 Paleta Oficial

| Token | Hex | Uso |
|-------|-----|-----|
| `bgPrimary` | `#0D0E15` | Fondo principal (modo oscuro) |
| `bgSecondary` | `#161824` | Fondos secundarios / paneles |
| `bgTertiary` | `#26293B` | Tarjetas y superficies elevadas |
| `accentPurple` | `#7C3AED` | Acción principal / marca |
| `accentCyan` | `#06B6D4` | Enlaces e información |
| `textPrimary` | `#F9FAFB` | Texto principal |
| `textMuted` | `#9CA3AF` | Texto secundario / leyendas |
| `success` | `#10B981` | Éxito / confirmación |
| `danger` | `#EF4444` | Error / alerta |

### 2.2 Reglas de uso
- El morado `#7C3AED` es el color de marca; se reserva para acciones primarias, selección y elementos destacados.
- El cian `#06B6D4` se usa para información, enlaces e indicadores activos.
- Los fondos siguen una jerarquía de 3 niveles: `#0D0E15` (base) → `#161824` (panel) → `#26293B` (tarjeta).
- El éxito siempre se representa en verde `#10B981` y los errores en rojo `#EF4444`.
- Los textos usan `#F9FAFB` para contenido principal y `#9CA3AF` para contenido secundario, manteniendo contraste AA.

### 2.3 Tipografía
- **Fuente principal**: Inter (vía Google Fonts), con pesos 400/500/600/700.
- **Monoespaciada (código/datos técnicos)**: JetBrains Mono / fuente mono del sistema.
- Tamaño base 14 px; títulos en escala 20/24/32 px.

---

## 3. Arquitectura del Sistema

Portal Pilot es una plataforma **híbrida** compuesta por tres superficies que comparten un mismo núcleo de datos:

| Superficie | Ruta / Proyecto | Tecnología | Usuario objetivo |
|------------|-----------------|------------|------------------|
| **App Multi-Plataforma** | `portal_pilot_app/` | Flutter (Android, iOS, Web, Windows) | Negocios comerciales (offline-first) |
| **Admin Web (portal root)** | `pp/` (dashboard, tenants, usuarios, billing) | HTML/CSS/JS + Express API | Administradores de Portal Pilot (superadmin) |
| **Portal Enterprise** | `enterprise/` (dashboard, fleet, automation, team, security) | HTML/CSS/JS + Express API | Clientes enterprise (por tenant) |

```
┌─────────────────────────────┐   HTTPS   ┌────────────────────────────────────────────┐
│  CLIENTE (Escritorio)       │──────────▶│  NUBE (Backend + Datos)                    │
│  Flutter Desktop (Windows)  │           │  Vercel (Express/Node.js)                  │
│  ─────────────────────────  │           │  ────────────────────────────────────      │
│  · 7 módulos de negocio     │           │  · API REST /api/* (server.js)             │
│  · Motor IA + RPA local     │           │  · Endpoints serverless /api/… (app)       │
│  · Cola offline local       │           │  · Proxy seguro /api/ai/groq               │
│  · Base local (SQLite)      │           │  · Autenticación JWT + tenant              │
└─────────────────────────────┘           │  · Supabase (PostgreSQL + RLS)             │
                                          └────────────────────────────────────────────┘
┌─────────────────────────────┐   HTTPS              │
│  WEB (Admin + Enterprise)   │──────────────────────┤
│  · pp/ (portal root)        │                       ▼
│  · enterprise/ (clientes)   │        ┌──────────────────────┐
│  · HTML/CSS/JS estático     │        │  NocoDB              │
│  · Sesión en localStorage   │        │  (usuarios/tenants)  │
└─────────────────────────────┘        └──────────────────────┘
```

### 3.1 Capas y Tecnologías

| Capa | Tecnología | Responsabilidad |
|------|-----------|-----------------|
| Presentación (escritorio) | Flutter Desktop (Windows) | Interfaz nativa, rendimiento y experiencia de escritorio |
| Presentación (web) | HTML5 / CSS3 / JavaScript (vanilla) | Portal admin (`pp/`) y portal enterprise (`enterprise/`) |
| Servicios locales (app) | SQLite / SharedPreferences | Persistencia offline y preferencias |
| API principal (web) | Node.js / Express 5 en Vercel (`backend/server.js`) | Auth, tenants, usuarios, fleet, auditoría, IA |
| API serverless (app) | Node.js en Vercel (`portal_pilot_app/api/`) | Sincronización Supabase de la app de escritorio |
| Base de datos | Supabase (PostgreSQL) | Datos multiempresa con RLS por `empresa_codigo` |
| Directorio de usuarios | NocoDB | Usuarios y tenants del portal web |
| Inteligencia Artificial | Groq API (LLM) | Asistente conversacional y automatización |

### 3.2 Flujo de datos
1. **Web**: el cliente inicia sesión contra `/api/login` y recibe un **JWT** con su `empresa_codigo` y `rol`. La sesión se persiste en `localStorage` (`token`, `userRole`, `userName`, `userApellido`, `userEmail`, `userFoto`, `userBanner`, `empresaCodigo`, `empresaNombre`, `currentAccountId`).
2. **App**: el login autentica contra NocoDB vía `/api/login.js` (serverless) y guarda la sesión con `AuthController` en `SharedPreferences`; todas las consultas a Supabase se filtran por `empresa_codigo` y las políticas **RLS** verifican el claim del JWT.
3. Las llamadas de IA van al proxy `/api/ai/groq` del backend (nunca directo del cliente), que resuelve la llave Groq desde variables de entorno.
4. En modo offline, las operaciones de la app se encolan localmente y se sincronizan al restablecer conexión.

### 3.3 Modo sin conexión (Offline-first)
- Las operaciones de POS, inventario y facturación pueden ejecutarse sin red.
- Los datos se acumulan en la base local y se sincronizan de forma idempotente al volver la conexión.
- La sincronización respeta el `empresa_codigo` de origen para no mezclar tenants.

---

## 4. Módulos del Sistema

Los 7 módulos son configurados por empresa (`empresa_codigo`) y se asignan por rol de usuario.

### 4.1 Punto de Venta (POS) — `#F97316`
- Terminal de cobro rápida con captura de código de barras.
- Historial completo de ventas y reportes de cierre.
- Integrado con Inventario (ProductoList) para stock en tiempo real.

### 4.2 Facturación — `#10B981`
- Emisión de facturas electrónicas y manejo de clientes.
- Detalle de factura, formulario de alta y reportes.
- Preparado para cumplimiento SAR (facturación electrónica).

### 4.3 Inventario — `#F59E0B`
- Productos, bodegas y kardex de movimientos.
- Control de existencias por empresa con consulta en tiempo real.
- Conexión directa con POS y ventas.

### 4.4 CRM — `#06B6D4`
- Gestión de clientes (lista y formulario).
- Ventas y seguimiento comercial.
- Vista unificada del ciclo cliente.

### 4.5 RRHH / Nómina — `#EC4899`
- Empleados (lista y formulario).
- Planilla, recibos de nómina y beneficios.
- Asistencia del personal.

### 4.6 Contabilidad — `#3B82F6`
- Transacciones y estados financieros.
- Reportes por período.
- Trazabilidad de operaciones contables.

---

## 5. Plataforma Web

La web es HTML/CSS/JS estático servido por Vercel, con backend Express (`backend/server.js`). Se divide en dos portales:

### 5.1 Portal de administración (`pp/`) — rol `ROOT`
Accesos raíz de Portal Pilot. Páginas: `welcome.html` (`/inicio`), `dashboard.html` (`/dashboard`), `tenants.html` (`/tenants`), `tenant_detail.html`, `usuarios.html` (`/usuarios`), `usuario_detail.html`, `billing_plans.html`, `global_settings.html`, `perfil.html`, `system_health.html`.
- Guard de acceso: `pp/js/portal-admin-guard.js` (exige rol `ROOT`/`superadmin`).
- JS propios: `pp/js/dashboard.js`, `tenants.js`, `tenant_detail.js`, `usuarios.js`, `usuario_detail.js`, `perfil.js`.

### 5.2 Portal Enterprise (`enterprise/`) — clientes por tenant
Páginas: `dashboard.html`, `inicio.html`, `fleet.html`, `automation.html`, `team.html`, `security.html`, `tenant_detail.html`, `perfil.html`.
- Módulos enterprise: **Flotilla** (vehículos), **Automatizaciones** (RPA con ejecuciones), **Equipo** (usuarios del tenant), **Seguridad** (auditoría y API keys).
- SPA con dashboard que cambia por plan: `js/dashboard.js` + `js/plan-gate.js`.

### 5.3 Páginas públicas y de marca
`index.html` (landing), `login.html`/`login2.html`, `registro.html`/`registrov2.html`, `primer_acceso.html`, `recuperación` vía API, `download.html`, `documentacion.html`, `auditoria.html`, `sd.html`, `sla.html`, `support.html`, `terminos.html`, `privacidad.html`, `cookies.html`, `pay_plan.html`, `404.html`.

### 5.4 Sesión web
- Claves de `localStorage`: `token`, `userRole`, `userName`, `userApellido`, `userEmail`, `userFoto`, `userBanner`, `empresaCodigo`, `empresaNombre`, `currentAccountId` (gestionadas en `js/login.js`).
- `js/plan-gate.js` y `js/sidebar-loader.js` adaptan la navegación según plan y rol.

---

## 6. Endpoints del Backend

Backend Express 5 (`backend/server.js`, ~2948 líneas) desplegado en Vercel. Todas las rutas `/api/*` se redirigen a `backend/server.js` vía `vercel.json`.

### 6.1 Autenticación y cuentas
| Método | Ruta | Protegida | Descripción |
|--------|------|-----------|-------------|
| GET | `/api/health` | No | Estado del servidor |
| GET | `/api/config` | No | Configuración pública (planes, features) |
| GET | `/api/check-email` | No | Verifica si un email ya está registrado |
| GET | `/api/diagnostico` | No | Diagnóstico de conectividad de servicios |
| GET | `/api/test-email` | No | Envío de prueba de correos |
| POST | `/api/registro` | No | Registro de nuevo usuario/tenant (con rate-limit) |
| POST | `/api/enviar-codigo-verificacion` | No | Código de verificación por correo |
| POST | `/api/login` | No | Login (rate-limit `loginLimiter`); JWT `{sub, rol, empresa_codigo, empresa_nombre}` |
| POST | `/api/refresh` | Sí | Renueva JWT (2 h) |
| POST | `/api/notify/onboarding` | Sí | Envía onboarding |
| POST | `/api/notify/activation` | Sí | Envía activación |
| POST | `/api/support-ticket` | No | Crea ticket de soporte |
| POST | `/api/alerta-no-autorizado` | No | Alerta ante intentos no autorizados |
| POST | `/api/recuperacion` | No | Solicitud de recuperación |
| POST | `/api/recuperacion/verificar` | No | Verifica código de recuperación |

### 6.2 Tenants (multiempresa)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/tenants` | Lista tenants (solo `ROOT`) |
| POST | `/api/tenants` | Crea tenant |
| GET | `/api/tenant/:id` | Detalle de tenant |
| PUT | `/api/tenants/:id` | Actualiza tenant |
| DELETE | `/api/tenants/:id` | Elimina tenant |
| GET | `/api/debug/tenants/:id` | Depuración interna de un tenant |

### 6.3 Usuarios
`GET/POST /api/users`, `GET/PUT/DELETE /api/users/:id`, `POST /api/upload` (foto/banner).

### 6.4 Enterprise
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET/POST | `/api/tenant/apikeys` · DELETE `/api/tenant/apikeys/:id` | API keys por tenant |
| POST | `/api/ai/chat` | Chat IA (proxy Groq) |
| GET | `/api/dashboard/summary` | Resumen del dashboard |
| GET/POST | `/api/fleet` · PATCH `/api/fleet/:id` | Vehículos |
| GET | `/api/security/audit` | Auditoría de seguridad |
| GET/POST | `/api/automation` · PATCH `/api/automation/:id` | Automatizaciones |

### 6.5 Variables de entorno
`SUPABASE_URL`, `SUPABASE_KEY` (web), `GROQ_API_KEY`, `JWT_SECRET`, `NOCODB_*` (URL/PAT/base/tabla), credenciales SMTP (Nodemailer).

---

## 7. Gestión de Tenants

- **Identificador de tenant:** `empresa_codigo` (texto, p. ej. `PP-123456`). El valor `ROOT` identifica al superadministrador.
- **Origen de usuarios y tenants:** NocoDB. El login normaliza el campo `empresa_codigo`; si el rol contiene `root`/`superadmin` o el código es `ROOT`, se fuerza el tenant `ROOT`.
- **RLS en Supabase:** cada tabla de negocio lleva `empresa_codigo TEXT NOT NULL` (columna de tenant, sin FK) y las políticas comparan el claim del JWT mediante `jwt_empresa_codigo()`.
- **Aislamiento:** un usuario solo puede leer/escribir filas de su propio `empresa_codigo`; `ROOT` puede administrar todos los tenants desde `pp/`.
- **`empresa_id` (UUID):** columna opcional de compatibilidad; los endpoints serverless la resuelven de forma *best-effort* contra la tabla `empresas` y operan por `empresa_codigo` aunque dicha tabla no exista (evita bloqueos 42P01).

---

## 8. Sincronización de la App (Serverless)

La app Flutter sincroniza contra endpoints serverless en `portal_pilot_app/api/` (Vercel):

| Endpoint | Tabla Supabase | Función |
|----------|----------------|---------|
| `/api/login.js` | NocoDB (`AUTH_BACKEND_URL`/`AUTH_BACKEND_TOKEN`) | Login de la app con fallback de emergencia |
| `/api/clientes` | `clientes` | CRUD de clientes |
| `/api/productos` | `productos` | Upsert masivo de productos/stock |
| `/api/facturas` | `facturas` | CRUD + anulación de facturas |
| `/api/transacciones` | `transacciones` | Movimientos contables |
| `/api/ventas` | `productos` + `facturas` | Cierre POS: descuenta stock y crea factura |
| `/api/ai/groq` | — | Proxy seguro a Groq (la app nunca guarda la llave) |

**Comportamiento del tenant en serverless:**
- Todo POST recibe `empresa_codigo` y lo persiste como columna de tenant.
- `resolverEmpresaId()` (en `api/_lib/supabase.js`) es *best-effort*: si la tabla `empresas` no existe o no hay match, devuelve `null` y la escritura **no se bloquea**; se omite `empresa_id` y se opera por `empresa_codigo`.
- Los GET filtran por `empresa_codigo=eq.`; si la migración de columna está pendiente, fallan a lectura completa con filtro en memoria.

---

## 9. Seguridad

### 9.1 Cero llaves expuestas
- **El cliente no contiene llaves de API**: ni de Supabase ni de Groq.
- El backend usa `process.env.SUPABASE_URL`, `process.env.SUPABASE_KEY` y `process.env.GROQ_API_KEY`.
- El proxy `/api/ai/groq` protege la llamada al LLM desde el frontend.
- Verificación realizada sobre los binarios compilados: sin patrones de secretos (`sk-`, `hf_`, claves JWT) y solo URL pública `https://portalpilot-app.vercel.app`.

### 9.2 Aislamiento multiempresa
- Cada tabla de negocio incluye `empresa_codigo TEXT NOT NULL` (columna de tenant, sin FK rígidas que rompan la instalación).
- Políticas **RLS** de Supabase comparan `empresa_codigo` con el claim `jwt_empresa_codigo()` del JWT: un usuario jamás puede ver ni modificar datos de otra empresa.
- Los índices únicos compuestos (`empresa_codigo, placa`, etc.) evitan colisiones entre tenants.

### 9.3 Migraciones idempotentes
- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` y `CREATE OR REPLACE FUNCTION`.
- Se pueden re-ejecutar sin errores ni duplicados en cualquier entorno (dev / prod).
- Validación de sintaxis con parser SQL (PostgreSQL) antes de cada despliegue.

### 9.4 Buenas prácticas
- Autenticación con JWT y roles (`Owner`, `Admin`, `Miembro`).
- Auditoría por empresa (`auditoria`): log de accesos y operaciones sensibles.
- Gestión de API keys por tenant con revocación (`api_keys`).

---

## 10. Despliegue

### 10.1 Cliente de escritorio
```powershell
flutter build windows --release
# Salida: build\windows\x64\runner\Release\PortalPilotWorkspace.exe
```

### 10.2 Backend web
```bash
npm install
vercel deploy        # entorno: production
# Variables: SUPABASE_URL, SUPABASE_KEY, GROQ_API_KEY, JWT_SECRET, NOCODB_*, SMTP_*
```

### 10.3 Endpoints serverless de la app
```bash
cd portal_pilot_app/api
vercel deploy
# Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_BACKEND_URL, AUTH_BACKEND_TOKEN, NOCODB_BASE_ID, NOCODB_TABLE_NAME
```

### 10.4 Base de datos (Supabase SQL Editor)
1. Ejecutar `supabase/migracion_sync.sql` (tablas de sync: facturas, transacciones, clientes, productos, ventas, notas_estado).
2. Ejecutar `supabase/migracion_enterprise.sql` (api_keys, vehiculos, auditoria, automatizaciones, automation_runs).
3. Verificar en la consola de Supabase que las políticas RLS quedaron activas por `empresa_codigo`.

---

> Documento generado para el repositorio **Portal Pilot**. Prohibida su redistribución sin autorización.
