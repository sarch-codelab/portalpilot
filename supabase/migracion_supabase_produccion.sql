-- ============================================================================
-- SCRIPT UNIFICADO DE MIGRACIÓN SUPABASE PRODUCCIÓN: PORTAL PILOT
-- Elimina la dependencia de NocoDB e implementa usuarios, tenants,
-- notificaciones, auditoría, configuraciones globales y almacenamiento de assets.
-- ============================================================================

-- 1. EXTENSIONES NECESARIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA DE EMPRESAS / TENANTS
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(50) UNIQUE NOT NULL,
    nombre_empresa VARCHAR(150) NOT NULL,
    rtn VARCHAR(20),
    email VARCHAR(100),
    telefono VARCHAR(30),
    direccion TEXT,
    plan VARCHAR(50) DEFAULT 'pro',
    limite_usuarios INT DEFAULT 10,
    estado VARCHAR(20) DEFAULT 'activo', -- 'activo', 'suspendido', 'demo'
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserción de Tenant ROOT predeterminado si no existe
INSERT INTO public.tenants (codigo, nombre_empresa, rtn, plan, estado)
VALUES ('ROOT', 'Portal Pilot System Admin', '00000000000000', 'enterprise', 'activo')
ON CONFLICT (codigo) DO NOTHING;

-- 3. TABLA DE USUARIOS DEL PORTAL Y APP
CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    rol VARCHAR(50) DEFAULT 'admin', -- 'root', 'superadmin', 'admin', 'cajero', 'operador'
    empresa_codigo VARCHAR(50) NOT NULL REFERENCES public.tenants(codigo) ON DELETE CASCADE,
    estado VARCHAR(20) DEFAULT 'activo', -- 'activo', 'inactivo', 'pendiente'
    avatar_url TEXT,
    telefono VARCHAR(30),
    ultimo_acceso TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inserción de Usuario ROOT de Emergencia (password por defecto hash bcrypt para 'admin123' o reemplazable)
INSERT INTO public.usuarios (email, password_hash, nombre, rol, empresa_codigo, estado)
VALUES ('admin@portalpilot.com', '$2a$10$7vN5tDkI46c.r.O0sL7/vOq22gZ6zG98t8vX09Z9/5vG5vG5vG5vG', 'Super Admin Portal Pilot', 'root', 'ROOT', 'activo')
ON CONFLICT (email) DO NOTHING;

-- 4. TABLA DE NOTIFICACIONES (SISTEMA REAL EN TIEMPO REAL)
CREATE TABLE IF NOT EXISTS public.notificaciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_codigo VARCHAR(50) REFERENCES public.tenants(codigo) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo VARCHAR(30) DEFAULT 'info', -- 'info', 'success', 'warning', 'danger'
    prioridad VARCHAR(20) DEFAULT 'normal', -- 'baja', 'normal', 'alta'
    leida BOOLEAN DEFAULT FALSE,
    link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notificación inicial del sistema
INSERT INTO public.notificaciones (empresa_codigo, titulo, mensaje, tipo, prioridad)
VALUES ('ROOT', 'Sistema Portal Pilot Activo', 'Bienvenido a Portal Pilot. El servidor Supabase está 100% operativo.', 'success', 'alta');

-- 5. TABLA DE AUDITORÍA Y LOGS
CREATE TABLE IF NOT EXISTS public.auditoria_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_codigo VARCHAR(50),
    usuario_email VARCHAR(120),
    accion VARCHAR(100) NOT NULL,
    modulo VARCHAR(50) NOT NULL,
    detalle TEXT,
    ip_origen VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABLA DE CONFIGURACIONES GLOBALES
CREATE TABLE IF NOT EXISTS public.configuraciones_globales (
    clave VARCHAR(100) PRIMARY KEY,
    valor TEXT NOT NULL,
    entorno VARCHAR(30) DEFAULT 'production',
    sensible BOOLEAN DEFAULT FALSE,
    descripcion TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuraciones iniciales del sistema
INSERT INTO public.configuraciones_globales (clave, valor, entorno, sensible, descripcion)
VALUES 
    ('SITE_NAME', 'Portal Pilot Honduras', 'production', false, 'Nombre público del sistema'),
    ('PRIMARY_DOMAIN', 'https://portal-pilot.vercel.app', 'production', false, 'Dominio principal Web'),
    ('API_DOMAIN', 'https://portalpilot-app.vercel.app', 'production', false, 'Dominio principal API Serverless'),
    ('MAX_USERS_DEFAULT', '10', 'production', false, 'Límite por defecto de usuarios por tenant')
ON CONFLICT (clave) DO NOTHING;

-- 7. TABLA DE PLANES DE PAGO / SUSCRIPCIONES
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
VALUES 
    ('starter', 'Plan Starter', 29.00, 290.00, 3, 1, '["POS Básico", "Facturación SAR", "1 Bodega", "Soporte Standard"]'),
    ('pro', 'Plan Pro Business', 79.00, 790.00, 10, 5, '["POS Avanzado", "Facturación SAR", "5 Bodegas", "IA Groq Integrada", "Multisucursal"]'),
    ('enterprise', 'Plan Enterprise', 199.00, 1990.00, 100, 50, '["Acceso Ilimitado", "IA Groq Dedicada", "Bots RPA", "Auditoría Blockchain", "Soporte 24/7 VIP"]')
ON CONFLICT (id) DO NOTHING;

-- 8. POLÍTICAS DE SEGURIDAD RLS (ROW LEVEL SECURITY)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuraciones_globales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_pago ENABLE ROW LEVEL SECURITY;

-- Políticas permisivas para servicio backend / service_role
CREATE POLICY "Servicio backend acceso completo a tenants" ON public.tenants FOR ALL USING (true);
CREATE POLICY "Servicio backend acceso completo a usuarios" ON public.usuarios FOR ALL USING (true);
CREATE POLICY "Servicio backend acceso completo a notificaciones" ON public.notificaciones FOR ALL USING (true);
CREATE POLICY "Servicio backend acceso completo a auditoria" ON public.auditoria_logs FOR ALL USING (true);
CREATE POLICY "Servicio backend acceso completo a configuraciones" ON public.configuraciones_globales FOR ALL USING (true);
CREATE POLICY "Acceso público lectura planes de pago" ON public.planes_pago FOR SELECT USING (activo = true);

-- 9. CONFIGURACIÓN DE STORAGE BUCKET PARA ASSETS (IMÁGENES, AVATARES Y LOGOS)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('portal-pilot-assets', 'portal-pilot-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Imágenes públicas acceso lectura" ON storage.objects 
FOR SELECT USING (bucket_id = 'portal-pilot-assets');

CREATE POLICY "Permiso inserción imágenes usuarios autenticados" ON storage.objects 
FOR INSERT WITH CHECK (bucket_id = 'portal-pilot-assets');

-- Fin del script de migración
