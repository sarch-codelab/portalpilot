# Portal Pilot

> **Plataforma SaaS Multi-Empresa con IA en la Nube** — Gestión empresarial integral para PyMES y centros educativos. Facturación electrónica SAR (Honduras), inventario, contabilidad, RRHH, CRM, POS y educación en una sola plataforma con asistentes virtuales potenciados por Groq API.

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://portal-pilot.vercel.app)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Groq](https://img.shields.io/badge/Groq-API%20IA-FF6B35?style=for-the-badge&logo=groq&logoColor=white)](https://groq.com)
[![NocoDB](https://img.shields.io/badge/NocoDB-Airtable%20Alternative-0078D4?style=for-the-badge&logo=nocodb&logoColor=white)](https://nocodb.com)
[![License](https://img.shields.io/badge/License-Proprietary-FF6B35?style=for-the-badge)](LICENSE)
[![Made in Honduras](https://img.shields.io/badge/Made%20in-Honduras%20🇭🇳-0051BA?style=for-the-badge)](https://portal-pilot.vercel.app)

---

## 🎯 Visión General

**Portal Pilot** es una plataforma empresarial híbrida que combina:

| Superficie | Tecnología | Usuario Objetivo |
|------------|------------|------------------|
| **App de Escritorio** | Flutter Desktop (Windows) | Negocios y centros educativos (offline-first) |
| **Portal Admin (`pp/`)** | HTML/CSS/JS + Express API | Superadministradores (rol `ROOT`) |
| **Portal Enterprise (`enterprise/`)** | HTML/CSS/JS + Express API | Clientes por tenant (multi-empresa) |
| **Landing & Auth** | HTML/CSS/JS estático (Vercel) | Público general |

> **Demo en vivo:** [https://portal-pilot.vercel.app](https://portal-pilot.vercel.app)

---

## ✨ Características Principales

### 🤖 IA en la Nube — Groq API
Asistentes virtuales integrados en **cada módulo** con latencia ultra-baja. Análisis inteligente, generación de reportes, automatización de tareas y respuestas contextuales en milisegundos. El proxy `/api/ai/groq` protege la API key — **nunca expuesta al cliente**.

### 📦 7+ Módulos de Negocio Especializados
| Módulo | Color | Descripción |
|--------|-------|-------------|
| **Facturación SAR** | `#10B981` | Facturación electrónica lista para SAR (Honduras), clientes, reportes |
| **Inventario** | `#F59E0B` | Productos, bodegas, kardex, stock tiempo real, conexión POS |
| **Contabilidad** | `#3B82F6` | Transacciones, estados financieros, trazabilidad contable |
| **RRHH / Nómina** | `#EC4899` | Empleados, planilla, recibos, beneficios, asistencia |
| **CRM** | `#06B6D4` | Clientes, ventas, seguimiento comercial, ciclo unificado |
| **POS** | `#F97316` | Terminal cobro rápida, código barras, historial, cierre caja |
| **Educación** | `#8B5CF6` | Notas con rúbricas, matrícula, asistencia, IA educativa (extracción PDF) |

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
│  │ IA + RPA local│  │                │  │  • Proxy seguro /api/ai/groq  │  │
│  │ SQLite local  │  │                │  │  • JWT Auth + tenant          │  │
│  └───────────────┘  │                │  └───────────────────────────────┘  │
└─────────────────────┘                │  ┌───────────────────────────────┐  │
┌─────────────────────┐     HTTPS      │  │ Supabase (PostgreSQL + RLS)   │  │
│   WEB (Admin +     │ ─────────────▶ │  │  • Multi-tenant por           │  │
│   Enterprise)       │                │  │    empresa_codigo             │  │
│  • HTML/CSS/JS      │                │  │  • Políticas RLS por JWT      │  │
│  • localStorage     │                │  └───────────────────────────────┘  │
└─────────────────────┘                │  ┌───────────────────────────────┐  │
                                       │  │ NocoDB                        │  │
                                       │  │  • Usuarios & tenants portal  │  │
                                       │  └───────────────────────────────┘  │
                                       └─────────────────────────────────────┘
```

---

## 🛠 Stack Tecnológico

### Backend
| Capa | Tecnología | Versión | Propósito |
|------|------------|---------|-----------|
| **Runtime** | Node.js | 18+ | Serverless en Vercel |
| **Framework** | Express | 5.x | API REST principal |
| **Base de Datos** | Supabase (PostgreSQL) | 15+ | Datos multi-tenant con RLS |
| **Directorio** | NocoDB | - | Usuarios y tenants del portal web |
| **IA** | Groq API | - | LLM ultra-rápido (Llama 3, Mixtral) |
| **Auth** | JWT + bcryptjs | - | Tokens firmados, hash contraseñas |
| **Email** | Nodemailer | 8.x | SMTP transaccional |
| **Seguridad** | Helmet, CORS, Rate-limit | - | Headers, CORS, protección DDoS |

### Frontend (Web)
| Tecnología | Uso |
|------------|-----|
| **HTML5 / CSS3 / JS Vanilla** | Portal admin (`pp/`), Enterprise (`enterprise/`), Landing, Auth |
| **CSS Variables** | Sistema de diseño (modo oscuro, paleta corporativa) |
| **Inter / JetBrains Mono** | Tipografía principal y monoespaciada |
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
- Cuenta en [NocoDB](https://nocodb.com) (API token)

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
NOCODB_URL=https://app.nocodb.com
NOCODB_API_TOKEN=tu_token_nocodb

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
-- 1. Tablas de sincronización (app Flutter)
\i supabase/migracion_sync.sql

-- 2. Tablas Enterprise (portal web)
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
├── api/                          # Endpoints serverless (app Flutter)
│   ├── _lib/supabase.js         # Cliente Supabase + helper tenant
│   ├── login.js                 # Login app (NocoDB + fallback)
│   ├── matriculas/              # CRUD matrículas (educación)
│   ├── notas/                   # Notas estado (JSONB)
│   ├── clientes/                # CRUD clientes
│   ├── productos/               # Upsert masivo productos/stock
│   ├── facturas/                # CRUD + anulación facturas
│   ├── transacciones/           # Movimientos contables
│   ├── ventas/                  # Cierre POS: stock + factura
│   └── ai/groq.js               # Proxy seguro Groq API
│
├── backend/                      # Backend Express principal (Vercel)
│   ├── server.js                # 2948 líneas - API completa
│   └── supabaseClient.js        # Cliente Supabase (service role)
│
├── pp/                          # Portal Admin (rol ROOT)
│   ├── dashboard.html           # Dashboard principal
│   ├── tenants.html             # Gestión tenants
│   ├── usuarios.html            # Gestión usuarios
│   ├── billing_plans.html       # Planes y facturación
│   ├── global_settings.html     # Configuración global
│   ├── system_health.html       # Salud del sistema
│   └── js/                      # Lógica portal admin
│
├── enterprise/                   # Portal Enterprise (clientes)
│   ├── dashboard.html           # Dashboard por plan
│   ├── fleet.html               # Flotilla (vehículos)
│   ├── automation.html          # Automatizaciones RPA
│   ├── team.html                # Equipo (usuarios tenant)
│   ├── security.html            # Auditoría + API Keys
│   └── js/                      # Lógica enterprise
│
├── css/
│   ├── index.css                # Estilos landing (76KB)
│   └── variables.css            # Design tokens (paleta, spacing)
│
├── js/                          # JS público compartido
│   ├── login.js                 # Auth landing
│   ├── plan-gate.js             # Gate por plan/rol
│   └── sidebar-loader.js        # Navegación dinámica
│
├── supabase/
│   ├── migracion_sync.sql       # Tablas app Flutter
│   └── migracion_enterprise.sql # Tablas portal web (RLS)
│
├── vercel.json                  # Configuración despliegue
├── package.json
└── DOCUMENTO_TECNICO_PORTAL_PILOT.md  # Documentación técnica completa
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

### App Flutter (Serverless) — `portal_pilot_app/api/`
| Endpoint | Tabla Supabase | Función |
|----------|----------------|---------|
| `/api/login.js` | NocoDB | Login app con fallback |
| `/api/matriculas` | `matriculas` | CRUD matrículas (29 campos) |
| `/api/notas` | `notas_estado` | Snapshot notas JSONB |
| `/api/clientes` | `clientes` | CRUD clientes |
| `/api/productos` | `productos` | Upsert masivo stock |
| `/api/facturas` | `facturas` | CRUD + anulación |
| `/api/transacciones` | `transacciones` | Movimientos contables |
| `/api/ventas` | `productos` + `facturas` | Cierre POS |
| `/api/ai/groq` | — | Proxy seguro Groq |

---

## 🔐 Seguridad

### Cero Llaves Expuestas
- **Nunca** se incluyen claves de Supabase ni Groq en el cliente
- Backend usa `process.env.SUPABASE_KEY`, `process.env.GROQ_API_KEY`
- Proxy `/api/ai/groq` protege llamadas al LLM desde frontend
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
- ✅ JWT con roles (`Owner`, `Administrador`, `Miembro`, `profesor`, etc.)
- ✅ Auditoría por empresa (`auditoria`): log accesos y operaciones sensibles
- ✅ Gestión API Keys por tenant con revocación (`api_keys`)
- ✅ Rate limiting en auth (`loginLimiter`: 5 req/15min)
- ✅ Helmet CSP configurado, CORS restrictivo
- ✅ Bcrypt para hash de contraseñas
- ✅ TLS 1.3 en tránsito (Vercel + Supabase)

---

## 💰 Planes y Precios (HNL — Lempiras)

| Característica | **Starter** L499/mes | **Business** L1,499/mes | **Enterprise** L4,999/mes |
|----------------|----------------------|-------------------------|---------------------------|
| Usuarios activos | 1 | Hasta 25 | Ilimitados |
| IA Groq API | 50 consultas/mes | Ilimitada | Personalizada |
| Módulos incluidos | 2 módulos | Todos los módulos | Todos + API |
| Facturación SAR | ✅ | ✅ | ✅ |
| Multi-empresa | — | Hasta 3 | Ilimitadas |
| Soporte técnico | Comunidad | Email 24h | Prioritario 24/7 |
| Almacenamiento | 100 MB | 5 GB | Ilimitado |

> **Anual**: -20% en todos los planes. Precios en Lempiras (HNL).

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

**Portal Pilot** nace en Honduras para resolver la gestión empresarial real de PyMES y centros educativos de la región. Combina cumplimiento local (Facturación SAR), infraestructura cloud global y IA de vanguardia.

> **¿Listo para automatizar tu empresa?**  
> [Registrar Empresa Gratis](https://portal-pilot.vercel.app/registrov2.html) · [Ver Planes](https://portal-pilot.vercel.app/#pricing)

---

<div align="center">

**Portal Pilot** — Tu Negocio Inteligente

[![GitHub Stars](https://img.shields.io/github/stars/sarch-codelab/portalpilot?style=social)](https://github.com/sarch-codelab/portalpilot)
[![GitHub Forks](https://img.shields.io/github/forks/sarch-codelab/portalpilot?style=social)](https://github.com/sarch-codelab/portalpilot/fork)
[![Twitter](https://img.shields.io/twitter/follow/portalpilot?style=social)](https://twitter.com/portalpilot)

</div>