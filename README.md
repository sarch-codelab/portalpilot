# Portal Pilot

> **Plataforma SaaS Multi-Empresa con IA en la Nube** — ERP comercial integral para pulperías, abarroterías, supermercados, distribuidoras y cadenas multi-sucursal. Facturación electrónica SAR (Honduras), inventario multi-bodega, POS con códigos de barras, CRM, membresías y gestión comercial completa con asistentes virtuales potenciados por Groq API.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://portal-pilot.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Groq](https://img.shields.io/badge/Groq-API%20IA-FF6B35?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)
[![License](https://img.shields.io/badge/License-Proprietary-FF6B35?style=for-the-badge)](LICENSE)
[![Made in Honduras](https://img.shields.io/badge/Made%20in-Honduras%20🇭🇳-0051BA?style=for-the-badge)](https://portal-pilot.vercel.app)

---

## 🎯 Visión General

**Portal Pilot** es una plataforma empresarial híbrida que combina:

| Superficie | Tecnología | Usuario Objetivo |
|------------|------------|------------------|
| **App Multi-Plataforma** | Flutter (Android, iOS, Web, Windows) | Negocios comerciales (offline-first) |
| **Portal Admin (`pp/`)** | HTML/CSS/JS + Express API | Superadministradores (rol `ROOT`) |
| **Portal Empresa (`empresa/`)** | HTML/CSS/JS + Express API | Administración avanzada por tenant |
| **Landing & Auth** | HTML/CSS/JS estático (Vercel) | Público general |

> **Demo en vivo:** [https://portal-pilot.vercel.app](https://portal-pilot.vercel.app)

---

## ✨ Características Principales

### 🤖 IA en la Nube — Groq API
Asistentes virtuales integrados en **cada módulo** con latencia ultra-baja. Análisis inteligente, generación de reportes, automatización de tareas y respuestas contextuales en milisegundos. El proxy `/api/ai/chat` protege la API key — **nunca expuesta al cliente**.

### 📦 10 Módulos de Negocio Especializados
| Módulo | Color | Estado | Descripción |
|--------|-------|--------|-------------|
| **Facturación SAR** | `#10B981` | ✅ Completo | Facturación electrónica lista para SAR (Honduras), clientes, reportes |
| **Inventario** | `#F59E0B` | ✅ Completo | Productos, bodegas, kardex, stock tiempo real, conexión POS |
| **Contabilidad** | `#3B82F6` | 🔄 Frontend | Transacciones, estados financieros, trazabilidad contable |
| **RRHH / Nómina** | `#EC4899` | 🔄 Frontend | Empleados, planilla, recibos, beneficios, asistencia |
| **CRM** | `#06B6D4` | ✅ Completo | Clientes, ventas, seguimiento comercial, ciclo unificado |
| **POS** | `#F97316` | ✅ Completo | Terminal cobro rápida, código barras, historial, cierre caja |
| **Canal Tradicional** | `#F59E0B` | ✅ Completo | Pulperías y mercaditos: fiado, cobros, rutas de reparto |
| **Canal Moderno** | `#10B981` | ✅ Completo | Supermercados y cadenas: multi-sucursal, transferencias, consolidado |
| **Sector Retail** | `#06B6D4` | ✅ Completo | Precios por canal, promociones, inventario por tienda |
| **Membresías** | `#8B5CF6` | ✅ Completo | Modelos club (tipo PriceSmart): socios, puntos, renovaciones |

> **Nota**: Contabilidad y RRHH/Nómina tienen interfaz web completa pero sus endpoints backend están en desarrollo. Los demás módulos tienen API REST completa en `backend/server.js`.

### 🔐 Control de Acceso Enterprise
- **3 Roles**: `Owner` (propietario completo), `Administrador` (gestión parcial), `Miembro` (acceso limitado)
- **Permisos por módulo**: Control granular quién accede a Facturación, Inventario, Contabilidad, etc.
- **2FA (TOTP)**: Autenticación de dos factores obligatoria/opcional
- **RLS en Supabase**: Aislamiento total de datos por `empresa_codigo` a nivel de base de datos

### 🏢 Multi-Empresa (Multi-Tenant)
- Un solo portal para gestionar **todas tus empresas** con códigos únicos (`PP-123456`)
- Portales separados, planes personalizados, registro de actividad por tenant
- Planes **Business** y **Enterprise** permiten múltiples tenants bajo una cuenta

### 📊 Dashboard en Tiempo Real
- Métricas de uso, actividad de usuarios, estadísticas del asistente IA
- Visualización centralizada de todos los procesos empresariales
- Auto-actualización via polling/WebSockets

### 🌐 Arquitectura Cloud Moderna
```
┌─────────────────────┐     HTTPS      ┌─────────────────────────────────────┐
│   CLIENTE           │ ─────────────▶ │   NUBE (Backend + Datos)            │
│  ┌───────────────┐  │                │  ┌───────────────────────────────┐  │
│  │ App Flutter   │  │                │  │ Vercel (Express/Node.js 5)    │  │
│  │ (Windows)     │  │                │  │  • API REST /api/*            │  │
│  │ 7 módulos     │  │                │  │  • Serverless /api/… (app)    │  │
│  │ IA + RPA local│  │                │  │  • Proxy seguro /api/ai/chat   │  │
│  │ SQLite local  │  │                │  │  • JWT Auth + tenant          │  │
│  └───────────────┘  │                │  └───────────────────────────────┘  │
└─────────────────────┘                │  ┌───────────────────────────────┐  │
┌─────────────────────┐     HTTPS      │  │ Supabase (PostgreSQL + RLS)   │  │
│   WEB (Admin +     │ ─────────────▶ │  │  • Multi-tenant por           │  │
│   Enterprise)       │                │  │    empresa_codigo             │  │
│  • HTML/CSS/JS      │                │  │  • Políticas RLS por JWT      │  │
│  • localStorage     │                │  └───────────────────────────────┘  │
└─────────────────────┘                └─────────────────────────────────────┘
```

---

## 🛠 Stack Tecnológico

### Backend
| Capa | Tecnología | Versión | Propósito |
|------|------------|---------|-----------|
| **Runtime** | Node.js | 18+ | Serverless en Vercel |
| **Framework** | Express | 5.x | API REST principal |
| **Base de Datos** | Supabase (PostgreSQL) | 15+ | Datos multi-tenant con RLS |
| **IA** | Groq API | - | LLM ultra-rápido (Llama 3, Mixtral) |
| **Auth** | JWT + bcryptjs | - | Tokens firmados, hash contraseñas |
| **Email** | Nodemailer | 9.x | SMTP transaccional |
| **Seguridad** | Helmet, CORS, Rate-limit | - | Headers, CORS, protección DDoS |

### Frontend (Web)
| Tecnología | Uso |
|------------|-----|
| **HTML5 / CSS3 / JS Vanilla** | Portal admin (`pp/`), Empresa (`empresa/`), Landing, Auth |
| **CSS Variables** | Sistema de diseño (modo oscuro, paleta corporativa) |
| **Syne / DM Sans** | Tipografía principal (Syne headings, DM Sans body) |
| **localStorage** | Persistencia de sesión (JWT, roles, tenant) |

### App de Escritorio
| Tecnología | Uso |
|------------|-----|
| **Flutter Desktop** | Windows nativo (offline-first) |
| **SQLite** | Base de datos local |
| **SharedPreferences** | Sesión y preferencias |
| **Cola offline** | Sincronización idempotente al reconectar |

---

## 🚀 Inicio Rápido

### Prerrequisitos
- Node.js 18+
- Cuenta en [Vercel](https://vercel.com)
- Cuenta en [Supabase](https://supabase.com)
- Cuenta en [Groq](https://console.groq.com) (API key)

### 1. Clonar e Instalar
```bash
git clone https://github.com/sarch-codelab/portalpilot.git
cd portalpilot
npm install
```

### 2. Configurar Variables de Entorno
Crear `.env` en la raíz (basado en `.env.example`):
```env
# Backend
JWT_SECRET=tu_jwt_secreto_super_seguro_64_chars_minimo

# Supabase
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# Groq AI
GROQ_API_KEY=gsk_tu_groq_api_key

# Email (Nodemailer)
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=tu_usuario
SMTP_PASS=tu_password
SMTP_FROM="Portal Pilot <noreply@tudominio.com>"

# Frontend
FRONTEND_URL=https://portal-pilot.vercel.app
```

### 3. Base de Datos (Supabase)
Ejecutar en **Supabase SQL Editor** en orden:
```sql
-- 1. Migración unificada completa
\i supabase/migracion_unificada_completa.sql

-- 2. Migración enterprise (RLS)
\i supabase/migracion_enterprise.sql
```
Verificar que las políticas **RLS** quedaron activas por `empresa_codigo`.

### 4. Desarrollo Local
```bash
npm run dev
# Sirve en http://localhost:5173
```

### 5. Despliegue en Vercel
```bash
vercel deploy --prod
# Configurar variables de entorno en Vercel Dashboard
```

---

## 📁 Estructura del Proyecto

```
portalpilot/
├── api/                          # Endpoints serverless (2 archivos)
│   ├── ping-search-engines.js   # Notificación a buscadores
│   └── support-ticket.js        # Tickets de soporte
│
├── backend/                      # Backend Express principal (Vercel)
│   ├── server.js                # 5690 líneas - API completa (/api/*)
│   ├── supabaseClient.js        # Cliente Supabase (service role)
│   └── package.json             # Dependencias backend
│
├── pp/                          # Portal Admin (rol ROOT)
│   ├── dashboard.html           # Dashboard principal
│   ├── tenants.html             # Gestión tenants
│   ├── usuarios.html            # Gestión usuarios
│   ├── billing_plans.html       # Planes y facturación
│   ├── global_settings.html     # Configuración global
│   ├── system_health.html       # Salud del sistema
│   ├── analytics.html           # Analíticas
│   ├── auditoria.html           # Auditoría del sistema
│   ├── bots_rpa.html            # Bots RPA
│   ├── perfil.html              # Perfil admin
│   ├── tenant_detail.html       # Detalle tenant
│   ├── usuario_detail.html      # Detalle usuario
│   └── welcome.html             # Bienvenida
│
├── empresa/                      # Portal web avanzado por empresa
│   ├── dashboard.html           # Dashboard por plan
│   ├── fleet.html               # Flotilla (vehículos)
│   ├── automation.html          # Automatizaciones RPA
│   ├── team.html                # Equipo (usuarios tenant)
│   ├── security.html            # Auditoría + API Keys
│   ├── api_keys.html            # Gestión API Keys
│   ├── inicio.html              # Inicio empresa
│   ├── perfil.html              # Perfil empresa
│   └── tenant_detail.html       # Detalle tenant
│
├── index.css                    # Estilos landing (110KB)
├── index.html                   # Landing page principal
├── css/                         # Estilos por módulo (18 archivos)
│   ├── login.css                # Autenticación
│   ├── dashboard.css            # Dashboard
│   ├── styles.css               # Compartidos
│   └── ...                      # billing, tenants, perfil, etc.
│
├── js/                          # JS por módulo (22 archivos)
│   ├── login.js                 # Auth landing
│   ├── plan-gate.js             # Gate por plan/rol
│   ├── sidebar-loader.js        # Navegación dinámica
│   ├── dashboard.js             # Lógica dashboard
│   ├── billing_plans.js         # Lógica planes
│   └── ...                      # tenants, usuarios, perfil, etc.
│
├── supabase/                     # Migraciones SQL (7 archivos)
│   ├── migracion_enterprise.sql # Tablas portal web (RLS)
│   ├── migracion_unificada_completa.sql
│   └── ...                      # migraciones comerciales, seguridad, etc.
│
├── scripts/
│   └── post-deploy-ping.js      # Ping post-despliegue
│
├── EMAIL PORTAL PILOT/          # Plantillas de email transaccional
├── img/                         # Imágenes del proyecto
├── uploads/                     # Directorio de subidas
│
├── index.html                   # Landing page
├── login.html                   # Login
├── registrov2.html              # Registro
├── pay_plan.html                # Selección de plan y pago
├── documentacion.html           # Documentación de usuario
├── 404.html                     # Página no encontrada
├── cookies.html / privacidad.html / terminos.html / sla.html
├── support.html / download.html / primer_acceso.html
│
├── vercel.json                  # Configuración despliegue y rutas
├── package.json                 # Dependencias del proyecto
├── .env.example                 # Variables de entorno (ejemplo)
├── robots.txt / sitemap.xml
└── DOCUMENTO_TECNICO_PORTAL_PILOT.md
```

---

## 🔌 API Reference

### Autenticación y Cuentas
| Método | Endpoint | Protegida | Descripción |
|--------|----------|-----------|-------------|
| `GET` | `/api/health` | No | Estado del servidor |
| `GET` | `/api/config` | No | Config pública (planes, features) |
| `POST` | `/api/registro` | No | Registro usuario/tenant (rate-limit) |
| `POST` | `/api/login` | No | Login → JWT `{sub, rol, empresa_codigo}` |
| `POST` | `/api/refresh` | Sí | Renueva JWT (2h) |
| `POST` | `/api/recuperacion` | No | Solicitud recuperación contraseña |

### Tenants (Multi-Empresa) — Solo `ROOT`
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/tenants` | Lista todos los tenants |
| `POST` | `/api/tenants` | Crea nuevo tenant |
| `GET` | `/api/tenant/:id` | Detalle de tenant |
| `PUT` | `/api/tenants/:id` | Actualiza tenant |
| `DELETE` | `/api/tenants/:id` | Elimina tenant |

### Enterprise (por Tenant)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET/POST` | `/api/tenant/apikeys` | API Keys del tenant |
| `DELETE` | `/api/tenant/apikeys/:id` | Revoca API Key |
| `POST` | `/api/ai/chat` | Chat IA (proxy Groq) |
| `GET` | `/api/dashboard/summary` | Resumen dashboard |
| `GET/POST` | `/api/fleet` | Vehículos (flotilla) |
| `PATCH` | `/api/fleet/:id` | Actualiza vehículo |
| `GET` | `/api/security/audit` | Auditoría seguridad |
| `GET/POST` | `/api/automation` | Automatizaciones RPA |
| `PATCH` | `/api/automation/:id` | Actualiza automatización |

### Negocio (todos los módulos) — `backend/server.js`
Todos los endpoints son manejados por `backend/server.js` vía enrutamiento de `vercel.json` (`/api/* → server.js`).

| Módulo | Endpoints | Función |
|--------|-----------|---------|
| **Usuarios** | `GET/POST /api/users`, `GET/PUT/DELETE /api/users/:id` | CRUD usuarios |
| **2FA** | `POST /api/login/2fa`, `/api/security/2fa/setup`, `/2fa/confirm`, `/2fa/disable` | Autenticación dos factores |
| **Productos** | `GET/POST /api/productos`, `PUT/DELETE /api/productos/:id` | CRUD productos |
| **Kardex** | `GET /api/kardex` | Movimientos de inventario |
| **Bodegas** | `GET/POST /api/bodegas` | Gestión de bodegas |
| **Clientes** | `GET/POST /api/clientes`, `PUT/DELETE /api/clientes/:id` | CRUD clientes |
| **Facturas** | `GET/POST /api/facturas`, `DELETE /api/facturas/:id` | Facturación SAR |
| **POS** | `POST /api/pos/ventas` | Cierre de venta POS |
| **Ventas Fiadas** | `GET/POST /api/ventas-fiadas` | Canal tradicional (fiado) |
| **Abonos** | `GET/POST /api/abonos` | Pagos a cuentas fiadas |
| **Sucursales** | `GET/POST /api/sucursales` | Multi-sucursal |
| **Transferencias** | `GET/POST /api/transferencias` | Transferencias entre bodegas |
| **Proveedores** | `GET/POST /api/proveedores` | Gestión de proveedores |
| **Compras** | `GET/POST /api/compras` | Órdenes de compra |
| **Listas de Precios** | `GET/POST /api/listas-precios` | Precios por canal |
| **Promociones** | `GET/POST /api/promociones` | Promociones y descuentos |
| **Rutas** | `GET/POST /api/rutas` | Rutas de reparto |
| **Visitas** | `GET/POST /api/visitas` | Registro de visitas |
| **Membresías** | `GET/POST /api/membresias/planes`, `/socios`, `/socios/:id/puntos` | Club de socios |
| **Notificaciones** | `GET/POST /api/notificaciones` | Alertas del sistema |
| **Pagos** | `POST /api/confirmar-pago`, `/api/tigo-money-reference` | Procesamiento de pagos |

### IA (Groq API) — `backend/server.js`
| Endpoint | Función |
|----------|---------|
| `POST /api/ai/chat` | Chat general (proxy seguro) |
| `POST /api/ai/vision` | Análisis de imágenes |
| `GET /api/ai/barcode/:code` | Lookup código de barras |
| `POST /api/ai/dashboard` | Análisis de dashboard |
| `POST /api/ai/pos/analyze` | Análisis de ventas POS |
| `POST /api/ai/pos/upsell` | Sugerencias upsell |
| `POST /api/ai/crm/customer` | Análisis de cliente |
| `POST /api/ai/support` | Asistente de soporte |

---

## 🔐 Seguridad

### Cero Llaves Expuestas
- **Nunca** se incluyen claves de Supabase ni Groq en el cliente
- Backend usa `process.env.SUPABASE_KEY`, `process.env.GROQ_API_KEY`
- Proxy `/api/ai/chat` protege llamadas al LLM desde frontend
- Verificado en binarios compilados: sin patrones `sk-`, `hf_`, JWT secrets

### Aislamiento Multi-Tenant (RLS)
```sql
-- Cada tabla de negocio incluye:
empresa_codigo TEXT NOT NULL  -- Columna de tenant (sin FK rígida)

-- Políticas RLS comparan claim del JWT:
CREATE POLICY tabla_all ON tabla FOR ALL USING (
  empresa_codigo = jwt_empresa_codigo()
);

-- Helper claim JWT:
CREATE OR REPLACE FUNCTION jwt_empresa_codigo()
RETURNS TEXT AS $$
  SELECT NULLIF(auth.jwt() ->> 'empresa_codigo', '');
$$ LANGUAGE SQL STABLE;
```
**Resultado**: Un usuario **jamás** puede leer/escribir datos de otra empresa. `ROOT` administra todos los tenants desde `pp/`.

### Migraciones Idempotentes
- `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- `DROP POLICY IF EXISTS`, `CREATE OR REPLACE FUNCTION`
- Re-ejecutables sin errores en cualquier entorno (dev/prod)
- Validación sintaxis SQL (PostgreSQL) pre-despliegue

### Buenas Prácticas Implementadas
- ✅ JWT con roles (`Owner`, `Administrador`, `Miembro`)
- ✅ Auditoría por empresa (`auditoria`): log accesos y operaciones sensibles
- ✅ Gestión API Keys por tenant con revocación (`api_keys`)
- ✅ Rate limiting en auth (`loginLimiter`: 5 req/15min)
- ✅ Helmet CSP configurado, CORS restrictivo
- ✅ Bcrypt para hash de contraseñas
- ✅ TLS 1.3 en tránsito (Vercel + Supabase)

---

## 💰 Planes y Precios (HNL — Lempiras)

| Característica | **Prueba** Gratis 15 días | **Business** L1,499/mes | **Enterprise** L4,999/mes |
|----------------|--------------------------|-------------------------|---------------------------|
| Usuarios | Hasta 5 | Hasta 15 | Ilimitados |
| Empresas | 1 | Hasta 3 | Ilimitadas |
| Facturación SAR | ✅ | ✅ | ✅ |
| Inventario Multi-Almacén | ✅ | ✅ | ✅ |
| Contabilidad | Básica | Completa | Completa + API |
| Nómina Hondureña | — | ✅ | ✅ |
| IA Portal Pilot | Uso básico | Uso generoso | Avanzada / personalizada |
| Bots RPA | — | Automatizaciones estándar | Ilimitados |
| Auditoría / Logs | ✅ | ✅ | ✅ |
| Soporte | Email | Email prioritario | Prioritario 24/7 |

> Precios en Lempiras (HNL). Sin tarjeta de crédito para el plan Prueba. El plan Prueba incluye 15 días de acceso completo; al vencerse, se debe elegir Business o Enterprise para continuar usando el sistema.

---

## 📱 App de Escritorio (Flutter)

```bash
cd portal_pilot_app
flutter pub get
flutter build windows --release
# Salida: build\windows\x64\runner\Release\PortalPilotWorkspace.exe
```

**Características offline-first:**
- POS, Inventario, Matrícula funcionan sin red
- Datos se acumulan en SQLite local
- Sincronización idempotente al restablecer conexión
- Respeto estricto a `empresa_codigo` de origen

---

## 🧪 Testing y Calidad

```bash
# Lint (si configurado)
npm run lint

# Typecheck (si TypeScript)
npm run typecheck

# Tests (si configurados)
npm test
```

> **Nota**: El proyecto usa JavaScript vanilla (ES6+) sin TypeScript ni framework de testing configurado actualmente. Se recomienda añadir ESLint + Prettier + Vitest.

---

## 📚 Documentación

- **[Documento Técnico Completo](DOCUMENTO_TECNICO_PORTAL_PILOT.md)** — 332 líneas: arquitectura, módulos, endpoints, seguridad, despliegue
- **[Documentación Web](documentacion.html)** — Guía de usuario en la landing
- **[SLA](sla.html)** — Acuerdo de nivel de servicio
- **[Privacidad](privacidad.html)** / **[Términos](terminos.html)** / **[Cookies](cookies.html)**

---

## 🤝 Contribuir

1. Fork del repositorio
2. Crear rama: `git checkout -b feature/nueva-funcionalidad`
3. Commit: `git commit -m 'feat: descripción clara'`
4. Push: `git push origin feature/nueva-funcionalidad`
5. Abrir Pull Request

### Convenciones de Commit
```
feat:     Nueva funcionalidad
fix:      Corrección de bug
docs:     Documentación
style:    Formato (sin cambios de lógica)
refactor: Refactorización
test:     Tests
chore:    Mantenimiento
```

---

## 👥 Equipo

| Rol | Nombre | Especialidad |
|-----|--------|--------------|
| **CTO & IA Lead** | Joseph Sanchez | FullStack, IA Cloud, Groq API |
| **CEO & Fundador** | Amy Fajardo | Arquitectura multi-empresa, Cloud Infra, Estrategia |
| **Head of Security** | Sofia Guzman | Ciberseguridad, 2FA, Cloud Auth, Roles granulares |
| **Desarrollo & Automatización** | Jose Carcamo | Backend API, Automatizaciones RPA, Trazabilidad |

---

## 📄 Licencia

**Código propietario** — Todos los derechos reservados © 2026 Portal Pilot.

> Prohibida su redistribución, copia o modificación sin autorización escrita del equipo de Portal Pilot.

---

## 🌐 Enlaces

| Enlace | Descripción |
|--------|-------------|
| [🌐 Portal Pilot Live](https://portal-pilot.vercel.app) | Demo en producción |
| [📖 Documentación](https://portal-pilot.vercel.app/documentacion.html) | Guía de usuario |
| [📥 Descargar App](https://portal-pilot.vercel.app/download.html) | App Windows (Flutter) |
| [🐛 Reportar Issue](https://github.com/sarch-codelab/portalpilot/issues) | Bugs y sugerencias |
| [💬 Soporte](https://portal-pilot.vercel.app/support.html) | Centro de ayuda |

---

## 🇭🇳 Hecho en Honduras

**Portal Pilot** nace en Honduras para resolver la gestión empresarial real de pulperías, abarroterías, supermercados, distribuidoras y cadenas multi-sucursal de la región. Combina cumplimiento local (Facturación SAR), infraestructura cloud global y IA de vanguardia.

> **¿Listo para automatizar tu empresa?**  
> [Registrar Empresa Gratis](https://portal-pilot.vercel.app/registrov2.html) · [Ver Planes](https://portal-pilot.vercel.app/#pricing)

---

<div align="center">

**Portal Pilot** — Tu Negocio Inteligente

[![GitHub Stars](https://img.shields.io/github/stars/sarch-codelab/portalpilot?style=social)](https://github.com/sarch-codelab/portalpilot)
[![GitHub Forks](https://img.shields.io/github/forks/sarch-codelab/portalpilot?style=social)](https://github.com/sarch-codelab/portalpilot/fork)
[![Twitter](https://img.shields.io/twitter/follow/portalpilot?style=social)](https://twitter.com/portalpilot)

</div>
