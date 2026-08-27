-- ============================================================================
-- SCRIPT UNIFICADO DE MIGRACIÓN SUPABASE PRODUCCIÓN: PORTAL PILOT (BULLETPROOF V4)
-- Solución Total: Elimina restricciones de FK rígidas preexistentes a auth.users (usuarios_id_fkey)
-- ============================================================================

-- 1. EXTENSIONES NECESARIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABLA DE EMPRESAS / TENANTS
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo VARCHAR(50),
    nombre_empresa VARCHAR(150),
    rtn VARCHAR(20),
    email VARCHAR(100),
    telefono VARCHAR(30),
    direccion TEXT,
    plan VARCHAR(50) DEFAULT 'pro',
    limite_usuarios INT DEFAULT 10,
    estado VARCHAR(20) DEFAULT 'activo',
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.tenants ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nombre_empresa VARCHAR(150);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS rtn VARCHAR(20);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS email VARCHAR(100);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'pro';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS limite_usuarios INT DEFAULT 10;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS referencia_pago TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_codigo_unique ON public.tenants(codigo);

INSERT INTO public.tenants (id, codigo, nombre_empresa, rtn, plan, estado)
SELECT gen_random_uuid(), 'ROOT', 'Portal Pilot System Admin', '00000000000000', 'enterprise', 'activo'
WHERE NOT EXISTS (SELECT 1 FROM public.tenants WHERE codigo = 'ROOT');

-- 3. TABLA DE USUARIOS DEL PORTAL Y APP
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(120),
    password_hash TEXT,
    password TEXT,
    nombre VARCHAR(100),
    apellido VARCHAR(100),
    rol VARCHAR(50) DEFAULT 'admin',
    empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
    empresa_id UUID,
    estado VARCHAR(20) DEFAULT 'activo',
    activo BOOLEAN DEFAULT TRUE,
    avatar_url TEXT,
    foto_perfil_url TEXT,
    telefono VARCHAR(30),
    ultimo_acceso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 🔥 IMPORTANTE: Eliminar restricciones FK rígidas a auth.users que causan error 23503
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_id_fkey;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_empresa_id_fkey;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_empresa_codigo_fkey;

ALTER TABLE public.usuarios ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(120);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS nombre VARCHAR(100);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS apellido VARCHAR(100);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS rol VARCHAR(50) DEFAULT 'admin';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS empresa_codigo VARCHAR(50) DEFAULT 'ROOT';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS empresa_id UUID;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'activo';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email_unique ON public.usuarios(email);

INSERT INTO public.usuarios (id, email, password_hash, password, nombre, rol, empresa_codigo, estado, activo)
SELECT gen_random_uuid(), 'admin@portalpilot.com', '$2a$10$7vN5tDkI46c.r.O0sL7/vOq22gZ6zG98t8vX09Z9/5vG5vG5vG5vG', 'admin123', 'Super Admin Portal Pilot', 'root', 'ROOT', 'activo', true
WHERE NOT EXISTS (SELECT 1 FROM public.usuarios WHERE email = 'admin@portalpilot.com');

UPDATE public.usuarios 
SET password_hash = '$2a$10$7vN5tDkI46c.r.O0sL7/vOq22gZ6zG98t8vX09Z9/5vG5vG5vG5vG',
    password = 'admin123',
    empresa_codigo = 'ROOT'
WHERE email = 'admin@portalpilot.com';

-- 4. TABLA DE NOTIFICACIONES
CREATE TABLE IF NOT EXISTS public.notificaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
    usuario_id UUID,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo VARCHAR(30) DEFAULT 'info',
    prioridad VARCHAR(20) DEFAULT 'normal',
    leida BOOLEAN DEFAULT FALSE,
    link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notificaciones ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS empresa_codigo VARCHAR(50) DEFAULT 'ROOT';
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS usuario_id UUID;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS titulo VARCHAR(150);
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS mensaje TEXT;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'info';
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) DEFAULT 'normal';
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS leida BOOLEAN DEFAULT FALSE;
ALTER TABLE public.notificaciones ADD COLUMN IF NOT EXISTS link TEXT;

INSERT INTO public.notificaciones (id, empresa_codigo, titulo, mensaje, tipo, prioridad)
SELECT gen_random_uuid(), 'ROOT', 'Sistema Portal Pilot Activo', 'Bienvenido a Portal Pilot. El servidor Supabase está 100% operativo.', 'success', 'alta'
WHERE NOT EXISTS (SELECT 1 FROM public.notificaciones WHERE titulo = 'Sistema Portal Pilot Activo');

-- 5. TABLA DE AUDITORÍA Y LOGS
CREATE TABLE IF NOT EXISTS public.auditoria_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
    usuario_email VARCHAR(120),
    accion VARCHAR(100) NOT NULL,
    modulo VARCHAR(50) NOT NULL,
    detalle TEXT,
    ip_origen VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.auditoria_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 6. TABLA DE CONFIGURACIONES GLOBALES
CREATE TABLE IF NOT EXISTS public.configuraciones_globales (
    clave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL,
    entorno VARCHAR(30) DEFAULT 'production',
    sensible BOOLEAN DEFAULT FALSE,
    descripcion TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'SITE_NAME', 'Portal Pilot Honduras', 'production', false, 'Nombre público del sistema'
WHERE NOT EXISTS (SELECT 1 FROM public.configuraciones_globales WHERE clave = 'SITE_NAME');

INSERT INTO public.configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'PRIMARY_DOMAIN', 'https://portal-pilot.vercel.app', 'production', false, 'Dominio principal Web'
WHERE NOT EXISTS (SELECT 1 FROM public.configuraciones_globales WHERE clave = 'PRIMARY_DOMAIN');

INSERT INTO public.configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'API_DOMAIN', 'https://portalpilot-app.vercel.app', 'production', false, 'Dominio principal API Serverless'
WHERE NOT EXISTS (SELECT 1 FROM public.configuraciones_globales WHERE clave = 'API_DOMAIN');

INSERT INTO public.configuraciones_globales (clave, valor, entorno, sensible, descripcion)
SELECT 'MAX_USERS_DEFAULT', '10', 'production', false, 'Límite por defecto de usuarios por tenant'
WHERE NOT EXISTS (SELECT 1 FROM public.configuraciones_globales WHERE clave = 'MAX_USERS_DEFAULT');

-- 7. TABLA DE PLANES DE PAGO
CREATE TABLE IF NOT EXISTS public.planes_pago (
    id VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    precio_mensual NUMERIC(10,2) NOT NULL,
    precio_anual NUMERIC(10,2) NOT NULL,
    limite_usuarios INT NOT NULL,
    limite_bodegas INT NOT NULL,
    caracteristicas JSONB,
    activo BOOLEAN DEFAULT TRUE
);

INSERT INTO public.planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'starter', 'Plan Starter', 499.00, 4990.00, 5, 1, '["POS Básico", "Facturación SAR", "1 Bodega", "Soporte Standard", "15 días gratis"]'
WHERE NOT EXISTS (SELECT 1 FROM public.planes_pago WHERE id = 'starter');

INSERT INTO public.planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'business', 'Plan Business', 1499.00, 14990.00, 25, 5, '["POS Avanzado", "Facturación SAR", "5 Bodegas", "IA Groq Integrada", "Multisucursal", "25 usuarios"]'
WHERE NOT EXISTS (SELECT 1 FROM public.planes_pago WHERE id = 'business');

INSERT INTO public.planes_pago (id, nombre, precio_mensual, precio_anual, limite_usuarios, limite_bodegas, caracteristicas)
SELECT 'enterprise', 'Plan Enterprise', 4999.00, 49990.00, 250, 50, '["Acceso Ilimitado", "IA Groq Dedicada", "Bots RPA", "Auditoría Blockchain", "Soporte 24/7 VIP", "Usuarios ilimitados"]'
WHERE NOT EXISTS (SELECT 1 FROM public.planes_pago WHERE id = 'enterprise');

-- 7b. TABLA DE TICKETS DE SOPORTE
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_codigo VARCHAR(50) DEFAULT 'ROOT',
    nombre VARCHAR(100),
    email VARCHAR(120),
    empresa VARCHAR(150),
    plan VARCHAR(50),
    categoria VARCHAR(50),
    prioridad VARCHAR(20) DEFAULT 'normal',
    mensaje TEXT,
    estado VARCHAR(20) DEFAULT 'open' CHECK (estado IN ('open', 'en_progreso', 'resuelta', 'cerrada')),
    ticket_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.support_tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON public.support_tickets(email);
CREATE INDEX IF NOT EXISTS idx_support_tickets_estado ON public.support_tickets(estado);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON public.support_tickets(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_unique_id ON public.support_tickets(ticket_id) WHERE ticket_id IS NOT NULL;

-- 8. RLS Y PERMISOS DE LECTURA/ESCRITURA ACCESIBLES
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_globales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_pago ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backend_tenants_policy" ON public.tenants;
CREATE POLICY "backend_tenants_policy" ON public.tenants FOR ALL USING (true);

DROP POLICY IF EXISTS "backend_usuarios_policy" ON public.usuarios;
CREATE POLICY "backend_usuarios_policy" ON public.usuarios FOR ALL USING (true);

DROP POLICY IF EXISTS "backend_notif_policy" ON public.notificaciones;
CREATE POLICY "backend_notif_policy" ON public.notificaciones FOR ALL USING (true);

DROP POLICY IF EXISTS "backend_audit_policy" ON public.auditoria_logs;
CREATE POLICY "backend_audit_policy" ON public.auditoria_logs FOR ALL USING (true);

DROP POLICY IF EXISTS "backend_config_policy" ON public.configuraciones_globales;
CREATE POLICY "backend_config_policy" ON public.configuraciones_globales FOR ALL USING (true);

DROP POLICY IF EXISTS "public_planes_policy" ON public.planes_pago;
CREATE POLICY "public_planes_policy" ON public.planes_pago FOR SELECT USING (true);

DROP POLICY IF EXISTS "backend_support_policy" ON public.support_tickets;
CREATE POLICY "backend_support_policy" ON public.support_tickets FOR ALL USING (true);

-- 9. CONFIGURACIÓN DE STORAGE BUCKET PARA ASSETS (IMÁGENES)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('portal-pilot-assets', 'portal-pilot-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_storage_select" ON storage.objects;
CREATE POLICY "public_storage_select" ON storage.objects FOR SELECT USING (bucket_id = 'portal-pilot-assets');

DROP POLICY IF EXISTS "public_storage_insert" ON storage.objects;
CREATE POLICY "public_storage_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'portal-pilot-assets');

-- Fin del script v4
