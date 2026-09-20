const path = require('path');
try {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  }
} catch (e) { console.warn('[DOTENV] Non-critical:', e.message); }

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const { supabase, requireSupabase, getSupabaseUrl, getSupabaseKey } = require('./supabaseClient');
console.log(`[STARTUP] Supabase client: ${supabase ? 'ACTIVO' : 'INACTIVO'}`);

// Panel admin pp/: endpoints /api/admin/* (requieren ROOT) que alimentan las
// nuevas páginas de supervisión (tickets, bots, renovaciones, KYC, etc.).
const adminPortal = require('./adminPortalEndpoints');



const app = express();

// 🔧 FIX VERCEL: Detectar entorno serverless
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
console.log(`[STARTUP] Environment: ${IS_SERVERLESS ? 'SERVERLESS' : 'LOCAL'}, Node: ${process.version}`);

if (IS_SERVERLESS) app.set('trust proxy', 1);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowedOrigins = [
  ...FRONTEND_URL.split(',').map(origin => origin.trim()).filter(Boolean),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://portal-pilot.vercel.app',
  'https://www.portal-pilot.vercel.app',
  'https://portalpilot-app.vercel.app',
  'https://www.portalpilot-app.vercel.app'
];
const corsOptions = {
  origin: (origin, callback) => {
    // Las vistas previas de Vercel no deben poder consumir la API de producción.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    // Desarrollo local: cualquier puerto de localhost/127.0.0.1 es válido.
    // En producción (serverless) se mantiene el allowlist estricto.
    if (!IS_SERVERLESS) {
      try {
        const { hostname } = new URL(origin);
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          callback(null, true);
          return;
        }
      } catch (e) { /* origen inválido → rechazo normal */ }
    }
    callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "style-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      "img-src": ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://raw.githubusercontent.com", "https://api.dicebear.com", "https://api.producthunt.com", "https://www.google-analytics.com", "https://www.googletagmanager.com"],
      "connect-src": [
        "'self'",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://www.google-analytics.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.g.doubleclick.net",
        "https://portal-pilot.vercel.app",
      ],
    },
  },
}));

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[REQUEST]', req.method, req.path);
  }
  next();
});
app.use(express.json({ limit: '10mb' }));

function handleServerError(res, error) {
  console.error('[ERROR]', error?.message || error);
  // Errores de configuración (SMTP faltante, etc.): 503 con mensaje ACCIONABLE,
  // nunca un 500 genérico que oculte la causa real.
  if (error?.code === 'SMTP_NOT_CONFIGURED') {
    return res.status(503).json({ error: error.message, code: 'SMTP_NOT_CONFIGURED' });
  }
  return res.status(500).json({ error: 'Ha ocurrido un error interno en el servidor' });
}

app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError || err?.status === 400)) {
    return res.status(400).json({ error: 'JSON inválido en la solicitud.' });
  }
  if (err?.message === 'Origen no permitido por CORS') {
    return res.status(403).json({ error: 'Origen no permitido por CORS.' });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo excede el tamaño máximo permitido.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo de la solicitud es demasiado grande.' });
  }
  console.error('[UNHANDLED ERROR]', err?.message || err);
  next(err);
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos: un usuario real no se bloquea al hacer login + refresh
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.' }
});

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de recuperación. Intenta de nuevo en 15 minutos.' }
});

const alertaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas alertas. Intenta de nuevo más tarde.' }
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // evita email-bombing vía endpoints públicos de correo
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados envíos. Intenta de nuevo más tarde.' }
});

const pagoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas confirmaciones de pago. Intenta de nuevo en una hora.' }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const JWT_SECRET = process.env.JWT_SECRET;

// Nunca firmar tokens con una clave incluida en el código. En producción se
// detiene el arranque: publicar una API sin JWT_SECRET sería inseguro.
if (!JWT_SECRET && (IS_SERVERLESS || process.env.NODE_ENV === 'production')) {
  throw new Error('JWT_SECRET debe configurarse en el entorno de producción.');
}
const localJwtSecret = JWT_SECRET || crypto.randomBytes(48).toString('hex');

// ─── COOKIE DE SESIÓN (protección server-side de pp/ y empresa/) ───
const SESSION_COOKIE = 'pp_session';
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function getSessionCookieSecure() {
  return IS_SERVERLESS || process.env.NODE_ENV === 'production';
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: getSessionCookieSecure(),
    sameSite: 'lax',
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: '/'
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: getSessionCookieSecure(),
    sameSite: 'lax',
    path: '/'
  });
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      try { cookies[name] = decodeURIComponent(value); } catch (e) { cookies[name] = value; }
    }
  });
  return cookies;
}

// Alias de URL limpia raíz → página dentro del área protegida. Se resuelven en
// el backend (no como estáticos) para que el guard de /pp/ aplique igual.
const PORTAL_ALIASES = {
  '/tenants': '/pp/tenants',
  '/dashboard': '/pp/dashboard',
  '/usuarios': '/pp/usuarios',
  '/global_settings': '/pp/global_settings',
  '/billing_plans': '/pp/billing_plans',
  '/bots_rpa': '/pp/bots_rpa',
  '/auditoria': '/pp/auditoria',
  '/analytics': '/pp/analytics',
  '/system_health': '/pp/system_health',
  '/perfil': '/pp/perfil',
  '/inicio': '/pp/welcome',
};

function isProtectedAreaPath(path) {
  return path === '/pp' || path.startsWith('/pp/')
    || path === '/empresa' || path.startsWith('/empresa/')
    || path === '/enterprise' || path.startsWith('/enterprise/')
    || PORTAL_ALIASES[path];
}

// Middleware de ciberseguridad: NO entrega ningún archivo de pp/ (admin) ni
// empresa/ (tenant) sin una sesión autenticada. Redirige de inmediato a
// /login.html sin servir ni siquiera el HTML, para no exponer la estructura
// ni ningún recurso del área protegida.
function protectPortalArea(req, res, next) {
  if (!isProtectedAreaPath(req.path)) return next();

  // Distinguir navegación de páginas (Accept: text/html) de sub-recursos
  // (CSS/JS/img). A los recursos se les devuelve 403 sin redirección para que
  // el navegador NO sustituya login.html como si fuera el CSS/JS (página sin
  // estilos) y para evitar redirecciones cacheadas raras del CDN.
  const isHtmlRequest = (req.headers.accept || '').includes('text/html');
  const forbidden = () => res.status(403).json({ error: 'Sesión no autorizada para este recurso' });

  const cookies = parseCookies(req);
  let sessionUser = null;

  // 1) Cookie httpOnly de sesión (navegación normal de páginas).
  if (cookies[SESSION_COOKIE]) {
    try {
      sessionUser = jwt.verify(cookies[SESSION_COOKIE], localJwtSecret);
    } catch (e) {
      sessionUser = null;
    }
  }

  // 2) Fallback header Authorization (requests programáticas/API).
  if (!sessionUser) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        sessionUser = jwt.verify(authHeader.slice(7), localJwtSecret);
      } catch (e) {
        sessionUser = null;
      }
    }
  }

  if (!sessionUser) {
    return isHtmlRequest ? res.redirect('/login.html') : forbidden();
  }

  req.user = sessionUser;
  const codigo = normalizeTenantCode(sessionUser.empresa_codigo);
  const role = (sessionUser.rol || '').toString().trim().toLowerCase();
  const isRoot = ['root', 'root pp', 'superadmin'].includes(role);
  const isTenantUser = Boolean(codigo);

  // /pp/* solo para administradores raíz; /empresa/* para usuarios de tenant o raíz.
  const resolvedPath = PORTAL_ALIASES[req.path] || req.path;
  const isAdminArea = resolvedPath === '/pp' || resolvedPath.startsWith('/pp/');
  if (isAdminArea) {
    if (!isRoot) return isHtmlRequest ? res.redirect('/login.html') : forbidden();
  } else {
    if (!isRoot && !isTenantUser) return isHtmlRequest ? res.redirect('/login.html') : forbidden();
    // Blueprint (§15): el Member NO entra a /empresa (Portal Empresa).
    // Su lugar es el Workspace Client. Solo Owner/Admin (y ROOT) administran.
    if (!isRoot && !isOwnerUser(req)) {
      return isHtmlRequest ? res.redirect('/download.html') : forbidden();
    }
  }

  next();
}

// ═══════════════════════════════════════════════════════════════
// MODO SOLO LECTURA (TRIAL VENCIDO)
// Cuando los 15 días de prueba vencen sin pago, la empresa conserva
// el acceso para CONSULTAR y EXPORTAR sus datos, pero ya NO puede
// registrar movimientos nuevos (ventas, facturas, inventario, etc.).
// GET/HEAD/OPTIONS siempre se permiten. Las escrituras se bloquean
// salvo rutas de autenticación, pago/renovación y exportación.
// ═══════════════════════════════════════════════════════════════
const WRITE_ALLOWED_WHEN_EXPIRED_PREFIXES = [
  '/api/session/sync',
  '/api/login',
  '/api/logout',
  '/api/password',
  '/api/recuperacion',
  '/api/security',
  '/api/confirmar-pago',
  '/api/tigo-money-reference',
  '/api/payment',
  '/api/plan',
  '/api/suscripcion',
  '/api/empresa/profile',
  '/api/renew',
  '/api/billing',
  '/api/export',
  '/api/backup',
  '/api/download',
  '/api/restore',
  '/api/refresh',
  '/api/me',
  '/api/tenant/modules',
  '/api/tenant/stats',
  '/api/notificaciones',
];

function isWriteAllowedWhenExpired(path) {
  const norm = (path || '').replace(/\/+$/, '');
  return WRITE_ALLOWED_WHEN_EXPIRED_PREFIXES.some((p) => {
    if (p === norm) return true;
    if (p.endsWith('/')) return norm.startsWith(p);
    return norm.startsWith(p + '/');
  });
}

// Cache corta de entitlements para no golpear la DB en cada request.
const _entitlementsCache = new Map();
const ENTITLEMENTS_CACHE_TTL_MS = 30 * 1000;

async function getEntitlementsCached(req) {
  const tenantCode = normalizeTenantCode(getTenantCode(req));
  if (!tenantCode) return getTenantEntitlements(req);
  const hit = _entitlementsCache.get(tenantCode);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  const data = await getTenantEntitlements(req);
  _entitlementsCache.set(tenantCode, { data, expiresAt: Date.now() + ENTITLEMENTS_CACHE_TTL_MS });
  return data;
}

app.use(async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (isWriteAllowedWhenExpired(req.path)) return next();

  const authHeader = req.headers['authorization'];
  // Rutas públicas (login, registro, confirmación de pago) sin token → pasar.
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const decoded = jwt.verify(authHeader.slice(7), localJwtSecret);
    req.user = decoded; // evita que authenticate revuelva a consultar el mismo token
    const entitlements = await getEntitlementsCached(req);
    if (!entitlements || entitlements.status !== 'expired') return next();
    req.entitlements = entitlements;
    return res.status(403).json({
      error: 'Tu período de prueba de 15 días ha vencido. La plataforma está en modo solo lectura: puedes consultar y exportar tus datos, pero no registrar movimientos nuevos. Renueva tu plan para continuar.',
      code: 'TRIAL_EXPIRED',
      readOnly: true
    });
  } catch (err) {
    return next(); // token inválido → la ruta (authenticate) responderá 401/403
  }
});

// ── Metering de escrituras operativas (Blueprint §12): cada alta/edición
// operativa exitosa incrementa 'documents' del tenant. Debe registrarse ANTES
// de las rutas para que el hook de respuesta aplique a todas. Nunca bloquea.
const METERED_WRITE_PREFIXES = [
  '/api/productos', '/api/clientes', '/api/facturas', '/api/recibos', '/api/notas-credito',
  '/api/pos/ventas', '/api/compras', '/api/cotizaciones', '/api/ordenes-compra', '/api/kardex',
  '/api/ventas-fiadas', '/api/abonos', '/api/sucursales', '/api/bodegas', '/api/proveedores',
  '/api/transferencias', '/api/membresias', '/api/promociones', '/api/rutas', '/api/visitas',
  '/api/notas', '/api/transacciones', '/api/sync'
];

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const isMetered = METERED_WRITE_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!isMetered) return next();
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try { registrarUsoTenant(getTenantCode(req), 'documents', 1); } catch (e) { /* metering nunca bloquea */ }
    }
  });
  next();
});

app.post('/api/session/sync', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token no provisto' });

  // NUNCA setear la cookie de sesión con un token inválido: si se hacía, el
  // navegador quedaba en un loop infinito (/login → panel → /login) cuando el
  // localStorage tenía un token caducado o firmado con un secreto anterior.
  let decoded;
  try {
    decoded = jwt.verify(token, localJwtSecret);
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido', code: 'SESSION_INVALID' });
  }

  // Revocación de sesiones: si el token_version del usuario avanzó, el token
  // ya no es válido y no debe reestablecer la cookie.
  try {
    if (decoded?.sub && supabase) {
      const current = await getTokenVersionCached(decoded.sub);
      if (current != null && (decoded.token_version || 0) < current) {
        return res.status(401).json({ error: 'Sesión revocada. Inicia sesión de nuevo.', code: 'SESSION_REVOKED' });
      }
    }
  } catch (e) {
    console.warn('[SESSION_SYNC] token_version check falló (se permite):', e.message);
  }

  if (decoded.sub) {
    try {
      const now = new Date().toISOString();
      const restUrl = `${getSupabaseUrl()}/rest/v1/usuarios?id=eq.${decoded.sub}`;
      const key = getSupabaseKey();
      const headers = {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      };
      await axios.patch(restUrl, { updated_at: now, ultimo_acceso: now }, { headers, timeout: 8000 });
    } catch (e) {
      console.warn('[SESSION_SYNC] No se pudo actualizar ultimo_acceso:', e.message);
    }
  }
  setSessionCookie(res, token);
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token no provisto' });

  jwt.verify(token, localJwtSecret, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    // Revocación de sesiones (Bloque J): si el usuario incrementó su
    // token_version, todos los tokens emitidos ANTES quedan inválidos.
    // Se consulta el valor actual en DB (30s de caché por usuario).
    req.user = user;
    if (user?.sub && supabase) {
      try {
        const current = await getTokenVersionCached(user.sub);
        if (current != null && (user.token_version || 0) < current) {
          return res.status(401).json({ error: 'Sesión revocada. Inicia sesión de nuevo.', code: 'SESSION_REVOKED' });
        }
      } catch (e) {
        console.warn('[AUTH] token_version check falló (se permite):', e.message);
      }
    }
    next();
  });
}

// Caché corto de token_version por usuario para no golpear la DB en cada request.
const _tokenVersionCache = new Map();
const TOKEN_VERSION_CACHE_TTL_MS = 30 * 1000;
async function getTokenVersionCached(userId) {
  const hit = _tokenVersionCache.get(userId);
  if (hit && Date.now() < hit.expiresAt) return hit.value;
  const { data, error } = await supabase.from('usuarios').select('token_version').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const value = data ? (data.token_version || 0) : null;
  _tokenVersionCache.set(userId, { value, expiresAt: Date.now() + TOKEN_VERSION_CACHE_TTL_MS });
  return value;
}
function invalidateTokenVersionCache(userId) {
  _tokenVersionCache.delete(userId);
}

function isRootUser(req) {
  const role = (req.user?.rol || '').toString().trim().toLowerCase();
  const rootRoles = ['root', 'root pp', 'superadmin'];
  return rootRoles.includes(role);
}

function requireRoot(req, res, next) {
  if (!isRootUser(req)) {
    return res.status(403).json({ error: 'Esta acción requiere un usuario ROOT.' });
  }
  next();
}

function getTenantCode(req) {
  return (req.user?.empresa_codigo || '').toString().trim();
}

function normalizeTenantCode(code) {
  return (code || '').toString().trim().toUpperCase();
}

function slugifyDominio(value) {
  const slug = (value || '').toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'empresa';
}

const ALL_PLAN_FEATURES = Object.freeze([
  'operacion_basica', 'operacion_completa', 'inventario', 'facturacion_sar', 'web_consulta', 'web_admin',
  'pos_basico', 'pos', 'clientes', 'reportes', 'reportes_basicos', 'reportes_avanzados',
  'proveedores', 'compras', 'precios', 'promociones',
  'canal_tradicional', 'canal_moderno', 'fiado', 'rutas', 'cobros',
  'sucursales', 'transferencias', 'inventario_multi_sucursal',
  'membresias', 'socios', 'puntos',
  'roles', 'auditoria', 'seguridad_avanzada',
  'api_keys', 'automation', 'fleet', 'multiempresa',
  'ia', 'ia_avanzada'
]);

const PLAN_ENTITLEMENTS = Object.freeze({
  // Prueba: trial de 15 días con TODA la plataforma abierta para evaluar.
  starter: {
    maxUsers: 5, maxCompanies: 1,
    features: ALL_PLAN_FEATURES
  },
  business: {
    maxUsers: 15, maxCompanies: 3,
    features: [
      'operacion_completa', 'inventario', 'facturacion_sar', 'web_admin', 'reportes', 'ia', 'roles', 'auditoria',
      'pos', 'clientes', 'proveedores', 'compras', 'precios', 'promociones',
      'canal_tradicional', 'fiado', 'rutas', 'cobros',
      'reportes_basicos'
    ]
  },
  enterprise: {
    maxUsers: Number.MAX_SAFE_INTEGER, maxCompanies: Number.MAX_SAFE_INTEGER,
    features: ALL_PLAN_FEATURES
  }
});

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();
  if (['enterprise', 'corporativo'].includes(value)) return 'enterprise';
  if (['business', 'pro'].includes(value)) return 'business';
  return 'starter';
}

// Plan engine DB-backed: lee planes/plan_features/plan_limits cuando existen
// y NO rompe si faltan (fallback a constantes locales).
async function getPlanConfigFromDB(plan) {
  const fallback = PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.starter;
  if (!supabase) return fallback;
  try {
    const { data: row } = await supabase.from('planes')
      .select('id, orden, max_users, max_companies')
      .eq('clave', plan).maybeSingle();
    if (!row) return fallback;

    const { data: feats } = await supabase.from('plan_features')
      .select('feature')
      .eq('plan_id', row.id);
    const features = (feats && feats.length) ? feats.map(f => f.feature) : fallback.features;

    const { data: limits } = await supabase.from('plan_limits')
      .select('recurso, maximo')
      .eq('plan_id', row.id);

    return {
      maxUsers: Number.isFinite(Number(row.max_users)) ? Number(row.max_users) : fallback.maxUsers,
      maxCompanies: Number.isFinite(Number(row.max_companies)) ? Number(row.max_companies) : fallback.maxCompanies,
      features,
      customLimits: (limits && limits.length) ? limits.reduce((acc, l) => { acc[l.recurso] = Number(l.maximo); return acc; }, {}) : {}
    };
  } catch (e) {
    return fallback;
  }
}

async function getTenantEntitlements(req) {
  if (isRootUser(req)) return { plan: 'enterprise', ...PLAN_ENTITLEMENTS.enterprise };
  const tenantCode = normalizeTenantCode(getTenantCode(req));
  if (!tenantCode || !supabase) return { plan: 'starter', ...PLAN_ENTITLEMENTS.starter };
  const { data: tenant } = await supabase.from('tenants')
    .select('plan, limite_usuarios, limite_empresas, estado, created_at')
    .eq('codigo', tenantCode).maybeSingle();
  const plan = normalizePlan(tenant?.plan);
  const base = await getPlanConfigFromDB(plan);
  const baseLimits = PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.starter;
  // null-safety: Number(null)=0 pasaría Number.isFinite y dejaría el plan sin
  // cupo de usuarios (bug crítico: tenants de /api/registro nacen con NULL).
  const maxUsers = (tenant?.limite_usuarios != null && Number.isFinite(Number(tenant.limite_usuarios))) ? Number(tenant.limite_usuarios) : base.maxUsers;
  const maxCompanies = (tenant?.limite_empresas != null && Number.isFinite(Number(tenant.limite_empresas))) ? Number(tenant.limite_empresas) : base.maxCompanies;

  // Trial de 15 días: si el plan es starter y superó los 15 días desde created_at,
  // el tenant queda suspendido hasta que pague un plan superior.
  let status = normalizeStatus(tenant?.estado || 'active');
  let trialEndsAt = null;
  if (plan === 'starter' && status === 'active' && tenant?.created_at) {
    const created = new Date(tenant.created_at).getTime();
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (Number.isFinite(created) && now - created > 15 * DAY_MS) {
      status = 'expired';
      trialEndsAt = new Date(created + 15 * DAY_MS).toISOString();
    }
  }

  return {
    plan,
    maxUsers,
    maxCompanies,
    features: base.features,
    customLimits: base.customLimits || {},
    limits: PLAN_LIMITS[plan] || baseLimits,
    trial_ends_at: trialEndsAt,
    trial: { isTrial: plan === 'starter' && status !== 'expired', endsAt: trialEndsAt },
    status
  };
}

function requirePlanFeature(feature) {
  return async (req, res, next) => {
    try {
      const entitlements = req.entitlements || await getTenantEntitlements(req);
      if (entitlements.status && entitlements.status === 'expired') {
        return res.status(403).json({ error: 'Tu período de prueba de 15 días ha vencido. La plataforma está en modo solo lectura: puedes consultar y exportar tus datos, pero no registrar movimientos nuevos. Elige un plan para continuar usando Portal Pilot.', code: 'TRIAL_EXPIRED', readOnly: true });
      }
      if (entitlements.status && entitlements.status !== 'active') {
        return res.status(403).json({ error: 'La empresa no tiene un plan activo.' });
      }
      // Límite server-side (Blueprint §11): si el plan define un límite para este
      // recurso/feature, se comprueba aquí contra tenant_usage — nunca solo en UI.
      const featureLimit = Number(entitlements.limits?.[feature]);
      if (Number.isFinite(featureLimit) && featureLimit > 0 && supabase) {
        try {
          const tenantL = normalizeTenantCode(getTenantCode(req));
          const mesL = new Date().toISOString().slice(0, 7);
          const { data: usageRow } = await supabase.from('tenant_usage')
            .select('cantidad').eq('empresa_codigo', tenantL).eq('recurso', feature).eq('periodo', mesL).maybeSingle();
          if ((Number(usageRow?.cantidad) || 0) >= featureLimit) {
            return res.status(403).json({ error: `Límite del plan alcanzado para ${feature}: ${featureLimit}.`, code: 'PLAN_LIMIT_REACHED' });
          }
        } catch (e) { console.warn('[PLAN_LIMIT] check falló (se permite):', e.message); }
      }
      if (!entitlements.features.includes(feature)) {
        return res.status(403).json({ error: `Esta función requiere un plan superior: ${feature}.`, code: 'PLAN_LIMIT' });
      }
      req.entitlements = entitlements;
      next();
    } catch (error) {
      handleServerError(res, error);
    }
  };
}

function requireTenantAdmin(req, res, next) {
  if (isRootUser(req)) return next();
  const role = String(req.user?.rol || '').trim().toLowerCase();
  if (!['owner', 'administrador', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'Esta acción requiere rol Owner o Administrador.' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════
// RBAC: requireOwner + tenant-scope helpers (Bloque 1 & 7)
// El scope SIEMPRE sale del JWT autenticado, jamás del body/query
// que envíe el cliente. Refuerza el aislamiento por empresa_codigo.
// ═══════════════════════════════════════════════════════════════
const OWNER_LIKE_ROLES = ['owner', 'administrador', 'admin'];

function isOwnerUser(req) {
  if (isRootUser(req)) return true;
  const role = String(req.user?.rol || '').trim().toLowerCase();
  return OWNER_LIKE_ROLES.includes(role) || role.includes('owner') || role === 'ceo';
}

function requireOwner(req, res, next) {
  if (!isOwnerUser(req)) {
    return res.status(403).json({ error: 'Esta acción es exclusiva del Owner de la empresa.' });
  }
  next();
}

// OWNER estricto: para acciones CRÍTICAS (eliminar usuarios, revocar sesiones
// ajenas) el rol 'admin' NO cuenta como owner — solo 'owner'/'ceo' (o ROOT).
// isOwnerUser se mantiene amplio para el acceso general al portal empresa.
function isTrueOwner(req) {
  if (isRootUser(req)) return true;
  const role = String(req.user?.rol || '').trim().toLowerCase();
  return role === 'owner' || role === 'ceo';
}

// Código de tenant EFECTIVO: para ROOT puede venir del body/query (acciones
// transversales); para cualquier otro rol, el token manda y se ignora lo que
// envíe el cliente. Previene el salto de tenant (OWNER 184 → tenant 185).
function effectiveTenantCode(req) {
  const bodyItem = Array.isArray(req.body) ? req.body[0] : req.body;
  const declared = (bodyItem?.empresa_codigo || req.query?.empresa_codigo || req.query?.empresa || '').toString().trim();
  const authTenant = normalizeTenantCode(getTenantCode(req));
  if (isRootUser(req)) return normalizeTenantCode(declared) || authTenant;
  return authTenant;
}

// Helper de scope centralizado: obliga a que las consultas de datos de tenant
// siempre filtren por empresa_codigo efectivo (single source of truth).
function withTenantScope(query, req) {
  const tenant = effectiveTenantCode(req);
  if (!tenant) return query;
  return query.eq('empresa_codigo', tenant);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function createBase32Secret(bytes = 20) {
  const source = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of source) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return output + (bits ? BASE32_ALPHABET[(value << (5 - bits)) & 31] : '');
}

function decodeBase32(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of String(value || '').replace(/=|\s/g, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Clave 2FA inválida.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function getTotpCode(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const index = digest[digest.length - 1] & 0x0f;
  const number = ((digest[index] & 0x7f) << 24) | (digest[index + 1] << 16) | (digest[index + 2] << 8) | digest[index + 3];
  return String(number % 1000000).padStart(6, '0');
}

function verifyTotp(secret, code, ventana = 1) {
  const candidate = String(code || '').trim();
  const offsets = [];
  for (let i = -ventana; i <= ventana; i++) offsets.push(i);
  return offsets.some(offset => {
    const expected = getTotpCode(secret, offset);
    return candidate.length === expected.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
  });
}

function createBackupCodes() {
  return Array.from({ length: 8 }, () => `${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4)}-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4)}`);
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

function normalizarSecretoTotp(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

function esUsuarioAdmin(userRow) {
  const roles = [userRow && userRow.rol, userRow && userRow.rol_global].map(r => String(r || '').trim().toLowerCase());
  const adminRoles = ['owner', 'admin', 'administrador', 'superadmin', 'root', 'root pp'];
  return roles.some(r => adminRoles.includes(r));
}

function verificarSetupToken(setupToken) {
  try {
    const payload = jwt.verify(setupToken, localJwtSecret);
    if (!payload || payload.purpose !== 'mfa_setup') return null;
    return payload;
  } catch (e) {
    return null;
  }
}

let _flag2faAdminsCache = { value: null, expiresAt: 0 };
async function flagDosFaAdminsActivo() {
  if (!supabase) return false;
  if (_flag2faAdminsCache.value !== null && Date.now() < _flag2faAdminsCache.expiresAt) return _flag2faAdminsCache.value;
  let value = false;
  try {
    const { data } = await supabase.from('configuraciones_globales').select('valor').eq('clave', 'FLAG_2FA_ADMINS').maybeSingle();
    value = !!data && String(data.valor).trim().toLowerCase() === 'true';
  } catch (e) {
    value = false;
  }
  _flag2faAdminsCache = { value, expiresAt: Date.now() + 60000 };
  return value;
}

function assertTenantAccess(req, targetTenantCode) {
  if (isRootUser(req)) return true;
  const currentTenant = normalizeTenantCode(getTenantCode(req));
  const targetTenant = normalizeTenantCode(targetTenantCode);
  return currentTenant && targetTenant && currentTenant === targetTenant;
}

function normalizeStatus(rawStatus) {
  const status = (rawStatus || '').toString().trim().toLowerCase();
  if (['pendiente', 'pendiente_activacion', 'pendiente-activacion', 'pendiente activacion', 'pending', 'pending_activation', 'pending-activation', 'first_access', 'primer_acceso', 'pending-first-access'].includes(status)) {
    return 'pending';
  }
  if (['activo', 'active', 'activa', 'activated', 'habilitado'].includes(status)) {
    return 'active';
  }
  if (['suspendido', 'suspended', 'blocked', 'bloqueado'].includes(status)) {
    return 'suspended';
  }
  if (['expired', 'vencido', 'expirado'].includes(status)) {
    return 'expired';
  }
  if (['inactivo', 'inactive', 'eliminado', 'deleted', 'removed', 'retired'].includes(status)) {
    return 'inactive';
  }
  return status || 'active';
}

function normalizeSectorValue(value) {
  if (!value) return '';
  const normalized = String(value).trim();
  const mapping = {
    tecnologia: 'Tecnología',
    educacion: 'Educación',
    salud: 'Salud & Farmacéutica',
    finanzas: 'Finanzas & Banca',
    manufactura: 'Manufactura',
    retail: 'Retail & E-commerce',
    logistica: 'Logística & Transporte',
    energia: 'Energía',
    gobierno: 'Gobierno',
    otro: 'Otro'
  };
  return mapping[normalized.toLowerCase()] || normalized;
}

function isDeletedStatus(rawStatus) {
  const status = normalizeStatus(rawStatus);
  return ['inactive', 'deleted'].includes(status);
}

// Protección por servidor de las áreas privadas (admin pp/ y empresa/).
// Debe registrarse ANTES de express.static para que ningún recurso de esas
// carpetas se sirva sin autenticación previa.
app.use(protectPortalArea);
// Resuelve alias y /enterprise/* a su archivo real dentro del área protegida,
// DESPUÉS del guard: /tenants → /pp/tenants(.html), /enterprise/x → /empresa/x(.html).
app.use((req, res, next) => {
  if (PORTAL_ALIASES[req.path]) {
    req.url = PORTAL_ALIASES[req.path];
  } else if (req.path.startsWith('/enterprise/')) {
    req.url = '/empresa/' + req.path.slice('/enterprise/'.length);
  }
  next();
});
// Blindaje: nunca servir como estático código fuente, configs ni secretos.
// El bundle serverless contiene server.js (el entrypoint) en la raíz, por lo
// que sin este guard `GET /backend/server.js` devolvía el código del backend.
app.use((req, res, next) => {
  let p = req.path || '';
  try { p = decodeURIComponent(p); } catch (e) { /* path no decodificable */ }
  p = p.toLowerCase();
  const blocked =
    p.startsWith('/backend/') ||
    p.startsWith('/scripts/') ||
    p.startsWith('/supabase/') ||
    p.startsWith('/node_modules/') ||
    p.startsWith('/.git') ||
    p === '/.env' || p.startsWith('/.env') ||
    p === '/package.json' || p === '/package-lock.json' || p === '/vercel.json' ||
    /^\/api\/[^/]+\.(js|jsx|ts|tsx|json|map)$/.test(p);
  if (blocked) return res.status(404).send('Not found');
  next();
});
// express.static con extensions:['html'] → soporta URLs limpias
// (/pp/tenants → pp/tenants.html, /empresa/team → empresa/team.html,
// /tenants → pp/tenants.html) SIN exponerlas: el guard de auth corre
// antes y ambas rutas (limpia y .html) pasan por él.
app.use(express.static(path.join(__dirname, '..'), { extensions: ['html'] }));

function generateSecurePassword() {
  return crypto.randomBytes(8).toString('hex');
}

function generateVerificationCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return crypto.randomInt(min, max).toString().padStart(length, '0');
}

const PORT = process.env.PORT || 5173;
// JWT Secret verification
if (!process.env.JWT_SECRET) {
  if (IS_SERVERLESS || process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET debe configurarse en el entorno de producción.');
  }
  console.error('[STARTUP] CRÍTICO: JWT_SECRET no está definido. Los tokens JWT no funcionarán correctamente.');
}



async function findTenantByIdentifier(identifier) {
  if (!identifier) return null;
  const normalizedIdentifier = String(identifier).trim();

  if (!supabase) {
    console.warn('[TENANT_LOOKUP] Supabase not available');
    return null;
  }

  try {
    const { data: tenant, error } = await supabase.from('tenants').select('*').eq('codigo', normalizedIdentifier).maybeSingle();
    if (!error && tenant) return tenant;
  } catch (err) { console.warn('[TENANT_LOOKUP] Supabase codigo lookup failed:', err.message); }

  try {
    const { data: tenant, error } = await supabase.from('tenants').select('*').eq('id', normalizedIdentifier).maybeSingle();
    if (!error && tenant) return tenant;
  } catch (err) { console.warn('[TENANT_LOOKUP] Supabase id lookup failed:', err.message); }

  console.warn(`[TENANT_LOOKUP] Tenant not found for identifier: ${normalizedIdentifier}`);
  return null;
}

// ======================================================================
// MÓDULO DE EMAIL — configuración 100% por entorno (SMTP_
// ======================================================================
// CRÍTICO corregido: antes el host/port estaban hardcodeados a Gmail; sin
// credenciales todo envío fallaba (y algunos flujos fingían éxito). Ahora:
//  - SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (fallback: EMAIL_USER/EMAIL_PASS)
//  - Si faltan credenciales, enviarCorreo() lanza un error CLARO en vez de
//    fallar silenciosamente. Ningún flujo oculta un error SMTP.
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const SMTP_CONFIGURADO = Boolean(SMTP_USER && SMTP_PASS);

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: SMTP_CONFIGURADO ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  pool: false, // 🔧 FIX VERCEL: Desactivar pool de sockets para evitar conexiones muertas en serverless
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000
});

const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || EMAIL_FROM;

// Punto único de envío: valida configuración y aporta el remitente por defecto.
async function enviarCorreo(opciones) {
  if (!SMTP_CONFIGURADO) {
    const err = new Error('SMTP no configurado: define SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS (o EMAIL_USER/EMAIL_PASS) en las variables de entorno. El correo no fue enviado.');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const mail = { ...opciones };
  if (!mail.from) mail.from = `"Portal Pilot" <${EMAIL_FROM}>`;
  return transporter.sendMail(mail);
}

// 🔧 FIX VERCEL: Eliminar dispatchEmailAsync (no funciona en serverless)
// En su lugar, todas las funciones de email ahora son await directamente

async function obtenerUbicacion(ip) {
  try {
    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.')) {
      return 'Desarrollo Local';
    }
    const response = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
    if (response.data && response.data.status === 'success') {
      return `${response.data.city}, ${response.data.country} (Aproximado)`;
    }
    return 'Ubicación Desconocida';
  } catch (error) {
    return 'Ubicación Desconocida';
  }
}

function obtenerDispositivo(userAgent) {
  if (!userAgent) return 'Dispositivo Desconocido';

  let browser = 'Navegador Desconocido';
  let os = 'Sistema Operativo Desconocido';

  if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Chrome') && !userAgent.includes('Chromium')) browser = 'Chrome';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  return `${browser} en ${os}`;
}

// 🔧 FIX VERCEL: Función auxiliar para cargar plantillas con fallback
function cargarPlantilla(rutasPosibles, fallbackHtml) {
  for (const ruta of rutasPosibles) {
    try {
      if (fs.existsSync(ruta)) {
        return fs.readFileSync(ruta, 'utf8');
      }
    } catch (err) {
      console.warn(`[PLANTILLA] No se pudo leer ${ruta}:`, err.message);
    }
  }
  console.warn(`[PLANTILLA] Usando fallback HTML para plantilla`);
  return fallbackHtml;
}

// 🔔 Envía notificación de prueba gratuita vencida
async function enviarEmailTrialVencido({ email, nombre, empresaCodigo, empresaNombre }) {
  try {
    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Trial Vencido.html'),
      path.join(__dirname, '../empresa/EMAIL enterprise/Trial Vencido.html'),
      path.join(__dirname, 'templates/Trial Vencido.html')
    ];

    const opciones = { day: 'numeric', month: 'long', year: 'numeric' };
    const fechaVencimiento = new Intl.DateTimeFormat('es-HN', opciones).format(new Date());

    const fallbackHtml = `<!DOCTYPE html><html><body>
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0b0a15;color:#e2e8f0;padding:24px;border-radius:12px;">
        <h2 style="color:#fbbf24;">Tu prueba gratuita ha vencido</h2>
        <p>Hola ${nombre || ''}, tu prueba gratuita de 15 días de <strong>Portal Pilot</strong> ha finalizado.</p>
        <p>Para seguir usando tus datos, elige el plan <strong>Business (L1,499/mes)</strong> o <strong>Enterprise (L4,999/mes)</strong>.</p>
        <p style="text-align:center;margin:24px 0;"><a href="https://portal-pilot.vercel.app/pay_plan.html?plan=business" style="background:#8b5cf6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Elegir un Plan</a></p>
      </div>
      </body></html>`;

    const htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml)
      .replaceAll('{{USER_NAME}}', nombre || '')
      .replaceAll('{{COMPANY_NAME}}', empresaNombre || empresaCodigo || 'tu empresa')
      .replaceAll('{{COMPANY_CODE}}', empresaCodigo || '')
      .replaceAll('{{EXPIRY_DATE}}', fechaVencimiento);

    const destino = String(email || '').trim().toLowerCase();
    if (!destino) return null;

    await enviarCorreo({
      from: `"Portal Pilot" <${EMAIL_FROM}>`,
      to: destino,
      subject: '⏳ Tu prueba gratuita de Portal Pilot ha vencido',
      html: htmlContent
    });

    console.log(`[TRIAL] Correo de prueba vencida enviado a ${destino}`);
    return true;
  } catch (error) {
    console.error('[TRIAL] Error enviando correo de prueba vencida:', error.message);
    return null;
  }
}

async function enviarAlertaNuevoAcceso(emailDestinatario, req, success = true) {
  try {
    const ipRaw = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const ip = ipRaw.includes('::ffff:') ? ipRaw.replace('::ffff:', '') : ipRaw;

    const [ubicacion, dispositivo] = await Promise.all([
      obtenerUbicacion(ip),
      obtenerDispositivo(req.headers['user-agent'])
    ]);

    const opciones = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
    const fechaActual = new Intl.DateTimeFormat('es-HN', opciones).format(new Date());

    // 🔧 FIX VERCEL: Rutas de plantillas con múltiples intentos
    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Nuevo Acceso.html'),
      path.join(__dirname, '../EMAIL PORTAL PILOT/nuevo_acceso.html'),
      path.join(__dirname, '../empresa/EMAIL enterprise/Nuevo Acceso.html'),
      path.join(__dirname, 'templates/Nuevo Acceso.html'),
      path.join(__dirname, 'templates/nuevo_acceso.html')
    ];

    const fallbackHtml = `<!DOCTYPE html><html><body><p>${success ? 'Nuevo inicio de sesión detectado' : 'Intento de acceso fallido detectado'}</p></body></html>`;
    let htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml);

    const titulo = success ? 'Nuevo inicio de sesión detectado' : 'Intento de acceso fallido detectado';
    const mensajePrincipal = success
      ? `Se ha detectado un acceso exitoso desde ${dispositivo} (${ubicacion}) el ${fechaActual}.`
      : `Se ha detectado un intento de acceso fallido desde ${dispositivo} (${ubicacion}) el ${fechaActual}.`;

    const loginUrl = 'https://portal-pilot.vercel.app/login.html';

    htmlContent = htmlContent
      .replace('{{TITLE}}', titulo)
      .replace('{{MAIN_MESSAGE}}', mensajePrincipal)
      .replace('{{USER_EMAIL}}', emailDestinatario)
      .replace('{{PASSWORD_BLOCK}}', '---')
      .replace('{{TENANT_INFO}}', 'Información de tenant no disponible')
      .replace('{{LOGIN_URL}}', loginUrl)
      .replace('{{LOGIN_BUTTON_TEXT}}', 'Ir al login de Portal Pilot')
      .replace('{{SECURITY_FOOTER}}', success ? 'Si reconoces este inicio, no es necesario hacer nada.' : 'Si no fuiste tú, cambia tu contraseña.')
      .replace('{{BANNER}}', '');

    if (!success) {
      const warningBanner = `<div style="background-color: #dc2626; color: #ffffff; text-align: center; padding: 12px; font-weight: bold;">⚠️ AVISO: Intento de inicio de sesión BLOQUEADO</div>`;
      htmlContent = htmlContent.replace('{{BANNER}}', warningBanner);
    }

    const textContent = `${titulo}\n\n${mensajePrincipal}\n\nUsuario: ${emailDestinatario}`;
    const mailOptions = {
      from: `"Seguridad Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: success ? '⚠️ Alerta de Seguridad: Nuevo inicio de sesión' : '🚨 ALERTA: Intento de acceso fallido',
      text: textContent,
      html: htmlContent
    };

    await enviarCorreo(mailOptions);
    console.log(`[Seguridad] Correo enviado a ${emailDestinatario} (Exitoso: ${success})`);
  } catch (error) {
    console.error('[Seguridad] Error al enviar correo:', error.message);
  }
}

async function enviarAlertaActivacionCuenta(emailDestinatario, passwordTemporal, tokenForLink = null, tenantName = null) {
  try {
    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Activación de Cuenta.html'),
      path.join(__dirname, '../empresa/EMAIL enterprise/Activación de Cuenta.html'),
      path.join(__dirname, 'templates/Activación de Cuenta.html')
    ];

    const fallbackHtml = `
      <div style="font-family: sans-serif; max-width:600px;margin:0 auto;background:#0b0a15;color:#e2e8f0;padding:20px;border-radius:12px;">
        <h2>Activación de Cuenta</h2>
        <p>Tu contraseña temporal es: <code style="background:#1e1b4b;padding:4px 8px;border-radius:4px;">${passwordTemporal}</code></p>
        <p>Accede en: <a href="https://portal-pilot.vercel.app/primer_acceso.html">Portal Pilot</a></p>
      </div>
    `;
    let htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml);

    const passwordPlaceholderRegex = /\{\{\s*TEMP_PASSWORD\s*\}\}/g;
    htmlContent = htmlContent.replace(passwordPlaceholderRegex, () => passwordTemporal);
    if (!passwordPlaceholderRegex.test(htmlContent)) {
      htmlContent = htmlContent.replace(/TEMP_PASSWORD/g, () => passwordTemporal);
    }

    let loginUrl = `https://portal-pilot.vercel.app/primer_acceso.html?email=${encodeURIComponent(emailDestinatario)}`;
    if (tokenForLink) loginUrl += `&token=${encodeURIComponent(tokenForLink)}`;

    htmlContent = htmlContent.replace(/https:\/\/portal-pilot\.vercel\.app(?:\/[^"'\s]*)?/g, loginUrl);

    const displayTenant = tenantName || 'Portal Pilot';
    htmlContent = htmlContent.replace(/\{\{\s*TENANT_NAME\s*\}\}/g, displayTenant);
    htmlContent = htmlContent.replace(/\{\{\s*TENANT\s*\}\}/g, displayTenant);

    const mailOptions = {
      from: `"Seguridad Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: '🔑 Activación de Cuenta: Credenciales de acceso temporal',
      text: `Activación para ${emailDestinatario}\nContraseña temporal: ${passwordTemporal}\nAccede: ${loginUrl}`,
      html: htmlContent
    };

    await enviarCorreo(mailOptions);
    console.log(`[Activación] Correo enviado a ${emailDestinatario}`);
    return true;
  } catch (error) {
    console.error('[Activación] Error al enviar correo:', error.message);
    return false;
  }
}

async function enviarOnboardingEmail(emailDestinatario, datos = {}) {
  try {
    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Onboarding.html'),
      path.join(__dirname, 'templates/Onboarding.html')
    ];

    const fallbackHtml = `
      <div style="font-family: sans-serif; max-width:600px;margin:0 auto;background:#0b0a15;color:#e2e8f0;padding:20px;border-radius:12px;">
        <h2>Bienvenido a Portal Pilot</h2>
        <p>Tu cuenta ha sido activada exitosamente.</p>
        <p>Accede en: <a href="https://portal-pilot.vercel.app/login.html">Portal Pilot</a></p>
      </div>
    `;
    let htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml);

    htmlContent = htmlContent
      .replaceAll('{{USER_NAME}}', datos.nombre || '')
      .replaceAll('{{COMPANY_NAME}}', datos.empresaNombre || 'tu empresa')
      .replaceAll('{{COMPANY_CODE}}', datos.empresaCodigo || '')
      .replaceAll('{{PLAN_NAME}}', datos.planNombre || 'Prueba Gratuita');

    const mailOptions = {
      from: `"Soporte Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: '🚀 Bienvenido a Portal Pilot: Acceso Concedido',
      text: `Bienvenido a Portal Pilot, ${emailDestinatario}.`,
      html: htmlContent
    };

    await enviarCorreo(mailOptions);
    console.log(`[Onboarding] Correo enviado a ${emailDestinatario}`);
  } catch (error) {
    console.error('[Onboarding] Error al enviar correo:', error.message);
  }
}

async function enviarCambioEstadoUsuario(emailDestinatario, action, adminEmail, reason) {
  try {
    const isSuspended = action === 'suspended';
    const subject = isSuspended ? '⚠️ Tu cuenta ha sido suspendida' : '✅ Cuenta reactivada';
    const actionText = isSuspended ? 'suspendida' : 'reactivada';
    const reasonText = reason ? `<p>Motivo: <strong>${reason}</strong></p>` : '';

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; padding: 30px; border-radius: 16px;">
        <h2>Tu cuenta ha sido ${actionText}</h2>
        <p>Un administrador ha ${actionText} tu acceso.</p>
        ${reasonText}
        <p>Administrador: ${adminEmail}</p>
      </div>`;

    await enviarCorreo({
      from: `"Seguridad Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject,
      text: `Tu cuenta ha sido ${actionText}.`,
      html: htmlContent
    });
    console.log(`[EstadoUsuario] Correo enviado a ${emailDestinatario}`);
  } catch (error) {
    console.error('[EstadoUsuario] Error:', error.message);
  }
}

async function enviarNuevoAccesoUsuario(emailDestinatario, passwordTemporal, tenantName, userName) {
  try {
    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Nuevo Acceso.html'),
      path.join(__dirname, '../empresa/EMAIL enterprise/Nuevo Acceso.html'),
      path.join(__dirname, 'templates/Nuevo Acceso.html')
    ];

    const fallbackHtml = `
      <div style="font-family: sans-serif; max-width:600px;margin:0 auto;background:#0b0a15;color:#e2e8f0;padding:20px;border-radius:12px;">
        <h2>Nuevo Acceso a Portal Pilot</h2>
        <p>Hola ${userName || emailDestinatario}, tu usuario ha sido creado.</p>
        <p><strong>Contraseña temporal:</strong> <code>${passwordTemporal}</code></p>
      </div>
    `;
    let htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml);

    const loginUrl = 'https://portal-pilot.vercel.app/login.html';
    const displayName = userName || emailDestinatario;
    const tenantLabel = tenantName ? `Tenant: ${tenantName}` : '';
    const passwordText = passwordTemporal
      ? `<strong>Contraseña temporal:</strong> <code>${passwordTemporal}</code>`
      : '<strong>Contraseña:</strong> Generada automáticamente.';

    htmlContent = htmlContent
      .replace('{{TITLE}}', 'Nuevo Acceso a Portal Pilot')
      .replace('{{SUBTITLE}}', `Hola ${displayName}, tu usuario ha sido creado.`)
      .replace('{{MAIN_MESSAGE}}', 'Puedes iniciar sesión con las credenciales abajo.')
      .replace('{{USER_EMAIL}}', emailDestinatario)
      .replace('{{PASSWORD_BLOCK}}', passwordText)
      .replace('{{TENANT_INFO}}', tenantLabel)
      .replace('{{LOGIN_URL}}', loginUrl)
      .replace('{{LOGIN_BUTTON_TEXT}}', 'Ir a login')
      .replace('{{SECURITY_FOOTER}}', 'Si no solicitaste este acceso, contacta a soporte.')
      .replace('{{BANNER}}', '');

    const mailOptions = {
      from: `"Seguridad Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: '🔐 Nuevo Acceso: Portal Pilot',
      text: `Nuevo acceso para ${displayName}.\n${tenantLabel}\n${passwordTemporal ? 'Contraseña: ' + passwordTemporal : ''}`,
      html: htmlContent
    };

    await enviarCorreo(mailOptions);
    console.log(`[Acceso Usuario] Correo enviado a ${emailDestinatario}`);
    return true;
  } catch (error) {
    console.error('[Acceso Usuario] Error:', error.message);
    return false;
  }
}

async function enviarCorreoPortalPilot(emailDestinatario, asunto, titulo, subtitulo, detallesHTML) {
  try {
    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 30px;">
        <div style="text-align: center; border-bottom: 1px solid #1e1b4b; padding-bottom: 20px; margin-bottom: 25px;">
          <span style="font-size: 24px; font-weight: 800; color: #ffffff;">Portal <span style="color: #8b5cf6;">Pilot</span></span>
          <p style="color: #94a3b8; font-size: 13px;">Notificaciones del Ecosistema</p>
        </div>
        <h2 style="color: #ffffff; font-size: 18px;">${titulo}</h2>
        <p style="color: #94a3b8; font-size: 14px;">${subtitulo}</p>
        <div style="background-color: #111022; border-left: 4px solid #8b5cf6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          ${detallesHTML}
        </div>
        <div style="font-size: 11px; color: #64748b; text-align: center; margin-top: 35px; border-top: 1px solid #1e1b4b; padding-top: 20px;">
          © 2026 Portal Pilot. Todos los derechos reservados.
        </div>
      </div>
    `;

    await enviarCorreo({
      from: `"Notificaciones Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: asunto,
      text: `${titulo}\n\n${subtitulo}`,
      html: htmlContent
    });
    console.log(`[Notificación] Correo enviado a ${emailDestinatario}: "${asunto}"`);
  } catch (error) {
    console.error('[Notificación] Error:', error.message);
  }
}

// ======================================================================
// RUTAS
// ======================================================================

// ── Panel admin pp/: endpoints /api/admin/* (ROOT) ──
// Debe montarse ANTES de authenticate global alguno; el router aplica su
// propio guard ROOT por request. Rutas: tickets, bots, renovaciones,
// cobranza, alertas, consumo_planes, planes, provisionar, integraciones,
// seguridad, consumo_ia, incidentes, kyc, finanzas, comunicados, reglas,
// stream y respaldos.
if (adminPortal) app.use('/api/admin', authenticate, adminPortal);

// 🔧 FIX VERCEL: Health check endpoint
// No revelar configuración interna (Supabase/JWT/entorno) a clientes anónimos.
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok' });
});

// ======================================================================
// NOTIFICACIONES API (SUPABASE REAL)
// ======================================================================
app.get('/api/notificaciones', authenticate, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    let query = supabase
      .from('notificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!isRootUser(req)) query = query.eq('empresa_codigo', getTenantCode(req));
    const { data: notifs, error } = await query;

    if (error) throw error;
    const unreadCount = (notifs || []).filter(n => !n.leida).length;
    res.json({ notificaciones: notifs || [], unread_count: unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al obtener notificaciones' });
  }
});

app.put('/api/notificaciones/:id/read', authenticate, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { id } = req.params;
    const { data: notification, error: lookupError } = await supabase
      .from('notificaciones').select('empresa_codigo').eq('id', id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!notification) return res.status(404).json({ error: 'Notificación no encontrada.' });
    if (!assertTenantAccess(req, notification.empresa_codigo)) {
      return res.status(403).json({ error: 'No tienes acceso a esta notificación.' });
    }
    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Notificación marcada como leída' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al actualizar notificación' });
  }
});

app.post('/api/notificaciones', authenticate, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { empresa_codigo, titulo, mensaje, tipo, prioridad } = req.body;
    const targetTenant = empresa_codigo || getTenantCode(req);
    if (!targetTenant || !assertTenantAccess(req, targetTenant)) {
      return res.status(403).json({ error: 'No tienes acceso a la empresa indicada.' });
    }
    const { data, error } = await supabase
      .from('notificaciones')
      .insert({
        empresa_codigo: targetTenant,
        titulo: titulo || 'Notificación',
        mensaje: mensaje || '',
        tipo: tipo || 'info',
        prioridad: prioridad || 'normal'
      });

    if (error) throw error;
    res.json({ success: true, notificacion: data });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al crear notificación' });
  }
});

// ======================================================================
// STORAGE UPLOAD API (SUPABASE STORAGE)
// ======================================================================
app.post('/api/upload-image', authenticate, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { imageBase64, filename, contentType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Base64 image data missing' });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de imagen no permitido.' });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'La imagen debe pesar como máximo 5 MB.' });
    }
    const safeFilename = path.basename(filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `uploads/${getTenantCode(req)}/${Date.now()}_${safeFilename}`;
    const mime = contentType;

    const { data, error } = await supabase.storage.upload('portal-pilot-assets', filePath, buffer, mime);
    if (error) throw error;

    const publicUrl = supabase.storage.getPublicUrl('portal-pilot-assets', filePath);
    res.json({ success: true, url: publicUrl, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al subir imagen a Supabase Storage' });
  }
});

app.get('/api/config', (req, res) => {
  // Compatibilidad: el flujo CANÓNICO de registro es registrov2.html →
  // POST /api/registro (crea Auth + perfil con el MISMO id). El viejo flujo
  // client-side (signUp en el navegador + /api/registro) creaba usuarios
  // Auth huérfanos con id distinto al perfil. Se mantiene la respuesta por
  // si existe cache, PERO ya no se expone la URL del proyecto.
  res.json({ supabaseUrl: null, supabaseAnonKey: null, registroLegacy: false });
});
// -------------------------------------------------------------------------
// CONFIGURACION GLOBAL (panel ROOT) - persiste en configuraciones_globales
// -------------------------------------------------------------------------
function validarClaveConfig(clave) {
  return /^[A-Za-z0-9_]{1,100}$/.test(String(clave || '').trim());
}

app.get('/api/global/config', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { data, error } = await supabase
      .from('configuraciones_globales')
      .select('clave, valor, entorno, sensible, descripcion, updated_at')
      .order('clave', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ configuraciones: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/global/config', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const cuerpo = Array.isArray(req.body && req.body.configuraciones) ? req.body.configuraciones : [];
    if (!cuerpo.length) return res.status(400).json({ error: 'Enviar configuraciones a guardar.' });
    const ahora = new Date().toISOString();
    const filas = [];
    const claves = [];
    for (const c of cuerpo) {
      const clave = String((c && c.clave) || '').trim();
      if (!validarClaveConfig(clave)) continue;
      const valor = (c.valor === null || c.valor === undefined) ? '' : String(c.valor);
      filas.push({
        clave,
        valor,
        entorno: String((c && c.entorno) || 'production').slice(0, 30),
        sensible: !!(c && c.sensible),
        descripcion: (c && c.descripcion) ? String(c.descripcion).slice(0, 300) : null,
        updated_at: ahora
      });
      claves.push(clave);
    }
    if (!filas.length) return res.status(400).json({ error: 'No hay claves validas.' });
    const { error } = await supabase.from('configuraciones_globales').upsert(filas, { onConflict: 'clave' });
    if (error) return res.status(500).json({ error: error.message });
    const quien = (req.user && req.user.email) || 'root';
    await registrarAuditoria('ROOT', 'config_actualizada', 'Configuracion global actualizada: ' + claves.join(', '), 'config', quien, req);
    return res.json({ ok: true, actualizadas: claves.length });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/global/config/:clave', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const clave = String(req.params.clave || '').trim();
    if (!validarClaveConfig(clave) || clave.toUpperCase() === 'SITE_NAME') {
      return res.status(400).json({ error: 'Clave invalida o protegida.' });
    }
    const { error } = await supabase.from('configuraciones_globales').delete().eq('clave', clave);
    if (error) return res.status(500).json({ error: error.message });
    const quien = (req.user && req.user.email) || 'root';
    await registrarAuditoria('ROOT', 'config_eliminada', 'Configuracion global eliminada: ' + clave, 'config', quien, req);
    return res.json({ ok: true, clave });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/global/admins', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { data, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, rol, rol_global, estado, activo, ultimo_acceso, empresa_codigo')
      .order('nombre', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    const admins = (data || [])
      .filter(function (u) {
        const rg = String(u.rol_global || '').toLowerCase();
        const r = String(u.rol || '').toLowerCase();
        return ['root', 'root pp', 'superadmin'].includes(rg) || ['root', 'root pp', 'superadmin'].includes(r);
      })
      .map(function (u) {
        return {
          id: u.id,
          nombre: (u.nombre || '').trim() || 'Sin nombre',
          email: u.email || '',
          rol: (u.rol_global || u.rol || 'admin'),
          estado: (u.estado || 'activo'),
          activo: u.activo !== false,
          ultimo_acceso: u.ultimo_acceso || null,
          empresa_codigo: u.empresa_codigo || 'ROOT'
        };
      });
    return res.json({ total: admins.length, admins });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/global/admins', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const nombre = String((req.body && req.body.nombre) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalido.' });
    const { data: usuario, error } = await supabase.from('usuarios').select('id, nombre, email, rol, rol_global').eq('email', email).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!usuario) return res.status(404).json({ error: 'No existe ningun usuario con ese email.' });
    const payload = { rol: 'root', rol_global: 'root', updated_at: new Date().toISOString() };
    if (nombre && usuario.nombre !== nombre) payload.nombre = nombre.slice(0, 100);
    const { error: upErr } = await supabase.from('usuarios').update(payload).eq('id', usuario.id);
    if (upErr) return res.status(500).json({ error: upErr.message });
    const quien = (req.user && req.user.email) || 'root';
    await registrarAuditoria('ROOT', 'admin_creado', 'Administrador global agregado: ' + email, 'config', quien, req);
    return res.json({ ok: true, admin: { id: usuario.id, nombre: (usuario.nombre || '').trim(), email, rol: 'root' } });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/global/admins/:id', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const id = String(req.params.id || '');
    if (id === req.user.sub) return res.status(400).json({ error: 'No puedes remover tu propio acceso de administrador.' });
    const { data: usuario, error } = await supabase.from('usuarios').select('id, email').eq('id', id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
    const { error: upErr } = await supabase.from('usuarios').update({ rol: 'admin', rol_global: 'operador', updated_at: new Date().toISOString() }).eq('id', id);
    if (upErr) return res.status(500).json({ error: upErr.message });
    const quien = (req.user && req.user.email) || 'root';
    await registrarAuditoria('ROOT', 'admin_eliminado', 'Administrador global removido: ' + (usuario.email || id), 'config', quien, req);
    return res.json({ ok: true, id });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/check-email', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { data: users, error } = await supabase.from('usuarios').select('id, email, rol, estado, activo').limit(50);
    if (error) throw error;
    const formatted = (users || []).map(u => ({
      id: u.id,
      email: u.email || '(sin email)',
      rol: u.rol || '(sin rol)',
      status: u.estado || '(sin status)',
      tiene_password: true
    }));
    res.json({ total: formatted.length, usuarios: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/diagnostico', authenticate, requireRoot, async (req, res) => {
  const result = {
    entorno: process.env.NODE_ENV || 'no definido',
    is_serverless: IS_SERVERLESS,
    supabase_configured: !!process.env.SUPABASE_URL,
    email_user: process.env.EMAIL_USER ? '✅ DEFINIDO' : '❌ FALTA',
    email_pass: process.env.EMAIL_PASS ? '✅ DEFINIDO' : '❌ FALTA',
    jwt_secret: process.env.JWT_SECRET ? '✅ DEFINIDO' : '❌ FALTA',
    smtp_configurado: SMTP_CONFIGURADO ? '✅ DEFINIDO' : '❌ FALTA (define SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS o EMAIL_USER/EMAIL_PASS)',
    ai_providers_configurados: Object.keys(AI_PROVIDERS).filter(k => AI_PROVIDERS[k].getKey()).join(', ') || 'NINGUNO',
    supabase_test: null,
    supabase_error: null
  };

  if (!supabase) {
    result.supabase_error = '❌ Cliente Supabase no disponible';
  } else {
    try {
      const { data, error } = await supabase.from('usuarios').select('id').limit(1);
      if (error) throw error;
      result.supabase_test = `✅ CONEXIÓN OK - Usuarios encontrados: ${data?.length ?? 0}`;
    } catch (err) {
      result.supabase_error = `❌ ERROR: ${err.message}`;
    }
  }

  res.json(result);
});

app.get('/api/test-email', authenticate, requireRoot, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Ruta no disponible.' });
  }
  const targetEmail = req.query.to || process.env.EMAIL_USER;
  try {
    await transporter.verify();
    const info = await enviarCorreo({
      from: `"Prueba Portal Pilot" <${EMAIL_FROM}>`,
      to: targetEmail,
      subject: '🧪 Prueba de Notificación por Correo — Portal Pilot',
      text: 'Este es un correo de prueba enviado exitosamente desde el backend de Portal Pilot.'
    });
    res.json({ success: true, message: 'Correo enviado con éxito', messageId: info.messageId, recipient: targetEmail });
  } catch (err) {
    console.error('[TEST EMAIL] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Error desconocido al enviar correo',
      code: err.code || null,
      command: err.command || null,
      response: err.response || null
    });
  }
});

app.post('/api/registro', async (req, res) => {
  try {
    const {
      empresaNombre, empresaCodigo, dominioWorkspace, landPage,
      empresaSize, sise, empresaSector, empresaCountry, zonaHoraria,
      logoUrl, bannerUrl,
      usuarioNombre, usuarioApellido, email, cargo, area, rango,
      perfilFotoUrl, perfilBannerUrl,
      password, dosFaActivo, dosFaSecret, dosFaBackupCodes, terminosAceptados,
      plan
    } = req.body;
    // Contexto de onboarding (Blueprint §2): la app entrega industria/tamaño;
    // se persisten en el tenant para que el Workspace los represente.
    const industria = String(req.body.industria || '').trim() || String(empresaSector || '').trim() || null;
    const tamano = String(req.body.tamano || '').trim() || String(empresaSize || sise || '').trim() || null;

    if (!email || !password || !empresaCodigo || !usuarioNombre || !usuarioApellido) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const emailNorm = String(email).trim().toLowerCase();
    // El código de empresa se normaliza a UPPERCASE en origen para que coincida
    // con resolverEmpresaSupabase (normaliza a mayúsculas) y con la comprobación
    // de unicidad que ya usa toUpperCase (release audit §21).
    const codigoNorm = normalizeTenantCode(empresaCodigo);

    // Consultar existencia previa en Supabase
    if (supabase) {
      const { data: existing } = await supabase.from('usuarios').select('id').eq('email', emailNorm).maybeSingle();
      if (existing) {
        return res.status(409).json({ error: 'El correo ya está registrado.' });
      }
      // Unicidad del código de empresa (release audit): dos tenants no pueden
      // compartir empresa_codigo — contaminaría el scope de aislamiento.
      const { data: dup } = await supabase.from('tenants').select('codigo').eq('codigo', String(empresaCodigo).trim().toUpperCase()).maybeSingle();
      if (dup) {
        return res.status(409).json({ error: 'El código de empresa ya existe. Elige otro nombre/código.' });
      }

      // Autenticación en dos pasos (TOTP) elegida durante el registro: se valida
      // el código en el servidor ANTES de crear nada y se persiste el secreto.
      let campos2fa = { two_factor_enabled: false, two_factor_secret: null, two_factor_confirmed_at: null, two_factor_backup_codes: [] };
      if (dosFaActivo === true || String(dosFaActivo) === 'true') {
        const secreto = normalizarSecretoTotp(dosFaSecret);
        let codigoValido = false;
        try { codigoValido = secreto.length >= 16 && verifyTotp(secreto, req.body.dosFaCode, 2); } catch (e) { codigoValido = false; }
        if (!codigoValido) {
          return res.status(400).json({ error: 'No se pudo verificar el código 2FA. Escanea de nuevo el código e inténtalo otra vez.' });
        }
        const codigosRespaldo = Array.isArray(dosFaBackupCodes) ? dosFaBackupCodes.filter(Boolean).map(hashBackupCode) : [];
        campos2fa = {
          two_factor_enabled: true,
          two_factor_secret: secreto,
          two_factor_confirmed_at: new Date().toISOString(),
          two_factor_backup_codes: codigosRespaldo
        };
      }

      const { company_banner, company_logo, profile_banner, profile_pic } = req.body || {};

      // Crear tenant en Supabase
      await supabase.from('tenants').upsert({
        codigo: codigoNorm,
        nombre_empresa: empresaNombre || 'Portal Pilot',
        dominio: (dominioWorkspace && dominioWorkspace.trim()) ? dominioWorkspace.trim() : null,
        plan: plan || 'starter',
        area: industria,
        tamano: tamano,
        estado: 'activo'
      }, { onConflict: 'codigo' });

      // Hashear contraseña y crear usuario en Supabase
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const userUuid = crypto.randomUUID();
      // El primer usuario del tenant es el OWNER (Blueprint §3/§6).
      const { data: newUser, error: userErr } = await supabase.from('usuarios').insert({
        id: userUuid,
        email: emailNorm,
        password_hash: passwordHash,
        password: passwordHash,
        nombre: String(usuarioNombre || '').trim(),
        apellido: usuarioApellido || '',
        rol: 'owner',
        rol_global: 'owner',
        empresa_codigo: codigoNorm,
        estado: 'activo',
        activo: true,
        foto_perfil_url: profile_pic || company_logo || null,
        ...campos2fa
      });

      if (userErr) {
        console.error('[REGISTRO] Error insertando usuario en Supabase:', JSON.stringify(userErr));
        return res.status(400).json({ error: userErr.message || userErr.details || 'Error al crear usuario en base de datos' });
      }

      // Suscripción inicial (Blueprint §14): trial 15 días para starter, activa para planes pagados.
      try {
        const planClave = normalizePlan(plan || 'starter');
        const { data: planRow } = await supabase.from('planes').select('id').eq('clave', planClave).maybeSingle();
        await supabase.from('subscriptions').upsert({
          empresa_codigo: codigoNorm,
          plan_id: planRow?.id || null,
          estado: planClave === 'starter' ? 'trial' : 'active',
          trial_started_at: new Date().toISOString(),
          trial_ends_at: planClave === 'starter' ? new Date(Date.now() + 15 * 86400000).toISOString() : null,
          current_period_start: new Date().toISOString()
        }, { onConflict: 'empresa_codigo' });
      } catch (subErr) {
        console.warn('[REGISTRO] subscriptions best-effort:', subErr.message);
      }
    }

    // AUTOMATION HOOK: tenant_creado
    dispatchAutomationEvent(codigoNorm, 'tenant_creado', { empresaCodigo: codigoNorm, plan, email }).catch(err => console.warn('[REGISTRO] automation hook error:', err.message));

    return res.status(201).json({ 
      message: 'Tenant creado con éxito',
      empresaCodigo: codigoNorm,
      dominioWorkspace: dominioWorkspace || null,
      plan: plan || null
    });
  } catch (error) {
    console.error('[REGISTRO EXCEPCION]:', error.stack || error.message);
    return res.status(500).json({ error: error.message || 'No se pudo completar el registro en este momento.' });
  }
});

// Endpoint para enviar código de verificación de email durante el registro
app.post('/api/enviar-codigo-verificacion', emailLimiter, async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      return res.status(400).json({ error: 'Faltan parámetros: email y codigo son requeridos' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Correo inválido' });
    }
    await enviarCorreo({
      from: `"Portal Pilot" <${EMAIL_FROM}>`,
      to: email,
      subject: `🔐 Tu código de verificación de Portal Pilot: ${codigo}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0f0f1a;color:#e0e0f0;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
            <h1 style="margin:0;font-size:24px;color:#fff;">Portal Pilot</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);">Código de verificación</p>
          </div>
          <div style="padding:32px;text-align:center;">
            <p style="margin:0 0 24px;font-size:15px;color:#a0a0c0;">Usa este código para verificar tu cuenta. Expira en 10 minutos.</p>
            <div style="font-size:42px;font-weight:800;letter-spacing:14px;color:#6366f1;font-family:monospace;background:rgba(99,102,241,0.1);padding:20px;border-radius:10px;display:inline-block;">${codigo}</div>
            <p style="margin:24px 0 0;font-size:13px;color:#666;">¿No solicitaste esto? Ignora este mensaje.</p>
          </div>
        </div>
      `
    });
    res.json({ success: true, message: 'Código enviado correctamente' });
  } catch (err) {
    console.error('[CODIGO-VERIFICACION] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function getModulesForAreaAndPlan(area = '', plan = 'pro') {
  const areaNorm = (area || '').toLowerCase();
  const planNorm = normalizePlan(plan);

  let modulos = [];

  if (areaNorm.includes('retail')) {
    modulos = ['pos_caja', 'inventario_rapido', 'control_stock', 'facturacion_sar', 'credito_clientes'];
  } else if (areaNorm.includes('membresía') || areaNorm.includes('tecnológica') || areaNorm.includes('membresia')) {
    modulos = ['gestion_membresias', 'ventas_mayoreo', 'pos_escaner', 'facturacion_sar', 'analytics_ventas'];
  } else if (areaNorm.includes('tradicional') || areaNorm.includes('pulpería')) {
    modulos = ['pos_pulperia', 'control_caja', 'inventario_basico', 'cuentas_por_cobrar', 'facturacion_sar'];
  } else if (areaNorm.includes('moderno') || areaNorm.includes('supermercado')) {
    modulos = ['pos_multicaja', 'inventario_avanzado', 'transferencias_bodega', 'facturacion_sar', 'despacho_flotas'];
  } else {
    modulos = ['pos_ventas', 'inventario_multibodega', 'facturacion_sar', 'clientes_proveedores', 'reportes_comerciales'];
  }

  if (planNorm === 'starter') {
    modulos = modulos.slice(0, 3);
  } else if (planNorm === 'enterprise' || planNorm === 'corporativo') {
    modulos.push('automatizacion_rpa', 'flota_vehiculos', 'api_keys_seguridad');
  }

  return modulos;
}

// Mensaje genérico: nunca revelar si el correo existe (evita enumeración de usuarios).
const LOGIN_ERROR_GENERIC = 'Credenciales inválidas. Verifica tu correo y contraseña.';
// Hash señuelo válido: se compara cuando el usuario no existe para igualar el
// tiempo de respuesta y evitar distinguir correos registrados por timing.
const LOGIN_DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Por favor, proporciona email y contraseña.' });
    }

    const emailNorm = String(email).trim().toLowerCase();

    let userRow = null;

    if (supabase) {
      const { data: found, error: findErr } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', emailNorm)
        .maybeSingle();

      if (findErr) {
        console.warn('[LOGIN] Error buscando usuario en Supabase:', findErr.message);
      }
      if (found) {
        userRow = found;
      }
    }

    if (!userRow) {
      // Comparación señuelo para no filtrar la existencia del correo por timing.
      try { await bcrypt.compare(String(password || ''), LOGIN_DUMMY_HASH); } catch (e) { /* noop */ }
      return res.status(401).json({ error: LOGIN_ERROR_GENERIC });
    }

    let isMatch = false;
    const storedHash = userRow.password_hash || userRow.password;
    if (storedHash && storedHash.startsWith('$2')) {
      isMatch = await bcrypt.compare(password, storedHash);
    } else if (storedHash) {
      // Contraseñas en texto plano (legado) ya no se aceptan: deben restablecerse.
      console.warn(`[LOGIN] Hash inválido (texto plano) para ${emailNorm} — se requiere restablecer contraseña.`);
    }

    if (!isMatch) {
      try {
        if (userRow.empresa_codigo) {
          await registrarAuditoria(userRow.empresa_codigo, 'login_fallido', 'Intento de inicio de sesión fallido', 'seguridad', normalizeDisplayName(userRow.nombre, userRow.apellido), req);
          await registrarEventoSeguridad(userRow.empresa_codigo, 'login_fallido', { usuarioId: userRow.id, usuarioEmail: userRow.email, req, severidad: 'warning', descripcion: 'Intento de inicio de sesión fallido' });
        }
      } catch (e) { console.warn('[LOGIN] No se pudo auditar intento fallido:', e.message); }
      return res.status(401).json({ error: LOGIN_ERROR_GENERIC });
    }

    if (userRow.two_factor_enabled && userRow.two_factor_secret) {
      const mfaToken = jwt.sign(
        { purpose: 'mfa_login', sub: userRow.id, email: userRow.email },
        localJwtSecret,
        { expiresIn: '5m' }
      );
      return res.status(202).json({ requiresTwoFactor: true, mfaToken });
    }

    // FLAG_2FA_ADMINS: si está activo, los administradores sin 2FA deben
    // inscribirse antes de recibir sesión (se emite un token temporal de
    // inscripción, así nadie queda bloqueado).
    if (await flagDosFaAdminsActivo() && esUsuarioAdmin(userRow)) {
      const setupToken = jwt.sign(
        { purpose: 'mfa_setup', sub: userRow.id, email: userRow.email },
        localJwtSecret,
        { expiresIn: '10m' }
      );
      return res.status(202).json({ requiresTwoFactorSetup: true, setupToken });
    }

    let tenantData = null;
    if (supabase && userRow.empresa_codigo) {
      const { data: t } = await supabase.from('tenants').select('*').eq('codigo', userRow.empresa_codigo).maybeSingle();
      tenantData = t;
    }

    const accountToken = jwt.sign(
      {
        sub: userRow.id,
        email: userRow.email,
        rol: resolveDisplayRole(userRow, tenantData),
        empresa_codigo: userRow.empresa_codigo || 'ROOT',
        token_version: userRow.token_version || 0
      },
      localJwtSecret,
      { expiresIn: '30d' }
    );


    const userArea = tenantData?.area || userRow.area || 'Área Comercial';
    const userPlan = tenantData?.plan || 'starter';
    const activeModules = getModulesForAreaAndPlan(userArea, userPlan);

    // Persistir sesión en cookie httpOnly para la protección server-side de pp/ y empresa/
    setSessionCookie(res, accountToken);

    try {
      if (userRow.empresa_codigo) {
        await registrarAuditoria(userRow.empresa_codigo, 'login_exitoso', 'Inicio de sesión exitoso', 'seguridad', normalizeDisplayName(userRow.nombre, userRow.apellido), req);
        // Registro real de dispositivo/sesión y evento de seguridad (best-effort).
        const sesOk = await registrarSesionTenant(userRow.empresa_codigo, userRow.id, req);
        if (!sesOk) console.warn('[LOGIN] No se pudo registrar la sesión en tenant_sessions');
        await registrarEventoSeguridad(userRow.empresa_codigo, 'login_exitoso', { usuarioId: userRow.id, usuarioEmail: userRow.email, req, descripcion: 'Inicio de sesión exitoso' });
      }
    } catch (e) { console.warn('[LOGIN] No se pudo auditar el inicio de sesión:', e.message); }

    // Detectar trial vencido (plan starter > 15 días)
    let trialExpired = false;
    if (userPlan && ['starter', 'free', 'startup'].includes(normalizePlan(userPlan)) && tenantData?.created_at) {
      const created = new Date(tenantData.created_at).getTime();
      if (Number.isFinite(created) && Date.now() - created > 15 * 24 * 60 * 60 * 1000) {
        trialExpired = true;
        // Notificar por correo que la prueba gratuita ha vencido
        enviarEmailTrialVencido({
          email: userRow.email,
          nombre: userRow.nombre || userRow.apellido || '',
          empresaCodigo: userRow.empresa_codigo,
          empresaNombre: tenantData?.nombre_empresa || tenantData?.empresa_nombre || userRow.empresa_codigo
        });
      }
    }

    return res.status(200).json({
      message: 'Login exitoso',
      token: accountToken,
      user: {
        id: userRow.id,
        nombre: userRow.nombre || '',
        apellido: userRow.apellido || '',
        email: userRow.email,
        rol: resolveDisplayRole(userRow, tenantData),
        empresa_codigo: userRow.empresa_codigo || 'ROOT',
        empresa_nombre: tenantData?.nombre_empresa || tenantData?.nombre || tenantData?.empresa_nombre || userRow.empresa_codigo || 'ROOT',
        tenant: userRow.empresa_codigo || 'ROOT',
        area: userArea,
        plan: userPlan,
        features: PLAN_ENTITLEMENTS[normalizePlan(userPlan)]?.features || [],
        modulos_activos: activeModules,
        status: userRow.estado || 'activo',
        trial_expired: trialExpired,
        read_only: trialExpired,
        trial_ends_at: (tenantData?.created_at && ['starter', 'free', 'startup'].includes(normalizePlan(userPlan))) ? new Date(new Date(tenantData.created_at).getTime() + 15 * 86400000).toISOString() : null,
        area_negocio: tenantData?.area || tenantData?.area_negocio || null,
        foto_perfil_url: userRow.avatar_url || userRow.foto_perfil_url || null,
        banner_perfil_url: userRow.banner_perfil_url || null,
        token: accountToken
      }
    });
  } catch (error) {
    console.error('[LOGIN] Error general en /api/login:', error.stack || error.message);
    return res.status(500).json({ error: 'Error interno en el servidor de autenticación' });
  }
});

app.post('/api/login/2fa', loginLimiter, async (req, res) => {
  try {
    const { mfaToken, code } = req.body || {};
    if (!mfaToken || !code) return res.status(400).json({ error: 'Código de verificación requerido.' });
    let challenge;
    try {
      challenge = jwt.verify(mfaToken, localJwtSecret);
    } catch {
      return res.status(401).json({ error: 'La verificación expiró. Inicia sesión de nuevo.' });
    }
    if (challenge.purpose !== 'mfa_login') return res.status(401).json({ error: 'Solicitud de verificación inválida.' });
    if (!supabase) return res.status(503).json({ error: 'Autenticación no disponible.' });

    const { data: userRow, error } = await supabase.from('usuarios').select('*').eq('id', challenge.sub).maybeSingle();
    if (error || !userRow || !userRow.two_factor_enabled || !userRow.two_factor_secret) {
      return res.status(401).json({ error: 'No se pudo validar el segundo factor.' });
    }

    const backupHash = hashBackupCode(code);
    const backupCodes = Array.isArray(userRow.two_factor_backup_codes) ? userRow.two_factor_backup_codes : [];
    const isTotpValid = verifyTotp(userRow.two_factor_secret, code, 2);
    const backupIndex = backupCodes.indexOf(backupHash);
    if (!isTotpValid && backupIndex < 0) return res.status(401).json({ error: 'Código 2FA inválido.' });
    if (backupIndex >= 0) {
      backupCodes.splice(backupIndex, 1);
      await supabase.from('usuarios').update({ two_factor_backup_codes: backupCodes }).eq('id', userRow.id);
    }

    let tenantData = null;
    if (userRow.empresa_codigo) {
      const { data } = await supabase.from('tenants').select('*').eq('codigo', userRow.empresa_codigo).maybeSingle();
      tenantData = data;
    }
    const userArea = tenantData?.area || userRow.area || 'Área Comercial';
    const userPlan = normalizePlan(tenantData?.plan);
    const token = jwt.sign({
      sub: userRow.id, email: userRow.email, rol: resolveDisplayRole(userRow, tenantData),
      empresa_codigo: userRow.empresa_codigo || 'ROOT',
      token_version: userRow.token_version || 0
    }, localJwtSecret, { expiresIn: '30d' });
    const now = new Date().toISOString();
    const restUrl = `${getSupabaseUrl()}/rest/v1/usuarios?id=eq.${userRow.id}`;
    const key = getSupabaseKey();
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    };
    await axios.patch(restUrl, { updated_at: now, ultimo_acceso: now }, { headers, timeout: 8000 });
    const trialExpired2fa = userPlan === 'starter' && tenantData?.created_at
      ? (Number.isFinite(new Date(tenantData.created_at).getTime()) && Date.now() - new Date(tenantData.created_at).getTime() > 15 * 24 * 60 * 60 * 1000)
      : false;
    try {
      if (userRow.empresa_codigo) {
        await registrarAuditoria(userRow.empresa_codigo, 'login_exitoso', 'Inicio de sesión exitoso (2FA)', 'seguridad', normalizeDisplayName(userRow.nombre, userRow.apellido), req);
      }
    } catch (e) { console.warn('[LOGIN] No se pudo auditar el inicio de sesión 2FA:', e.message); }
    setSessionCookie(res, token);
    return res.json({
      message: 'Login exitoso', token,
      user: {
        id: userRow.id, nombre: userRow.nombre || '', apellido: userRow.apellido || '', email: userRow.email,
        rol: resolveDisplayRole(userRow, tenantData), empresa_codigo: userRow.empresa_codigo || 'ROOT',
        tenant: userRow.empresa_codigo || 'ROOT', area: userArea, plan: userPlan,
        features: PLAN_ENTITLEMENTS[userPlan]?.features || [], modulos_activos: getModulesForAreaAndPlan(userArea, userPlan), status: userRow.estado || 'activo', token,
        read_only: trialExpired2fa, trial_expired: trialExpired2fa
      }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/login/2fa/setup', loginLimiter, async (req, res) => {
  try {
    const challenge = verificarSetupToken(req.body && req.body.setupToken);
    if (!challenge) return res.status(401).json({ error: 'La verificación expiró. Inicia sesión de nuevo.' });
    if (!supabase) return res.status(503).json({ error: '2FA no disponible.' });
    const { data: user, error } = await supabase.from('usuarios').select('id, email, two_factor_enabled').eq('id', challenge.sub).maybeSingle();
    if (error || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.two_factor_enabled) return res.status(409).json({ error: '2FA ya está activado.' });
    const secret = createBase32Secret();
    await supabase.from('usuarios').update({ two_factor_secret: secret, two_factor_confirmed_at: null }).eq('id', user.id);
    const label = encodeURIComponent(`Portal Pilot:${user.email}`);
    return res.json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Portal%20Pilot&algorithm=SHA1&digits=6&period=30` });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/login/2fa/setup-confirm', loginLimiter, async (req, res) => {
  try {
    const { setupToken, code } = req.body || {};
    const challenge = verificarSetupToken(setupToken);
    if (!challenge) return res.status(401).json({ error: 'La verificación expiró. Inicia sesión de nuevo.' });
    if (!supabase) return res.status(503).json({ error: '2FA no disponible.' });
    const { data: user, error } = await supabase.from('usuarios').select('*').eq('id', challenge.sub).maybeSingle();
    if (error || !user || !user.two_factor_secret) return res.status(400).json({ error: 'Primero inicia la configuración de 2FA.' });
    if (!verifyTotp(user.two_factor_secret, code, 2)) return res.status(400).json({ error: 'Código 2FA inválido.' });
    const backupCodes = createBackupCodes();
    await supabase.from('usuarios').update({
      two_factor_enabled: true,
      two_factor_confirmed_at: new Date().toISOString(),
      two_factor_backup_codes: backupCodes.map(hashBackupCode)
    }).eq('id', user.id);

    let tenantData = null;
    if (user.empresa_codigo) {
      const { data } = await supabase.from('tenants').select('*').eq('codigo', user.empresa_codigo).maybeSingle();
      tenantData = data;
    }
    const userArea = tenantData?.area || user.area || 'Área Comercial';
    const userPlan = normalizePlan(tenantData?.plan);
    const token = jwt.sign({
      sub: user.id, email: user.email, rol: resolveDisplayRole(user, tenantData),
      empresa_codigo: user.empresa_codigo || 'ROOT', token_version: user.token_version || 0
    }, localJwtSecret, { expiresIn: '30d' });
    setSessionCookie(res, token);

    try {
      const now = new Date().toISOString();
      const restUrl = `${getSupabaseUrl()}/rest/v1/usuarios?id=eq.${user.id}`;
      const key = getSupabaseKey();
      await axios.patch(restUrl, { updated_at: now, ultimo_acceso: now }, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        timeout: 8000
      });
    } catch (e) { /* best-effort */ }

    try {
      if (user.empresa_codigo) {
        await registrarAuditoria(user.empresa_codigo, '2fa_activado', '2FA activado durante el inicio de sesión', 'seguridad', normalizeDisplayName(user.nombre, user.apellido), req);
        await registrarEventoSeguridad(user.empresa_codigo, 'login_exitoso', { usuarioId: user.id, usuarioEmail: user.email, req, descripcion: 'Inicio de sesión con 2FA recién activado' });
        await registrarSesionTenant(user.empresa_codigo, user.id, req);
      }
    } catch (e) { console.warn('[LOGIN] No se pudo auditar 2FA forzado:', e.message); }

    return res.json({
      message: 'Login exitoso', token, backupCodes,
      user: {
        id: user.id, nombre: user.nombre || '', apellido: user.apellido || '', email: user.email,
        rol: resolveDisplayRole(user, tenantData), empresa_codigo: user.empresa_codigo || 'ROOT',
        tenant: user.empresa_codigo || 'ROOT', area: userArea, plan: userPlan,
        features: PLAN_ENTITLEMENTS[userPlan]?.features || [],
        modulos_activos: getModulesForAreaAndPlan(userArea, userPlan),
        status: user.estado || 'activo', token
      }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/security/2fa/status', authenticate, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: '2FA no disponible.' });
    const { data: user, error } = await supabase.from('usuarios').select('two_factor_enabled, two_factor_confirmed_at').eq('id', req.user.sub).maybeSingle();
    if (error || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.json({ enabled: !!user.two_factor_enabled, confirmed_at: user.two_factor_confirmed_at || null });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/security/2fa/setup', authenticate, async (req, res) => {
  try {
    if (!supabase) return res.status(503).json({ error: '2FA no disponible.' });
    const { data: user, error } = await supabase.from('usuarios').select('id, email, two_factor_enabled').eq('id', req.user.sub).maybeSingle();
    if (error || !user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (user.two_factor_enabled) return res.status(409).json({ error: '2FA ya está activado.' });
    const secret = createBase32Secret();
    await supabase.from('usuarios').update({ two_factor_secret: secret, two_factor_confirmed_at: null }).eq('id', user.id);
    const label = encodeURIComponent(`Portal Pilot:${user.email}`);
    return res.json({ secret, otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Portal%20Pilot&algorithm=SHA1&digits=6&period=30` });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/security/2fa/confirm', authenticate, async (req, res) => {
  try {
    const { code } = req.body || {};
    const { data: user, error } = await supabase.from('usuarios').select('id, two_factor_secret').eq('id', req.user.sub).maybeSingle();
    if (error || !user?.two_factor_secret) return res.status(400).json({ error: 'Primero inicia la configuración de 2FA.' });
    if (!verifyTotp(user.two_factor_secret, code, 2)) return res.status(400).json({ error: 'Código 2FA inválido.' });
    const backupCodes = createBackupCodes();
    await supabase.from('usuarios').update({
      two_factor_enabled: true, two_factor_confirmed_at: new Date().toISOString(),
      two_factor_backup_codes: backupCodes.map(hashBackupCode)
    }).eq('id', user.id);
    return res.json({ success: true, backupCodes });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/security/2fa/disable', authenticate, async (req, res) => {
  try {
    const { code } = req.body || {};
    const { data: user, error } = await supabase.from('usuarios').select('id, two_factor_secret, two_factor_enabled').eq('id', req.user.sub).maybeSingle();
    if (error || !user?.two_factor_enabled) return res.status(400).json({ error: '2FA no está activado.' });
    if (!verifyTotp(user.two_factor_secret, code, 2)) return res.status(400).json({ error: 'Código 2FA inválido.' });
    await supabase.from('usuarios').update({ two_factor_enabled: false, two_factor_secret: null, two_factor_confirmed_at: null, two_factor_backup_codes: [] }).eq('id', user.id);
    return res.json({ success: true });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/tenant/modules', authenticate, async (req, res) => {
  try {
    const tenantCode = getTenantCode(req) || 'ROOT';
    let tenant = null;
    if (supabase) {
      const { data: t } = await supabase.from('tenants').select('*').eq('codigo', tenantCode).maybeSingle();
      tenant = t;
    }
    const area = tenant?.area || 'Área Comercial';
    const plan = normalizePlan(tenant?.plan);
    const modulos = getModulesForAreaAndPlan(area, plan);
    const entitlements = await getTenantEntitlements(req);
    res.json({ success: true, empresa_codigo: tenantCode, area, plan, features: PLAN_ENTITLEMENTS[plan]?.features || [], read_only: entitlements.status === 'expired', modulos_activos: modulos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Error consultando módulos' });
  }
});

app.post('/api/confirmar-pago', pagoLimiter, async (req, res) => {
  try {
    const { email, plan, metodoPago } = req.body || {};
    // Compatibilidad de formato: el frontend puede enviar empresaCodigo o
    // empresa_codigo. Un pago con código válido nunca debe perderse por el
    // formato del campo (bug: pay_handler solo leía camelCase).
    const empresaCodigo = req.body?.empresaCodigo || req.body?.empresa_codigo || null;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio y debe ser válido.' });
    }
    // RBAC opcional: si la petición llega CON sesión, solo Owner/Admin/ROOT
    // pueden activar un plan. Sin sesión (flujo de pago público) se permite:
    // es exactamente el flujo de pay_plan.html.
    const authHdr = req.headers['authorization'] || '';
    if (authHdr.startsWith('Bearer ')) {
      try {
        const dec = jwt.verify(authHdr.slice(7), localJwtSecret);
        const r = String(dec.rol || '').toLowerCase();
        if (!['owner', 'admin', 'administrador', 'root', 'superadmin', 'ceo'].includes(r)) {
          return res.status(403).json({ error: 'Solo el propietario o un administrador puede activar un plan.', code: 'FORBIDDEN_ROLE' });
        }
      } catch (_) { /* token inválido → flujo público; las validaciones de abajo aplican */ }
    }
    if (!plan) {
      return res.status(400).json({ error: 'El plan es obligatorio.' });
    }
    const allowedPlans = ['starter', 'business', 'enterprise'];
    const planLower = String(plan).toLowerCase();
    if (!allowedPlans.includes(planLower)) {
      return res.status(400).json({ error: `Plan inválido. Debe ser uno de: ${allowedPlans.join(', ')}.` });
    }
    // El pago debe referenciar una empresa real (el flujo web envía el código
    // del tenant registrado). Un tenant inexistente NO puede "activar" un plan.
    if (empresaCodigo && supabase) {
      const { data: tExiste } = await supabase.from('tenants').select('codigo').eq('codigo', String(empresaCodigo).trim().toUpperCase()).maybeSingle();
      if (!tExiste) {
        return res.status(404).json({ error: 'No existe una empresa registrada con ese código. Regístrate primero.' });
      }
    }

    const emailNorm = String(email).trim().toLowerCase();
    const planNombre = plan ? String(plan).toUpperCase() : 'PRO';
    const amountMap = { STARTER: 0, BUSINESS: 1499, ENTERPRISE: 4999 };
    const paymentStatus = metodoPago === 'tigo' || metodoPago === 'transferencia' ? 'pending' : 'success';

    // Traza de seguridad: endpoint público de billing → todo intento queda
    // auditado (éxito, fallo y origen), no solo los pagos aplicados.
    try {
      await registrarEventoSeguridad(empresaCodigo || 'ROOT', 'pago_confirmado_intento', {
        usuarioEmail: emailNorm, req, severidad: 'info',
        descripcion: `Confirmación de pago plan ${planNombre} vía ${metodoPago || 'transferencia'}`
      });
    } catch (e) { /* best-effort */ }

    // Actualizar plan del tenant en Supabase si existe
    if (supabase && empresaCodigo && !empresaCodigo.includes('XXXX')) {
      await supabase.from('tenants').update({ plan: planNombre.toLowerCase(), estado: 'activo' }).eq('codigo', empresaCodigo);
      // State machine de suscripción: pago confirmado → active (Blueprint §14).
      try {
        const planClavePago = normalizePlan(planNombre);
        const { data: planRowPago } = await supabase.from('planes').select('id').eq('clave', planClavePago).maybeSingle();
        await supabase.from('subscriptions').upsert({
          empresa_codigo: empresaCodigo,
          plan_id: planRowPago?.id || null,
          estado: 'active',
          current_period_start: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'empresa_codigo' });
        await registrarAuditoria(empresaCodigo, 'pago_confirmado', `Pago confirmado: plan ${planNombre}`, 'billing', emailNorm, req);
      } catch (e) { console.warn('[BILLING] subscriptions sync:', e.message); }
      // El pago cambia plan/estado → invalidar caché de entitlements para que
      // el modo read-only por trial expirado se levante AL INSTANTE (sin esperar
      // el TTL de 30s), y el nuevo plan aplique en la siguiente operación.
      try { _entitlementsCache.delete(String(empresaCodigo).trim().toUpperCase()); } catch (e2) { /* best-effort */ }
    }

    if (supabase) {
      const { error: paymentError } = await supabase.from('billing_payments').insert({
        empresa_codigo: empresaCodigo || null,
        email: emailNorm,
        plan: planNombre.toLowerCase(),
        amount: amountMap[planNombre] || 0,
        currency: 'HNL',
        payment_method: metodoPago || 'transferencia',
        status: paymentStatus,
        reference: req.body.tigoRef || req.body.bankRef || null
      });
      if (paymentError) console.warn('[BILLING] No se pudo guardar historial de pago:', paymentError.message);
    }

    // Enviar correo de confirmación de pago
    try {
      await enviarCorreo({
        from: `"Portal Pilot Billing" <${EMAIL_FROM}>`,
        to: emailNorm,
        subject: `🎉 ¡Pago Confirmado! Tu Plan ${planNombre} en Portal Pilot está Activo`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0b0b10;color:#e0e0f0;border-radius:16px;padding:32px;border:1px solid rgba(139,92,246,0.3);">
            <div style="text-align:center;margin-bottom:24px;">
              <h1 style="color:#a78bfa;margin:0;font-size:26px;">Portal Pilot</h1>
              <p style="color:#30d158;font-weight:700;font-size:16px;margin-top:4px;">✓ Confirmación de Pago Exitoso</p>
            </div>
            <p>Hola,</p>
            <p>Tu pago para el <strong>Plan ${planNombre}</strong> ha sido procesado y verificado correctamente.</p>
            <div style="background:#16161a;padding:20px;border-radius:12px;margin:20px 0;border:1px solid rgba(255,255,255,0.1);">
               <p style="margin:4px 0;font-size:14px;"><strong>Método de pago:</strong> ${metodoPago === 'tarjeta' ? 'Tarjeta de Crédito/Débito Digital' : metodoPago === 'tigo' ? 'Tigo Money (+504 3315-4594)' : 'Transferencia Bancaria'}</p>
               <p style="margin:4px 0;font-size:14px;"><strong>Estado:</strong> <span style="color:#30d158;font-weight:700;">ACTIVO</span></p>
               <p style="margin:4px 0;font-size:14px;"><strong>ID de Empresa:</strong> ${empresaCodigo || 'ROOT'}</p>
               ${metodoPago === 'tigo' ? `<p style="margin:4px 0;font-size:14px;"><strong>Referencia Tigo Money:</strong> ${req.body.tigoRef || 'N/A'}</p><p style="margin:4px 0;font-size:12px;color:#888;">Tu pago está pendiente de verificación manual. Envía tu comprobante por WhatsApp al +504 3315-4594 para confirmación inmediata.</p>` : ''}
            </div>
            <p>Ya puedes acceder a tu panel con todos los módulos comerciales habilitados.</p>
            <div style="text-align:center;margin-top:28px;">
              <a href="https://portal-pilot.vercel.app/login.html" style="background:linear-gradient(135deg,#8b5cf6,#a78bfa);color:#fff;padding:12px 28px;border-radius:30px;text-decoration:none;font-weight:700;display:inline-block;">Iniciar Sesión en Portal Pilot</a>
            </div>
          </div>
        `
      });
    } catch (e) {
      console.warn('[CONFIRMAR PAGO] Advertencia enviando correo:', e.message);
    }

    return res.status(200).json({
      success: true,
      message: `¡Pago del Plan ${planNombre} activado con éxito! Se ha enviado el comprobante a ${emailNorm}.`,
      plan: planNombre,
      email: emailNorm
    });
  } catch (error) {
    console.error('[CONFIRMAR PAGO] Error:', error.message);
    return res.status(500).json({ error: 'Error al procesar la confirmación del pago.' });
  }
});

app.post('/api/tigo-money-reference', emailLimiter, async (req, res) => {
  try {
    const { email, plan, empresaCodigo } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio y válido.' });
    }
    const emailNorm = String(email).trim().toLowerCase();
    const planNombre = String(plan || 'business').toUpperCase();
    const empresa = empresaCodigo || 'ROOT';

    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    const referencia = `PP-${planNombre.slice(0, 4)}-${empresa}-${timestamp}-${random}`;

    if (supabase && empresa && !empresa.includes('XXXX')) {
      await supabase.from('tenants').update({
        plan: planNombre.toLowerCase(),
        estado: 'pendiente_tigo',
        referencia_pago: referencia,
        updated_at: new Date().toISOString()
      }).eq('codigo', empresa);
    }

    const amountMap = { STARTER: 'L.0.00', BUSINESS: 'L.1,499.00', ENTERPRISE: 'L.4,999.00' };
    const amount = amountMap[planNombre] || 'L.1,499.00';

    return res.json({
      success: true,
      referencia,
      amount,
      plan: planNombre,
      email: emailNorm,
      empresa: empresa,
      tigo_number: '33154594',
      whatsapp: '+504331545494',
      instructions: `Envía exactamente ${amount} desde tu app Tigo Money al número 33154594 con referencia ${referencia}. Luego envía captura a WhatsApp +504 3315-4594.`
    });
  } catch (error) {
    console.error('[TIGO MONEY REFERENCE] Error:', error.message);
    return res.status(500).json({ error: 'Error generando referencia de Tigo Money.' });
  }
});

app.post('/api/refresh', authenticate, (req, res) => {
  try {
    const newToken = jwt.sign(
      {
        sub: req.user.sub, rol: req.user.rol, empresa_codigo: req.user.empresa_codigo,
        // Preservar la versión de token: authenticate ya validó contra DB,
        // pero el token renovado NO debe "resucitar" sesiones revocadas.
        token_version: req.user.token_version || 0
      },
      localJwtSecret,
      { expiresIn: '2h' }
    );
    setSessionCookie(res, newToken);
    res.json({ token: newToken });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/notify/onboarding', authenticate, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email' });
    await enviarOnboardingEmail(email);
    res.json({ message: 'Onboarding enviado' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/notify/activation', authenticate, async (req, res) => {
  try {
    const { email, password, tenantName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Faltan email o password' });
    await enviarAlertaActivacionCuenta(email, password, null, tenantName || null);
    res.json({ message: 'Correo de activación enviado' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// ======================================================================
// SOPORTE: Crear ticket desde el formulario de soporte
// ======================================================================
app.post('/api/support-ticket', emailLimiter, async (req, res) => {
  try {
    const { name, email, company, plan, category, priority, message } = req.body || {};

    if (!name || !email || !category || !message) {
      return res.status(400).json({ error: 'Campos requeridos: name, email, category, message' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const ticket = {
      nombre: escapeHtml(name).slice(0, 200),
      email: escapeHtml(email).slice(0, 200),
      empresa: escapeHtml(company || '').slice(0, 200),
      plan: escapeHtml(plan || 'none').slice(0, 50),
      categoria: escapeHtml(category).slice(0, 50),
      prioridad: escapeHtml(priority || 'normal').slice(0, 20),
      mensaje: escapeHtml(message).slice(0, 5000),
      estado: 'open',
      created_at: new Date().toISOString()
    };

    // Almacenar en Supabase si está configurado
    if (supabase) {
      try {
        const { data, error } = await supabase.from('support_tickets').insert([ticket]);
        if (!error && data) {
          const row = Array.isArray(data) ? data[0] : data;
          const ticketId = row?.id || 'TKT-' + Date.now();

          // Notificar al equipo de soporte por correo
          try {
            await enviarCorreoPortalPilot(
              process.env.EMAIL_USER,
              `[Soporte] Nuevo ticket (${ticket.category})`,
              'Nuevo ticket de soporte recibido',
              `De: ${ticket.name} <${ticket.email}>`,
              `<p><strong>Categoría:</strong> ${ticket.category}</p>
               <p><strong>Prioridad:</strong> ${ticket.priority}</p>
               <p><strong>Empresa:</strong> ${ticket.company || 'N/A'} · Plan ${ticket.plan}</p>
               <p><strong>Mensaje:</strong><br>${ticket.message}</p>`
            );
          } catch (mailErr) {
            console.error('[SOPORTE] Error enviando correo:', mailErr.message);
          }

          return res.status(201).json({
            success: true,
            ticketId,
            message: 'Ticket creado exitosamente'
          });
        }
        console.warn('[SOPORTE] Supabase insert falló:', error?.message);
      } catch (err) {
        console.warn('[SOPORTE] Supabase no disponible:', err.message);
      }
    }

    // Fallback: registrar en consola y confirmar
    console.log('[SUPPORT TICKET]', JSON.stringify(ticket, null, 2));
    return res.status(201).json({
      success: true,
      ticketId: 'LOG-' + Date.now(),
      message: 'Ticket registrado. Responderemos a ' + ticket.email + ' en menos de 24 horas.'
    });
  } catch (err) {
    console.error('[SOPORTE] Error:', err.message);
    return res.status(500).json({ error: 'Error al procesar el ticket. Intenta de nuevo o contacta a portalpilot.hn@gmail.com' });
  }
});

app.get('/api/billing/payments', authenticate, requireRoot, async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    let query = supabase.from('billing_payments').select('*').order('created_at', { ascending: false }).limit(limit);
    if (req.query.status) query = query.eq('status', String(req.query.status));
    if (req.query.plan) query = query.eq('plan', String(req.query.plan));
    if (req.query.from) query = query.gte('created_at', String(req.query.from));
    if (req.query.to) query = query.lte('created_at', `${String(req.query.to)}T23:59:59.999Z`);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ payments: data || [] });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/tenants', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    let tenantsFormat = [];
    const userTenantCode = normalizeTenantCode(getTenantCode(req));
    const userIsRoot = isRootUser(req);

    if (supabase) {
      // ⚠️ Eliminado: "auto-cleanup" destructivo en GET. Un GET no debe borrar
      // tenants (riesgo real: eliminar un tenant recién registrado cuyo owner
      // aún no crea usuarios, o durante una carrera de registro). La limpieza
      // de tenants huérfanos es una tarea de mantenimiento explícita (ROOT).

      let query = supabase.from('tenants').select('*');
      if (!userIsRoot && userTenantCode) {
        query = query.eq('codigo', userTenantCode);
      }
      const { data: supaTenants, error } = await query;
      if (!error && supaTenants && supaTenants.length > 0) {
        tenantsFormat = supaTenants.map(t => ({
          id: t.id || t.codigo || 'ROOT',
          codigo: t.codigo || t.id || 'ROOT',
          name: t.nombre_empresa || t.nombre || t.codigo || 'Empresa',
          domain: t.dominio || `${slugifyDominio(t.nombre_empresa || t.nombre || t.codigo || 'empresa')}.pp.ia`,
          plan: t.plan || 'enterprise',
          status: t.estado === 'activo' ? 'active' : t.estado === 'suspendido' ? 'suspended' : t.estado || 'active',
          users: 1,
          registered: t.created_at || new Date().toISOString(),
          country: t.pais || 'Honduras',
          logo_url: t.logo_url || null,
          banner_url: t.banner_url || null
        }));
      }
    }

    if (tenantsFormat.length === 0 && userIsRoot) {
      tenantsFormat = [{
        id: 'ROOT',
        codigo: 'ROOT',
        name: 'Portal Pilot Honduras',
        domain: 'portalpilot.pp.ia',
        plan: 'enterprise',
        status: 'active',
        users: 1,
        registered: new Date().toISOString(),
        country: 'Honduras'
      }];
    }

    res.json(tenantsFormat);
  } catch (error) {
    console.error('[GET TENANTS] Error:', error.message);
    res.status(500).json({ error: 'Error al obtener la lista de empresas (tenants).' });
  }
});

app.post('/api/tenants', authenticate, requireRoot, async (req, res) => {
  try {
    const { nombre, dominio, plan, emailAdmin, pais, zonaHoraria, notas } = req.body;
    const codigo = `PP-${Date.now().toString().slice(-6)}`;

    // 1. Crear tenant en Supabase
    if (supabase) {
      const { error: tenantErr } = await supabase.from('tenants').insert({
        codigo,
        nombre_empresa: nombre,
        dominio,
        plan: plan || 'starter',
        estado: 'activo',
        pais,
        zona_horaria: zonaHoraria,
        notas,
        email: emailAdmin,
        limite_usuarios: 10
      });
      if (tenantErr) {
        console.error('[CREAR_TENANT] Error Supabase tenant:', tenantErr.message);
        throw new Error('No se pudo crear el tenant en la base de datos');
      }
    }

    const passwordTemporal = generateSecurePassword();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordTemporal, salt);

    // 2. Verificar si el email ya existe en Supabase
    if (supabase) {
      const { data: existing } = await supabase.from('usuarios').select('id').eq('email', emailAdmin.toLowerCase().trim()).maybeSingle();
      if (existing) {
        return res.status(400).json({ error: 'El correo del administrador ya está registrado' });
      }
    }

    // 3. Crear usuario Owner en Supabase
    let adminUserId = null;
    if (supabase) {
      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: emailAdmin.toLowerCase().trim(),
        password: passwordTemporal,
        email_confirm: true
      });
      if (authErr) {
        console.error('[CREAR_TENANT] Error crear auth user:', authErr.message);
      } else {
        adminUserId = authData.user.id;
        const { error: insertErr } = await supabase.from('usuarios').insert({
          id: adminUserId,
          email: emailAdmin.toLowerCase().trim(),
          nombre: 'Owner',
          apellido: 'Tenant',
          rol: 'Owner',
          empresa_codigo: codigo,
          estado: 'activo',
          activo: true
        });
        if (insertErr) {
          console.error('[CREAR_TENANT] Error insertar usuario:', insertErr.message);
        }
      }
    }

    let activationToken = null;
    try {
      activationToken = jwt.sign(
        { sub: adminUserId, rol: 'Owner', empresa_codigo: codigo },
        localJwtSecret,
        { expiresIn: '6h' }
      );
    } catch (e) {
      console.warn('[CREAR_TENANT] No se pudo generar token:', e.message);
    }

    await enviarAlertaActivacionCuenta(emailAdmin, passwordTemporal, activationToken, nombre);

    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      '🏢 Nuevo Tenant Registrado',
      'Nueva Empresa Registrada',
      'Se ha registrado una nueva empresa en Portal Pilot.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>Nombre:</strong> ${nombre}</li>
        <li><strong>Código:</strong> ${codigo}</li>
        <li><strong>Plan:</strong> ${(plan || 'starter').toUpperCase()}</li>
        <li><strong>Email Admin:</strong> ${emailAdmin}</li>
      </ul>`
    );

    await registrarAuditoria(codigo, 'Tenant creado', `Se creó el tenant "${nombre}" y su administrador ${emailAdmin}`, 'tenants', req.user?.email || '', req);

    res.status(201).json({
      message: 'Tenant y Administrador creados exitosamente',
      tenant: { codigo, nombre, dominio, plan, pais },
      admin: { email: emailAdmin, status: 'activo' }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/tenant/:id', authenticate, async (req, res, next) => {
  // Rutas reservadas bajo /api/tenant/* que NO son identificadores de tenant.
  // (Bug real: /api/tenant/usage y /api/tenant/subscription caían aquí y
  // respondían 404 "Tenant not found" — aislamiento de rutas corregido.)
  const RESERVED_TENANT_ROUTES = new Set(['apikeys', 'features', 'modules', 'security', 'usage', 'subscription']);
  if (RESERVED_TENANT_ROUTES.has(req.params.id)) return next();
  try {
    const tenantId = req.params.id;
    const tenant = await findTenantByIdentifier(tenantId);

    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const tenantCode = tenant.codigo || tenant.Codigo || tenant.code || tenant.Id || tenant.id;
    const userRole = (req.user.rol || '').toString().toLowerCase().trim();
    const currentTenantCode = normalizeTenantCode(getTenantCode(req));
    const rootUserCheck = isRootUser(req);
    const declaredTenantCode = normalizeTenantCode(tenantCode || tenantId);
    // Scope estricto (Blueprint §5): ser Owner/Admin del PROPIO tenant no
    // autoriza ver otros tenants. Solo ROOT es transversal.
    const isTenantSelf = currentTenantCode && declaredTenantCode && currentTenantCode === declaredTenantCode;
    const isTenantAdminRole = ['owner', 'owner pp', 'administrador', 'admin', 'ceo'].some(r => userRole === r || userRole.includes(r));
    const isAdmin = rootUserCheck || (isTenantAdminRole && isTenantSelf);

    if (!rootUserCheck && !isAdmin) {
      return res.status(403).json({ error: 'Acceso no autorizado al tenant' });
    }

    const preview = {
      id: tenant.codigo || tenantCode,
      name: tenant.nombre_empresa || tenant.nombre || tenant.Nombre,
      domain: tenant.dominio || tenant.Dominio || `${slugifyDominio(tenant.nombre_empresa || tenant.nombre || tenant.Nombre || tenant.codigo)}.pp.ia`,
      plan: tenant.plan || tenant.Plan,
      status: (tenant.estado || tenant.Estado || '').toString().toLowerCase() === 'activo' ? 'active' : (tenant.estado || tenant.Estado || '').toString().toLowerCase() === 'suspendido' ? 'suspended' : (tenant.estado || tenant.Estado),
      country: tenant.pais || tenant.Pais
    };

    let detail = null;
    if (isAdmin) {
      detail = {
        notes: tenant.notas,
        timezone: tenant.zona_horaria,
        createdAt: tenant.created_at || tenant.CreatedAt,
        updatedAt: tenant.updated_at || tenant.UpdatedAt
      };
    }

    res.json({ preview, detail });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Límites de plan compartidos (tenants y usuarios)
const PLAN_LIMITS = {
  starter: { usuarios: 5, bots: 2, tokens: 100000, storage: 5, soporte: 'Email', sla: '99.0%' },
  business: { usuarios: 50, bots: 15, tokens: 2000000, storage: 100, soporte: 'Priority 24/7', sla: '99.9%' },
  enterprise: { usuarios: 200, bots: 50, tokens: 10000000, storage: 500, soporte: 'Dedicado 24/7', sla: '99.99%' },
  custom: { usuarios: 9999, bots: 9999, tokens: 99999999, storage: 9999, soporte: 'Dedicado 24/7', sla: '99.99%' }
};

function planLimitsFor(plan) {
  return PLAN_LIMITS[String(plan || '').toLowerCase()] || PLAN_LIMITS.business;
}

// Información detallada del tenant con stats reales
app.get('/api/tenant/:id/stats', authenticate, async (req, res) => {
  try {
    const tenantId = req.params.id;
    const tenant = await findTenantByIdentifier(tenantId);

    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const tenantCode = tenant.codigo || tenant.Codigo || tenant.code || tenant.Id || tenant.id;
    const userRole = (req.user.rol || '').toString().toLowerCase().trim();
    const currentTenantCode = normalizeTenantCode(getTenantCode(req));
    const roleLower = userRole;
    const rootUserCheck = isRootUser(req);
    const declaredTenantCode = normalizeTenantCode(tenantCode || tenantId);
    // Scope estricto (Blueprint §5): solo ROOT ve stats de tenants ajenos.
    const isTenantSelf = currentTenantCode && declaredTenantCode && currentTenantCode === declaredTenantCode;
    const isTenantAdminRole = ['owner', 'owner pp', 'administrador', 'admin', 'ceo'].some(r => userRole === r || userRole.includes(r));
    const isAdmin = rootUserCheck || (isTenantAdminRole && isTenantSelf);

    if (!isAdmin && !isTenantSelf) {
      return res.status(403).json({ error: 'Acceso no autorizado al tenant' });
    }

    const finalTenantCode = tenant.codigo || tenant.id;

    // Obtener stats reales
    const [usuariosRes, botsRes, facturasRes, tokensRes] = await Promise.all([
      supabase.from('usuarios').select('id, activo').eq('empresa_codigo', finalTenantCode),
      supabase.from('automatizaciones').select('id, estado').eq('empresa_codigo', finalTenantCode),
      supabase.from('facturas').select('id').eq('empresa_codigo', finalTenantCode),
      supabase.from('ai_usage_log').select('tokens_total').eq('empresa_codigo', finalTenantCode)
    ]);

    const usuarios = usuariosRes.data || [];
    const bots = botsRes.data || [];
    const facturas = facturasRes.data || [];
    const tokensUsados = (tokensRes.data || []).reduce((s, r) => s + (Number(r.tokens_total) || 0), 0);

    const totalUsuarios = usuarios.length;
    const usuariosActivos = usuarios.filter(u => u.activo !== false).length;
    const totalBots = bots.length;
    const botsActivos = bots.filter(b => b.estado === 'activo' || b.estado === 'active').length;
    const totalFacturas = facturas.length;
    const bytesUsados = 0;
    const gbUsados = (bytesUsados / (1024 * 1024 * 1024)).toFixed(2);

    // Límites según plan
    const plan = tenant.plan || 'business';
    const limits = planLimitsFor(plan);

    const stats = {
      plan: tenant.plan || 'business',
      usuarios: {
        total: totalUsuarios,
        activos: usuariosActivos,
        limite: limits.usuarios,
        porcentaje: limits.usuarios > 0 ? Math.round((totalUsuarios / limits.usuarios) * 100) : 0
      },
      bots: {
        total: totalBots,
        activos: botsActivos,
        limite: limits.bots,
        porcentaje: limits.bots > 0 ? Math.round((totalBots / limits.bots) * 100) : 0
      },
      tokens: {
        usados: tokensUsados,
        limite: limits.tokens,
        porcentaje: limits.tokens > 0 ? Math.round((tokensUsados / limits.tokens) * 100) : 0
      },
      almacenamiento: {
        gbUsados: parseFloat(gbUsados),
        limite: limits.storage,
        porcentaje: limits.storage > 0 ? Math.round((parseFloat(gbUsados) / limits.storage) * 100) : 0
      },
      facturas: {
        total: totalFacturas
      },
      soporte: limits.soporte,
      sla: limits.sla,
      planNombre: plan.charAt(0).toUpperCase() + plan.slice(1)
    };

    res.json({ stats, tenant: { codigo: tenant.codigo, nombre: tenant.nombre_empresa } });
  } catch (error) {
    return handleServerError(res, error);
  }
});// ── PUT /api/empresa/profile — el Owner/Admin actualiza la configuración de SU empresa ──
// El frontend (empresa/configuracion.html) enviaba PUT a /api/tenants/:id (404 del
// verbo). Este endpoint reutiliza EXACTAMENTE la misma lógica de actualización,
// pero el id SIEMPRE sale del JWT: el cliente no puede elegir el tenant.
app.put('/api/empresa/profile', authenticate, requireTenantAdmin, async (req, res) => {
  req.params.id = normalizeTenantCode(getTenantCode(req));
  return handleTenantUpdate(req, res);
});

app.put('/api/tenants/:id', authenticate, requireTenantAdmin, async (req, res) => {
  // El scope se decide por acceso: ROOT puede editar cualquier tenant;
  // Owner/Admin solo el propio (assertTenantAccess lo valida más abajo).
  return handleTenantUpdate(req, res);
});

async function handleTenantUpdate(req, res) {
  try {
    const { id } = req.params;
    const { plan, estado, nombre_empresa, dominio, pais, zona_horaria, rtn, telefono, direccion, email_facturacion, moneda, formato_fecha, idioma } = req.body;
    if (!assertTenantAccess(req, id)) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este tenant.' });
    }

    // RBAC/Billing (Bloques D+E): cambiar el plan de la propia empresa es una
    // operación de facturación exclusiva de ROOT (el Owner contrata vía el
    // flujo de pago confirmado, no auto-editando el registro). Un ADMIN nunca
    // debe poder elevar su plan manipulando la petición.
    if (plan && !isRootUser(req)) {
      await registrarAuditoria(id, 'Cambio de plan bloqueado', `Usuario no-ROOT intentó cambiar plan a ${plan}`, 'seguridad', req.user?.email || '', req);
      return res.status(403).json({ error: 'Cambiar el plan se realiza a través del proceso de pago. Contacta a soporte o usa la sección de suscripción.' });
    }

    const empresa = await findTenantByIdentifier(id);
    if (!empresa) return res.status(404).json({ error: 'Tenant no encontrado' });

    // Update in Supabase
    if (supabase) {
      const supaUpdate = {};
      if (plan) supaUpdate.plan = plan;
      if (estado) supaUpdate.estado = estado;
      if (nombre_empresa) supaUpdate.nombre_empresa = nombre_empresa;
      if (dominio) supaUpdate.dominio = dominio;
      if (pais) supaUpdate.pais = pais;
      if (zona_horaria) supaUpdate.zona_horaria = zona_horaria;
      // Info legal / configuración general del Portal Empresa (Bloque A).
      // Columnas nuevas (migracion_portales_v2) se aplican en un segundo intento
      // para que un esquema aún no migrado no descarte TODO el update.
      const coreUpdate = {};
      if (rtn !== undefined) coreUpdate.rtn = String(rtn).slice(0, 40);
      if (telefono !== undefined) coreUpdate.telefono = String(telefono).slice(0, 40);
      if (direccion !== undefined) coreUpdate.direccion = String(direccion).slice(0, 500);
      Object.assign(supaUpdate, coreUpdate);
      const newColsUpdate = {};
      if (email_facturacion !== undefined) newColsUpdate.email_facturacion = String(email_facturacion).slice(0, 200);
      if (moneda !== undefined) newColsUpdate.moneda = String(moneda).slice(0, 10);
      if (formato_fecha !== undefined) newColsUpdate.formato_fecha = String(formato_fecha).slice(0, 20);
      if (idioma !== undefined) newColsUpdate.idioma = String(idioma).slice(0, 10);
      Object.assign(supaUpdate, newColsUpdate);
      if (Object.keys(supaUpdate).length > 0) {
        let upErr = null;
        const res1 = await supabase.from('tenants').update(supaUpdate).eq('codigo', id);
        upErr = res1.error;
        if (upErr && Object.keys(newColsUpdate).length) {
          // Esquema sin las columnas nuevas: reintentar solo con las core.
          const res2 = await supabase.from('tenants').update(coreUpdate).eq('codigo', id);
          upErr = res2.error;
        }
        if (upErr) {
          await registrarAuditoria(id, 'Error actualizando tenant', upErr.message, 'sistema', req.user?.email || '', req);
          return res.status(500).json({ error: upErr.message });
        }
      }
    }

    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      '💼 Tenant Actualizado',
      'Configuración Modificada',
      `Tenant ${id} actualizado.`,
      `<ul style="list-style: none; padding: 0;">
        <li><strong>Código:</strong> ${id}</li>
        ${plan ? `<li><strong>Plan:</strong> ${plan.toUpperCase()}</li>` : ''}
        ${estado ? `<li><strong>Estado:</strong> ${estado.toUpperCase()}</li>` : ''}
        ${nombre_empresa ? `<li><strong>Empresa:</strong> ${nombre_empresa}</li>` : ''}
        ${dominio ? `<li><strong>Dominio:</strong> ${dominio}</li>` : ''}
        ${pais ? `<li><strong>País:</strong> ${pais}</li>` : ''}
        ${zona_horaria ? `<li><strong>Zona Horaria:</strong> ${zona_horaria}</li>` : ''}
      </ul>`
    );

    await registrarAuditoria(id, 'Tenant actualizado', `Se actualizaron los datos del tenant ${id}${plan ? `, plan: ${plan}` : ''}${estado ? `, estado: ${estado}` : ''}`, 'tenants', req.user?.email || '', req);

    res.json({ message: 'Tenant actualizado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
  }
}

app.delete('/api/tenants/:id', authenticate, async (req, res) => {
  try {
    // RBAC (Bloque I): eliminar un tenant destruye usuarios, empresa y datos
    // asociados. Es una operación crítica exclusiva de ROOT; un OWNER de tenant
    // nunca debe poder ejecutarla (ni manipulando la petición).
    if (!isRootUser(req)) {
      return res.status(403).json({ error: 'Eliminar un tenant es una operación exclusiva de ROOT.' });
    }
    const { id } = req.params;
    const tenant = await findTenantByIdentifier(id);
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const tenantCode = tenant.codigo || tenant.id || id;
    const finalTenantCode = tenantCode || id;

    if (!assertTenantAccess(req, finalTenantCode)) {
      return res.status(403).json({ error: 'No autorizado para eliminar este tenant.' });
    }

    let deletedCount = 0;

    // ── SUPABASE: Eliminar empresa + usuarios + auth ──
    if (supabase) {
      try {
        const { data: empRecord } = await supabase
          .from('empresas').select('id').eq('codigo', finalTenantCode).single();

        if (empRecord) {
          const { data: supaUsers } = await supabase
            .from('usuarios').select('id').eq('empresa_id', empRecord.id);

          for (const u of (supaUsers || [])) {
            await supabase.from('usuario_modulos').delete().eq('usuario_id', u.id);
          }

          await supabase.from('usuarios').delete().eq('empresa_id', empRecord.id);
          deletedCount += (supaUsers || []).length;

          await supabase.from('empresas').delete().eq('id', empRecord.id);

          for (const u of (supaUsers || [])) {
            try { await supabase.auth.admin.deleteUser(u.id); } catch (_) { console.warn('[TENANT_DELETE] Non-critical:', _.message); }
          }

          console.log(`[DELETE TENANT SUPABASE] Empresa ${finalTenantCode}: ${(supaUsers || []).length} usuarios + empresa eliminados`);
        }
      } catch (err) {
        console.warn(`[DELETE TENANT SUPABASE] Error:`, err.message);
      }
    }

    await registrarAuditoria(finalTenantCode, 'Tenant eliminado', `Se eliminó el tenant ${finalTenantCode} y ${deletedCount} usuario(s)`, 'tenants', req.user?.email || '', req);

    res.json({ message: 'Tenant y todos sus usuarios eliminados exitosamente', deletedUsers: deletedCount });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/debug/tenants/:id', authenticate, async (req, res) => {
  try {
    // DEBUG: solo ROOT puede inspeccionar tenants de terceros (evita fuga cross-tenant).
    if (!isRootUser(req)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const tenant = await findTenantByIdentifier(req.params.id);
    return res.json({ message: 'Tenant lookup', tenant: tenant || null, found: !!tenant });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/alerta-no-autorizado', alertaLimiter, async (req, res) => {
  try {
    const { url, referrer } = req.body;
    const ipRaw = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const ip = ipRaw.includes('::ffff:') ? ipRaw.replace('::ffff:', '') : ipRaw;

    const [ubicacion, dispositivo] = await Promise.all([
      obtenerUbicacion(ip),
      obtenerDispositivo(req.headers['user-agent'])
    ]);

    const opciones = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
    const fechaActual = new Intl.DateTimeFormat('es-HN', opciones).format(new Date());

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; border: 1px solid #dc2626; border-radius: 12px; padding: 30px;">
        <h1 style="color: #ef4444;">🚨 ALERTA DE SEGURIDAD</h1>
        <p>Intento de acceso no autorizado bloqueado:</p>
        <ul>
          <li><strong>Página:</strong> ${escapeHtml(url)}</li>
          <li><strong>Referrer:</strong> ${escapeHtml(referrer) || 'Directo'}</li>
          <li><strong>IP:</strong> ${escapeHtml(ip)}</li>
          <li><strong>Ubicación:</strong> ${escapeHtml(ubicacion)}</li>
          <li><strong>Dispositivo:</strong> ${escapeHtml(dispositivo)}</li>
          <li><strong>Fecha:</strong> ${escapeHtml(fechaActual)}</li>
        </ul>
      </div>
    `;

    await enviarCorreo({
      to: SMTP_USER || EMAIL_FROM,
      subject: '🚨 ALERTA: Intento de bypass detectado',
      html: htmlContent
    });

    res.json({ success: true, message: 'Alerta enviada' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/recuperacion', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Correo electrónico requerido.' });

    const emailNorm = String(email).trim().toLowerCase();
    let userFound = false;

    if (supabase) {
      try {
        const { data: user } = await supabase.from('usuarios').select('id, email').eq('email', emailNorm).maybeSingle();
        if (user) userFound = true;
      } catch (e) {
        console.warn('[RECOVERY] Supabase lookup failed:', e.message);
      }
    }

    if (!userFound) {
      return res.json({ message: 'Si el correo está registrado, se ha enviado un código.' });
    }

    const code = generateVerificationCode(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    let codeStored = false;
    if (supabase) {
      try {
        await supabase.from('configuraciones_globales').delete().eq('clave', `recovery_${emailNorm}`);
        const { error } = await supabase.from('configuraciones_globales').insert({
          clave: `recovery_${emailNorm}`,
          valor: JSON.stringify({ code, expires_at: expiresAt }),
          entorno: 'recovery',
          sensible: true,
          descripcion: `Recovery code for ${emailNorm}`
        });
        if (!error) codeStored = true;
      } catch (e) {
        console.warn('[RECOVERY] Supabase code storage failed:', e.message);
      }
    }

    if (!codeStored) {
      return res.status(500).json({ error: 'No se pudo generar el código de recuperación.' });
    }

    const rutasPlantilla = [
      path.join(__dirname, '../EMAIL PORTAL PILOT/Recuperación de Cuenta.html'),
      path.join(__dirname, 'templates/Recuperación de Cuenta.html')
    ];

    const fallbackHtml = `
      <div style="font-family: sans-serif; max-width:600px;margin:0 auto;background:#0b0a15;color:#e2e8f0;padding:20px;border-radius:12px;">
        <h2>Recuperación de Cuenta</h2>
        <p>Tu código de verificación es: <strong style="font-size: 24px; letter-spacing: 4px;">${code.slice(0, 3)} ${code.slice(3)}</strong></p>
        <p>Expira en 15 minutos.</p>
      </div>
    `;
    let htmlContent = cargarPlantilla(rutasPlantilla, fallbackHtml);

    const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
    htmlContent = htmlContent.replace('842 915', formattedCode);

    await enviarCorreo({
      to: emailNorm,
      subject: '🔑 Código de Verificación',
      html: htmlContent
    });

    console.log(`[Recuperación] Código enviado a ${emailNorm}`);
    res.json({ message: 'Si el correo está registrado, se ha enviado un código.' });
  } catch (error) {
    console.error('[RECOVERY] Error:', error.message);
    return handleServerError(res, error);
  }
});

app.post('/api/recuperacion/verificar', recoveryLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    const emailNorm = String(email).trim().toLowerCase();
    let found = null;

    // Look up recovery code in Supabase
    if (supabase) {
      try {
        const { data: row } = await supabase.from('configuraciones_globales')
          .select('clave, valor')
          .eq('clave', `recovery_${emailNorm}`)
          .eq('entorno', 'recovery')
          .maybeSingle();
        if (row && row.valor) {
          const parsed = JSON.parse(row.valor);
          if (parsed.code === code.trim()) {
            found = { email: emailNorm, code: parsed.code, expires_at: parsed.expires_at };
          }
        }
      } catch (e) {
        console.warn('[RECOVERY VERIFY] Supabase lookup failed:', e.message);
      }
    }

    if (!found) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const expiresAt = found.expires_at || null;
    if (!expiresAt || new Date() > new Date(expiresAt)) {
      // Clean expired code
      if (supabase) {
        try { await supabase.from('configuraciones_globales').delete().eq('clave', `recovery_${emailNorm}`); } catch (e) { console.warn('[RECOVERY_EXPIRED] Non-critical:', e.message); }
      }
      return res.status(400).json({ error: 'El código ha expirado.' });
    }

    // Delete used code
    if (supabase) {
      try { await supabase.from('configuraciones_globales').delete().eq('clave', `recovery_${emailNorm}`); } catch (e) { console.warn('[RECOVERY_DELETE] Non-critical:', e.message); }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update password in Supabase
    if (supabase) {
      try {
        const { error } = await supabase.from('usuarios')
          .update({ password_hash: passwordHash, password: passwordHash })
          .eq('email', emailNorm);
        if (!error) {
          return res.json({ message: 'Contraseña restablecida con éxito.' });
        }
        console.warn('[RECOVERY VERIFY] Supabase update failed:', error.message);
      } catch (e) {
        console.warn('[RECOVERY VERIFY] Supabase update error:', e.message);
      }
    }

    return res.status(500).json({ error: 'No se pudo restablecer la contraseña.' });
  } catch (error) {
    console.error('[RECOVERY VERIFY] Error:', error.message);
    return handleServerError(res, error);
  }
});

app.get('/api/users', authenticate, async (req, res) => {
  try {
    const allUsers = [];
    const seenEmails = new Set();
    const userTenant = getTenantCode(req);
    const userIsRoot = isRootUser(req);

    if (supabase) {
      try {
        let query = supabase.from('usuarios').select('*').order('created_at', { ascending: false });
        if (!userIsRoot && userTenant) {
          query = query.eq('empresa_codigo', userTenant);
        }

        const { data: supaUsers, error: supaErr } = await query;

        if (supaErr) console.warn('[GET USERS] Supabase error:', supaErr.message);

        // Emails dueños de tenant (para mostrar rol Owner en lugar de Admin)
        const ownerEmails = new Set();
        try {
          const { data: tns } = await supabase.from('tenants').select('email');
          (tns || []).forEach(t => { if (t && t.email) ownerEmails.add(String(t.email).toLowerCase().trim()); });
        } catch (e) { /* noop */ }

(supaUsers || []).filter(u => u.activo !== false).forEach(u => {
            const email = (u.email || '').toLowerCase();
            if (email && !seenEmails.has(email)) {
              seenEmails.add(email);
              const rolGlobal = String(u.rol_global || '').trim().toLowerCase();
              const rolUsuario = String(u.rol || '').trim().toLowerCase();
              const esAdminPortal = ['root', 'root pp', 'superadmin'].includes(rolGlobal) || ['root', 'root pp', 'superadmin'].includes(rolUsuario);
              allUsers.push({
                id: u.id,
                displayId: u.id,
                nombre: u.nombre || u.email.split('@')[0],
                apellido: u.apellido || '',
                email: email,
                rol: ownerEmails.has(email) ? 'Owner' : (u.rol || u.rol_global || 'Owner'),
                tenant_code: esAdminPortal ? null : (u.empresa_codigo || null),
                tenant: esAdminPortal ? 'Portal Pilot (Global)' : (u.empresa_codigo || 'Sin tenant'),
                scope: esAdminPortal ? 'global' : 'tenant',
                status: 'active',
                registered: u.created_at || new Date().toISOString(),
                lastActivity: u.ultimo_acceso || u.updated_at || null,
                avatar: u.foto_perfil_url || u.avatar_url || null,
                banner: u.banner_perfil_url || null,
                notas: '',
                source: 'supabase'
              });
            }
          });
      } catch (err) {
        console.warn('[GET USERS] Error consultando usuarios:', err.message);
      }
    }

    // Sort by date
    allUsers.sort((a, b) => new Date(b.registered) - new Date(a.registered));

    res.json(allUsers);
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (!requireSupabase(res)) return;

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, empresa_id, empresa_codigo, nombre, apellido, email, rol_global, rol, activo, estado, two_factor_enabled, created_at, updated_at, ultimo_acceso, foto_perfil_url, banner_perfil_url')
      .eq('id', id)
      .single();

    if (error || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    let codigo = usuario.empresa_codigo || '', empNombre = '', tenantEmail = '';
    if (usuario.empresa_id) {
      try {
        const { data: emp } = await supabase.from('empresas').select('nombre, codigo').eq('id', usuario.empresa_id).single();
        if (emp) { codigo = emp.codigo || codigo; empNombre = emp.nombre || ''; }
      } catch (e) { /* noop */ }
    }
    // Fallback a la tabla tenants (los registros /api/registro crean tenants, no empresas)
    if (codigo) {
      try {
        const { data: ten } = await supabase.from('tenants').select('nombre_empresa, email').eq('codigo', normalizeTenantCode(codigo)).maybeSingle();
        if (ten) {
          empNombre = empNombre || ten.nombre_empresa || '';
          tenantEmail = ten.email || '';
        }
      } catch (e) { /* noop */ }
    }

    if (!isRootUser(req) && !assertTenantAccess(req, codigo)) {
      return res.status(403).json({ error: 'No tienes permiso para ver este usuario.' });
    }

    const nombreCompleto = normalizeDisplayName(usuario.nombre, usuario.apellido);
    const stats = await computeUserStats(usuario.id, codigo, nombreCompleto, usuario);

    const rolGlobal = String(usuario.rol_global || '').trim().toLowerCase();
    const rolUsuario = String(usuario.rol || '').trim().toLowerCase();
    const esAdminPortal = ['root', 'root pp', 'superadmin'].includes(rolGlobal) || ['root', 'root pp', 'superadmin'].includes(rolUsuario);

    res.json({
      id: usuario.id,
      displayId: usuario.id,
      nombre: nombreCompleto,
      nombre_completo: nombreCompleto,
      apellido: usuario.apellido || '',
      email: usuario.email || '',
      rol: resolveDisplayRole(usuario, { email: tenantEmail }),
      tenant_code: esAdminPortal ? null : (codigo || null),
      tenant: esAdminPortal ? 'Portal Pilot (Global)' : (empNombre || codigo || 'Sin tenant'),
      scope: esAdminPortal ? 'global' : 'tenant',
      status: ['inactivo', 'suspendido', 'blocked'].includes(String(usuario.estado || '').toLowerCase())
        ? 'inactive'
        : (usuario.activo ? 'active' : 'inactive'),
      verified: !!usuario.two_factor_enabled,
      registered: usuario.created_at || new Date().toISOString(),
      lastActivity: usuario.ultimo_acceso || usuario.updated_at || null,
      avatar: usuario.foto_perfil_url || null,
      banner: usuario.banner_perfil_url || null,
      notas: '',
      source: 'supabase',
      stats,
      professional: {
        departamento: null,
        cargo: null,
        ubicacion: null,
        zonaHoraria: null,
        telCorporativo: null,
        extension: null,
        responsabilidades: null
      }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Sesiones activas de un usuario (basado en ultimo_acceso/updated_at)
app.get('/api/users/:id/sessions', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, email, nombre, apellido, empresa_codigo, ultimo_acceso, updated_at, created_at, foto_perfil_url')
      .eq('id', req.params.id)
      .single();

    if (error || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Verificar permisos: root o mismo usuario o admin del tenant
    const codigo = usuario.empresa_codigo || 'ROOT';
    if (!isRootUser(req) && req.user.sub !== usuario.id) {
      if (!assertTenantAccess(req, codigo)) {
        return res.status(403).json({ error: 'No tienes permiso para ver estas sesiones.' });
      }
    }

    // Datos REALES de tenant_sessions (Bloque J): nada de sesiones simuladas.
    // Si la tabla aún no existe (drift), se devuelve lista vacía con flag —
    // nunca sesiones inventadas.
    let sessions = [];
    let fallback = false;
    try {
      const { data: sesiones, error: sesErr } = await supabase.from('tenant_sessions')
        .select('id, ip, dispositivo, ubicacion, ultimo_actividad, created_at, revocada')
        .eq('usuario_id', usuario.id)
        .order('ultimo_actividad', { ascending: false })
        .limit(50);
      if (sesErr) throw sesErr;
      sessions = (sesiones || []).map(s => ({
        id: s.id,
        deviceName: s.dispositivo || 'Dispositivo no registrado',
        deviceType: /m[oó]vil|mobile|android|iphone/i.test(s.dispositivo || '') ? 'mobile' : 'desktop',
        browser: s.dispositivo || 'Desconocido',
        os: s.dispositivo || 'Desconocido',
        ip: s.ip || null,
        location: s.ubicacion || null,
        lastActivity: s.ultimo_actividad || s.created_at,
        createdAt: s.created_at,
        isCurrent: false,
        isActive: !s.revocada && s.ultimo_actividad && (Date.now() - new Date(s.ultimo_actividad).getTime() < 30 * 60 * 1000),
        revocada: !!s.revocada
      }));
    } catch (e) {
      fallback = true;
      console.warn('[USER_SESSIONS] tenant_sessions no disponible:', e.message);
    }

    res.json({ sessions, total: sessions.length, fallback });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Revocar todas las sesiones excepto la actual (incrementa token_version)
app.post('/api/users/:id/revoke-sessions', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { id } = req.params;
    
    // Verificar permisos: root, mismo usuario, o admin del tenant
    const { data: usuario, error: userErr } = await supabase
      .from('usuarios')
      .select('id, empresa_codigo')
      .eq('id', id)
      .single();

    if (userErr || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (!isRootUser(req) && req.user.sub !== id) {
      if (!assertTenantAccess(req, usuario.empresa_codigo)) {
        return res.status(403).json({ error: 'No tienes permiso para revocar sesiones de este usuario.' });
      }
    }

    // Incrementar token_version para invalidar todos los tokens existentes.
    // Si la columna aún no existe (drift de esquema), no se rompe la acción:
    // la sesión se cierra del lado del cliente y queda el evento registrado.
    const { error: updateErr } = await supabase
      .from('usuarios')
      .update({ token_version: (usuario.token_version || 0) + 1 })
      .eq('id', id);

    if (updateErr) {
      console.warn('[REVOKE_SESSIONS] token_version no disponible:', updateErr.message);
    } else {
      // La revocación surte efecto de inmediato (sin esperar la caché de 30s).
      invalidateTokenVersionCache(id);
    }

    // Si es el usuario actual, también limpiar su cookie
    if (req.user.sub === id) {
      clearSessionCookie(res);
    }

    res.json({ message: 'Todas las sesiones han sido revocadas.' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Exportar datos del usuario (GDPR)
app.get('/api/users/:id/export', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { id } = req.params;

    // Verificar permisos: root, mismo usuario, o admin del tenant
    const { data: usuario, error: userErr } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', id)
      .single();

    if (userErr || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (!isRootUser(req) && req.user.sub !== id) {
      if (!assertTenantAccess(req, usuario.empresa_codigo)) {
        return res.status(403).json({ error: 'No tienes permiso para exportar datos de este usuario.' });
      }
    }

    // Obtener actividad, sesiones, API keys, etc.
    const [actividad, sesiones, apiKeys] = await Promise.all([
      supabase.from('auditoria').select('*').eq('usuario_id', id).order('created_at', { ascending: false }).limit(100),
      supabase.from('auditoria').select('*').eq('usuario_id', id).eq('accion', 'login_exitoso').order('created_at', { ascending: false }).limit(20),
      supabase.from('api_keys').select('*').eq('usuario_id', id)
    ]);

    const exportData = {
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        rol: usuario.rol_global || usuario.rol,
        empresa_codigo: usuario.empresa_codigo,
        created_at: usuario.created_at,
        updated_at: usuario.updated_at,
        ultimo_acceso: usuario.ultimo_acceso,
        activo: usuario.activo,
        two_factor_enabled: usuario.two_factor_enabled
      },
      actividad: (actividad.data || []).map(a => ({
        accion: a.accion,
        detalles: a.detalles,
        ip: a.ip,
        modulo: a.modulo,
        resultado: a.resultado,
        created_at: a.created_at
      })),
      sesiones: (sesiones.data || []).map(s => ({
        accion: s.accion,
        ip: s.ip,
        created_at: s.created_at
      })),
      apiKeys: (apiKeys.data || []).map(k => ({
        nombre: k.nombre,
        created_at: k.created_at,
        ultimo_uso: k.ultimo_uso
      })),
      exportado_en: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="usuario-${id}-export-${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Historial de actividad de un usuario (desde tabla auditoria)
app.get('/api/users/:id/activity', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const offset = parseInt(req.query.offset) || 0;

    const { data: usuario, error: userErr } = await supabase
      .from('usuarios')
      .select('id, empresa_codigo')
      .eq('id', id)
      .single();

    if (userErr || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Verificar permisos: root, mismo usuario, o admin del tenant
    if (!isRootUser(req) && req.user.sub !== id) {
      if (!assertTenantAccess(req, usuario.empresa_codigo)) {
        return res.status(403).json({ error: 'No tienes permiso para ver esta actividad.' });
      }
    }

    // Consultar auditoria por nombre del usuario (la tabla registra 'usuario'
    // como texto, no usuario_id) y SIEMPRE con scope de tenant.
    const { data: target } = await supabase
      .from('usuarios')
      .select('nombre, apellido')
      .eq('id', id)
      .single();
    const nombreUsuario = normalizeDisplayName(target?.nombre, target?.apellido);

    let query = supabase
      .from('auditoria')
      .select('id, accion, descripcion, tipo, usuario, ip, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    const codigoActividad = normalizeTenantCode(usuario.empresa_codigo || '');
    if (codigoActividad && !isRootUser(req)) query = query.eq('empresa_codigo', codigoActividad);
    if (nombreUsuario) query = query.ilike('usuario', `%${nombreUsuario}%`);

    const { data: actividad, error: actErr } = await query;

    if (actErr) {
      console.warn('[GET USER ACTIVITY] Error:', actErr.message);
      return res.json({ activity: [], total: 0 });
    }

    const formatted = (actividad || []).map(a => ({
      id: a.id,
      action: a.accion,
      details: a.descripcion || '',
      ip: a.ip,
      timestamp: a.created_at,
      module: a.tipo || 'Sistema',
      result: 'success',
      hash: a.id ? String(a.id).slice(0, 8) : ''
    }));

    res.json({ activity: formatted, total: formatted.length });
  } catch (error) {
    return handleServerError(res, error);
  }
});

// Suplantar usuario (solo admin ROOT) — emite un JWT válido con la sesión del usuario objetivo
app.post('/api/users/:id/impersonate', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    if (!isRootUser(req)) {
      return res.status(403).json({ error: 'Solo el administrador ROOT puede suplantar usuarios.' });
    }

    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, email, rol_global, rol, empresa_codigo, nombre, apellido, foto_perfil_url, banner_perfil_url')
      .eq('id', req.params.id)
      .single();
    if (error || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const codigo = usuario.empresa_codigo || 'ROOT';

    // Resolver nombre visible del tenant/empresa para la barra lateral
    let empresaNombre = codigo === 'ROOT' ? 'Portal Pilot' : codigo;
    let tenantEmail = '';
    try {
      if (codigo && codigo !== 'ROOT') {
        const tCode = normalizeTenantCode(codigo);
        const { data: t } = await supabase.from('tenants').select('nombre_empresa, email').eq('codigo', tCode).maybeSingle();
        if (t?.nombre_empresa) {
          empresaNombre = t.nombre_empresa;
        } else {
          const { data: e } = await supabase.from('empresas').select('nombre').eq('codigo', tCode).maybeSingle();
          if (e?.nombre) empresaNombre = e.nombre;
        }
        if (t?.email) tenantEmail = t.email;
      }
    } catch (e) { /* noop */ }

    const displayRole = resolveDisplayRole(usuario, { email: tenantEmail });
    const token = jwt.sign(
      {
        sub: usuario.id,
        email: usuario.email,
        rol: displayRole,
        empresa_codigo: codigo,
        imp: true
      },
      localJwtSecret,
      { expiresIn: '2h' }
    );

    const nombre = normalizeDisplayName(usuario.nombre, usuario.apellido);
    return res.json({
      success: true,
      message: `Sesión iniciada como ${nombre}`,
      token,
      user: {
        id: usuario.id,
        nombre,
        email: usuario.email,
        rol: displayRole,
        tenant: codigo,
        empresa_codigo: codigo,
        empresa_nombre: empresaNombre,
        foto_perfil_url: usuario.foto_perfil_url || null,
        banner_perfil_url: usuario.banner_perfil_url || null
      }
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.post('/api/users', authenticate, requireTenantAdmin, requirePlanFeature('web_admin'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, apellido, email, rol, tenant, notas, password, modulos } = req.body;

    if (!nombre || !email) {
      return res.status(400).json({ error: 'Nombre y Email son obligatorios.' });
    }

    // 1. Resolve empresa — buscar por código o nombre del tenant en Supabase
    let empresaCodigo = tenant || getTenantCode(req) || '';
    // Scope estricto (Bloque D): cualquier declaración de tenant distinta al del
    // JWT (en 'tenant' o 'empresa_codigo') es rechazada para no-ROOT, incluso
    // si el campo sería ignorado — evita ambigüedades y fail-open futuros.
    const declaredAlt = (req.body?.empresa_codigo || '').toString().trim().toUpperCase();
    if (!isRootUser(req) && declaredAlt && declaredAlt !== normalizeTenantCode(getTenantCode(req))) {
      return res.status(403).json({ error: 'No puedes crear usuarios fuera de tu tenant.' });
    }
    if (!isRootUser(req) && empresaCodigo !== getTenantCode(req)) {
      return res.status(403).json({ error: 'No puedes crear usuarios fuera de tu tenant.' });
    }

    let empresaRecord = null;
    if (empresaCodigo) {
      // Intentar por código primero
      const { data: empByCode } = await supabase
        .from('empresas')
        .select('id, nombre')
        .eq('codigo', empresaCodigo)
        .single();
      empresaRecord = empByCode;

      // Si no encontró por código, intentar por nombre
      if (!empresaRecord) {
        const { data: empByName } = await supabase
          .from('empresas')
          .select('id, nombre, codigo')
          .ilike('nombre', empresaCodigo)
          .single();
        empresaRecord = empByName;
        if (empresaRecord) empresaCodigo = empresaRecord.codigo || empresaCodigo;
      }
    }

    if (!empresaRecord) {
      return res.status(400).json({ error: `No se encontró empresa con código "${empresaCodigo}". Primero sincroniza la empresa en Supabase.` });
    }

    const entitlements = req.entitlements || await getTenantEntitlements(req);
    if (!isRootUser(req)) {
      const { count, error: countError } = await supabase
        .from('usuarios').select('id', { count: 'exact', head: true })
        .eq('empresa_id', empresaRecord.id).eq('activo', true);
      if (countError) throw countError;
      if ((count || 0) >= entitlements.maxUsers) {
        return res.status(403).json({
          error: `Tu plan ${entitlements.plan} permite hasta ${entitlements.maxUsers} usuarios activos.`,
          code: 'PLAN_USER_LIMIT'
        });
      }
    }

    // 2. Check duplicado
    const { data: existing } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
    if (existing) {
      return res.status(400).json({ error: 'El correo ya está registrado.' });
    }

    // 4. Insertar perfil en tabla usuarios
    // rol SIEMPRE explícito: la columna tiene default 'admin' en DB y heredarlo
    // para un miembro sería una escalada de privilegios (Blueprint §6/§15).
    const rolSolicitado = String(rol || 'miembro').trim().toLowerCase();
    const rolCanonico = ['owner', 'administrador', 'admin', 'miembro', 'user'].includes(rolSolicitado) ? rolSolicitado : 'miembro';
    // RBAC (Bloque D): solo el OWNER (o ROOT) puede crear OWNER/ADMIN.
    // Un ADMIN nunca puede fabricar un OWNER ni otro ADMIN — ni manipulando
    // el body de la petición. Se degrada a 'miembro' en vez de fallar duro
    // para no romper flujos legítimos de alta de personal.
    const requesterIsOwner = isOwnerUser(req);
    const rolCanonicoFinal = ['owner', 'admin', 'administrador'].includes(rolCanonico) && !requesterIsOwner
      ? 'miembro'
      : rolCanonico;

    // 3. Crear usuario en Supabase Auth
    const passwordTemporal = password || generateSecurePassword();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: passwordTemporal,
      email_confirm: true
    });
    if (authError) {
      console.error('[SUPABASE AUTH] Error creando usuario:', authError.message);
      return res.status(400).json({ error: `Error al crear cuenta: ${authError.message}` });
    }

    // El login (/api/login) valida contra password_hash de la tabla usuarios:
    // sin esto, el usuario NUNCA podría iniciar sesión (bug real detectado).
    const saltInsert = await bcrypt.genSalt(10);
    const passwordHashInsert = await bcrypt.hash(passwordTemporal, saltInsert);
    const { error: insertError } = await supabase.from('usuarios').insert({
      id: authData.user.id,
      empresa_id: empresaRecord.id,
      nombre: nombre.trim(),
      apellido: (apellido || '').trim(),
      email: email.toLowerCase().trim(),
      rol_global: rolCanonicoFinal,
      rol: rolCanonicoFinal === 'user' ? 'miembro' : rolCanonicoFinal,
      empresa_codigo: empresaCodigo,
      password_hash: passwordHashInsert,
      password: passwordHashInsert,
      activo: true
    });
    if (insertError) {
      console.error('[SUPABASE] Error insertando perfil:', insertError.message);
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: `Error al guardar perfil: ${insertError.message}` });
    }

    // 5. Asignar módulos al trabajador
    if (Array.isArray(modulos) && modulos.length > 0) {
      const moduloInserts = modulos.map(m => ({
        usuario_id: authData.user.id,
        empresa_id: empresaRecord.id,
        modulo_id: m.modulo_id || m,
        rol: m.rol || 'user'
      }));
      const { error: modError } = await supabase.from('usuario_modulos').insert(moduloInserts);
      if (modError) console.warn('[SUPABASE] Error asignando módulos:', modError.message);
    }

    // 6. Enviar email de activación
    await enviarAlertaActivacionCuenta(email, passwordTemporal, null, empresaRecord.nombre);

    // 7. Notificar al admin
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      '👤 Nuevo Trabajador Registrado',
      'Nuevo Trabajador Creado',
      'Se ha creado un nuevo trabajador en Supabase.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>Nombre:</strong> ${nombre} ${apellido || ''}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Tenant:</strong> ${empresaRecord.nombre}</li>
        <li><strong>Módulos:</strong> ${modulos?.map(m => m.modulo_id || m).join(', ') || 'Ninguno'}</li>
      </ul>`
    );

    // AUTOMATION HOOK: usuario_creado
    dispatchAutomationEvent(empresaCodigo, 'usuario_creado', {
      nombre, email, rol: rol || 'user', empresaCodigo
    }).catch((e) => { console.warn('[AUTOMATION_HOOK] Non-critical:', e.message); });

    if (rolCanonicoFinal !== rolCanonico) {
      await registrarAuditoria(empresaCodigo, 'Rol degradado', `Se intentó crear ${email} como ${rolCanonico} sin ser Owner; se asignó miembro`, 'seguridad', req.user?.email || '', req);
    }
    await registrarAuditoria(empresaCodigo, 'Usuario creado', `Se creó el usuario ${email} con rol ${rolCanonicoFinal}`, 'usuarios', req.user?.email || '', req);

    res.status(201).json({
      message: 'Trabajador creado exitosamente',
      user: {
        id: authData.user.id,
        nombre, apellido: apellido || '',
        email, rol: rol || 'user',
        status: 'active'
      }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { id } = req.params;
    const { nombre, apellido, email, rol, tenant, notas, status, password, reason, modulos, foto_perfil_url, banner_perfil_url } = req.body;

    // Cualquier usuario puede editar su PROPIO perfil; los admins pueden editar a cualquiera de su tenant
    const normalizedRole = String(req.user?.rol || '').trim().toLowerCase();
    const isAdmin = isRootUser(req) || ['owner', 'administrador', 'admin'].includes(normalizedRole);
    const isSelf = (req.user?.sub && String(req.params.id) === String(req.user.sub)) ||
      (id.includes('@') && id.toLowerCase() === String(req.user?.email || '').toLowerCase());
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este usuario.' });
    }

    // 1. Fetch current user
    const { data: usuarioActual, error: fetchErr } = await supabase
      .from('usuarios')
      .select('id, empresa_id, empresa_codigo, nombre, apellido, email, rol_global, activo')
      .eq('id', id)
      .single();

    if (fetchErr || !usuarioActual) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const codigo = normalizeTenantCode(usuarioActual.empresa_codigo || '');
    if (!isRootUser(req) && !assertTenantAccess(req, codigo)) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este usuario.' });
    }

    // 2. Check email uniqueness
    if (email && email !== usuarioActual.email) {
      const { data: existing } = await supabase
        .from('usuarios')
        .select('id')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();
      if (existing) return res.status(400).json({ error: 'El correo ya está en uso.' });
    }

    // 3. Build update fields
    const updateFields = {};
    if (typeof nombre !== 'undefined') updateFields.nombre = nombre;
    if (typeof apellido !== 'undefined') updateFields.apellido = apellido;
    if (typeof email !== 'undefined') updateFields.email = email.toLowerCase().trim();
    if (typeof rol !== 'undefined') {
      // RBAC (Bloque D): solo Owner (o ROOT) puede asignar roles privilegiados.
      const rolSolicitado = String(rol || '').trim().toLowerCase();
      const rolPrivilegiado = ['owner', 'admin', 'administrador'].includes(rolSolicitado);
      if (rolPrivilegiado && !isRootUser(req) && !isOwnerUser(req)) {
        await registrarAuditoria(codigo, 'Escalada bloqueada', `ADMIN intentó asignar rol ${rolSolicitado} a ${usuarioActual.email}`, 'seguridad', req.user?.email || '', req);
        return res.status(403).json({ error: 'Solo el Owner de la empresa puede asignar roles Owner/Admin.' });
      }
      // Nadie puede editar al propio OWNER ni elevarlo: su único manejo es baja
      // del usuario, que queda excluida por el bloqueo de borrado más abajo.
      if (['owner', 'administrador', 'admin'].includes(String(usuarioActual.rol || usuarioActual.rol_global || '').toLowerCase())
        && !isRootUser(req) && !isOwnerUser(req)) {
        return res.status(403).json({ error: 'El Owner de la empresa solo puede ser gestionado por el mismo o por ROOT.' });
      }
      // OWNER: no puede (des)elevarse a sí mismo ni auto-remover su rol.
      if (isSelf && ['owner', 'admin', 'administrador'].includes(rolSolicitado) === false
        && ['owner', 'admin', 'administrador'].includes(String(usuarioActual.rol || usuarioActual.rol_global || '').toLowerCase())) {
        return res.status(403).json({ error: 'No puedes quitarte a ti mismo el rol Owner.' });
      }
      updateFields.rol_global = rolSolicitado;
      updateFields.rol = rolSolicitado;
    }
    if (typeof notas !== 'undefined') updateFields.notas = notas;
    if (typeof status !== 'undefined') updateFields.activo = normalizeStatus(status) === 'active';
    if (typeof foto_perfil_url !== 'undefined') updateFields.foto_perfil_url = foto_perfil_url || null;
    if (typeof banner_perfil_url !== 'undefined') updateFields.banner_perfil_url = banner_perfil_url || null;

    if (Object.keys(updateFields).length > 0) {
      const { error: updateErr } = await supabase
        .from('usuarios')
        .update(updateFields)
        .eq('id', id);
      if (updateErr) throw updateErr;
    }

    // 4. Update password in Supabase Auth if provided
    if (password) {
      const { error: pwdErr } = await supabase.auth.admin.updateUser(id, { password });
      if (pwdErr) console.warn('[SUPABASE] Error actualizando contraseña:', pwdErr.message);
    }

    // 5. Update email in Supabase Auth if changed
    if (email && email !== usuarioActual.email) {
      const { error: emailErr } = await supabase.auth.admin.updateUser(id, { email: email.toLowerCase().trim() });
      if (emailErr) console.warn('[SUPABASE] Error actualizando email:', emailErr.message);
    }

    // 6. Update modules if provided
    if (Array.isArray(modulos)) {
      await supabase.from('usuario_modulos').delete().eq('usuario_id', id);
      if (modulos.length > 0) {
        const inserts = modulos.map(m => ({
          usuario_id: id,
          empresa_id: usuarioActual.empresa_id,
          modulo_id: m.modulo_id || m,
          rol: m.rol || 'user'
        }));
        await supabase.from('usuario_modulos').insert(inserts);
      }
    }

    // 7. Send notifications
    const updatedEmail = email || usuarioActual.email;
    const normalizedStatus = typeof status !== 'undefined' ? normalizeStatus(status) : null;

    if (normalizedStatus === 'active' && !usuarioActual.activo && updatedEmail) {
      await enviarOnboardingEmail(updatedEmail);
    }
    if (normalizedStatus && ['active', 'suspended'].includes(normalizedStatus) && updatedEmail) {
      await enviarCambioEstadoUsuario(updatedEmail, normalizedStatus, req.user.email || 'admin@portalpilot.io', reason || '');
    }

    const esAccion = status === 'suspended' ? 'Suspensión' : status === 'active' ? 'Activación' : 'Actualización';
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      `✏️ ${esAccion} de Trabajador`,
      `Trabajador ${esAccion}`,
      `Operación de ${esAccion} realizada.`,
      `<ul style="list-style: none; padding: 0;">
        <li><strong>ID:</strong> ${id}</li>
        ${nombre ? `<li><strong>Nombre:</strong> ${nombre} ${apellido || ''}</li>` : ''}
        ${email ? `<li><strong>Email:</strong> ${email}</li>` : ''}
        ${rol ? `<li><strong>Rol:</strong> ${rol}</li>` : ''}
        ${status ? `<li><strong>Estado:</strong> ${status.toUpperCase()}</li>` : ''}
      </ul>`
    );

    await registrarAuditoria(codigo, 'Usuario actualizado', `Se actualizaron los datos del usuario ${updatedEmail}`, 'usuarios', req.user?.email || '', req);

    res.json({ message: 'Trabajador actualizado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.delete('/api/users/:id', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userTenant = getTenantCode(req);
    const userIsRoot = isRootUser(req);
    const isEmail = id.includes('@');

    // Resolve target user and its tenant (always, so we can cascade the tenant later)
    let targetUser = null;
    if (supabase) {
      const lookup = isEmail
        ? await supabase.from('usuarios').select('id, empresa_codigo').eq('email', id.toLowerCase()).single()
        : await supabase.from('usuarios').select('id, empresa_codigo').eq('id', id).single();
      targetUser = lookup.data || null;
      if (!targetUser) {
        return res.status(404).json({ error: 'Usuario no encontrado.' });
      }
      targetUserId = targetUser.id || null;
      targetTenant = normalizeTenantCode(targetUser.empresa_codigo || '');
    }

    // OWNER exclusiva (estricta): solo el Owner real (o ROOT) puede eliminar
    // usuarios. Un ADMIN queda excluido aunque isOwnerUser lo trate como
    // admin-portal para navegación.
    if (!isTrueOwner(req)) {
      return res.status(403).json({ error: 'Eliminar usuarios es una acción exclusiva del Owner de la empresa.' });
    }
    // El OWNER nunca puede eliminarse a sí mismo.
    if (String(req.user?.sub) === String(targetUserId) || id.toLowerCase() === String(req.user?.email || '').toLowerCase()) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta siendo Owner.' });
    }

    // Verify target user belongs to same tenant (unless ROOT)
    if (!userIsRoot && userTenant && targetTenant && targetTenant !== normalizeTenantCode(userTenant)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar usuarios de otra empresa.' });
    }

    let tenantDeleted = false;

    if (supabase) {
      try {
        await supabase.from('usuario_modulos').delete().eq('usuario_id', isEmail ? id : targetUserId);
      } catch (e) { console.warn('[USER_DELETE] Non-critical modulos:', e.message); }

      if (isEmail) {
        await supabase.from('usuarios').delete().eq('email', id.toLowerCase());
      } else {
        await supabase.from('usuarios').delete().eq('id', id);
        // Borrar también la identidad del usuario en Supabase Auth
        if (targetUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
          try { await supabase.auth.admin.deleteUser(targetUserId); } catch (e) { console.warn('[USER_DELETE] Auth non-critical:', e.message); }
        }
      }

      // CASCADE: si el tenant ya no tiene usuarios, eliminar el tenant y su empresa
      if (targetTenant && targetTenant !== 'ROOT') {
        try {
          const { data: restantes } = await supabase.from('usuarios').select('id').eq('empresa_codigo', targetTenant);
          if (!restantes || restantes.length === 0) {
            try { await supabase.from('empresas').delete().eq('codigo', targetTenant); } catch (e) { console.warn('[USER_DELETE] Empresa non-critical:', e.message); }
            try { await supabase.from('tenants').delete().eq('codigo', targetTenant); } catch (e) { console.warn('[USER_DELETE] Tenant non-critical:', e.message); }
            tenantDeleted = true;
          }
        } catch (e) {
          console.warn('[USER_DELETE] Cascade non-critical:', e.message);
        }
      }
    }

    await registrarAuditoria(targetTenant || userTenant, 'Usuario eliminado', `Se eliminó el usuario ${id}`, 'usuarios', req.user?.email || '', req);

    return res.json({
      success: true,
      message: tenantDeleted ? 'Usuario eliminado y tenant eliminado (ya no tenía usuarios).' : 'Usuario eliminado exitosamente',
      tenantDeleted
    });
  } catch (error) {
    console.error('[DELETE USER] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Error al eliminar usuario' });
  }
});

// ═══ SUBIDA DE IMÁGENES (Supabase Storage o fallback data:URL) ═══
const UPLOADS_BUCKET = 'uploads';

app.post('/api/upload', authenticate, async (req, res) => {
  try {
    const { file, folder, filename } = req.body;
    if (!file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    const match = file.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Formato de imagen inválido' });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen no debe superar 10MB' });
    }

    // Si hay Supabase Storage real, úsalo
    if (supabase && supabase.storage) {
      const tenantCode = getTenantCode(req) || 'default';
      const subDir = folder || 'general';
      const safeName = (filename || `img_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeName}_${Date.now()}.${ext}`;
      const filePath = `${tenantCode}/${subDir}/${fileName}`;

      const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const { data, error } = await supabase.storage.upload(UPLOADS_BUCKET, filePath, buffer, contentType);

      if (error) {
        console.error('[UPLOAD] Supabase Storage error:', error.message);
        return res.status(500).json({ error: 'Error al subir archivo a Storage' });
      }

      const fileUrl = supabase.storage.getPublicUrl(UPLOADS_BUCKET, filePath);
      return res.json({ url: fileUrl, path: `/${filePath}`, size: buffer.length });
    }

    // Fallback: devolver data:URL (funciona sin Storage, ideal para desarrollo/Vercel serverless)
    const dataUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64Data}`;
    return res.json({ url: dataUrl, path: null, size: buffer.length, fallback: true });

  } catch (error) {
    console.error('[UPLOAD] Error:', error.message);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// ═══════════════════════════════════════════════════════════════
// MÓDULO ENTERPRISE: API Keys, IA (Groq), Dashboard, Flota, Seguridad, Automatización
// ═══════════════════════════════════════════════════════════════

async function registrarAuditoria(empresaCodigo, accion, descripcion, tipo = 'sistema', usuarioNombre = '', req = null) {
  if (!supabase) return;
  const payload = {
    empresa_codigo: normalizeTenantCode(empresaCodigo || getTenantCode(req || { user: {} })),
    accion: String(accion || '').slice(0, 200),
    descripcion: String(descripcion || '').slice(0, 2000),
    tipo: String(tipo || 'sistema').slice(0, 50),
    usuario: String(usuarioNombre || '').slice(0, 200),
    ip: (req && req.ip ? String(req.ip).slice(0, 60) : ''),
    created_at: new Date().toISOString()
  };
  if (!payload.empresa_codigo) return;
  try { await supabase.from('auditoria').insert([payload]); } catch (err) {
    console.warn('[AUDITORIA] No se pudo registrar:', err.message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolverEmpresaSupabase(empresaCodigo) {
  if (!supabase || !empresaCodigo) return null;
  try {
    const norm = normalizeTenantCode(empresaCodigo);
    const raw = String(empresaCodigo).trim();
    let { data, error } = await supabase
      .from('empresas')
      .select('id, codigo, nombre')
      .eq('codigo', norm)
      .maybeSingle();
    if ((!data || error) && raw && raw !== norm) {
      const r = await supabase.from('empresas').select('id, codigo, nombre').eq('codigo', raw).maybeSingle();
      data = r.data; error = r.error;
    }
    // Los clientes (p.ej. pp/tenant_detail) identifican al tenant por UUID;
    // resolverlo vía tenants.id → codigo para no devolver 404 falsos.
    if (!data && UUID_RE.test(raw)) {
      const { data: tenant } = await supabase.from('tenants').select('codigo').eq('id', raw).maybeSingle();
      if (tenant?.codigo) {
        const r = await supabase.from('empresas').select('id, codigo, nombre').eq('codigo', normalizeTenantCode(tenant.codigo)).maybeSingle();
        data = r.data; error = r.error;
      }
      if (!data) {
        const e = await supabase.from('empresas').select('id, codigo, nombre').eq('id', raw).maybeSingle();
        data = e.data; error = e.error;
      }
    }
    return (data && !error) ? data : null;
  } catch (err) {
    return null;
  }
}

// Evita el apellido duplicado (p.ej. "AMY FAJARDO FAJARDO") colapsando palabras idénticas consecutivas
function normalizeDisplayName(nombre, apellido) {
  const n = String(nombre || '').trim();
  const a = String(apellido || '').trim();
  const full = (a ? `${n} ${a}` : n).replace(/\s+/g, ' ').trim();
  const out = [];
  for (const word of full.split(' ')) {
    if (word && out.length && out[out.length - 1].toLowerCase() === word.toLowerCase()) continue;
    if (word) out.push(word);
  }
  return out.join(' ') || full;
}

// Si el correo del usuario coincide con el correo registrado del tenant, es el Owner/dueño de la empresa
function resolveDisplayRole(userRow, tenantRow) {
  const userEmail = String(userRow && (userRow.email || '')).toLowerCase().trim();
  const tenEmail = String(tenantRow && (tenantRow.email || tenantRow.correo || tenantRow.email_representante || tenantRow.correo_representante || '')).toLowerCase().trim();
  const globalRole = String(userRow && (userRow.rol_global || '')).trim().toLowerCase();
  if (['root', 'root pp', 'superadmin'].includes(globalRole)) return globalRole;
  if (userEmail && tenEmail && userEmail === tenEmail) return 'Owner';
  return userRow.rol || userRow.rol_global || 'admin';
}

// Estadísticas reales calculadas a partir de tablas del backend (nunca inventadas)
async function computeUserStats(userId, codigo, nombreCompleto, usuario) {
  const stats = { sesiones: null, bots: null, tokens: null, score: null, fallidos: null };
  if (!supabase) return stats;
  const t = codigo ? normalizeTenantCode(codigo) : '';
  const nameMatch = String(nombreCompleto || '').trim();
  const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Inicios de sesión reales (registrados desde /api/login)
  try {
    let q = supabase.from('auditoria').select('id', { count: 'exact', head: true }).eq('accion', 'login_exitoso');
    if (t) q = q.eq('empresa_codigo', t);
    if (nameMatch) q = q.ilike('usuario', `%${nameMatch}%`);
    const { count } = await q;
    stats.sesiones = count || 0;
  } catch (e) { /* noop */ }

  // Bots ejecutados (automation_runs no guarda usuario; nivel tenant)
  try {
    if (t) {
      const { count } = await supabase.from('automation_runs').select('id', { count: 'exact', head: true }).eq('empresa_codigo', t);
      stats.bots = count || 0;
    }
  } catch (e) { /* noop */ }

  // Tokens IA consumidos por el usuario + % sobre el límite del plan del tenant
  try {
    const { data } = await supabase.from('ai_usage_log').select('tokens_total').eq('usuario_id', userId);
    const usados = (data && Array.isArray(data)) ? data.reduce((s, r) => s + (Number(r.tokens_total) || 0), 0) : 0;
    let limite = 0;
    if (t) {
      const { data: ten } = await supabase.from('tenants').select('plan').eq('codigo', t).maybeSingle();
      limite = planLimitsFor(ten && ten.plan).tokens || 0;
    }
    stats.tokens = {
      usados,
      limite,
      porcentaje: limite > 0 ? Math.max(0, Math.min(100, Math.round((usados / limite) * 100))) : 0
    };
  } catch (e) { /* noop */ }

  // Intentos fallidos de sesión en los últimos 30 días
  try {
    if (t && nameMatch) {
      const { count } = await supabase
        .from('auditoria')
        .select('id', { count: 'exact', head: true })
        .eq('accion', 'login_fallido')
        .eq('empresa_codigo', t)
        .ilike('usuario', `%${nameMatch}%`)
        .gte('created_at', hace30dias);
      stats.fallidos = count || 0;
    }
  } catch (e) { /* noop */ }

  // Score de seguridad a partir de señales reales (2FA, estado, intentos fallidos)
  try {
    let score = 40;
    const estado = String(usuario?.estado || '').toLowerCase();
    if (usuario?.activo && !['inactivo', 'suspendido', 'blocked'].includes(estado)) score += 20;
    if (usuario?.two_factor_enabled) score += 25;
    if (typeof stats.fallidos === 'number') score -= stats.fallidos * 5;
    stats.score = Math.max(0, Math.min(100, Math.round(score)));
  } catch (e) { /* noop */ }

  return stats;
}

// ── Búsqueda multi-columna sin depender de PostgREST .or() (compat APP/supabase-js) ──
async function filtrarBusquedaEnMemoria({ query, columnas, termino, orderCol, limit, desc = false, max = 500 }) {
  const { data, error } = await query.limit(max);
  if (error) return { error };
  const t = (termino || '').trim().toLowerCase();
  let filas = (data || []).filter(r => columnas.some(c => String(r[c] || '').toLowerCase().includes(t)));
  filas.sort((a, b) => {
    const cmp = String(a[orderCol] || '').localeCompare(String(b[orderCol] || ''));
    return desc ? -cmp : cmp;
  });
  return { data: filas.slice(0, limit) };
}

// ── API Keys por tenant ───────────────────────────────────────
// ═══ API Keys por tenant ═══════════════════════════════════
// Seguridad (Bloque K): el secreto de una API key NUNCA se vuelve a mostrar
// ni se almacena en claro. En DB se guarda solo el hash SHA-256; el prefijo
// (primeros caracteres) es lo único legible para identificar la clave.
function hashApiKey(clave) {
  return crypto.createHash('sha256').update(String(clave || '')).digest('hex');
}

app.get('/api/tenant/apikeys', authenticate, requireTenantAdmin, requirePlanFeature('api_keys'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, nombre, clave, ultimo_uso, activa, created_at')
      .eq('empresa_codigo', tenant)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    // Nunca se devuelve el material secreto (hash ni plaintext).
    const keys = (data || []).map(k => {
      const c = String(k.clave || '');
      const esHash = /^[a-f0-9]{64}$/i.test(c);
      return {
        id: k.id,
        nombre: k.nombre,
        clave_prefix: k.clave_prefix || (esHash ? null : (c.slice(0, 14) || null)),
        legacy_secret: !esHash && !!c,
        ultimo_uso: k.ultimo_uso,
        activa: k.activa,
        created_at: k.created_at
      };
    });
    return res.json({ keys });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.post('/api/tenant/apikeys', authenticate, requireTenantAdmin, requirePlanFeature('api_keys'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const nombre = (req.body?.nombre || '').toString().trim().slice(0, 120);
    if (!nombre) return res.status(400).json({ error: 'El nombre de la clave es requerido' });

    const clave = 'pk_live_' + crypto.randomBytes(24).toString('hex');
    // Se persiste el hash; el plaintext viaja UNA sola vez en esta respuesta.
    let insertPayload = { empresa_codigo: tenant, nombre, clave: hashApiKey(clave), clave_prefix: clave.slice(0, 14), activa: true };
    let insertRes = await supabase.from('api_keys').insert([insertPayload]);
    if (insertRes.error && /clave_prefix|column/i.test(String(insertRes.error.message || ''))) {
      // Esquema sin clave_prefix: degradar sin exponer el secreto.
      insertPayload = { empresa_codigo: tenant, nombre, clave: hashApiKey(clave), activa: true };
      insertRes = await supabase.from('api_keys').insert([insertPayload]);
    }
    const { data, error } = insertRes;
    if (error) return res.status(500).json({ error: error.message });

    const row = Array.isArray(data) ? data[0] : (data || { id: null, nombre });
    await registrarAuditoria(tenant, 'API Key creada', `Se generó la clave de API "${nombre}" (${clave.slice(0, 14)}…)`, 'config', req.user?.nombre || '', req);
    return res.status(201).json({
      key: { id: row.id || null, nombre, clave_prefix: clave.slice(0, 14), activa: true, created_at: row.created_at || new Date().toISOString() },
      clave
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.delete('/api/tenant/apikeys/:id', authenticate, requireTenantAdmin, requirePlanFeature('api_keys'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { error } = await supabase.from('api_keys').delete().eq('id', req.params.id).eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'API Key revocada', 'Se revocó una clave de API', 'config', req.user?.nombre || '', req);
    return res.json({ success: true });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════
// AI GATEWAY — Centralized AI provider abstraction
// ═══════════════════════════════════════════════════════════════

const AI_PROVIDERS = {
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    getKey: () => process.env.GROQ_API_KEY,
    models: {
      chat: 'openai/gpt-oss-20b',
      // CORREGIDO (2026-09-16): Groq eliminó 'meta-llama/llama-4-scout-17b-16e-instruct'
      // de su oferta de visión 2026 (model_not_found → toda la ruta vision caía a 503).
      // Los modelos de visión vigentes en GroqCloud son la serie Qwen 3.6/3.8 27B.
      vision: 'qwen/qwen3.6-27b',
      fast: 'openai/gpt-oss-20b'
    }
  },
  huggingface: {
    name: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1/chat/completions',
    getKey: () => process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN,
    models: {
      chat: 'meta-llama/Llama-3.3-70B-Instruct',
      vision: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
      fast: 'meta-llama/Llama-3.3-70B-Instruct'
    }
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    getKey: () => process.env.OPENROUTER_API_KEY,
    models: {
      chat: 'meta-llama/llama-3.3-70b-instruct:free',
      vision: 'meta-llama/llama-4-scout-17b-16e-instruct:free',
      fast: 'meta-llama/llama-3.1-8b-instruct:free'
    }
  }
};

const AI_PROVIDER_ORDER = ['groq', 'huggingface', 'openrouter'];

// ── Auto-descubrimiento de modelos vivos (Groq depreca modelos seguido) ──────
// Consulta https://api.groq.com/openai/v1/models y cachea 5 min. Si un modelo
// preferido ya no existe, se usa automáticamente el siguiente disponible.
const _pickCache = { models: null, at: 0 };
const _PICK_CACHE_MS = 5 * 60 * 1000;

const _CHAT_PRIORITY = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'meta-llama/llama-3.3-70b-versatile',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-3.1-8b-instant',
  'llama-3.1-8b-instant',
];

const _VISION_PRIORITY = [
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.5-27b',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
];

async function _fetchLiveGroqModels(apiKey) {
  try {
    const r = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 5000,
    });
    const ids = (r.data && r.data.data || [])
      .map((m) => m && m.id)
      .filter(Boolean);
    return ids.length ? ids : null;
  } catch (err) {
    console.warn('[AI_PICK] fallback a lista estática:', err.response?.status || err.message);
    return null;
  }
}

// Devuelve { chat: [...], vision: [...] } cadenas de fallback con modelos vivos.
async function pickLiveModels(requested) {
  const providers = AI_PROVIDERS;
  const pk = providers.groq && providers.groq.getKey();
  const now = Date.now();
  if (pk && (!_pickCache.models || now - _pickCache.at > _PICK_CACHE_MS)) {
    const live = await _fetchLiveGroqModels(pk);
    if (live && live.length) {
      _pickCache.models = new Set(live.map((id) => String(id).trim()));
      _pickCache.at = now;
    }
  }
  const liveIds = _pickCache.models;

  const buildChain = (priority, filter) => {
    const chain = [];
    const push = (id) => {
      if (!id) return;
      id = String(id).trim();
      if (!id || chain.includes(id)) return;
      if (liveIds && !liveIds.has(id) && id !== requested) return;
      chain.push(id);
    };
    if (requested) push(requested);
    for (const id of priority) push(id);
    if (liveIds) {
      for (const id of Array.from(liveIds)) {
        if (chain.length >= 5) break;
        if (filter && !filter(id)) continue;
        push(id);
      }
    }
    return chain;
  };

  const chat = buildChain(_CHAT_PRIORITY, (id) => {
    const l = id.toLowerCase();
    if (/whisper|guard|compound|sarif|safety/i.test(l)) return false;
    return /gpt-oss|llama-3|qwen/i.test(l);
  });

  const vision = buildChain(_VISION_PRIORITY, (id) => {
    const l = id.toLowerCase();
    if (/whisper|guard|compound|safety/i.test(l)) return false;
    return l.includes('qwen') || l.includes('vision');
  });

  return { chat, vision, live: liveIds ? Array.from(liveIds) : null };
}

async function callAIGateway({ provider, modelRole, messages, temperature, maxTokens, imageBase64 }) {
  const providers = provider ? [provider] : AI_PROVIDER_ORDER;
  const picked = await pickLiveModels('');

  for (const provKey of providers) {
    const prov = AI_PROVIDERS[provKey];
    if (!prov) continue;
    const apiKey = prov.getKey();
    if (!apiKey) continue;

    // Cadena de modelos: primero los vivos auto-descubiertos, luego el hardcodeado.
    let modelChain = null;
    if (provKey === 'groq') {
      modelChain = modelRole === 'vision'
        ? (picked.vision.length ? picked.vision : [prov.models.vision])
        : (picked.chat.length ? picked.chat : [prov.models.chat]);
    } else {
      modelChain = modelRole ? [prov.models[modelRole] || prov.models.chat] : [prov.models.chat];
    }

    for (const modelId of modelChain) {
      try {
        const startTime = Date.now();
        const response = await axios.post(
          prov.baseUrl,
          {
            model: modelId,
            messages,
            temperature: typeof temperature === 'number' ? temperature : 0.7,
            max_tokens: maxTokens || 800
          },
          {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 30000
          }
        );

        const reply = (response.data?.choices?.[0]?.message?.content || '').trim();
        const usage = response.data?.usage || {};
        const durationMs = Date.now() - startTime;

        return {
          success: true,
          reply,
          provider: provKey,
          model: response.data?.model || modelId,
          tokensInput: usage.prompt_tokens || 0,
          tokensOutput: usage.completion_tokens || 0,
          tokensTotal: usage.total_tokens || 0,
          durationMs
        };
      } catch (err) {
        const errMsg = (err.response?.data?.error?.message || err.message || '').toString().toLowerCase();
        console.warn(`[AI_GATEWAY] ${prov.name} model ${modelId} failed:`, err.response?.status || err.message);
        // Modelo deprecado/inexistente: probar el siguiente de la cadena.
        if (!/does not exist|model_not_found|decommissioned|not found/.test(errMsg) &&
            err.response?.status !== 404) {
          break; // error no relacionado con el modelo: pasar al siguiente provider
        }
        continue;
      }
    }
  }

  return { success: false, error: 'Todos los proveedores de IA fallaron o no están configurados' };
}

// Precios de referencia USD por 1M tokens (conservadores, para uso interno).
const AI_TOKEN_COSTS_USD_PER_M = {
  groq: { input: 0.15, output: 0.60 },
  huggingface: { input: 0.10, output: 0.30 },
  openrouter: { input: 0.10, output: 0.30 }
};
const DEFAULT_TOKEN_COST_PER_M = { input: 0.30, output: 0.60 };

async function logAIUsage({ empresaCodigo, empresaId, usuarioId, provider, model, funcion, tokensInput, tokensOutput, tokensTotal, durationMs, success, errorMessage }) {
  try {
    const tokensIn = Number(tokensInput) || 0;
    const tokensOut = Number(tokensOutput) || 0;
    const tokensAll = Number(tokensTotal) || (tokensIn + tokensOut);
    const costTable = AI_TOKEN_COSTS_USD_PER_M[String(provider || '').toLowerCase()] || DEFAULT_TOKEN_COST_PER_M;
    const costEstimated = Number(((tokensIn / 1000000) * costTable.input + (tokensOut / 1000000) * costTable.output).toFixed(6));
    if (supabase) {
      const row = {
        empresa_codigo: empresaCodigo,
        empresa_id: empresaId,
        usuario_id: usuarioId,
        provider,
        model,
        funcion,
        tokens_input: tokensIn,
        tokens_output: tokensOut,
        tokens_total: tokensAll,
        cost_estimated: costEstimated,
        duration_ms: durationMs,
        success,
        error_message: errorMessage || null,
        created_at: new Date().toISOString()
      };
      try {
        await supabase.from('ai_usage_log').insert(row);
      } catch (insertErr) {
        console.error('[AI_USAGE] Insert falló (reintento 1):', insertErr.message, JSON.stringify({ empresa_codigo: empresaCodigo, provider, model, funcion, tokensAll }));
        await supabase.from('ai_usage_log').insert(row);
      }
      await registrarUsoTenant(empresaCodigo, 'ai_tokens', tokensAll);
      await registrarUsoTenant(empresaCodigo, 'api_requests', 1);
    }
  } catch (e) {
    console.error('[AI_USAGE] Fallo total de log de uso IA (no bloquea respuesta):', e.message);
  }
}

// ── Presupuesto de tokens IA (server-side, Blueprint §11/§12) ──
// El límite mensual del plan se aplica ANTES de llamar al proveedor: si el
// tenant agotó su cuota de ai_tokens, la llamada ni siquiera sale.
async function assertAiTokenBudget(req, res) {
  if (!supabase) return true;
  const tenant = normalizeTenantCode(getTenantCode(req));
  if (!tenant || isRootUser(req)) return true;
  try {
    const ent = req.entitlements || await getTenantEntitlements(req);
    const limite = Number(ent?.limits?.tokens) || 0;
    if (!limite || limite <= 0) return true;
    const mes = new Date().toISOString().slice(0, 7);
    const { data: row } = await supabase.from('tenant_usage')
      .select('cantidad').eq('empresa_codigo', tenant).eq('recurso', 'ai_tokens').eq('periodo', mes).maybeSingle();
    const usados = Number(row?.cantidad) || 0;
    if (usados >= limite) {
      res.status(429).json({
        error: `Has agotado tu cuota mensual de IA (${limite.toLocaleString('es-HN')} tokens del plan ${ent.plan}). Sube de plan o espera el siguiente periodo.`,
        code: 'AI_TOKEN_LIMIT_REACHED',
        usados,
        limite
      });
      return false;
    }
  } catch (e) {
    console.warn('[AI_BUDGET] check falló (se permite):', e.message);
  }
  return true;
}

// ── AI Chat (centralized) ──────────────────────────────────────
app.post('/api/ai/chat', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    const { message, history, systemPrompt, temperature, provider } = req.body || {};
    const text = (message || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'Campo message requerido' });

    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);

    const messages = [];
    if (systemPrompt && String(systemPrompt).trim()) {
      messages.push({ role: 'system', content: String(systemPrompt).slice(0, 4000) });
    }
    if (Array.isArray(history)) {
      for (const m of history.slice(-12)) {
        if (m && m.role && m.content) {
          messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) });
        }
      }
    }
    messages.push({ role: 'user', content: text.slice(0, 4000) });

    const result = await callAIGateway({ provider, modelRole: 'chat', messages, temperature, maxTokens: 800 });

    if (!result.success) return res.status(503).json({ error: result.error });

    await logAIUsage({
      empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub,
      provider: result.provider, model: result.model, funcion: 'chat',
      tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, tokensTotal: result.tokensTotal,
      durationMs: result.durationMs, success: true
    });
    await registrarAuditoria(tenant, 'Consulta IA', text.slice(0, 200), 'ai', req.user?.nombre || '', req);

    return res.json({ reply: result.reply, model: result.model, provider: result.provider });
  } catch (err) {
    console.error('[AI/CHAT] Error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 429) return res.status(429).json({ error: 'Límite de solicitudes de IA alcanzado. Intenta de nuevo en unos segundos.' });
    return res.status(500).json({ error: 'No se pudo procesar la consulta de IA' });
  }
});

// ── AI Vision: image analysis (centralized) ────────────────────
app.post('/api/ai/vision', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    const { image, prompt, systemPrompt, maxTokens, provider } = req.body || {};
    if (!image) return res.status(400).json({ error: 'Campo image (base64) requerido' });

    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);

    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const mimeType = image.startsWith('data:') ? image.substring(5, image.indexOf(';')) : 'image/jpeg';

    const messages = [
      {
        role: 'system',
        content: (systemPrompt || 'Eres un asistente especializado en identificar productos. Analiza la imagen y responde en JSON con los campos: nombre, marca, categoria, descripcion, presentacion, unidad_medida, confianza (0-1). Si no puedes determinar algo, deja el campo como null. Responde SOLO con el JSON, sin texto adicional.').slice(0, 3000)
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          { type: 'text', text: (prompt || 'Identifica este producto y devuelve un JSON con: nombre, marca, categoria, descripcion, presentacion, unidad_medida, confianza').slice(0, 2000) }
        ]
      }
    ];

    const result = await callAIGateway({ provider, modelRole: 'vision', messages, temperature: 0.3, maxTokens: maxTokens || 800 });

if (!result.success) return res.status(503).json({ error: result.error });

    // Qwen (modelo de vision de Groq) antepone bloques  thinking... /response.
    // Limpiarlos para devolver solo el JSON al cliente.
    const reply = String(result.reply || '').replace(/<\/?(thinking|think|response)[\s\S]*?>/gi, '').trim();

    await logAIUsage({
      empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub,
      provider: result.provider, model: result.model, funcion: 'vision',
      tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, tokensTotal: result.tokensTotal,
      durationMs: result.durationMs, success: true
    });
    await registrarAuditoria(tenant, 'Vision IA', 'An�lisis de imagen de producto', 'ai', req.user?.nombre || '', req);

    return res.json({ reply, model: result.model, provider: result.provider });
  } catch (err) {
    console.error('[AI/VISION] Error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 429) return res.status(429).json({ error: 'Límite de solicitudes de IA alcanzado.' });
    return res.status(500).json({ error: 'No se pudo procesar la imagen' });
  }
});

// ── AI: barcode lookup (search products in Supabase) ───────────
app.get('/api/ai/barcode/:code', authenticate, requirePlanFeature('ia'), async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const code = req.params.code;
    const { data: products, error: productsError } = await supabase.from('productos')
      .select('id, codigo, nombre, descripcion, categoria, marca, presentacion, unidad_medida, precio_venta, stock_actual, imagen_url, barcode')
      .eq('empresa_id', empresa.id)
      .limit(500);
    if (productsError) {
      console.error('[AI/BARCODE] Error:', productsError.message);
      return res.status(500).json({ error: 'Error al buscar producto' });
    }
    const codeMin = (code || '').toLowerCase();
    const coincidencias = (products || []).filter(p => (p.barcode || '').toLowerCase() === codeMin || (p.codigo || '').toLowerCase() === codeMin).slice(0, 5);

    if (coincidencias.length > 0) {
      return res.json({ found: true, products: coincidencias, source: 'database' });
    }
    return res.json({ found: false, products: [], source: 'database', message: 'Producto no encontrado en catálogo' });
  } catch (err) {
    console.error('[AI/BARCODE] Error:', err.message);
    return res.status(500).json({ error: 'Error al buscar producto' });
  }
});

// ── AI: Dashboard natural language queries ────────────────────
app.post('/api/ai/dashboard', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Fetch dashboard data to give AI context
    const [facturasRes, transRes, productosRes, usuariosRes, fiadasRes, comprasRes, sociosRes, provRes] = await Promise.all([
      supabase.from('facturas').select('id, total, estado, created_at').eq('empresa_id', empresa.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('transacciones').select('id, tipo, categoria, monto, fecha, descripcion').eq('empresa_id', empresa.id).order('fecha', { ascending: false }).limit(100),
      supabase.from('productos').select('id, nombre, stock_actual, stock_minimo, precio_venta, categoria').eq('empresa_id', empresa.id).limit(100),
      supabase.from('usuarios').select('id, nombre, activo, rol_global').eq('empresa_id', empresa.id),
      supabase.from('ventas_fiadas').select('id, total, saldo_pendiente, estado, fecha_venta, cliente_nombre').eq('empresa_id', empresa.id).order('fecha_venta', { ascending: false }).limit(50),
      supabase.from('compras').select('id, total, estado, fecha_orden, proveedor_id').eq('empresa_id', empresa.id).order('fecha_orden', { ascending: false }).limit(50),
      supabase.from('socios').select('id, nombre, estado, puntos_acumulados, total_compras, fecha_vencimiento').eq('empresa_id', empresa.id).limit(50),
      supabase.from('proveedores').select('id, nombre, nivel, saldo_pendiente').eq('empresa_id', empresa.id).limit(50)
    ]);

    const contextData = {
      facturas: facturasRes.data || [],
      transacciones: transRes.data || [],
      productos: productosRes.data || [],
      usuarios: usuariosRes.data || [],
      ventas_fiadas: fiadasRes.data || [],
      compras: comprasRes.data || [],
      socios: sociosRes.data || [],
      proveedores: provRes.data || []
    };

    const systemPrompt = `Eres el asistente financiero de Portal Pilot para la empresa "${empresa.nombre || tenant}".
Responde en español. Sé conciso y usa formato markdown cuando sea útil.
Analiza los datos del dashboard que te proporciono y responde preguntas sobre:
- Ventas y facturación (facturas)
- Ingresos y gastos (transacciones)
- Inventario y stock (productos)
- Ventas fiadas y cartera (ventas_fiadas)
- Compras a proveedores (compras)
- Socios/miembros (socios)
- Proveedores (proveedores)
- Rendimiento del equipo (usuarios)

Puedes responder preguntas como:
- ¿Cuánto vendimos este mes?
- ¿Cuál fue nuestro producto más vendido?
- ¿Qué categoría está vendiendo menos?
- ¿Cuánto tenemos pendiente por cobrar (fiado)?
- ¿Cómo fueron las ventas respecto al mes anterior?
- ¿Cuánto debemos a proveedores?
- ¿Cuántos socios activos tenemos?

Datos actuales del dashboard (JSON):
${JSON.stringify(contextData, null, 2)}

Reglas:
- Usa los datos para respuestas concretas, no inventes números
- Si el usuario pide algo fuera de tu alcance, di "Solo puedo responder sobre datos del dashboard"
- Sé breve: máximo 3-4 oraciones a menos que pida detalle`;

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt.slice(0, 4000) });
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: 500 });
    if (!reply.success) {
      return res.status(reply.status || 503).json({ error: reply.error });
    }

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'dashboard_query', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/DASHBOARD] Error:', err.message);
    return res.status(500).json({ error: 'Error al procesar consulta' });
  }
});

// ── AI: POS sales analysis ──────────────────────────────────
app.post('/api/ai/pos/analyze', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const b = req.body || {};
    const message = b.message;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });
    const dateRange = b.dateRange || {};
    const desde = dateRange.from || dateRange.desde || null;
    const hasta = dateRange.to || dateRange.hasta || null;

    // 1) Transacciones POS (venta_pos) de Supabase
    let txs = [];
    try {
      let q = supabase.from('transacciones').select('id, monto, metodo_pago, fecha, metadata')
        .eq('empresa_id', empresa.id).eq('tipo', 'venta_pos');
      if (desde) q = q.gte('fecha', desde);
      if (hasta) q = q.lte('fecha', hasta);
      const { data } = await q.order('fecha', { ascending: false }).limit(2000);
      txs = data || [];
    } catch (err) { console.error('[AI/POS] err transacciones:', err.message); }

    // 2) Facturas (facturación) de Supabase
    let invs = [];
    try {
      let q = supabase.from('facturas').select('id, correlativo, cliente_nombre, items, subtotal, isv_15, isv_18, descuento, total, notas, created_at')
        .eq('empresa_id', empresa.id);
      if (desde) q = q.gte('created_at', desde);
      if (hasta) q = q.lte('created_at', `${hasta}T23:59:59.999Z`);
      const { data } = await q.order('created_at', { ascending: false }).limit(2000);
      invs = data || [];
    } catch (err) { console.error('[AI/POS] err facturas:', err.message); }

    // 3) Agregados combinados
    const metodoDeNota = (notas) => {
      const n = String(notas || '').toLowerCase();
      if (n.includes('tarjeta')) return 'tarjeta';
      if (n.includes('transferencia')) return 'transferencia';
      if (n.includes('efectivo')) return 'efectivo';
      return 'otras';
    };
    const itemsDe = (raw) => {
      if (Array.isArray(raw)) return raw;
      try { const p = JSON.parse(String(raw || '[]')); return Array.isArray(p) ? p : []; } catch { return []; }
    };

    let total = 0, efectivo = 0, tarjeta = 0, transferencia = 0, otras = 0;
    const top = new Map();
    txs.forEach((v) => {
      const m = Number(v.monto) || 0;
      total += m;
      const mp = String(v.metodo_pago || 'efectivo');
      if (mp.includes('tarjeta')) tarjeta += m;
      else if (mp.includes('transferencia')) transferencia += m;
      else if (mp.includes('efectivo')) efectivo += m;
      else otras += m;
      let meta = v.metadata;
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = {}; } }
      const list = (meta && Array.isArray(meta.items)) ? meta.items : (Array.isArray(meta) ? meta : []);
      list.forEach((i) => {
        const n = String(i.nombre || i.producto_nombre || '').trim();
        if (n) top.set(n, (top.get(n) || 0) + (parseInt(i.cantidad, 10) || 1));
      });
    });
    invs.forEach((f) => {
      const m = Number(f.total) || 0;
      total += m;
      const mk = metodoDeNota(f.notas);
      if (mk === 'tarjeta') tarjeta += m;
      else if (mk === 'transferencia') transferencia += m;
      else if (mk === 'efectivo') efectivo += m;
      else otras += m;
      itemsDe(f.items).forEach((i) => {
        const n = String(i.nombre || i.producto_nombre || '').trim();
        if (n) top.set(n, (top.get(n) || 0) + (parseInt(i.cantidad, 10) || 1));
      });
    });

    const numero = txs.length + invs.length;
    const ticketPromedio = numero > 0 ? Math.round((total / numero) * 100) / 100 : 0;
    const topProductos = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([producto, cantidad]) => ({ producto, cantidad }));

    const contexto = {
      total_ventas: Math.round(total * 100) / 100,
      numero_transacciones: numero,
      por_metodo_pago: { efectivo, tarjeta, transferencia, otras },
      ticket_promedio: ticketPromedio,
      top_productos: topProductos,
      fuente: { transacciones: txs.length, facturas: invs.length }
    };

    const sistema = `Eres el analista de caja del POS de Portal Pilot para "${empresa.nombre || tenant}".
Datos de ventas del periodo (combinados de transacciones POS y facturas):
${JSON.stringify(contexto, null, 2)}

Instrucciones:
- Responde en espanol, conciso y con numeros claros.
- Usa L. (lempiras hondureñas) como moneda, formato "L 1,234.56". Nunca uses EUR/USD.
- Desglosa por metodo de pago, ticket promedio y top de productos.
- Si no hay datos de ventas en el periodo, dilo con claridad y NO inventes cifras ni productos.`;

    const messages = [];
    messages.push({ role: 'system', content: sistema.slice(0, 4000) });
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: 700 });
    if (!reply.success) return res.status(reply.status || 503).json({ error: reply.error });

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'pos_analysis', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model, contexto });
  } catch (err) {
    console.error('[AI/POS] Error:', err.message);
    return res.status(500).json({ error: 'Error al analizar ventas' });
  }
});

// ── AI: POS upsell / cross-sell recomendations ──────────────
app.post('/api/ai/pos/upsell', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    const { carrito, catalogo, maxTokens } = req.body || {};
    const cart = Array.isArray(carrito) ? carrito : [];
    const catalog = Array.isArray(catalogo) ? catalogo : [];
    if (cart.length === 0) return res.status(400).json({ error: 'Falta carrito', reply: null, sugerencias: [] });

    const nombresEnCarrito = new Set(
      cart.map((c) => String(c.nombre || '').trim().toLowerCase()).filter(Boolean)
    );

    const tenant = normalizeTenantCode(getTenantCode(req));

    const prompt = [
      'Eres un vendedor experto de punto de venta. Tu tarea es recomendar productos complementarios (upsell/cross-sell) para el ticket actual.',
      'Reglas:',
      '- Recomienda SOLO productos existentes en el cat\u00e1logo proporcionado.',
      '- No repitas productos que ya est\u00e1n en el carrito.',
      '- M\u00e1ximo 3 sugerencias, ordenadas por relevancia (la mejor primero).',
      '- Un motivo corto y persuasivo por sugerencia (m\u00e1x 12 palabras).',
      '- Responde \u00daNICAMENTE con JSON v\u00e1lido con este formato exacto:',
      '{"sugerencias":[{"codigo":"CODIGO_DEL_CATALOGO","nombre":"Nombre del producto","motivo":"Motivo corto"}]}',
      '',
      'Carrito actual:',
      JSON.stringify(cart),
      '',
      'Cat\u00e1logo disponible:',
      JSON.stringify(catalog),
    ].join('\n');

    const messages = [
      { role: 'system', content: 'Eres el motor de recomendaciones de Portal Pilot POS. Si el cat\u00e1logo est\u00e1 vac\u00edo o no hay productos candidatos, devuelve {"sugerencias":[]}.' },
      { role: 'user', content: prompt.slice(0, 8000) }
    ];

    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: maxTokens || 600, temperature: 0.3 });
    if (!reply.success) return res.status(reply.status || 503).json({ error: reply.error, reply: null, sugerencias: [] });

    let sugerencias = [];
    try {
      const clean = String(reply.reply || '').replace(/<\/?think[\s\S]*?>/gi, '').trim();
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(clean.substring(start, end + 1));
        const arr = Array.isArray(parsed) ? parsed : (parsed.sugerencias || []);
        sugerencias = arr
          .filter((s) => s && s.codigo && !nombresEnCarrito.has(String(s.nombre || '').trim().toLowerCase()))
          .slice(0, 3)
          .map((s) => ({
            codigo: String(s.codigo || ''),
            nombre: String(s.nombre || ''),
            motivo: String(s.motivo || ''),
          }));
      }
    } catch (e) {
      console.error('[AI/UPSELL] No se pudo parsear JSON del modelo:', e.message);
    }

    await logAIUsage({ empresaCodigo: tenant, empresaId: null, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'pos_upsell', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, sugerencias, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/UPSELL] Error:', err.message);
    return res.status(500).json({ error: 'Error al generar recomendaciones', reply: null, sugerencias: [] });
  }
});

// ── AI: CRM customer summaries ──────────────────────────────
app.post('/api/ai/crm/customer', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const { message, customerId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Fetch customer context from clientes table (not usuarios)
    let customerData = null;
    if (customerId) {
      const { data: cliente } = await supabase.from('clientes')
        .select('id, nombre, rtn, email, telefono, direccion, limite_credito, saldo_pendiente, notas, activo, created_at')
        .eq('empresa_id', empresa.id).eq('id', customerId).single();
      customerData = cliente;
    }

    // Fetch recent facturas matching by cliente_nombre or cliente_rtn
    let facturas = [];
    if (customerData) {
      const searchTerm = customerData.rtn || customerData.nombre || '';
      const { data: byRtn } = await supabase.from('facturas')
        .select('id, correlativo, cliente_nombre, cliente_rtn, subtotal, isv, total, estado, created_at')
        .eq('empresa_id', empresa.id)
        .eq('cliente_rtn', customerData.rtn || '__none__')
        .order('created_at', { ascending: false }).limit(10);
      if (byRtn && byRtn.length > 0) {
        facturas = byRtn;
      } else {
        const { data: byName } = await supabase.from('facturas')
          .select('id, correlativo, cliente_nombre, cliente_rtn, subtotal, isv, total, estado, created_at')
          .eq('empresa_id', empresa.id)
          .ilike('cliente_nombre', `%${customerData.nombre}%`)
          .order('created_at', { ascending: false }).limit(10);
        facturas = byName || [];
      }
    }

    // Fetch recent ventas_fiadas (credit sales) for this customer
    let fiadas = [];
    if (customerData) {
      const { data: fiadaData } = await supabase.from('ventas_fiadas')
        .select('id, total, saldo_pendiente, estado, fecha_venta, cliente_nombre')
        .eq('empresa_id', empresa.id)
        .ilike('cliente_nombre', `%${customerData.nombre}%`)
        .order('fecha_venta', { ascending: false }).limit(10);
      fiadas = fiadaData || [];
    }

    const systemPrompt = `Eres el asistente CRM de Portal Pilot para "${empresa.nombre || tenant}".
${customerData ? `Datos del cliente:\n${JSON.stringify(customerData, null, 2)}` : 'No se especificó un cliente específico.'}
Facturas del cliente: ${JSON.stringify(facturas, null, 2)}
Ventas fiadas (crédito): ${JSON.stringify(fiadas, null, 2)}

Responde sobre:
- Resumen del cliente
- Sugerencias de seguimiento
- Estado de tickets pendientes
- Historial de compras

Sé conciso y profesional.`;

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt.slice(0, 4000) });
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: 500 });
    if (!reply.success) return res.status(reply.status || 503).json({ error: reply.error });

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'crm_customer', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/CRM] Error:', err.message);
    return res.status(500).json({ error: 'Error al procesar consulta CRM' });
  }
});

// ── AI: Support ticket assistant ─────────────────────────────
app.post('/api/ai/support', authenticate, requirePlanFeature('ia'), async (req, res) => {
  if (!(await assertAiTokenBudget(req, res))) return;
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const { message, ticketId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Fetch ticket context if provided
    let ticketData = null;
    if (ticketId) {
      const { data: ticket } = await supabase.from('support_tickets').select('id, nombre, mensaje, estado, prioridad, created_at').eq('empresa_id', empresa.id).eq('id', ticketId).single();
      ticketData = ticket;
    }

    // Fetch recent tickets for patterns
    const { data: recentTickets } = await supabase.from('support_tickets').select('id, nombre, estado, prioridad, created_at').eq('empresa_id', empresa.id).order('created_at', { ascending: false }).limit(20);

    const systemPrompt = `Eres el asistente de soporte de Portal Pilot para "${empresa.nombre || tenant}".
${ticketData ? `Ticket actual:\n${JSON.stringify(ticketData, null, 2)}` : 'No se especificó un ticket específico.'}
Tickets recientes de la empresa:\n${JSON.stringify(recentTickets || [], null, 2)}

Responde sobre:
- Sugerencias para resolver el ticket
- Clasificación de prioridad
- Respuestas sugeridas para el cliente
- Patrones de problemas frecuentes

Sé conciso, empático y profesional.`;

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt.slice(0, 4000) });
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: 500 });
    if (!reply.success) return res.status(reply.status || 503).json({ error: reply.error });

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'support_assist', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/SUPPORT] Error:', err.message);
    return res.status(500).json({ error: 'Error al procesar consulta de soporte' });
  }
});

// ── Dashboard: resumen por tenant ─────────────────────────────
app.get('/api/dashboard/summary', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const isPlatformView = isRootUser(req) && !req.query.tenant;
    const requestedTenant = isRootUser(req) && req.query.tenant
      ? normalizeTenantCode(req.query.tenant)
      : normalizeTenantCode(getTenantCode(req));
    const tenant = requestedTenant;
    const empresa = await resolverEmpresaSupabase(tenant);
    const empresaId = isPlatformView ? null : (empresa?.id || null);
    const periodDays = [1, 7, 30, 90].includes(Number(req.query.period)) ? Number(req.query.period) : 7;

    // ── Vista Plataforma (ROOT sin tenant): negocio real de Portal Pilot ──
    // Billing (pagos de planes), tenants y usuarios globales. NO datos de negocio de los tenants.
    if (isPlatformView) {
      const ahora = new Date();
      const hoy = ahora.toISOString().slice(0, 10);
      const enMes = t => t && t.slice(0, 7) === hoy.slice(0, 7);

      const [payRes, tenRes, userRes] = await Promise.all([
        supabase.from('billing_payments').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('tenants').select('*'),
        supabase.from('usuarios').select('id, rol_global, activo, created_at, ultimo_acceso')
      ]);
      const pagos = payRes.data || [];
      const tenantsList = tenRes.data || [];
      const users = userRes.data || [];
      const pagosOk = pagos.filter(p => p.status === 'success');
      const pagosPendientes = pagos.filter(p => p.status !== 'success');

      const usuariosTotal = users.length;
      const usuariosActivos = users.filter(u => u.activo !== false).length;
      const usuariosActivosHoy = users.filter(u => {
        const acceso = u.ultimo_acceso ? new Date(u.ultimo_acceso) : null;
        return u.activo !== false && acceso && acceso.toISOString().slice(0, 10) === hoy;
      }).length;
      const ingresoMes = pagosOk.filter(p => enMes(p.created_at)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const facturasTotal = pagosOk.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const transaccionesHoy = pagos.filter(p => (p.created_at || '').slice(0, 10) === hoy).length;

      const dias = [];
      for (let i = periodDays - 1; i >= 0; i--) {
        const d = new Date(ahora);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dias.push({ fecha: key, label: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()], facturas: 0, transacciones: 0, usuarios: 0, ingresos: 0, gastos: 0 });
      }
      pagos.forEach(p => {
        const k = (p.created_at || '').slice(0, 10);
        const slot = dias.find(d => d.fecha === k);
        if (slot) {
          slot.transacciones++;
          if (p.status === 'success') { slot.facturas++; slot.ingresos += Number(p.amount) || 0; }
        }
      });
      users.forEach(u => {
        const slot = dias.find(d => d.fecha === (u.created_at || '').slice(0, 10));
        if (slot) slot.usuarios++;
      });

      const rolesMap = {};
      users.forEach(u => { const r = u.rol_global || 'usuario'; rolesMap[r] = (rolesMap[r] || 0) + 1; });

      const eventos = [];
      pagos.forEach(p => eventos.push({
        tipo: p.status === 'success' ? 'ingreso' : 'gasto',
        descripcion: `Pago ${String(p.plan || '').toUpperCase()}${p.status === 'success' ? '' : ' pendiente'} — ${p.email || 's/n'} (L ${Number(p.amount || 0).toFixed(2)})`,
        fecha: p.created_at,
        meta: 'Billing'
      }));
      users.forEach(u => eventos.push({ tipo: 'usuario', descripcion: `Usuario ${u.activo === false ? 'desactivado' : 'registrado'} (${u.rol_global || 'usuario'})`, fecha: u.created_at, meta: 'Usuarios' }));
      eventos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
      const actividadReciente = eventos.slice(0, 8).map(e => ({
        titulo: e.descripcion,
        detalle: e.meta + (e.fecha ? ' · ' + new Date(e.fecha).toLocaleString('es') : ''),
        tipo: e.tipo
      }));

      const alertas = [];
      if (pagosPendientes.length > 0) alertas.push({ severidad: 'alta', titulo: `${pagosPendientes.length} pago(s) pendiente(s) de verificación`, detalle: 'Revisa el módulo de Billing para confirmar Tigo Money o transferencias.' });

      return res.json({
        tenant,
        empresa: empresa || null,
        kpis: {
          usuariosTotal,
          usuariosActivos,
          usuariosActivosHoy,
          facturasCount: pagosOk.length,
          facturasTotal,
          facturasPendientes: pagosPendientes.length,
          ingresoMes,
          gastoMes: 0,
          balanceMes: ingresoMes,
          productosCount: 0,
          lowStock: 0,
          transaccionesHoy,
          tenantsActivos: tenantsList.filter(t => (t.estado || 'activo') === 'activo').length
        },
        usage7d: dias,
        periodDays,
        roles: Object.entries(rolesMap).map(([rol, count]) => ({ rol, count })),
        gastosCategoria: [],
        actividadReciente,
        alertas
      });
    }

    // ── Vista Tenant: KPIs de negocio de la empresa seleccionada ──
    let users = [], facturas = [], transacciones = [], productos = [];
    if (empresaId) {
      const [uRes, fRes, tRes, pRes] = await Promise.all([
        supabase.from('usuarios').select('id, rol_global, activo, created_at, ultimo_acceso').eq('empresa_id', empresaId),
        supabase.from('facturas').select('id, total, estado, created_at').eq('empresa_id', empresaId),
        supabase.from('transacciones').select('id, tipo, categoria, monto, fecha').eq('empresa_id', empresaId),
        supabase.from('productos').select('id, stock_actual, stock_minimo').eq('empresa_id', empresaId)
      ]);
      users = uRes.data || users;
      facturas = fRes.data || facturas;
      transacciones = tRes.data || transacciones;
      productos = pRes.data || productos;
    }

    const ahora = new Date();
    const hoy = ahora.toISOString().slice(0, 10);
    const usuariosTotal = users.length;
    const usuariosActivos = users.filter(u => u.activo !== false).length;
    const usuariosActivosHoy = users.filter(u => {
      const acceso = u.ultimo_acceso ? new Date(u.ultimo_acceso) : null;
      return u.activo !== false && acceso && acceso.toISOString().slice(0, 10) === hoy;
    }).length;
    const facturasCount = facturas.length;
    const facturasTotal = facturas.reduce((s, f) => s + (Number(f.total) || 0), 0);
    const facturasPendientes = facturas.filter(f => (f.estado || 'emitida') === 'pendiente').length;

    const enMes = t => t && t.slice(0, 7) === hoy.slice(0, 7);
    const ingresoMes = transacciones.filter(t => t.tipo === 'ingreso' && enMes(t.fecha || t.created_at)).reduce((s, t) => s + (Number(t.monto) || 0), 0);
    const gastoMes = transacciones.filter(t => t.tipo === 'gasto' && enMes(t.fecha || t.created_at)).reduce((s, t) => s + (Number(t.monto) || 0), 0);
    const transaccionesHoy = transacciones.filter(t => (t.fecha || t.created_at || '').slice(0, 10) === hoy).length;

    const lowStock = productos.filter(p => (Number(p.stock_actual) || 0) <= (Number(p.stock_minimo) || 0)).length;

    // Uso últimos 7 días
    const dias = [];
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(ahora);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dias.push({ fecha: key, label: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()], facturas: 0, transacciones: 0, usuarios: 0, ingresos: 0, gastos: 0 });
    }
    facturas.forEach(f => {
      const k = (f.created_at || '').slice(0, 10);
      const slot = dias.find(d => d.fecha === k);
      if (slot) slot.facturas++;
    });
    transacciones.forEach(t => {
      const k = (t.fecha || t.created_at || '').slice(0, 10);
      const slot = dias.find(d => d.fecha === k);
      if (slot) {
        slot.transacciones++;
        if (t.tipo === 'ingreso') slot.ingresos += Number(t.monto) || 0;
        if (t.tipo === 'gasto') slot.gastos += Number(t.monto) || 0;
      }
    });
    users.forEach(u => {
      const slot = dias.find(d => d.fecha === (u.created_at || '').slice(0, 10));
      if (slot) slot.usuarios++;
    });

    // Roles
    const rolesMap = {};
    users.forEach(u => {
      const r = (u.rol_global || 'usuario');
      rolesMap[r] = (rolesMap[r] || 0) + 1;
    });

    // Gastos por categoría
    const gastosCategoria = {};
    transacciones.filter(t => t.tipo === 'gasto').forEach(t => {
      const c = t.categoria || 'Otro';
      gastosCategoria[c] = (gastosCategoria[c] || 0) + (Number(t.monto) || 0);
    });

    // Actividad reciente
    const eventos = [];
    facturas.forEach(f => eventos.push({ tipo: 'factura', descripcion: `Factura ${f.correlativo || 's/n'} por L ${Number(f.total).toFixed(2)}`, fecha: f.created_at, meta: 'Facturación' }));
    transacciones.forEach(t => eventos.push({ tipo: t.tipo, descripcion: `${t.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} — ${t.categoria || ''} ${t.descripcion || ''} (L ${Number(t.monto).toFixed(2)})`, fecha: t.fecha || t.created_at, meta: 'Contabilidad' }));
    users.forEach(u => eventos.push({ tipo: 'usuario', descripcion: `Usuario ${u.activo === false ? 'desactivado' : 'registrado'} (${u.rol_global || 'usuario'})`, fecha: u.created_at, meta: 'Usuarios' }));
    eventos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    const actividadReciente = eventos.slice(0, 8).map(e => ({
      titulo: e.descripcion,
      detalle: e.meta + (e.fecha ? ' · ' + new Date(e.fecha).toLocaleString('es') : ''),
      tipo: e.tipo
    }));

    const alertas = [];
    if (facturasPendientes > 0) alertas.push({ severidad: 'alta', titulo: `${facturasPendientes} factura(s) pendiente(s)`, detalle: 'Facturas por cobrar en el módulo Billing' });
    if (lowStock > 0) alertas.push({ severidad: 'media', titulo: `${lowStock} producto(s) con stock bajo`, detalle: 'Revisa el módulo de Inventario' });
    if (empresaId && gastoMes > ingresoMes) alertas.push({ severidad: 'media', titulo: 'Gastos superan ingresos', detalle: 'El balance del mes es negativo' });
    if (transaccionesHoy > 0) alertas.push({ severidad: 'baja', titulo: `${transaccionesHoy} transacción(es) hoy`, detalle: 'Movimientos registrados en Contabilidad' });
    if (!empresaId) alertas.push({ severidad: 'baja', titulo: 'Sesión ROOT sin tenant', detalle: 'Los KPIs se muestran vacíos hasta seleccionar una empresa' });

    return res.json({
      tenant,
      empresa: empresa || null,
      kpis: {
        usuariosTotal,
        usuariosActivos,
        usuariosActivosHoy,
        facturasCount,
        facturasTotal,
        facturasPendientes,
        ingresoMes,
        gastoMes,
        balanceMes: ingresoMes - gastoMes,
        productosCount: productos.length,
        lowStock,
        transaccionesHoy
      },
      usage7d: dias,
      periodDays,
      roles: Object.entries(rolesMap).map(([rol, count]) => ({ rol, count })),
      gastosCategoria: Object.entries(gastosCategoria).map(([categoria, monto]) => ({ categoria, monto })),
      actividadReciente,
      alertas
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Flota: vehículos por tenant ───────────────────────────────
app.get('/api/fleet', authenticate, requireTenantAdmin, requirePlanFeature('fleet'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase
      .from('vehiculos')
      .select('*')
      .eq('empresa_codigo', tenant)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ vehicles: data || [] });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.post('/api/fleet', authenticate, requireTenantAdmin, requirePlanFeature('fleet'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const b = req.body || {};
    const placa = (b.placa || '').toString().trim().toUpperCase();
    if (!placa) return res.status(400).json({ error: 'La placa es requerida' });

    const { data, error } = await supabase.from('vehiculos').insert([{
      empresa_codigo: tenant,
      placa,
      tipo: (b.tipo || 'Camión').toString().slice(0, 60),
      chofer: (b.chofer || '').toString().slice(0, 120),
      estado: ['en-ruta', 'disponible', 'alerta', 'taller'].includes(b.estado) ? b.estado : 'disponible',
      combustible: Math.min(100, Math.max(0, parseInt(b.combustible, 10) || 100)),
      km: parseFloat(b.km) || 0,
      ubicacion: (b.ubicacion || '').toString().slice(0, 200),
      ultimo_movimiento: b.ultimo_movimiento || new Date().toISOString()
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    await registrarAuditoria(tenant, 'Vehículo registrado', `Alta de vehículo ${placa}`, 'fleet', req.user?.nombre || '', req);
    return res.status(201).json({ vehicle: row });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.patch('/api/fleet/:id', authenticate, requireTenantAdmin, requirePlanFeature('fleet'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const campos = ['estado', 'combustible', 'chofer', 'km', 'ubicacion', 'tipo', 'fecha_mantenimiento', 'notas'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => {
      if (req.body[c] !== undefined) update[c] = req.body[c];
    });
    const { data, error } = await supabase.from('vehiculos').update(update).eq('id', req.params.id).eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    if (req.body.estado === 'taller') {
      await registrarAuditoria(tenant, 'Mantenimiento aprobado', `El vehículo pasó a taller`, 'fleet', req.user?.nombre || '', req);
    }
    return res.json({ vehicle: row, success: true });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Seguridad: auditoría con cadena de hashes ─────────────────
// Auditoría del tenant: todo Owner/Admin debe poder ver su registro.
// La feature 'seguridad_avanzada' añade verificación de integridad (cadena de
// hashes) para planes superiores, pero el log en sí no se oculta por plan.
app.get('/api/security/audit', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 10), 500);
    const { data, error } = await supabase
      .from('auditoria')
      .select('id, accion, descripcion, tipo, usuario, ip, created_at')
      .eq('empresa_codigo', tenant)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];
    let prevHash = '0'.repeat(64);
    const blocks = rows.map((e, i) => {
      const payload = `${prevHash}|${e.id}|${e.accion}|${e.descripcion}|${e.tipo}|${e.ip}|${e.created_at}`;
      const currHash = crypto.createHash('sha256').update(payload).digest('hex');
      const block = {
        block: rows.length - i,
        event: e.descripcion || e.accion,
        prevHash: prevHash.slice(0, 12) + '…',
        currHash: currHash.slice(0, 12) + '…',
        fullHash: currHash,
        valid: true,
        type: e.tipo || 'sistema',
        usuario: e.usuario || '',
        ip: e.ip || '',
        fecha: e.created_at
      };
      prevHash = currHash;
      return block;
    }).reverse();

    const total = rows.length;
    const verificados = total;
    return res.json({
      blocks,
      stats: {
        total,
        verificados,
        tipos: [...new Set(rows.map(r => r.tipo || 'sistema'))],
        ultimoEvento: rows.length ? rows[rows.length - 1].created_at : null
      }
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Automatización: agentes y registros ───────────────────────
app.get('/api/automation', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const [aRes, rRes] = await Promise.all([
      supabase.from('automatizaciones').select('*').eq('empresa_codigo', tenant).order('created_at', { ascending: true }),
      supabase.from('automation_runs').select('*').eq('empresa_codigo', tenant).order('created_at', { ascending: false }).limit(50)
    ]);
    if (aRes.error) return res.status(500).json({ error: aRes.error.message });
    return res.json({
      agents: aRes.data || [],
      runs: rRes.data || [],
      metrics: {
        total: (aRes.data || []).length,
        activos: (aRes.data || []).filter(a => a.estado === 'activo').length,
        tareasHoy: (rRes.data || []).filter(r => (r.created_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length
      }
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.post('/api/automation', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del agente es requerido' });

    const { data, error } = await supabase.from('automatizaciones').insert([{
      empresa_codigo: tenant,
      nombre,
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      icono: (b.icono || 'fa-bolt').toString().slice(0, 40),
      estado: 'activo',
      tareas: 0,
      exito: 100,
      trigger_flow: (b.trigger_flow || '').toString().slice(0, 200),
      accion: (b.accion || '').toString().slice(0, 200)
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    await supabase.from('automation_runs').insert([{
      empresa_codigo: tenant,
      automatizacion_id: row?.id || null,
      agente: nombre,
      mensaje: `Agente "${nombre}" creado y activado`,
      nivel: 'success'
    }]).catch((e) => { console.warn('[AUTOMATION_RUN] Non-critical:', e.message); });
    return res.status(201).json({ agent: row });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.patch('/api/automation/:id', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const update = { updated_at: new Date().toISOString() };
    if (req.body.estado !== undefined) update.estado = req.body.estado === 'activo' ? 'activo' : 'inactivo';
    if (req.body.tareas !== undefined) update.tareas = parseInt(req.body.tareas, 10) || 0;
    const { data, error } = await supabase.from('automatizaciones').update(update).eq('id', req.params.id).eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    if (row && update.estado) {
      await supabase.from('automation_runs').insert([{
        empresa_codigo: tenant,
        automatizacion_id: row.id,
        agente: row.nombre,
        mensaje: `Agente "${row.nombre}" ${update.estado === 'activo' ? 'activado' : 'pausado'}`,
        nivel: 'info'
      }]).catch((e) => { console.warn('[AUTOMATION_RUN] Non-critical:', e.message); });
    }
    return res.json({ agent: row, success: true });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ═══════════════════════════════════════════════════════════
// AUTOMATION ENGINE — Event dispatching + polling execution
// ═══════════════════════════════════════════════════════════

async function dispatchAutomationEvent(empresaCodigo, eventType, payload) {
  if (!supabase || !empresaCodigo) return;
  try {
    const { data: rules, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('empresa_codigo', empresaCodigo)
      .eq('trigger_type', eventType)
      .eq('enabled', true);
    if (error || !rules || !rules.length) return;

    for (const rule of rules) {
      if (!checkConditions(rule.conditions, payload)) continue;
      await executeActions(empresaCodigo, rule, payload);
      await supabase.from('automation_rules').update({
        last_executed_at: new Date().toISOString(),
        execution_count: (rule.execution_count || 0) + 1,
        updated_at: new Date().toISOString()
      }).eq('id', rule.id);
    }
  } catch (err) {
    console.warn('[AUTOMATION] dispatchEvent error:', err.message);
  }
}

function checkConditions(conditions, payload) {
  if (!conditions || typeof conditions !== 'object') return true;
  const c = typeof conditions === 'string' ? JSON.parse(conditions) : conditions;
  if (c.rol && payload.rol !== c.rol) return false;
  if (c.dias_minimas && payload.dias_vencida < c.dias_minimas) return false;
  if (c.estado && payload.estado !== c.estado) return false;
  if (c.tipo && payload.tipo !== c.tipo) return false;
  return true;
}

async function executeActions(empresaCodigo, rule, payload) {
  const actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : (rule.actions || []);
  for (const action of actions) {
    try {
      if (action.tipo === 'notificar') {
        await supabase.from('notificaciones').insert([{
          empresa_codigo: empresaCodigo,
          titulo: interpolate(action.titulo || 'Automatización', payload),
          mensaje: interpolate(action.mensaje || '', payload),
          tipo: 'automatizacion',
          leida: false,
          created_at: new Date().toISOString()
        }]);
      } else if (action.tipo === 'email') {
        await enviarCorreoPortalPilot(
          process.env.EMAIL_USER,
          action.asunto || 'Automatización Portal Pilot',
          interpolate(action.titulo || 'Notificación', payload),
          interpolate(action.mensaje || '', payload),
          interpolate(action.html || '<p>Notificación automática</p>', payload)
        ).catch((e) => { console.warn('[AUTOMATION_EMAIL] Non-critical:', e.message); });
      } else if (action.tipo === 'log') {
        await registrarAuditoria({
          empresaCodigo,
          accion: action.accion || rule.trigger_type,
          descripcion: interpolate(action.descripcion || `${rule.nombre} ejecutado`, payload),
          tipo: 'automatizacion',
          usuarioNombre: 'Sistema'
        });
      }
      await supabase.from('automation_runs').insert([{
        empresa_codigo: empresaCodigo,
        automatizacion_id: rule.id,
        agente: rule.nombre,
        mensaje: `${action.tipo}: ${action.titulo || action.accion || 'ejecutado'}`,
        nivel: 'success'
      }]);
    } catch (err) {
      console.warn(`[AUTOMATION] Action ${action.tipo} error:`, err.message);
    }
  }
}

function interpolate(str, data) {
  if (!str || !data) return str || '';
  return str.replace(/\{\{(\w+)\}\}/g, (m, key) => data[key] !== undefined ? data[key] : m);
}

// ── CRUD: Automation Rules ──────────────────────────────
app.get('/api/automation/rules', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('empresa_codigo', tenant)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rules: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/automation/rules', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    const trigger_type = (b.trigger_type || '').toString().trim();
    if (!nombre || !trigger_type) return res.status(400).json({ error: 'nombre y trigger_type son requeridos' });
    const validTriggers = ['usuario_creado', 'factura_vencida', 'stock_bajo', 'factura_creada', 'tenant_creado'];
    if (!validTriggers.includes(trigger_type)) return res.status(400).json({ error: `trigger_type inválido. Válidos: ${validTriggers.join(', ')}` });
    const { data, error } = await supabase.from('automation_rules').insert([{
      empresa_codigo: tenant,
      nombre,
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      trigger_type,
      conditions: b.conditions || {},
      actions: b.actions || [],
      enabled: true,
      execution_count: 0
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ rule: row });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/automation/rules/:id', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const update = { updated_at: new Date().toISOString() };
    if (req.body.enabled !== undefined) update.enabled = !!req.body.enabled;
    if (req.body.nombre) update.nombre = req.body.nombre;
    if (req.body.descripcion !== undefined) update.descripcion = req.body.descripcion;
    if (req.body.conditions) update.conditions = req.body.conditions;
    if (req.body.actions) update.actions = req.body.actions;
    const { data, error } = await supabase.from('automation_rules').update(update)
      .eq('id', req.params.id).eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rule: Array.isArray(data) ? data[0] : null, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/automation/rules/:id', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { error } = await supabase.from('automation_rules').delete()
      .eq('id', req.params.id).eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ── Polling: Execute all enabled checks ──────────────────
app.post('/api/automation/execute', authenticate, requireTenantAdmin, requirePlanFeature('automation'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada' });
    const results = [];

    // Check factura_vencida
    try {
      const { data: facturas } = await supabase.from('facturas')
        .select('id, correlativo, total, created_at, empresa_id')
        .eq('empresa_codigo', tenant);
      if (facturas && facturas.length) {
        const now = new Date();
        const vencidas = facturas.filter(f => {
          if (!f.created_at) return false;
          const diff = (now - new Date(f.created_at)) / (1000 * 60 * 60 * 24);
          return diff >= 3 && (f.estado || 'emitida') !== 'pagada';
        });
        if (vencidas.length > 0) {
          await dispatchAutomationEvent(tenant, 'factura_vencida', {
            dias_vencida: 3,
            cantidad: vencidas.length,
            total: vencidas.reduce((s, f) => s + (Number(f.total) || 0), 0)
          });
          results.push({ trigger: 'factura_vencida', matched: vencidas.length });
        }
      }
    } catch (_) { console.warn('[AUTOMATION_POLL] Non-critical:', _.message); }

    // Check stock_bajo
    try {
      const empresa = await resolverEmpresaSupabase(tenant);
      if (empresa) {
        const { data: productos } = await supabase.from('productos')
          .select('id, nombre, stock_actual, stock_minimo')
          .eq('empresa_id', empresa.id);
        if (productos && productos.length) {
          const bajos = productos.filter(p => (Number(p.stock_actual) || 0) <= (Number(p.stock_minimo) || 0));
          if (bajos.length > 0) {
            await dispatchAutomationEvent(tenant, 'stock_bajo', {
              cantidad: bajos.length,
              productos: bajos.map(p => p.nombre).join(', ')
            });
            results.push({ trigger: 'stock_bajo', matched: bajos.length });
          }
        }
      }
    } catch (_) { console.warn('[AUTOMATION_POLL] Non-critical:', _.message); }

    return res.json({ executed: true, results, timestamp: new Date().toISOString() });
  } catch (err) { return handleServerError(res, err); }
});



// ═══════════════════════════════════════════════════════════════
// SUCURSALES
// ═══════════════════════════════════════════════════════════════
app.get('/api/sucursales', authenticate, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('sucursales')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ sucursales: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/sucursales', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la sucursal es requerido' });
    const { data, error } = await supabase.from('sucursales').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      direccion: (b.direccion || '').toString().slice(0, 300),
      telefono: (b.telefono || '').toString().slice(0, 50),
      responsable: (b.responsable || '').toString().slice(0, 150),
      estado: b.estado || 'activa',
      es_principal: !!b.es_principal
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    await registrarAuditoria(tenant, 'Sucursal creada', 'Se creo la sucursal ' + nombre, 'sucursales', req.user?.nombre || '', req);
    return res.status(201).json({ sucursal: row });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/sucursales/:id', authenticate, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('sucursales')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Sucursal no encontrada' });
    return res.json({ sucursal: data });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/sucursales/:id', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'direccion', 'telefono', 'responsable', 'estado', 'es_principal'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('sucursales').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ sucursal: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/sucursales/:id', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('sucursales').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Sucursal eliminada', 'Se elimino la sucursal ' + req.params.id, 'sucursales', req.user?.nombre || '', req);
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// BODEGAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/bodegas', authenticate, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('bodegas').select('*').eq('empresa_id', empresa.id);
    if (req.query.sucursal_id) query = query.eq('sucursal_id', req.query.sucursal_id);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ bodegas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/bodegas', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la bodega es requerido' });
    const { data, error } = await supabase.from('bodegas').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      sucursal_id: b.sucursal_id || null,
      direccion: (b.direccion || '').toString().slice(0, 300),
      capacidad: parseFloat(b.capacidad) || 0,
      estado: b.estado || 'activa'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ bodega: row });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/bodegas/:id', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'sucursal_id', 'direccion', 'capacidad', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('bodegas').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ bodega: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/bodegas/:id', authenticate, requireTenantAdmin, requirePlanFeature('sucursales'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('bodegas').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// KARDEX (consolidated — old duplicate with wrong column name removed)
// ═══════════════════════════════════════════════════════════════
// GET/POST kardex endpoints are defined later with full validation and stock control

// ═══════════════════════════════════════════════════════════════
// PROVEEDORES
// ═══════════════════════════════════════════════════════════════
app.get('/api/proveedores', authenticate, requirePlanFeature('proveedores'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ proveedores: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/proveedores', authenticate, requireTenantAdmin, requirePlanFeature('proveedores'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del proveedor es requerido' });
    const { data, error } = await supabase.from('proveedores').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      nit: (b.nit || '').toString().slice(0, 30),
      telefono: (b.telefono || '').toString().slice(0, 50),
      email: (b.email || '').toString().slice(0, 150),
      direccion: (b.direccion || '').toString().slice(0, 300),
      contacto: (b.contacto || '').toString().slice(0, 150),
      notas: (b.notas || '').toString().slice(0, 500),
      estado: b.estado || 'activo'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ proveedor: row });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/proveedores/:id', authenticate, requirePlanFeature('proveedores'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('proveedores')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Proveedor no encontrado' });
    return res.json({ proveedor: data });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/proveedores/:id', authenticate, requireTenantAdmin, requirePlanFeature('proveedores'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'nit', 'telefono', 'email', 'direccion', 'contacto', 'notas', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('proveedores').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ proveedor: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/proveedores/:id', authenticate, requireTenantAdmin, requirePlanFeature('proveedores'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('proveedores').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// COMPRAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/compras', authenticate, requirePlanFeature('compras'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('compras').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.proveedor_id) query = query.eq('proveedor_id', req.query.proveedor_id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ compras: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/compras', authenticate, requireTenantAdmin, requirePlanFeature('compras'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.proveedor_id) return res.status(400).json({ error: 'proveedor_id es requerido' });
    if (items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un item' });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const { data: countData } = await supabase
      .from('compras').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresa.id)
      .gte('created_at', now.toISOString().slice(0, 10) + 'T00:00:00');
    const seq = String((countData || 0) + 1).padStart(4, '0');
    const numero_orden = 'COM-' + dateStr + '-' + seq;

    let subtotal = 0;
    items.forEach(item => {
      subtotal += (parseFloat(item.cantidad) || 0) * (parseFloat(item.costo_unitario) || 0);
    });

    const { data: compraData, error: compraErr } = await supabase.from('compras').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      numero_orden: numero_orden,
      proveedor_id: b.proveedor_id,
      subtotal: subtotal,
      impuestos: parseFloat(b.impuestos) || 0,
      total: subtotal + (parseFloat(b.impuestos) || 0),
      estado: 'pendiente',
      notas: (b.notas || '').toString().slice(0, 500),
      usuario: req.user?.nombre || '',
      created_at: now.toISOString()
    }]).select().maybeSingle();
    if (compraErr) return res.status(500).json({ error: compraErr.message });

    const detalle = items.map(item => ({
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      compra_id: compraData.id,
      producto_id: item.producto_id,
      cantidad: parseFloat(item.cantidad) || 0,
      costo_unitario: parseFloat(item.costo_unitario) || 0,
      subtotal: (parseFloat(item.cantidad) || 0) * (parseFloat(item.costo_unitario) || 0)
    }));
    const { error: detErr } = await supabase.from('compras_detalle').insert(detalle);
    if (detErr) return res.status(500).json({ error: detErr.message });

    await registrarAuditoria(tenant, 'Compra creada', 'Compra ' + numero_orden + ' registrada', 'compras', req.user?.nombre || '', req);
    return res.status(201).json({ compra: Object.assign({}, compraData, { items: detalle }) });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/compras/:id', authenticate, requirePlanFeature('compras'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('compras')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Compra no encontrada' });
    const { data: items } = await supabase
      .from('compras_detalle').select('*').eq('compra_id', data.id);
    return res.json({ compra: Object.assign({}, data, { items: items || [] }) });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/compras/:id', authenticate, requireTenantAdmin, requirePlanFeature('compras'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const nuevoEstado = (req.body.estado || '').toString().trim();
    if (!nuevoEstado) return res.status(400).json({ error: 'estado es requerido' });

    const { data: compra, error: fetchErr } = await supabase
      .from('compras').select('*').eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (fetchErr || !compra) return res.status(404).json({ error: 'Compra no encontrada' });

    const { error } = await supabase.from('compras').update({
      estado: nuevoEstado,
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    if (nuevoEstado === 'recibida' && compra.estado !== 'recibida') {
      const { data: items } = await supabase.from('compras_detalle').select('*').eq('compra_id', compra.id);
      if (items && items.length) {
        for (const item of items) {
          const { data: prod } = await supabase.from('productos').select('id, stock_actual').eq('id', item.producto_id).maybeSingle();
          if (prod) {
            const anterior = Number(prod.stock_actual) || 0;
            const nuevo = anterior + (Number(item.cantidad) || 0);
            await supabase.from('productos').update({ stock_actual: nuevo, updated_at: new Date().toISOString() }).eq('id', item.producto_id);
            await supabase.from('kardex').insert([{
              empresa_id: empresa.id,
              empresa_codigo: tenant,
              producto_id: item.producto_id,
              tipo: 'entrada',
              cantidad: Number(item.cantidad) || 0,
              costo_unitario: Number(item.costo_unitario) || 0,
              cantidad_anterior: anterior,
              cantidad_nueva: nuevo,
              referencia: compra.numero_orden,
              notas: 'Recepcion de compra ' + compra.numero_orden,
              usuario: req.user?.nombre || '',
              created_at: new Date().toISOString()
            }]);
          }
        }
      }
    }
    await registrarAuditoria(tenant, 'Compra actualizada', 'Compra ' + compra.numero_orden + ' -> ' + nuevoEstado, 'compras', req.user?.nombre || '', req);
    return res.json({ success: true, estado: nuevoEstado });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// LISTAS DE PRECIOS
// ═══════════════════════════════════════════════════════════════
app.get('/api/listas-precios', authenticate, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('listas_precios')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ listas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/listas-precios', authenticate, requireTenantAdmin, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la lista es requerido' });
    const { data, error } = await supabase.from('listas_precios').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      moneda: (b.moneda || 'GTQ').toString().slice(0, 5),
      es_por_defecto: !!b.es_por_defecto,
      estado: b.estado || 'activa'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ lista: row });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/listas-precios/:id', authenticate, requireTenantAdmin, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'descripcion', 'moneda', 'es_por_defecto', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('listas_precios').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ lista: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/listas-precios/:id', authenticate, requireTenantAdmin, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('listas_precios').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS CRUD
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/productos', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('productos').select('*').eq('empresa_id', empresa.id);
    if (req.query.categoria) query = query.eq('categoria', req.query.categoria);
    if (req.query.activo !== undefined) query = query.eq('activo', req.query.activo === 'true');
    if (req.query.search) {
      const resultado = await filtrarBusquedaEnMemoria({ query, columnas: ['nombre', 'codigo', 'barcode'], termino: req.query.search, orderCol: 'nombre', limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500) });
      if (resultado.error) return res.status(500).json({ error: resultado.error.message });
      return res.json({ productos: resultado.data || [], total: resultado.data.length });
    }
    if (req.query.barcode) query = query.eq('barcode', req.query.barcode);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const orderedQuery = query.order('nombre', { ascending: true });
    const result = typeof orderedQuery.range === 'function'
      ? await orderedQuery.range(offset, offset + limit - 1)
      : await orderedQuery.limit(limit);
    const { data, error, count } = result;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ productos: data || [], total: count });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/productos/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('productos').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Producto no encontrado' });
    return res.json({ producto: data });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/productos', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};

    // ── Formato APP (sync): { empresa_codigo, productos: [...], ... } ──
    if (Array.isArray(b.productos)) {
      let sincronizados = 0;
      const errores = [];
      for (const p of b.productos) {
        try {
          if (!p || (!p.nombre && !p.codigo)) {
            errores.push({ error: 'Producto sin nombre ni código' });
            continue;
          }
          const codigo = (p.codigo || '').toString().trim().slice(0, 100);
          const nombre = (p.nombre || 'Producto ' + codigo).toString().slice(0, 200);
          const campos = {
            empresa_id: empresa.id,
            empresa_codigo: tenant,
            codigo,
            nombre,
            descripcion: (p.descripcion || '').toString().slice(0, 500),
            categoria: (p.categoria || 'General').toString().slice(0, 100),
            unidad_medida: (p.unidad_medida || 'Unidad').toString().slice(0, 50),
            imagen_url: p.imagen_url || null,
            precio_compra: parseFloat(p.precio_compra) || 0,
            precio_venta: parseFloat(p.precio_venta) || 0,
            stock_actual: parseInt(p.stock_actual, 10) || 0,
            stock_minimo: parseInt(p.stock_minimo, 10) || 0,
            isv_rate: parseFloat(p.isv_rate) || 15,
            exento: !!p.exento,
            bodega: (p.bodega || 'General').toString().slice(0, 100),
            barcode: (p.barcode || '').toString().trim().slice(0, 100) || null,
            marca: (p.marca || '').toString().slice(0, 100) || null,
            presentacion: (p.presentacion || '').toString().slice(0, 100) || null,
            activo: p.activo !== false,
            updated_at: new Date().toISOString()
          };
          const { data: exist } = await supabase.from('productos')
            .select('id').eq('empresa_id', empresa.id).eq('codigo', codigo).limit(1);
          if (exist && exist.length > 0) {
            const up = {};
            const allowUp = ['nombre','descripcion','categoria','unidad_medida','imagen_url','precio_compra','precio_venta','stock_actual','stock_minimo','isv_rate','exento','bodega','barcode','marca','presentacion','sucursal_id','bodega_id','activo','updated_at'];
            allowUp.forEach(k => { if (campos[k] !== undefined) up[k] = campos[k]; });
            const { error: ue } = await supabase.from('productos').update(up).eq('id', exist[0].id);
            if (ue) errores.push({ codigo, error: ue.message });
            else sincronizados++;
            continue;
          }
          const { error: ie } = await supabase.from('productos').insert([campos]);
          if (ie) errores.push({ codigo, error: ie.message });
          else sincronizados++;
        } catch (e) {
          errores.push({ error: e.message });
        }
      }
      return res.status(200).json({ sincronizados, errores });
    }

    if (!b.nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const barcode = (b.barcode || '').toString().trim();
    if (barcode) {
      const { data: existing } = await supabase.from('productos')
        .select('id, codigo, nombre')
        .eq('empresa_id', empresa.id)
        .eq('barcode', barcode)
        .limit(1);
      if (existing && existing.length > 0) {
        return res.status(409).json({
          error: 'Producto con este código de barras ya existe',
          existing: existing[0]
        });
      }
    }
    const { data, error } = await supabase.from('productos').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      codigo: (b.codigo || '').toString().slice(0, 100),
      nombre: b.nombre.toString().slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      categoria: (b.categoria || 'General').toString().slice(0, 100),
      unidad_medida: (b.unidad_medida || 'Unidad').toString().slice(0, 50),
      imagen_url: b.imagen_url || null,
      precio_compra: parseFloat(b.precio_compra) || 0,
      precio_venta: parseFloat(b.precio_venta) || 0,
      stock_actual: parseInt(b.stock_actual, 10) || 0,
      stock_minimo: parseInt(b.stock_minimo, 10) || 0,
      isv_rate: parseFloat(b.isv_rate) || 15,
      exento: !!b.exento,
      bodega: (b.bodega || 'General').toString().slice(0, 100),
      barcode: (b.barcode || '').toString().slice(0, 100),
      marca: (b.marca || '').toString().slice(0, 100),
      presentacion: (b.presentacion || '').toString().slice(0, 100),
      sucursal_id: b.sucursal_id || null,
      bodega_id: b.bodega_id || null,
      activo: b.activo !== false
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ producto: data });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/productos/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const updates = {};
    const allowed = ['codigo','nombre','descripcion','categoria','unidad_medida','imagen_url','precio_compra','precio_venta','stock_actual','stock_minimo','isv_rate','exento','bodega','barcode','marca','presentacion','sucursal_id','bodega_id','activo'];
    allowed.forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios para actualizar' });
    const { data, error } = await supabase
      .from('productos').update(updates)
      .eq('id', req.params.id).eq('empresa_id', empresa.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Producto no encontrado' });
    return res.json({ producto: data });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/productos/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const objId = req.params.id;
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(objId);
    let deleteQuery = supabase.from('productos').delete();
    deleteQuery = esUuid
      ? deleteQuery.eq('id', objId)
      : deleteQuery.eq('codigo', objId);
    const { error } = await deleteQuery.eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// POS VENTAS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/pos/ventas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('transacciones').select('*')
      .eq('empresa_id', empresa.id).eq('tipo', 'venta_pos');
    if (req.query.fecha_desde) query = query.gte('fecha', req.query.fecha_desde);
    if (req.query.fecha_hasta) query = query.lte('fecha', req.query.fecha_hasta);
    if (req.query.metodo_pago) query = query.eq('metodo_pago', req.query.metodo_pago);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('fecha', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ventas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/pos/ventas/resumen', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: todayData } = await supabase
      .from('transacciones').select('monto, metodo_pago, fecha')
      .eq('empresa_id', empresa.id).eq('tipo', 'venta_pos')
      .gte('fecha', hoy + 'T00:00:00').lte('fecha', hoy + 'T23:59:59');
    const { data: allData } = await supabase
      .from('transacciones').select('monto, metodo_pago, fecha')
      .eq('empresa_id', empresa.id).eq('tipo', 'venta_pos');
    const today = todayData || [];
    const all = allData || [];
    const ventasHoy = today.length;
    const ingresosHoy = today.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    const ingresosTotales = all.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    const ticketPromedio = ventasHoy > 0 ? Math.round(ingresosHoy / ventasHoy * 100) / 100 : 0;
    const pagos = {};
    today.forEach(r => { pagos[r.metodo_pago || 'efectivo'] = (pagos[r.metodo_pago || 'efectivo'] || 0) + (Number(r.monto) || 0); });
    return res.json({ ventas_hoy: ventasHoy, ingresos_hoy: ingresosHoy, ingresos_totales: ingresosTotales, ticket_promedio: ticketPromedio, por_metodo_pago: pagos });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/pos/ventas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un item' });
    const subtotal = parseFloat(b.subtotal) || 0;
    const isv = parseFloat(b.isv) || 0;
    const descuento = parseFloat(b.descuento) || 0;
    const total = parseFloat(b.total) || (subtotal + isv - descuento);
    // CHECK productivo: tipo ∈ ('ingreso','gasto','transferencia','ajuste'). Una
    // venta POS es un ingreso (tipo); el detalle de la venta se preserva en
    // metadata y categoria NO se usa (columna libre). Se mapea 'venta_pos' → 'ingreso'
    // conservando el marcador original en metadata.origen_tipo para trazabilidad.
    const ventaRef = `venta_pos:${b.numero_venta || ''}`.trim();
    const insertVenta = (withUsuario) => {
      const payload = {
        empresa_id: empresa.id,
        empresa_codigo: tenant,
        tipo: 'ingreso',
        categoria: 'venta',
        descripcion: `Venta POS - ${items.length} item(s)`,
        monto: total,
        metodo_pago: (b.metodo_pago || 'efectivo').toString().slice(0, 50),
        referencia: ventaRef.slice(0, 200),
        metadata: JSON.stringify({
          items, subtotal, isv, descuento,
          cliente_nombre: b.cliente_nombre || '',
          numero_venta: b.numero_venta || '',
          origen_tipo: 'venta_pos',
          usuario_id: withUsuario ? (req.user?.sub || null) : null,
          sucursal_id: b.sucursal_id || null
        }),
        sucursal_id: b.sucursal_id || null,
        fecha: new Date().toISOString()
      };
      if (withUsuario) payload.usuario_id = req.user?.sub || null;
      return supabase.from('transacciones').insert([payload]).select().maybeSingle();
    };
    // Esquema productivo vigente: transacciones SIN usuario_id. Intentar con él;
    // si el schema cache no lo conoce, reintentar sin la columna (drift-tolerante).
    let { data: ventaData, error: ventaErr } = await insertVenta(true);
    if (ventaErr) ({ data: ventaData, error: ventaErr } = await insertVenta(false));
    if (ventaErr) return res.status(500).json({ error: ventaErr.message });
    for (const item of items) {
      if (item.producto_id) {
        const { data: prod } = await supabase.from('productos').select('stock_actual').eq('id', item.producto_id).eq('empresa_id', empresa.id).maybeSingle();
        if (prod) {
          const newStock = (prod.stock_actual || 0) - (parseInt(item.cantidad, 10) || 0);
          await supabase.from('productos').update({ stock_actual: Math.max(0, newStock) }).eq('id', item.producto_id);
        }
        await supabase.from('kardex').insert([{
          empresa_id: empresa.id,
          empresa_codigo: tenant,
          producto_id: item.producto_id,
          tipo_movimiento: 'salida',
          cantidad: parseInt(item.cantidad, 10) || 0,
          precio_unitario: parseFloat(item.precio_unitario) || 0,
          referencia: ventaData.id,
          notas: `Venta POS`,
          usuario_id: req.user?.sub || null
        }]).then(() => {}).catch(() => {});
      }
    }
    return res.status(201).json({ venta: ventaData });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/pos/ventas/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('transacciones').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    return res.json({ venta: data });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAS CRUD
// ═══════════════════════════════════════════════════════════════════════════

async function getInvoiceIssuer(empresaId) {
  const { data } = await supabase.from('empresas')
    .select('id, codigo, nombre, rtn, email, telefono, direccion, pais')
    .eq('id', empresaId)
    .maybeSingle();
  return data || null;
}

async function resolveDocumentTenant(req) {
  return isRootUser(req) && req.query.tenant
    ? normalizeTenantCode(req.query.tenant)
    : normalizeTenantCode(getTenantCode(req));
}

app.get('/api/recibos', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const empresa = await resolverEmpresaSupabase(await resolveDocumentTenant(req));
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase.from('recibos').select('*')
      .eq('empresa_id', empresa.id).order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ recibos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/recibos', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = await resolveDocumentTenant(req);
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const body = req.body || {};
    if (!body.cliente_nombre || !body.concepto || !(Number(body.monto) > 0)) {
      return res.status(400).json({ error: 'cliente_nombre, concepto y monto son requeridos' });
    }
    let invoice = null;
    if (body.factura_id) {
      const result = await supabase.from('facturas').select('id, total, cliente_nombre, cliente_rtn, cliente_email')
        .eq('id', body.factura_id).eq('empresa_id', empresa.id).maybeSingle();
      invoice = result.data;
      if (!invoice) return res.status(404).json({ error: 'Factura relacionada no encontrada' });
    }
    const saldoAnterior = Number(body.saldo_anterior ?? invoice?.total ?? 0);
    const monto = Number(body.monto);
    const { data, error } = await supabase.from('recibos').insert({
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      factura_id: invoice?.id || body.factura_id || null,
      correlativo: String(body.correlativo || `REC-${Date.now()}`).slice(0, 50),
      cliente_nombre: String(body.cliente_nombre || invoice?.cliente_nombre).slice(0, 200),
      cliente_rtn: String(body.cliente_rtn || invoice?.cliente_rtn || '').slice(0, 20),
      cliente_email: String(body.cliente_email || invoice?.cliente_email || '').slice(0, 100),
      concepto: String(body.concepto).slice(0, 500),
      monto,
      saldo_anterior: saldoAnterior,
      saldo_pendiente: Math.max(0, saldoAnterior - monto),
      metodo_pago: String(body.metodo_pago || '').slice(0, 50),
      referencia: String(body.referencia || '').slice(0, 100),
      estado: 'pagado'
    }).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Recibo creado', `Se registró el recibo ${data.correlativo}`, 'facturacion', req.user?.email || '', req);
    return res.status(201).json({ recibo: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/notas-credito', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const empresa = await resolverEmpresaSupabase(await resolveDocumentTenant(req));
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase.from('notas_credito').select('*')
      .eq('empresa_id', empresa.id).order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ notas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/notas-credito', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = await resolveDocumentTenant(req);
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const body = req.body || {};
    if (!body.factura_id || !body.motivo || !(Number(body.total) > 0)) {
      return res.status(400).json({ error: 'factura_id, motivo y monto/total son requeridos' });
    }
    // Compatibilidad de nombres: el frontend históricamente envía 'monto';
    // el backend almacena en 'total'. Ambos nombres son aceptados.
    if (body.total === undefined && body.monto !== undefined) body.total = body.monto;
    if (body.monto === undefined && body.total !== undefined) body.monto = body.total;
    const { data: invoice } = await supabase.from('facturas').select('id, total')
      .eq('id', body.factura_id).eq('empresa_id', empresa.id).maybeSingle();
    if (!invoice) return res.status(404).json({ error: 'Factura relacionada no encontrada' });
    if (Number(body.total) > Number(invoice.total)) return res.status(400).json({ error: 'La nota no puede superar el total de la factura' });
    const { data, error } = await supabase.from('notas_credito').insert({
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      factura_id: invoice.id,
      correlativo: String(body.correlativo || `NC-${Date.now()}`).slice(0, 50),
      motivo: String(body.motivo).slice(0, 500),
      tipo_ajuste: String(body.tipo_ajuste || 'correccion').slice(0, 50),
      items: Array.isArray(body.items) ? body.items : [],
      subtotal: Number(body.subtotal) || 0,
      isv: Number(body.isv) || 0,
      descuento: Number(body.descuento) || 0,
      total: Number(body.total),
      estado: 'emitida'
    }).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Nota de crédito creada', `Se registró la nota ${data.correlativo} para la factura ${invoice.id}`, 'facturacion', req.user?.email || '', req);
    return res.status(201).json({ nota: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/recibos/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = isRootUser(req) && req.query.tenant
      ? normalizeTenantCode(req.query.tenant)
      : normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase.from('recibos').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Recibo no encontrado' });
    return res.json({ recibo: data, empresa: await getInvoiceIssuer(empresa.id) });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/notas-credito/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = isRootUser(req) && req.query.tenant
      ? normalizeTenantCode(req.query.tenant)
      : normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase.from('notas_credito').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Nota de crédito no encontrada' });
    const { data: factura } = await supabase.from('facturas').select('*')
      .eq('id', data.factura_id).eq('empresa_id', empresa.id).maybeSingle();
    return res.json({ nota: data, factura: factura || null, empresa: await getInvoiceIssuer(empresa.id) });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/facturas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = isRootUser(req) && req.query.tenant
      ? normalizeTenantCode(req.query.tenant)
      : normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('facturas').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.tipo_documento) query = query.eq('tipo_documento', req.query.tipo_documento);
    if (req.query.search) {
      const resultado = await filtrarBusquedaEnMemoria({ query, columnas: ['correlativo', 'cliente_nombre'], termino: req.query.search, orderCol: 'created_at', limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200), desc: true });
      if (resultado.error) return res.status(500).json({ error: resultado.error.message });
      return res.json({ facturas: resultado.data || [] });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ facturas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/facturas/resumen', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('facturas').select('id, total, isv, estado, created_at')
      .eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const totalFacturado = rows.filter(r => r.estado !== 'anulada').reduce((s, r) => s + (Number(r.total) || 0), 0);
    const totalISV = rows.filter(r => r.estado !== 'anulada').reduce((s, r) => s + (Number(r.isv) || 0), 0);
    const emitidas = rows.filter(r => r.estado === 'emitida').length;
    const anuladas = rows.filter(r => r.estado === 'anulada').length;
    const totalFacturas = rows.length;
    return res.json({ total_facturado: totalFacturado, total_isv: totalISV, emitidas, anuladas, total_facturas: totalFacturas });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/facturas/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = isRootUser(req) && req.query.tenant
      ? normalizeTenantCode(req.query.tenant)
      : normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('facturas').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Factura no encontrada' });
    const { data: emisor } = await supabase
      .from('empresas')
      .select('id, codigo, nombre, rtn, email, telefono, direccion, pais')
      .eq('id', empresa.id)
      .maybeSingle();
    return res.json({ factura: data, empresa: emisor || empresa });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/facturas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.cliente_nombre) return res.status(400).json({ error: 'cliente_nombre es requerido' });
    const subtotal = parseFloat(b.subtotal) || 0;
    const isv = parseFloat(b.isv) || 0;
    const descuento = parseFloat(b.descuento) || 0;
    const total = parseFloat(b.total) || (subtotal + isv - descuento);
    const payloadFull = {
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      usuario_id: req.user?.sub || null,
      correlativo: (b.correlativo || '').toString().slice(0, 50),
      cliente_nombre: b.cliente_nombre.toString().slice(0, 200),
      cliente_rtn: (b.cliente_rtn || '').toString().slice(0, 20),
      cliente_email: (b.cliente_email || '').toString().slice(0, 100),
      subtotal, isv, descuento, total,
      items: Array.isArray(b.items) ? b.items : [],
      estado: 'emitida',
      tipo_documento: ({ 'factura': 'Factura', 'nota credito': 'Nota Crédito', 'nota crédito': 'Nota Crédito', 'nota debito': 'Nota Débito', 'nota débito': 'Nota Débito', 'factura exportacion': 'Factura Exportación' })[String(b.tipo_documento || 'factura').toLowerCase().trim()] || 'Factura',
      metodo_pago: (b.metodo_pago || '').toString().slice(0, 50),
      notas: (b.notas || '').toString().slice(0, 500),
      sucursal_id: b.sucursal_id || null,
      bodega_id: b.bodega_id || null,
      created_at: new Date().toISOString()
    };
    // Fallback de compatibilidad: si el esquema productivo aún no tiene columnas
    // opcionales (schema cache), reintentar con el payload base mínimo.
    // Fallback progresivo: si el esquema productivo carece de alguna columna
    // (drift de migraciones), se elimina esa columna del payload y se reintenta.
    // También cubre columnas NOT NULL antiguas (p.ej. cai): se envía '' en vez
    // de inventar datos fiscales.
    let payload = payloadFull;
    let r1 = await supabase.from('facturas').insert([payload]).select().maybeSingle();
    let error = r1.error, data = r1.data;
    let reintentos = 0;
    while (error && reintentos < 15) {
      const mMissing = /could not find the '([a-z_]+)' column/i.exec(error.message || '');
      const mNotNull = /null value in column "([a-z_]+)"/i.exec(error.message || '');
      // Constraint CHECK legado (p.ej. facturas_tipo_documento_check): los
      // valores modernos no existen en el esquema viejo → omitir la columna
      // para que aplique el DEFAULT del esquema productivo.
      const mCheck = /check constraint "facturas_([a-z_]+)_check"/i.exec(error.message || '');
      if (mMissing) {
        const col = mMissing[1];
        const { [col]: _omit, ...rest } = payload;
        payload = rest;
      } else if (mNotNull) {
        const col = mNotNull[1];
        if (payload[col] === undefined) payload[col] = '';
        else if (payload[col] === null) payload[col] = '';
        else break;
      } else if (mCheck && payload[mCheck[1]] !== undefined) {
        const { [mCheck[1]]: _omitChk, ...restChk } = payload;
        payload = restChk;
      } else break;
      reintentos++;
      const r = await supabase.from('facturas').insert([payload]).select().maybeSingle();
      error = r.error; data = r.data;
    }
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ factura: data });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/facturas/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const updates = {};
    if (b.estado !== undefined) updates.estado = b.estado;
    if (b.notas !== undefined) updates.notas = b.notas;
    if (b.metodo_pago !== undefined) updates.metodo_pago = b.metodo_pago;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios para actualizar' });
    const { data, error } = await supabase
      .from('facturas').update(updates)
      .eq('id', req.params.id).eq('empresa_id', empresa.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Factura no encontrada' });
    return res.json({ factura: data });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES CRUD
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/clientes', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('clientes').select('*').eq('empresa_id', empresa.id);
    if (req.query.search) {
      const resultado = await filtrarBusquedaEnMemoria({ query, columnas: ['nombre', 'rtn', 'email'], termino: req.query.search, orderCol: 'nombre', limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500) });
      if (resultado.error) return res.status(500).json({ error: resultado.error.message });
      return res.json({ clientes: resultado.data || [] });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('nombre', { ascending: true }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ clientes: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/clientes/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('clientes').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json({ cliente: data });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/clientes', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const { data, error } = await supabase.from('clientes').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: b.nombre.toString().slice(0, 200),
      rtn: (b.rtn || '').toString().slice(0, 20),
      email: (b.email || '').toString().slice(0, 100),
      telefono: (b.telefono || '').toString().slice(0, 30),
      direccion: (b.direccion || '').toString().slice(0, 300),
      notas: (b.notas || '').toString().slice(0, 500),
      activo: true,
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    // Esquema productivo vigente: clientes SIN limite_credito/saldo_pendiente
    // (drift detectado en release audit). Si llegan a existir tras una migración,
    // se reintenta incluyendo esos campos para no perder funcionalidad de crédito.
    if (error) {
      const r2 = await supabase.from('clientes').insert([{
        empresa_id: empresa.id,
        empresa_codigo: tenant,
        nombre: b.nombre.toString().slice(0, 200),
        rtn: (b.rtn || '').toString().slice(0, 20),
        email: (b.email || '').toString().slice(0, 100),
        telefono: (b.telefono || '').toString().slice(0, 30),
        direccion: (b.direccion || '').toString().slice(0, 300),
        limite_credito: parseFloat(b.limite_credito) || 0,
        saldo_pendiente: 0,
        notas: (b.notas || '').toString().slice(0, 500),
        activo: true,
        created_at: new Date().toISOString()
      }]).select().maybeSingle();
      if (r2.error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ cliente: r2.data });
    }
    return res.status(201).json({ cliente: data });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/clientes/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const updates = {};
    const allowed = ['nombre','rtn','email','telefono','direccion','limite_credito','notas','activo'];
    allowed.forEach(f => { if (b[f] !== undefined) updates[f] = b[f]; });
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Sin cambios para actualizar' });
    const { data, error } = await supabase
      .from('clientes').update(updates)
      .eq('id', req.params.id).eq('empresa_id', empresa.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Cliente no encontrado' });
    return res.json({ cliente: data });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/clientes/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase
      .from('clientes').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// KARDEX
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/kardex', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('kardex').select('*, productos(nombre, codigo, barcode)').eq('empresa_id', empresa.id);
    if (req.query.producto_id) query = query.eq('producto_id', req.query.producto_id);
    if (req.query.tipo_movimiento) query = query.eq('tipo_movimiento', req.query.tipo_movimiento);
    if (req.query.bodega_id) query = query.eq('bodega_id', req.query.bodega_id);
    if (req.query.fecha_desde) query = query.gte('created_at', req.query.fecha_desde);
    if (req.query.fecha_hasta) query = query.lte('created_at', req.query.fecha_hasta);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ movimientos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/kardex', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.producto_id) return res.status(400).json({ error: 'producto_id es requerido' });
    const tipoMov = (b.tipo_movimiento || '').toString().trim().toLowerCase();
    if (!['entrada', 'salida', 'ajuste'].includes(tipoMov)) return res.status(400).json({ error: 'tipo_movimiento debe ser entrada, salida o ajuste' });
    const cantidad = parseInt(b.cantidad, 10) || 0;
    if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });

    const { data: producto, error: prodErr } = await supabase
      .from('productos').select('id, stock_actual').eq('id', b.producto_id).eq('empresa_id', empresa.id).maybeSingle();
    if (prodErr || !producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const stockActual = Number(producto.stock_actual) || 0;
    let nuevoStock = stockActual;
    if (tipoMov === 'entrada') {
      nuevoStock = stockActual + cantidad;
    } else if (tipoMov === 'salida') {
      if (stockActual < cantidad) return res.status(400).json({ error: 'Stock insuficiente. Disponible: ' + stockActual });
      nuevoStock = stockActual - cantidad;
    } else {
      nuevoStock = cantidad;
    }

    const { error: updateErr } = await supabase
      .from('productos').update({ stock_actual: nuevoStock, updated_at: new Date().toISOString() }).eq('id', b.producto_id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const { data, error } = await supabase.from('kardex').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      producto_id: b.producto_id,
      tipo_movimiento: tipoMov,
      cantidad: cantidad,
      cantidad_anterior: stockActual,
      cantidad_nueva: nuevoStock,
      costo_unitario: parseFloat(b.costo_unitario || b.precio_unitario) || 0,
      referencia: (b.referencia || '').toString().slice(0, 200),
      notas: (b.notas || '').toString().slice(0, 500),
      usuario_id: req.user?.sub || null,
      usuario_nombre: req.user?.nombre || ''
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ movimiento: data, stock_anterior: stockActual, stock_nuevo: nuevoStock });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/productos/:id/precios', authenticate, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('productos_precio')
      .select('*, listas_precios(nombre)')
      .eq('producto_id', req.params.id)
      .eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ precios: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/productos/:id/precios', authenticate, requireTenantAdmin, requirePlanFeature('precios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.lista_id) return res.status(400).json({ error: 'lista_id es requerido' });
    const precio = parseFloat(b.precio) || 0;
    if (precio <= 0) return res.status(400).json({ error: 'El precio debe ser mayor a 0' });

    const { data: existing } = await supabase
      .from('productos_precios')
      .select('id')
      .eq('producto_id', req.params.id)
      .eq('lista_id', b.lista_id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase.from('productos_precios').update({
        precio: precio,
        precio_descuento: parseFloat(b.precio_descuento) || null,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ precio_item: data, updated: true });
    } else {
      const { data, error } = await supabase.from('productos_precios').insert([{
        empresa_id: empresa.id,
        empresa_codigo: tenant,
        producto_id: req.params.id,
        lista_id: b.lista_id,
        precio: precio,
        precio_descuento: parseFloat(b.precio_descuento) || null
      }]).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ precio_item: data, updated: false });
    }
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// PROMOCIONES
// ═══════════════════════════════════════════════════════════════
app.get('/api/promociones', authenticate, requirePlanFeature('promociones'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('promociones')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ promociones: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/promociones/activas', authenticate, requirePlanFeature('promociones'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('promociones')
      .select('*')
      .eq('empresa_id', empresa.id)
      .eq('estado', 'activa')
      .lte('fecha_inicio', now)
      .gte('fecha_fin', now);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ promociones: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/promociones', authenticate, requireTenantAdmin, requirePlanFeature('promociones'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la promocion es requerido' });
    if (!b.fecha_inicio || !b.fecha_fin) return res.status(400).json({ error: 'fecha_inicio y fecha_fin son requeridos' });
    const { data, error } = await supabase.from('promociones').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      tipo: (b.tipo || 'descuento_porcentaje').toString().slice(0, 50),
      valor: parseFloat(b.valor) || 0,
      producto_ids: b.producto_ids || [],
      compra_minima: parseFloat(b.compra_minima) || 0,
      fecha_inicio: b.fecha_inicio,
      fecha_fin: b.fecha_fin,
      estado: b.estado || 'activa'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ promocion: row });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/promociones/:id', authenticate, requireTenantAdmin, requirePlanFeature('promociones'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'descripcion', 'tipo', 'valor', 'producto_ids', 'compra_minima', 'fecha_inicio', 'fecha_fin', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('promociones').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ promocion: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/promociones/:id', authenticate, requireTenantAdmin, requirePlanFeature('promociones'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('promociones').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// VENTAS FIADAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/ventas-fiadas', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('ventas_fiadas').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.vendedor_id) query = query.eq('vendedor_id', req.query.vendedor_id);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ventas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/ventas-fiadas/resumen', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('ventas_fiadas')
      .select('total, saldo_pendiente, estado, fecha_vencimiento')
      .eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const hoy = new Date().toISOString().slice(0, 10);
    const totalPendiente = rows.filter(r => r.estado === 'pendiente').reduce((s, r) => s + (Number(r.total) || 0), 0);
    const totalParcial = rows.filter(r => r.estado === 'parcial').reduce((s, r) => s + (Number(r.saldo_pendiente) || 0), 0);
    const totalPagada = rows.filter(r => r.estado === 'pagada').reduce((s, r) => s + (Number(r.total) || 0), 0);
    const vencidas = rows.filter(r => r.estado !== 'pagada' && r.fecha_vencimiento && r.fecha_vencimiento < hoy).length;
    return res.json({ total_pendiente: totalPendiente, total_parcial: totalParcial, total_pagada: totalPagada, vencidas: vencidas });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/ventas-fiadas', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.cliente_nombre) return res.status(400).json({ error: 'cliente_nombre es requerido' });
    if (items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un item' });

    let subtotal = 0;
    items.forEach(item => {
      subtotal += (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0);
    });
    const total = subtotal;
    const saldo_pendiente = total - (parseFloat(b.abono_inicial) || 0);

    const { data: ventaData, error: ventaErr } = await supabase.from('ventas_fiadas').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      cliente_nombre: (b.cliente_nombre || '').toString().slice(0, 200),
      cliente_telefono: (b.cliente_telefono || '').toString().slice(0, 50),
      cliente_email: (b.cliente_email || '').toString().slice(0, 150),
      vendedor_id: b.vendedor_id || null,
      subtotal: subtotal,
      total: total,
      saldo_pendiente: saldo_pendiente > 0 ? saldo_pendiente : 0,
      estado: saldo_pendiente <= 0 ? 'pagada' : (parseFloat(b.abono_inicial) > 0 ? 'parcial' : 'pendiente'),
      fecha_vencimiento: b.fecha_vencimiento || null,
      notas: (b.notas || '').toString().slice(0, 500),
      usuario: req.user?.nombre || '',
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (ventaErr) return res.status(500).json({ error: ventaErr.message });

    const detalle = items.map(item => ({
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      venta_fiada_id: ventaData.id,
      producto_id: item.producto_id,
      cantidad: parseFloat(item.cantidad) || 0,
      precio_unitario: parseFloat(item.precio_unitario) || 0,
      subtotal: (parseFloat(item.cantidad) || 0) * (parseFloat(item.precio_unitario) || 0)
    }));
    const { error: detErr } = await supabase.from('ventas_fiadas_detalle').insert(detalle);
    if (detErr) return res.status(500).json({ error: detErr.message });

    return res.status(201).json({ venta: Object.assign({}, ventaData, { items: detalle }) });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/ventas-fiadas/:id', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('ventas_fiadas')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Venta fiada no encontrada' });
    const { data: items } = await supabase
      .from('ventas_fiadas_detalle').select('*').eq('venta_fiada_id', data.id);
    const { data: abonos } = await supabase
      .from('abonos').select('*').eq('venta_fiada_id', data.id).order('created_at', { ascending: true });
    return res.json({ venta: Object.assign({}, data, { items: items || [], abonos: abonos || [] }) });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/ventas-fiadas/:id', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['estado', 'fecha_vencimiento', 'notas', 'cliente_nombre', 'cliente_telefono', 'cliente_email'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('ventas_fiadas').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ venta: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});


// ── CRM Ventas (pipeline de oportunidades: cotizacion/en_proceso/ganada/perdida) ──
app.get('/api/ventas-crm', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('ventas_crm').select('*').eq('empresa_codigo', tenant);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.buscar) {
      const termino = String(req.query.buscar).trim().toLowerCase();
      const { data } = await supabase.from('ventas_crm').select('*').eq('empresa_codigo', tenant);
      const filtradas = (data || []).filter(v => (v.cliente || '').toLowerCase().includes(termino) || (v.descripcion || '').toLowerCase().includes(termino));
      return res.json({ ventas: filtradas.sort((a, b) => new Date(b.created_at || b.fecha) - new Date(a.created_at || a.fecha)) });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ventas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/ventas-crm/resumen', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('ventas_crm').select('estado, monto').eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const sum = (f) => rows.filter(f).reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
    return res.json({
      num_cotizacion: rows.filter(r => r.estado === 'cotizacion').length,
      num_en_proceso: rows.filter(r => r.estado === 'en_proceso').length,
      num_ganada: rows.filter(r => r.estado === 'ganada').length,
      num_perdida: rows.filter(r => r.estado === 'perdida').length,
      monto_ganada: sum(r => r.estado === 'ganada'),
      monto_pipeline: sum(r => r.estado !== 'perdida')
    });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/ventas-crm', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.cliente || !String(b.cliente).trim()) return res.status(400).json({ error: 'cliente es requerido' });
    const estadosValidos = ['cotizacion', 'en_proceso', 'ganada', 'perdida'];
    const estado = estadosValidos.includes(b.estado) ? b.estado : 'cotizacion';
    const { data, error } = await supabase.from('ventas_crm').insert([{
      empresa_codigo: tenant,
      empresa_id: empresa.id,
      usuario_id: req.user?.sub || null,
      cliente: String(b.cliente).slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 1000),
      monto: Math.max(0, parseFloat(b.monto) || 0),
      estado,
      fecha: b.fecha || new Date().toISOString(),
      creado_por: req.user?.nombre || ''
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Nueva venta CRM', String(b.cliente).slice(0, 120), 'crm', req.user?.nombre || '', req);
    return res.status(201).json({ venta: data });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/ventas-crm/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const b = req.body || {};
    const campos = {};
    if (b.cliente !== undefined) campos.cliente = String(b.cliente).slice(0, 200);
    if (b.descripcion !== undefined) campos.descripcion = (b.descripcion || '').toString().slice(0, 1000);
    if (b.monto !== undefined) campos.monto = Math.max(0, parseFloat(b.monto) || 0);
    if (b.estado !== undefined) {
      const estadosValidos = ['cotizacion', 'en_proceso', 'ganada', 'perdida'];
      if (!estadosValidos.includes(b.estado)) return res.status(400).json({ error: 'Estado inválido', validos: estadosValidos });
      campos.estado = b.estado;
    }
    campos.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('ventas_crm').update(campos).eq('id', req.params.id).eq('empresa_codigo', tenant).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    await registrarAuditoria(tenant, 'Actualizó venta CRM', (campos.estado || 'cambio').slice(0, 80), 'crm', req.user?.nombre || '', req);
    return res.json({ venta: data });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/ventas-crm/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('ventas_crm').delete().eq('id', req.params.id).eq('empresa_codigo', tenant).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    await registrarAuditoria(tenant, 'Eliminó venta CRM', String(data.cliente || '').slice(0, 80), 'crm', req.user?.nombre || '', req);
    return res.json({ ok: true, venta: data });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// ABONOS
// ═══════════════════════════════════════════════════════════════
app.post('/api/abonos', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    if (!b.venta_fiada_id) return res.status(400).json({ error: 'venta_fiada_id es requerido' });
    const monto = parseFloat(b.monto) || 0;
    if (monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

    const { data: venta, error: vErr } = await supabase
      .from('ventas_fiadas')
      .select('*')
      .eq('id', b.venta_fiada_id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (vErr || !venta) return res.status(404).json({ error: 'Venta fiada no encontrada' });

    const nuevoSaldo = Math.max(0, (Number(venta.saldo_pendiente) || 0) - monto);
    const nuevoEstado = nuevoSaldo <= 0 ? 'pagada' : 'parcial';

    const { data: abonoData, error: abErr } = await supabase.from('abonos').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      venta_fiada_id: b.venta_fiada_id,
      monto: monto,
      metodo_pago: (b.metodo_pago || 'efectivo').toString().slice(0, 50),
      notas: (b.notas || '').toString().slice(0, 300),
      usuario: req.user?.nombre || '',
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (abErr) return res.status(500).json({ error: abErr.message });

    const { error: upErr } = await supabase.from('ventas_fiadas').update({
      saldo_pendiente: nuevoSaldo,
      estado: nuevoEstado,
      updated_at: new Date().toISOString()
    }).eq('id', b.venta_fiada_id);
    if (upErr) return res.status(500).json({ error: upErr.message });

    return res.status(201).json({ abono: abonoData, saldo_pendiente: nuevoSaldo, estado: nuevoEstado });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/abonos', authenticate, requirePlanFeature('fiado'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('abonos').select('*').eq('empresa_id', empresa.id);
    if (req.query.venta_fiada_id) query = query.eq('venta_fiada_id', req.query.venta_fiada_id);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ abonos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// RUTAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/rutas', authenticate, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('rutas')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ rutas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/rutas', authenticate, requireTenantAdmin, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la ruta es requerido' });
    const { data, error } = await supabase.from('rutas').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      vendedor_id: b.vendedor_id || null,
      dias: b.dias || [],
      zona: (b.zona || '').toString().slice(0, 100),
      estado: b.estado || 'activa'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ ruta: row });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/rutas/:id', authenticate, requireTenantAdmin, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'descripcion', 'vendedor_id', 'dias', 'zona', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('rutas').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ ruta: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.delete('/api/rutas/:id', authenticate, requireTenantAdmin, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { error } = await supabase.from('rutas').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// VISITAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/visitas', authenticate, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('visitas').select('*').eq('empresa_id', empresa.id);
    if (req.query.ruta_id) query = query.eq('ruta_id', req.query.ruta_id);
    if (req.query.vendedor_id) query = query.eq('vendedor_id', req.query.vendedor_id);
    if (req.query.fecha) query = query.eq('fecha', req.query.fecha);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ visitas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/visitas/resumen', authenticate, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const hoy = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('visitas')
      .select('estado, resultado, fecha')
      .eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const rows = data || [];
    const completadasHoy = rows.filter(r => r.estado === 'completada' && (r.fecha || '').slice(0, 10) === hoy).length;
    const pendientes = rows.filter(r => r.estado === 'pendiente').length;
    const sinVenta = rows.filter(r => r.resultado === 'sin_venta' && (r.fecha || '').slice(0, 10) === hoy).length;
    const totalVisits = rows.filter(r => (r.fecha || '').slice(0, 10) === hoy).length;
    return res.json({ completadas_hoy: completadasHoy, pendientes: pendientes, sin_venta: sinVenta, total_visits: totalVisits });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/visitas', authenticate, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const { data, error } = await supabase.from('visitas').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      ruta_id: b.ruta_id || null,
      vendedor_id: b.vendedor_id || null,
      cliente_nombre: (b.cliente_nombre || '').toString().slice(0, 200),
      cliente_direccion: (b.cliente_direccion || '').toString().slice(0, 300),
      cliente_telefono: (b.cliente_telefono || '').toString().slice(0, 50),
      fecha: b.fecha || new Date().toISOString(),
      hora_inicio: b.hora_inicio || null,
      hora_fin: b.hora_fin || null,
      estado: b.estado || 'pendiente',
      resultado: b.resultado || null,
      notas: (b.notas || '').toString().slice(0, 500),
      usuario: req.user?.nombre || '',
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ visita: data });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/visitas/:id', authenticate, requirePlanFeature('rutas'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['estado', 'resultado', 'hora_fin', 'notas'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('visitas').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ visita: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// TRANSFERENCIAS
// ═══════════════════════════════════════════════════════════════
app.get('/api/transferencias', authenticate, requirePlanFeature('transferencias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('transferencias').select('*').eq('empresa_id', empresa.id);
    if (req.query.sucursal_origen_id) query = query.eq('sucursal_origen_id', req.query.sucursal_origen_id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ transferencias: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/transferencias', authenticate, requireTenantAdmin, requirePlanFeature('transferencias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!b.sucursal_origen_id) return res.status(400).json({ error: 'sucursal_origen_id es requerido' });
    if (!b.sucursal_destino_id) return res.status(400).json({ error: 'sucursal_destino_id es requerido' });
    if (items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un item' });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const { data: countData } = await supabase
      .from('transferencias').select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresa.id)
      .gte('created_at', now.toISOString().slice(0, 10) + 'T00:00:00');
    const seq = String((countData || 0) + 1).padStart(4, '0');
    const numero = 'TRF-' + dateStr + '-' + seq;

    const { data: trfData, error: trfErr } = await supabase.from('transferencias').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      numero: numero,
      sucursal_origen_id: b.sucursal_origen_id,
      sucursal_destino_id: b.sucursal_destino_id,
      estado: 'pendiente',
      notas: (b.notas || '').toString().slice(0, 500),
      usuario: req.user?.nombre || '',
      created_at: now.toISOString()
    }]).select().maybeSingle();
    if (trfErr) return res.status(500).json({ error: trfErr.message });

    const detalle = items.map(item => ({
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      transferencia_id: trfData.id,
      producto_id: item.producto_id,
      cantidad: parseFloat(item.cantidad) || 0
    }));
    const { error: detErr } = await supabase.from('transferencias_detalle').insert(detalle);
    if (detErr) return res.status(500).json({ error: detErr.message });

    return res.status(201).json({ transferencia: Object.assign({}, trfData, { items: detalle }) });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/transferencias/:id', authenticate, requirePlanFeature('transferencias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('transferencias')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Transferencia no encontrada' });
    const { data: items } = await supabase
      .from('transferencias_detalle').select('*').eq('transferencia_id', data.id);
    return res.json({ transferencia: Object.assign({}, data, { items: items || [] }) });
  } catch (err) { return handleServerError(res, err); }
});

app.patch('/api/transferencias/:id', authenticate, requireTenantAdmin, requirePlanFeature('transferencias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const nuevoEstado = (req.body.estado || '').toString().trim();
    if (!nuevoEstado) return res.status(400).json({ error: 'estado es requerido' });

    const { data: trf, error: fetchErr } = await supabase
      .from('transferencias').select('*').eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (fetchErr || !trf) return res.status(404).json({ error: 'Transferencia no encontrada' });

    const { error } = await supabase.from('transferencias').update({
      estado: nuevoEstado,
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    if (nuevoEstado === 'recibida' && trf.estado !== 'recibida') {
      const { data: items } = await supabase.from('transferencias_detalle').select('*').eq('transferencia_id', trf.id);
      if (items && items.length) {
        for (const item of items) {
          const { data: prod } = await supabase.from('productos').select('id, stock_actual').eq('id', item.producto_id).maybeSingle();
          if (prod) {
            const anterior = Number(prod.stock_actual) || 0;
            const nuevoSaldo = anterior - (Number(item.cantidad) || 0);
            if (nuevoSaldo < 0) continue;
            await supabase.from('productos').update({ stock_actual: nuevoSaldo, updated_at: new Date().toISOString() }).eq('id', item.producto_id);
            await supabase.from('kardex').insert([{
              empresa_id: empresa.id,
              empresa_codigo: tenant,
              producto_id: item.producto_id,
              sucursal_id: trf.sucursal_origen_id,
              tipo: 'salida',
              cantidad: Number(item.cantidad) || 0,
              cantidad_anterior: anterior,
              cantidad_nueva: nuevoSaldo,
              referencia: trf.numero,
              notas: 'Transferencia saliente ' + trf.numero,
              usuario: req.user?.nombre || '',
              created_at: new Date().toISOString()
            }]);

            const { data: prodDest } = await supabase.from('productos').select('id, stock_actual').eq('id', item.producto_id).maybeSingle();
            const stockDest = Number(prodDest?.stock_actual) || 0;
            const nuevoDest = stockDest + (Number(item.cantidad) || 0);
            await supabase.from('productos').update({ stock_actual: nuevoDest, updated_at: new Date().toISOString() }).eq('id', item.producto_id);
            await supabase.from('kardex').insert([{
              empresa_id: empresa.id,
              empresa_codigo: tenant,
              producto_id: item.producto_id,
              sucursal_id: trf.sucursal_destino_id,
              tipo: 'entrada',
              cantidad: Number(item.cantidad) || 0,
              cantidad_anterior: stockDest,
              cantidad_nueva: nuevoDest,
              referencia: trf.numero,
              notas: 'Transferencia entrante ' + trf.numero,
              usuario: req.user?.nombre || '',
              created_at: new Date().toISOString()
            }]);
          }
        }
      }
    }
    await registrarAuditoria(tenant, 'Transferencia actualizada', 'Transferencia ' + trf.numero + ' -> ' + nuevoEstado, 'transferencias', req.user?.nombre || '', req);
    return res.json({ success: true, estado: nuevoEstado });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// PLANES DE MEMBRESIA
// ═══════════════════════════════════════════════════════════════
app.get('/api/membresias/planes', authenticate, requirePlanFeature('membresias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('planes_membresia')
      .select('*')
      .eq('empresa_id', empresa.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ planes: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/membresias/planes', authenticate, requireTenantAdmin, requirePlanFeature('membresias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del plan es requerido' });
    const { data, error } = await supabase.from('planes_membresia').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      nombre: nombre.slice(0, 200),
      descripcion: (b.descripcion || '').toString().slice(0, 500),
      precio_mensual: parseFloat(b.precio_mensual) || 0,
      precio_anual: parseFloat(b.precio_anual) || 0,
      duracion_dias: parseInt(b.duracion_dias, 10) || 30,
      beneficios: b.beneficios || [],
      puntos_por_quetzal: parseFloat(b.puntos_por_quetzal) || 1,
      estado: b.estado || 'activo'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.status(201).json({ plan: row });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/membresias/planes/:id', authenticate, requireTenantAdmin, requirePlanFeature('membresias'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'descripcion', 'precio_mensual', 'precio_anual', 'duracion_dias', 'beneficios', 'puntos_por_quetzal', 'estado'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('planes_membresia').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ plan: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// SOCIOS
// ═══════════════════════════════════════════════════════════════
app.get('/api/membresias/socios', authenticate, requirePlanFeature('socios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('socios').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.plan_id) query = query.eq('plan_id', req.query.plan_id);
    if (req.query.search) {
      const resultado = await filtrarBusquedaEnMemoria({ query, columnas: ['nombre', 'numero_socio', 'email'], termino: req.query.search, orderCol: 'created_at', limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200), desc: true });
      if (resultado.error) return res.status(500).json({ error: resultado.error.message });
      return res.json({ socios: resultado.data || [] });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ socios: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/membresias/socios', authenticate, requireTenantAdmin, requirePlanFeature('socios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const nombre = (b.nombre || '').toString().trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre del socio es requerido' });

    const { data: countData } = await supabase
      .from('socios')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresa.id);
    const seq = String((countData || 0) + 1).padStart(4, '0');
    const numero_socio = 'SOC-' + seq;

    let fecha_vencimiento = b.fecha_vencimiento;
    if (!fecha_vencimiento && b.plan_id) {
      const { data: plan } = await supabase.from('planes_membresia').select('duracion_dias').eq('id', b.plan_id).maybeSingle();
      if (plan && plan.duracion_dias) {
        const fv = new Date();
        fv.setDate(fv.getDate() + Number(plan.duracion_dias));
        fecha_vencimiento = fv.toISOString().slice(0, 10);
      }
    }

    const { data, error } = await supabase.from('socios').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      numero_socio: numero_socio,
      nombre: nombre.slice(0, 200),
      email: (b.email || '').toString().slice(0, 150),
      telefono: (b.telefono || '').toString().slice(0, 50),
      direccion: (b.direccion || '').toString().slice(0, 300),
      plan_id: b.plan_id || null,
      fecha_registro: new Date().toISOString().slice(0, 10),
      fecha_vencimiento: fecha_vencimiento || null,
      puntos_acumulados: 0,
      estado: b.estado || 'activo',
      notas: (b.notas || '').toString().slice(0, 500)
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ socio: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/membresias/socios/:id', authenticate, requirePlanFeature('socios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('socios')
      .select('*, planes_membresia(nombre, precio_mensual, beneficios)')
      .eq('id', req.params.id)
      .eq('empresa_id', empresa.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Socio no encontrado' });
    const { data: puntos } = await supabase
      .from('socios_puntos').select('*').eq('socio_id', data.id).order('created_at', { ascending: false });
    return res.json({ socio: data, puntos: puntos || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/membresias/socios/:id', authenticate, requireTenantAdmin, requirePlanFeature('socios'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const campos = ['nombre', 'email', 'telefono', 'direccion', 'plan_id', 'fecha_vencimiento', 'estado', 'notas'];
    const update = { updated_at: new Date().toISOString() };
    campos.forEach(c => { if (req.body[c] !== undefined) update[c] = req.body[c]; });
    const { data, error } = await supabase.from('socios').update(update)
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
    if (error) return res.status(500).json({ error: error.message });
    const row = Array.isArray(data) ? data[0] : null;
    return res.json({ socio: row, success: true });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/membresias/socios/:id/puntos', authenticate, requirePlanFeature('puntos'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('socios_puntos')
      .select('*')
      .eq('socio_id', req.params.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ puntos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/membresias/socios/:id/puntos', authenticate, requirePlanFeature('puntos'), async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const tipo = (b.tipo || '').toString().trim();
    const cantidad = parseInt(b.cantidad, 10) || 0;
    if (!['acumular', 'canjear'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser acumular o canjear' });
    if (cantidad <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });

    const { data: socio, error: sErr } = await supabase
      .from('socios').select('id, puntos_acumulados').eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (sErr || !socio) return res.status(404).json({ error: 'Socio no encontrado' });

    const puntosActuales = Number(socio.puntos_acumulados) || 0;
    let nuevosPuntos = puntosActuales;
    if (tipo === 'acumular') {
      nuevosPuntos = puntosActuales + cantidad;
    } else {
      if (puntosActuales < cantidad) return res.status(400).json({ error: 'Puntos insuficientes. Disponibles: ' + puntosActuales });
      nuevosPuntos = puntosActuales - cantidad;
    }

    const { error: upErr } = await supabase.from('socios').update({
      puntos_acumulados: nuevosPuntos,
      updated_at: new Date().toISOString()
    }).eq('id', socio.id);
    if (upErr) return res.status(500).json({ error: upErr.message });

    const { data: puntosData, error: pErr } = await supabase.from('socios_puntos').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      socio_id: socio.id,
      tipo: tipo,
      cantidad: cantidad,
      puntos_anteriores: puntosActuales,
      puntos_nuevos: nuevosPuntos,
      referencia: (b.referencia || '').toString().slice(0, 200),
      notas: (b.notas || '').toString().slice(0, 300),
      usuario: req.user?.nombre || '',
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (pErr) return res.status(500).json({ error: pErr.message });

    return res.status(201).json({ movimiento: puntosData, puntos_anteriores: puntosActuales, puntos_nuevos: nuevosPuntos });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// TENANT FEATURES
// ═══════════════════════════════════════════════════════════════
app.get('/api/tenant/features', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase
      .from('tenant_features')
      .select('*')
      .eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ features: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/tenant/features', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const b = req.body || {};
    const feature_key = (b.feature_key || '').toString().trim();
    if (!feature_key) return res.status(400).json({ error: 'feature_key es requerido' });
    const enabled = b.enabled !== false;

    const { data: existing } = await supabase
      .from('tenant_features')
      .select('id')
      .eq('empresa_codigo', tenant)
      .eq('feature_key', feature_key)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase.from('tenant_features').update({
        enabled: enabled,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ feature: data, updated: true });
    } else {
      const { data, error } = await supabase.from('tenant_features').insert([{
        empresa_codigo: tenant,
        feature_key: feature_key,
        enabled: enabled,
        created_at: new Date().toISOString()
      }]).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ feature: data, updated: false });
    }
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// PORTAL EMPRESA — ENDPOINTS V2 (Bloques B–J)
// Cadena única: authenticate → authorize → tenant scope → plan → DB
// ═══════════════════════════════════════════════════════════════

// ── Registro de eventos de seguridad (best-effort, nunca bloquea) ──
async function registrarEventoSeguridad(empresaCodigo, evento, { usuarioId = null, usuarioEmail = '', severidad = 'info', req = null, descripcion = '', metadata = {} } = {}) {
  if (!supabase) return;
  const tenant = normalizeTenantCode(empresaCodigo || getTenantCode(req || { user: {} }));
  if (!tenant) return;
  try {
    const ipRaw = req && (req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress) || '';
    const ip = String(ipRaw).replace('::ffff:', '').slice(0, 60);
    await supabase.from('seguridad_eventos').insert({
      empresa_codigo: tenant,
      usuario_id: usuarioId || (req?.user?.sub || null),
      usuario_email: String(usuarioEmail || req?.user?.email || '').slice(0, 200),
      evento: String(evento).slice(0, 80),
      severidad,
      ip,
      dispositivo: obtenerDispositivo(req?.headers?.['user-agent']),
      descripcion: String(descripcion).slice(0, 1000),
      metadata
    });
  } catch (e) { console.warn('[SEC_EVENT] Non-critical:', e.message); }
}

// ── Sesiones: registrar sesión/dispositivo en login (best-effort) ──
async function registrarSesionTenant(empresaCodigo, usuarioId, req) {
  if (!supabase) return false;
  try {
    const ipRaw = req?.headers['x-forwarded-for']?.split(',')[0].trim() || req?.socket?.remoteAddress || '';
    const ip = String(ipRaw).replace('::ffff:', '').slice(0, 60);
    const dispositivo = obtenerDispositivo(req?.headers?.['user-agent']);
    const userAgent = String(req?.headers?.['user-agent'] || '').slice(0, 300);
    const { data: existente } = await supabase.from('tenant_sessions')
      .select('id').eq('usuario_id', usuarioId).eq('ip', ip).eq('dispositivo', dispositivo).eq('revocada', false).maybeSingle();
    if (existente) {
      await supabase.from('tenant_sessions').update({ ultimo_actividad: new Date().toISOString() }).eq('id', existente.id);
      return true;
    }
    let ubicacion = 'Desconocida';
    try { ubicacion = await obtenerUbicacion(ip); } catch (e) { /* noop */ }
    // Esquema productivo vigente: sin columna user_agent (drift detectado en
    // release audit). Insertar SIN la columna; reintentar con ella si la
    // migración llega a aplicarse — nunca dejar de registrar la sesión.
    let insErr = null;
    const r1 = await supabase.from('tenant_sessions').insert({
      usuario_id: usuarioId, empresa_codigo: normalizeTenantCode(empresaCodigo), ip, dispositivo, ubicacion
    });
    insErr = r1.error;
    if (insErr) {
      const r2 = await supabase.from('tenant_sessions').insert({
        usuario_id: usuarioId, empresa_codigo: normalizeTenantCode(empresaCodigo), ip, dispositivo, ubicacion, user_agent: userAgent
      });
      insErr = r2.error;
    }
    if (insErr) { console.warn('[SESSION_REG] Non-critical:', insErr.message); return false; }
    return true;
  } catch (e) { console.warn('[SESSION_REG] Non-critical:', e.message); return false; }
}

// ── GET /api/empresa/overview — datos reales para el dashboard empresa ──
app.get('/api/empresa/overview', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const mes = new Date().toISOString().slice(0, 7);
    const ent = req.entitlements || await getTenantEntitlements(req);

    const [tenRes, usrRes, facRes, recRes, ncRes, cliRes, prodRes, usageRes, aiRes, auditRes] = await Promise.all([
      supabase.from('tenants').select('*').eq('codigo', tenant).maybeSingle(),
      supabase.from('usuarios').select('id, nombre, apellido, email, rol, rol_global, activo, estado, ultimo_acceso, created_at').eq('empresa_codigo', tenant),
      supabase.from('facturas').select('id, total, estado, created_at').eq('empresa_codigo', tenant),
      supabase.from('recibos').select('id, total, created_at').eq('empresa_codigo', tenant),
      supabase.from('notas_credito').select('id, total, created_at').eq('empresa_codigo', tenant),
      supabase.from('clientes').select('id', { count: 'exact', head: true }).eq('empresa_codigo', tenant),
      supabase.from('productos').select('id', { count: 'exact', head: true }).eq('empresa_codigo', tenant),
      supabase.from('tenant_usage').select('recurso, cantidad').eq('empresa_codigo', tenant).eq('periodo', mes),
      supabase.from('ai_usage_log').select('tokens_total, success').eq('empresa_codigo', tenant),
      supabase.from('auditoria').select('accion, descripcion, tipo, usuario, created_at').eq('empresa_codigo', tenant).order('created_at', { ascending: false }).limit(12)
    ]);

    const usuarios = usrRes.data || [];
    const facturas = facRes.data || [];
    const uso = {};
    (usageRes.data || []).forEach(r => { uso[r.recurso] = (uso[r.recurso] || 0) + (Number(r.cantidad) || 0); });
    const aiRows = aiRes.data || [];
    const aiTokens = aiRows.reduce((s, r) => s + (Number(r.tokens_total) || 0), 0);
    const limiteTokens = ent.limits?.tokens || planLimitsFor(ent.plan).tokens;

    // Alertas derivadas de datos reales — nunca inventadas
    const alertas = [];
    if (ent.status === 'expired') alertas.push({ severidad: 'alta', titulo: 'Prueba vencida', detalle: 'La plataforma está en modo solo lectura. Renueva tu plan para seguir operando.' });
    else if (ent.trial?.endsAt) {
      const dias = Math.max(0, Math.ceil((new Date(ent.trial.endsAt) - Date.now()) / 86400000));
      if (dias <= 5) alertas.push({ severidad: dias <= 2 ? 'alta' : 'media', titulo: `Trial termina en ${dias} día(s)`, detalle: 'Elige un plan para conservar todas las funciones.' });
    }
    if (limiteTokens > 0 && aiTokens / limiteTokens >= 0.9) alertas.push({ severidad: 'alta', titulo: 'Consumo de IA próximo al límite', detalle: `${Math.round((aiTokens / limiteTokens) * 100)}% de los tokens del plan utilizados.` });
    const usuariosLimite = Number(ent.maxUsers) || 0;
    if (usuariosLimite > 0 && Number.isFinite(usuariosLimite) && usuarios.length / usuariosLimite >= 0.9) alertas.push({ severidad: 'media', titulo: 'Usuarios próximos al límite del plan', detalle: `${usuarios.length}/${usuariosLimite} usuarios.` });
    const facPendientes = facturas.filter(f => (f.estado || '') === 'pendiente').length;
    if (facPendientes > 0) alertas.push({ severidad: 'media', titulo: `${facPendientes} factura(s) pendiente(s)`, detalle: 'Revisa el módulo de Facturación.' });

    const limiteDocs = Number(ent.customLimits?.documents || 0);
    const docPct = limiteDocs > 0 ? Math.min(100, Math.round(((uso.documents || 0) / limiteDocs) * 100)) : 0;

    return res.json({
      empresa_codigo: tenant,
      empresa: { nombre: tenRes.data?.nombre_empresa || tenant, rtn: tenRes.data?.rtn || null, plan: ent.plan, estado: tenRes.data?.estado || 'activo' },
      plan: {
        clave: ent.plan, estado: ent.status,
        trial: ent.trial || null, trial_ends_at: ent.trial_ends_at || null,
        dias_trial_restantes: ent.trial?.endsAt ? Math.max(0, Math.ceil((new Date(ent.trial.endsAt) - Date.now()) / 86400000)) : null,
        max_users: ent.maxUsers, max_companies: ent.maxCompanies,
        features_count: (ent.features || []).length
      },
      kpis: {
        usuarios_total: usuarios.length,
        usuarios_activos: usuarios.filter(u => u.activo !== false).length,
        usuarios_limite: ent.maxUsers,
        usuarios_porcentaje: (usuariosLimite > 0 && Number.isFinite(usuariosLimite)) ? Math.round((usuarios.filter(u => u.activo !== false).length / usuariosLimite) * 100) : 0,
        facturas_total: facturas.length,
        facturas_monto: facturas.reduce((s, f) => s + (Number(f.total) || 0), 0),
        recibos_total: (recRes.data || []).length,
        notas_credito_total: (ncRes.data || []).length,
        clientes: cliRes.count || 0,
        productos: prodRes.count || 0,
        documentos_mes: uso.documents || 0,
        documentos_porcentaje: docPct,
        ia_tokens: aiTokens,
        ia_limite: limiteTokens,
        ia_porcentaje: limiteTokens > 0 ? Math.min(100, Math.round((aiTokens / limiteTokens) * 100)) : 0,
        ia_solicitudes: aiRows.length,
        api_requests: uso.api_requests || 0
      },
      usuarios_recientes: usuarios.slice(0, 5).map(u => ({ nombre: normalizeDisplayName(u.nombre, u.apellido), email: u.email, rol: u.rol || u.rol_global, activo: u.activo !== false, ultimo_acceso: u.ultimo_acceso, created_at: u.created_at })),
      actividad_reciente: (auditRes.data || []).map(a => ({ accion: a.accion, descripcion: a.descripcion, tipo: a.tipo, usuario: a.usuario, fecha: a.created_at })),
      alertas
    });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/entitlements — plan + features + límites (Plan Engine) ──
app.get('/api/empresa/entitlements', authenticate, async (req, res) => {
  try {
    const ent = await getTenantEntitlements(req);
    const tenant = normalizeTenantCode(getTenantCode(req));
    let sub = null;
    if (supabase && tenant) {
      try { const { data } = await supabase.from('subscriptions').select('*').eq('empresa_codigo', tenant).maybeSingle(); sub = data; } catch (e) { /* tabla opcional */ }
    }
    return res.json({
      plan: ent.plan,
      estado: ent.status,
      trial: ent.trial || null,
      trial_ends_at: ent.trial_ends_at || null,
      max_users: ent.maxUsers,
      max_companies: ent.maxCompanies,
      features: ent.features || [],
      custom_limits: ent.customLimits || {},
      limits: ent.limits || {},
      suscripcion: sub ? {
        estado: sub.estado,
        trial_started_at: sub.trial_started_at,
        trial_ends_at: sub.trial_ends_at,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: sub.cancel_at_period_end || false
      } : null
    });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/roles — matriz de roles del tenant (conteos reales) ──
app.get('/api/empresa/roles', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data: usuarios, error } = await supabase
      .from('usuarios').select('id, rol, rol_global, activo').eq('empresa_codigo', tenant);
    if (error) return res.status(500).json({ error: error.message });
    const roles = { owner: 0, admin: 0, miembro: 0, otros: 0 };
    (usuarios || []).forEach(u => {
      const r = String(u.rol || u.rol_global || '').toLowerCase();
      if (r === 'owner' || r === 'ceo') roles.owner++;
      else if (r === 'admin' || r === 'administrador') roles.admin++;
      else if (['miembro', 'member', 'user', 'operador'].includes(r)) roles.miembro++;
      else roles.otros++;
    });
    return res.json({
      roles,
      total: (usuarios || []).length,
      matriz: {
        owner: { gestionar_empresa: true, usuarios: true, roles: true, suscripcion: true, facturacion: true, api_keys: true, eliminar_usuarios: true },
        admin: { gestionar_empresa: true, usuarios: true, roles: false, suscripcion: false, facturacion: 'lectura', api_keys: true, eliminar_usuarios: false },
        member: { gestionar_empresa: false, usuarios: false, roles: false, suscripcion: false, facturacion: false, api_keys: false, eliminar_usuarios: false }
      }
    });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/modules — catálogo derivado de tenant → plan → entitlements ──
const MODULO_CATALOGO = Object.freeze({
  pos:             { nombre: 'POS',                     icono: 'fa-cash-register',       feature: 'pos' },
  inventario:      { nombre: 'Inventario',              icono: 'fa-boxes-stacked',       feature: 'inventario' },
  facturacion:     { nombre: 'Facturación',             icono: 'fa-file-invoice-dollar', feature: 'facturacion_sar' },
  contabilidad:    { nombre: 'Contabilidad',            icono: 'fa-calculator',          feature: 'operacion_completa' },
  crm:             { nombre: 'CRM',                     icono: 'fa-users',               feature: 'clientes' },
  rrhh:            { nombre: 'RRHH',                    icono: 'fa-id-badge',            feature: 'operacion_completa' },
  educacion:       { nombre: 'Educación',               icono: 'fa-graduation-cap',      feature: 'operacion_basica' },
  soporte:         { nombre: 'Soporte',                 icono: 'fa-headset',             feature: 'operacion_basica' },
  ia:              { nombre: 'Inteligencia Artificial', icono: 'fa-wand-magic-sparkles', feature: 'ia' },
  reportes:        { nombre: 'Reportes',                icono: 'fa-chart-bar',           feature: 'reportes' },
  sucursales:      { nombre: 'Sucursales',              icono: 'fa-store',               feature: 'sucursales' },
  rutas:           { nombre: 'Rutas y Cobros',          icono: 'fa-route',               feature: 'rutas' },
  automatizacion:  { nombre: 'Automatizaciones',        icono: 'fa-robot',               feature: 'automation' },
  api:             { nombre: 'API',                     icono: 'fa-plug',                feature: 'api_keys' },
  flota:           { nombre: 'Flota',                   icono: 'fa-truck',               feature: 'fleet' }
});

app.get('/api/empresa/modules', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const ent = await getTenantEntitlements(req);
    const features = ent.features || [];
    // Activación real por tenant (override en tenant_features)
    const { data: activadas } = await supabase.from('tenant_features')
      .select('feature_key, enabled').eq('empresa_codigo', tenant);
    const activadasMap = {};
    (activadas || []).forEach(f => { activadasMap[f.feature_key] = f.enabled !== false; });

    const modulos = Object.entries(MODULO_CATALOGO).map(([key, m]) => {
      const enPlan = features.includes(m.feature);
      const activada = activadasMap[key];
      let estado = 'activo';
      if (!enPlan) estado = 'requiere_upgrade';
      else if (activada === false) estado = 'bloqueado';
      else if (activada === undefined && key !== 'pos') estado = 'disponible';
      return {
        key,
        nombre: m.nombre,
        icono: m.icono,
        estado,
        en_plan: enPlan,
        feature: m.feature,
        limite: (ent.customLimits && ent.customLimits[key] !== undefined) ? ent.customLimits[key] : (key === 'sucursales' ? ent.maxCompanies : null)
      };
    });
    return res.json({ plan: ent.plan, estado: ent.status, modulos });
  } catch (err) { return handleServerError(res, err); }
});

// Activar/desactivar módulo del catálogo (persistido en tenant_features)
app.put('/api/empresa/modules/:key', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const key = String(req.params.key || '').trim();
    const meta = MODULO_CATALOGO[key];
    if (!meta) return res.status(404).json({ error: 'Módulo desconocido.' });
    const enabled = req.body?.enabled !== false;
    if (enabled) {
      const ent = await getTenantEntitlements(req);
      if (!(ent.features || []).includes(meta.feature)) {
        return res.status(403).json({ error: `El módulo ${meta.nombre} requiere un plan superior.`, code: 'PLAN_LIMIT' });
      }
    }
    const { data: existing } = await supabase.from('tenant_features')
      .select('id').eq('empresa_codigo', tenant).eq('feature_key', key).maybeSingle();
    if (existing) {
      await supabase.from('tenant_features').update({ enabled, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      await supabase.from('tenant_features').insert({ empresa_codigo: tenant, feature_key: key, enabled });
    }
    await registrarAuditoria(tenant, enabled ? 'Módulo activado' : 'Módulo desactivado', `${meta.nombre} (${key})`, 'configuracion', req.user?.email || '', req);
    return res.json({ success: true, key, enabled });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/billing/documents — historial fiscal real (Bloque F) ──
// Factura fiscal ≠ Recibo ≠ Nota de crédito: tipos separados, nunca mezclados.
app.get('/api/empresa/billing/documents', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    // Select resiliente por tabla: si el esquema productivo carece de alguna
    // columna (drift), se reintenta con un subconjunto base en vez de
    // devolver silenciosamente 0 documentos.
    async function selectDocs(table, columnasFull, columnasBase) {
      const build = (cols) => supabase.from(table).select(cols)
        .eq('empresa_codigo', tenant).order('created_at', { ascending: false }).limit(limit);
      let r = await build(columnasFull);
      if (r.error) r = await build(columnasBase);
      if (r.error) r = await build('id, total, created_at');
      return r;
    }
    const [fac, rec, nc] = await Promise.all([
      selectDocs('facturas', 'id, correlativo, cliente_nombre, total, isv, estado, tipo_documento, created_at', 'id, correlativo, cliente_nombre, total, estado, created_at'),
      selectDocs('recibos', 'id, correlativo, cliente_nombre, total, created_at', 'id, total, created_at'),
      selectDocs('notas_credito', 'id, correlativo, motivo, total, created_at', 'id, total, created_at')
    ]);
    const mapFactura = f => ({ tipo: 'factura', id: f.id, correlativo: f.correlativo || 's/n', contraparte: f.cliente_nombre || null, total: Number(f.total) || 0, isv: f.isv !== undefined && f.isv !== null ? Number(f.isv) : null, estado: f.estado || 'emitida', fecha: f.created_at });
    const mapRecibo = r => ({ tipo: 'recibo', id: r.id, correlativo: r.correlativo || 's/n', contraparte: r.cliente_nombre || null, total: Number(r.total) || 0, isv: null, estado: 'recibido', fecha: r.created_at });
    const mapNota = n => ({ tipo: 'nota_credito', id: n.id, correlativo: n.correlativo || 's/n', contraparte: n.motivo || null, total: Number(n.total) || 0, isv: null, estado: 'emitida', fecha: n.created_at });
    const documentos = [
      ...(fac.data || []).map(mapFactura),
      ...(rec.data || []).map(mapRecibo),
      ...(nc.data || []).map(mapNota)
    ].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    const partialErrors = [fac.error && `facturas: ${fac.error.message}`, rec.error && `recibos: ${rec.error.message}`, nc.error && `notas_credito: ${nc.error.message}`].filter(Boolean);
    return res.json({
      resumen: {
        facturas: { cantidad: (fac.data || []).length, monto: (fac.data || []).reduce((s, f) => s + (Number(f.total) || 0), 0) },
        recibos: { cantidad: (rec.data || []).length, monto: (rec.data || []).reduce((s, r) => s + (Number(r.total) || 0), 0) },
        notas_credito: { cantidad: (nc.data || []).length, monto: (nc.data || []).reduce((s, n) => s + (Number(n.total) || 0), 0) }
      },
      documentos,
      ...(partialErrors.length ? { partial_errors: partialErrors } : {})
    });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/security/events — eventos de seguridad (Bloque I) ──
app.get('/api/empresa/security/events', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { data, error } = await supabase.from('seguridad_eventos')
      .select('*').eq('empresa_codigo', tenant)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) {
      // Tabla aún no migrada: fallback a auditoría con tipos de seguridad.
      const { data: aud } = await supabase.from('auditoria')
        .select('id, accion, descripcion, tipo, usuario, ip, created_at')
        .eq('empresa_codigo', tenant).in('tipo', ['seguridad', 'usuarios'])
        .order('created_at', { ascending: false }).limit(limit);
      return res.json({
        eventos: (aud || []).map(a => ({ id: a.id, evento: a.accion, severidad: (String(a.accion || '').toLowerCase().includes('fallido') || String(a.accion || '').toLowerCase().includes('bloqueado')) ? 'warning' : 'info', usuario_email: a.usuario, ip: a.ip, dispositivo: null, descripcion: a.descripcion, created_at: a.created_at })),
        fallback: true
      });
    }
    return res.json({ eventos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/sessions — sesiones del tenant (Bloque I) ──
app.get('/api/empresa/sessions', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('tenant_sessions')
      .select('id, usuario_id, ip, dispositivo, ubicacion, ultimo_actividad, created_at, revocada')
      .eq('empresa_codigo', tenant)
      .order('ultimo_actividad', { ascending: false }).limit(100);
    if (error) {
      // Fallback: derivar de último_acceso real de usuarios (sin inventar datos).
      const { data: users } = await supabase.from('usuarios')
        .select('id, nombre, apellido, email, ultimo_acceso').eq('empresa_codigo', tenant);
      return res.json({
        sesiones: (users || []).filter(u => u.ultimo_acceso).slice(0, 50).map(u => ({
          id: u.id, usuario: normalizeDisplayName(u.nombre, u.apellido), email: u.email,
          ip: null, dispositivo: 'No registrado', ubicacion: null,
          ultimo_actividad: u.ultimo_acceso, revocada: false, fallback: true
        })),
        fallback: true
      });
    }
    const userIds = [...new Set((data || []).map(s => s.usuario_id).filter(Boolean))];
    const { data: users } = userIds.length
      ? await supabase.from('usuarios').select('id, nombre, apellido, email').in('id', userIds)
      : { data: [] };
    const umap = {};
    (users || []).forEach(u => { umap[u.id] = { nombre: normalizeDisplayName(u.nombre, u.apellido), email: u.email }; });
    const sesiones = (data || []).map(s => ({
      id: s.id, usuario_id: s.usuario_id, usuario: umap[s.usuario_id]?.nombre || '—', email: umap[s.usuario_id]?.email || '—',
      ip: s.ip, dispositivo: s.dispositivo, ubicacion: s.ubicacion,
      ultimo_actividad: s.ultimo_actividad, revocada: !!s.revocada
    }));
    return res.json({ sesiones, fallback: false });
  } catch (err) { return handleServerError(res, err); }
});

// Revocar una sesión concreta (sesión propia siempre permitida)
app.delete('/api/empresa/sessions/:id', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: sesion } = await supabase.from('tenant_sessions')
      .select('id, usuario_id, empresa_codigo').eq('id', req.params.id).maybeSingle();
    if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada.' });
    const esPropia = String(sesion.usuario_id) === String(req.user.sub);
    if (!esPropia) {
      if (!assertTenantAccess(req, sesion.empresa_codigo) || !isTrueOwner(req)) {
        return res.status(403).json({ error: 'Solo el Owner puede revocar sesiones de otros usuarios.' });
      }
    }
    const { error } = await supabase.from('tenant_sessions').update({ revocada: true }).eq('id', sesion.id);
    if (error) return res.status(500).json({ error: error.message });
    await registrarEventoSeguridad(sesion.empresa_codigo, 'session_revoked', { usuarioId: sesion.usuario_id, req, severidad: 'warning', descripcion: 'Sesión revocada por administrador' });
    return res.json({ success: true });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/activity — actividad operacional (Bloque J) ──
app.get('/api/empresa/activity', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const { data, error } = await supabase.from('auditoria')
      .select('id, accion, descripcion, tipo, usuario, created_at')
      .eq('empresa_codigo', tenant)
      .in('tipo', ['facturacion', 'fleet', 'pos', 'compras', 'inventario', 'sistema', 'automatizacion'])
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ eventos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/profile — fila completa del tenant (info legal/config) ──
app.get('/api/empresa/profile', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('tenants').select('*').eq('codigo', tenant).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Empresa no encontrada.' });
    return res.json({
      empresa: {
        codigo: data.codigo,
        nombre_empresa: data.nombre_empresa || '',
        dominio: data.dominio || '',
        rtn: data.rtn || '',
        telefono: data.telefono || '',
        direccion: data.direccion || '',
        email: data.email || '',
        email_facturacion: data.email_facturacion || '',
        pais: data.pais || '',
        zona_horaria: data.zona_horaria || '',
        moneda: data.moneda || 'HNL',
        formato_fecha: data.formato_fecha || 'DD/MM/YYYY',
        idioma: data.idioma || 'es',
        area: data.area || '',
        tamano: data.tamano || '',
        logo_url: data.logo_url || null,
        plan: data.plan || 'starter',
        estado: data.estado || 'activo',
        created_at: data.created_at
      }
    });
  } catch (err) { return handleServerError(res, err); }
});

// ── PUT /api/empresa/profile — el Owner/Admin actualiza la configuración de SU empresa ──
// El frontend (empresa/configuracion.html) enviaba PUT a /api/tenants/:id (404 del
// verbo). Este endpoint aplica el scope del JWT y delega a la MISMA lógica de
// PUT /api/tenants/:id mediante redirección interna 307 (preserva método, body
// y headers; el id SIEMPRE sale del JWT, no del cliente).
app.put('/api/empresa/profile', authenticate, requireTenantAdmin, (req, res) => {
  const targetId = encodeURIComponent(normalizeTenantCode(getTenantCode(req)));
  req.url = `/api/tenants/${targetId}`;
  return app._router.handle(req, res, () => {});
});

// ── GET /api/auditoria/tenant — log administrativo del propio tenant ──
// (El /api/auditoria global es ROOT-only; este es el equivalente scoped.)
app.get('/api/auditoria/tenant', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const { data, error } = await supabase.from('auditoria')
      .select('id, accion, descripcion, tipo, usuario, ip, created_at')
      .eq('empresa_codigo', tenant)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ eventos: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ── GET /api/empresa/support/tickets — tickets reales del tenant ──
app.get('/api/empresa/support/tickets', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('support_tickets')
      .select('id, nombre, email, empresa, categoria, prioridad, estado, asunto, mensaje, created_at')
      .eq('empresa', tenant)
      .order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ tickets: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ── Integraciones: catálogo + estado por tenant (Bloque K) ──
// El catálogo es metadata de la plataforma; el estado por tenant vive en
// tenant_integrations (migración). Sin credenciales de terceros aquí: las
// conexiones reales se completan cuando exista el secreto correspondiente.
const INTEGRACION_CATALOGO = Object.freeze({
  whatsapp:  { nombre: 'WhatsApp Business',    descripcion: 'Notificaciones de pedidos y estados por WhatsApp.', icono: 'fa-brands fa-whatsapp',   categoria: 'mensajeria' },
  telegram:  { nombre: 'Telegram',             descripcion: 'Alertas operativas a canales de Telegram.',         icono: 'fa-brands fa-telegram',   categoria: 'mensajeria' },
  correo:    { nombre: 'Correo (SMTP)',        descripcion: 'Envío de facturas y notificaciones por correo.',    icono: 'fa-solid fa-envelope',    categoria: 'mensajeria' },
  stripe:    { nombre: 'Stripe',               descripcion: 'Cobros con tarjeta para la tienda en línea.',       icono: 'fa-brands fa-stripe-s',   categoria: 'pagos' },
  mercadopago:{ nombre: 'Mercado Pago',        descripcion: 'Pagos con tarjeta y transferencias (LATAM).',       icono: 'fa-solid fa-money-bill-transfer', categoria: 'pagos' },
  googlecal: { nombre: 'Google Calendar',      descripcion: 'Sincronización de citas y reservas.',               icono: 'fa-brands fa-google',     categoria: 'productividad' },
  sheets:    { nombre: 'Google Sheets',        descripcion: 'Exportación automática de reportes a hojas de cálculo.', icono: 'fa-solid fa-table',   categoria: 'productividad' }
});

app.get('/api/empresa/integrations', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data, error } = await supabase.from('tenant_integrations')
      .select('integration_key, enabled, connected_at').eq('empresa_codigo', tenant);
    const estado = {};
    if (!error) (data || []).forEach(r => { estado[r.integration_key] = { enabled: r.enabled !== false, connected_at: r.connected_at }; });
    const integraciones = Object.entries(INTEGRACION_CATALOGO).map(([key, m]) => ({
      key, ...m,
      enabled: estado[key] ? estado[key].enabled : false,
      connected_at: estado[key] ? estado[key].connected_at : null
    }));
    return res.json({ integraciones });
  } catch (err) { return handleServerError(res, err); }
});

// Conectar/desconectar una integración (auditable; la config real de
// credenciales por proveedor llegará cuando existan los secretos).
app.put('/api/empresa/integrations/:key', authenticate, requireTenantAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const key = String(req.params.key || '').trim();
    const meta = INTEGRACION_CATALOGO[key];
    if (!meta) return res.status(404).json({ error: 'Integración desconocida.' });
    const enabled = req.body?.enabled !== false;
    const ahora = new Date().toISOString();
    const { error } = await supabase.from('tenant_integrations').upsert({
      empresa_codigo: tenant,
      integration_key: key,
      enabled,
      connected_by: req.user?.sub || null,
      connected_at: enabled ? ahora : null,
      updated_at: ahora
    }, { onConflict: 'empresa_codigo,integration_key' });
    if (error) {
      // Tabla aún no migrada: mensaje accionable en vez de 500 genérico.
      if (/could not find the table/i.test(error.message || '')) {
        return res.status(503).json({ error: 'Las integraciones requieren aplicar la migración migracion_portales_v2.sql (tabla tenant_integrations).', code: 'MIGRATION_PENDING' });
      }
      return res.status(500).json({ error: error.message });
    }
    await registrarAuditoria(tenant, enabled ? 'Integración conectada' : 'Integración desconectada', meta.nombre, 'configuracion', req.user?.email || '', req);
    await registrarEventoSeguridad(tenant, enabled ? 'integration_connected' : 'integration_disconnected', { req, severidad: 'warning', descripcion: meta.nombre });
    return res.json({ success: true, key, enabled });
  } catch (err) { return handleServerError(res, err); }
});

// COMPAT APP (Workspace) — transacciones, cotizaciones, órdenes de compra,
// notas y sincronización. La app (Flutter) usa estos mismos endpoints.
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/transacciones', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('transacciones').select('*').eq('empresa_id', empresa.id);
    if (req.query.tipo) query = query.eq('tipo', req.query.tipo);
    if (req.query.categoria) query = query.eq('categoria', req.query.categoria);
    if (req.query.fecha_desde) query = query.gte('fecha', req.query.fecha_desde);
    if (req.query.fecha_hasta) query = query.lte('fecha', req.query.fecha_hasta);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('fecha', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ transacciones: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/transacciones', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const t = req.body?.transaccion || req.body || {};
    if (!t.tipo) return res.status(400).json({ error: 'tipo es requerido' });
    const { data, error } = await supabase.from('transacciones').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      tipo: t.tipo.toString().slice(0, 30),
      categoria: (t.categoria || '').toString().slice(0, 100),
      descripcion: (t.descripcion || '').toString().slice(0, 1000),
      monto: parseFloat(t.monto) || 0,
      metodo_pago: t.metodo_pago ? String(t.metodo_pago).slice(0, 50) : null,
      referencia: (t.referencia || '').toString().slice(0, 200),
      fecha: t.fecha || new Date().toISOString(),
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Transacción registrada', `Transacción "${t.tipo}" por ${t.monto}`, 'contabilidad', req.user?.nombre || '', req);
    return res.status(201).json({ transaccion: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/cotizaciones', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('cotizaciones').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ cotizaciones: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/cotizaciones', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const c = req.body?.cotizacion || req.body || {};
    if (!c.cliente_nombre) return res.status(400).json({ error: 'cliente_nombre es requerido' });
    const subtotal = parseFloat(c.subtotal) || 0;
    const isv = parseFloat(c.isv) || 0;
    const descuento = parseFloat(c.descuento) || 0;
    const total = parseFloat(c.total) || (subtotal + isv - descuento);
    const { data, error } = await supabase.from('cotizaciones').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      usuario_id: req.user?.sub || null,
      correlativo: (c.correlativo || '').toString().slice(0, 50),
      cliente_nombre: c.cliente_nombre.toString().slice(0, 200),
      cliente_rtn: (c.cliente_rtn || '').toString().slice(0, 20),
      items: c.items || [],
      subtotal, isv, descuento, total,
      estado: (c.estado || 'activa').toString().slice(0, 20),
      notas: (c.notas || '').toString().slice(0, 500),
      sucursal_id: c.sucursal_id || null,
      creado_por: (c.creado_por || req.user?.nombre || '').toString().slice(0, 200),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Cotización creada', `Cotización para ${c.cliente_nombre}`, 'comercial', req.user?.nombre || '', req);
    return res.status(201).json({ cotizacion: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/ordenes-compra', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('ordenes_compra').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ordenes: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/ordenes-compra', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const o = req.body?.ordenCompra || req.body?.orden_compra || req.body || {};
    if (!o.proveedor_nombre) return res.status(400).json({ error: 'proveedor_nombre es requerido' });
    const subtotal = parseFloat(o.subtotal) || 0;
    const isv = parseFloat(o.isv) || 0;
    const descuento = parseFloat(o.descuento) || 0;
    const total = parseFloat(o.total) || (subtotal + isv - descuento);
    const { data, error } = await supabase.from('ordenes_compra').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      usuario_id: req.user?.sub || null,
      correlativo: (o.correlativo || '').toString().slice(0, 50),
      proveedor_nombre: o.proveedor_nombre.toString().slice(0, 200),
      proveedor_rtn: (o.proveedor_rtn || '').toString().slice(0, 20),
      items: o.items || [],
      subtotal, isv, descuento, total,
      estado: (o.estado || 'pendiente').toString().slice(0, 20),
      notas: (o.notas || '').toString().slice(0, 500),
      bodega_id: o.bodega_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria(tenant, 'Orden de compra creada', `Orden a ${o.proveedor_nombre}`, 'compras', req.user?.nombre || '', req);
    return res.status(201).json({ orden_compra: data });
  } catch (err) { return handleServerError(res, err); }
});

app.get('/api/notas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    let query = supabase.from('notas').select('*').eq('empresa_codigo', tenant);
    if (req.query.clave) query = query.eq('clave', req.query.clave);
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ notas: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

app.post('/api/notas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const clave = (b.clave || '').toString().trim().slice(0, 200);
    if (!clave) return res.status(400).json({ error: 'clave es requerido' });
    const datos = b.datos !== undefined ? b.datos : {};
    const { data: existing } = await supabase
      .from('notas').select('id')
      .eq('empresa_codigo', tenant)
      .eq('clave', clave)
      .maybeSingle();
    let result;
    if (existing) {
      const { data, error } = await supabase.from('notas').update({
        datos,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    } else {
      const { data, error } = await supabase.from('notas').insert([{
        empresa_id: empresa.id,
        empresa_codigo: tenant,
        clave,
        datos,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]).select().maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      result = data;
    }
    return res.json({ nota: result });
  } catch (err) { return handleServerError(res, err); }
});

const SYNC_SAFE_COLUMNS = Object.freeze({
  transacciones: ['id', 'empresa_id', 'empresa_codigo', 'tipo', 'categoria', 'descripcion', 'monto', 'metodo_pago', 'referencia', 'fecha', 'created_at', 'updated_at', 'metadata', 'sucursal_id'],
  productos: ['id', 'empresa_id', 'empresa_codigo', 'codigo', 'nombre', 'descripcion', 'categoria', 'unidad_medida', 'imagen_url', 'precio_compra', 'precio_venta', 'stock_actual', 'stock_minimo', 'isv_rate', 'exento', 'bodega', 'activo', 'created_at', 'updated_at'],
  clientes: ['id', 'empresa_id', 'empresa_codigo', 'nombre', 'rtn', 'email', 'telefono', 'direccion', 'limite_credito', 'saldo_pendiente', 'notas', 'activo', 'created_at', 'updated_at'],
  facturas: ['id', 'empresa_id', 'empresa_codigo', 'usuario_id', 'correlativo', 'cliente_nombre', 'cliente_rtn', 'cliente_email', 'subtotal', 'isv', 'descuento', 'total', 'estado', 'tipo_documento', 'metodo_pago', 'notas', 'created_at', 'updated_at'],
  cotizaciones: ['id', 'empresa_id', 'empresa_codigo', 'usuario_id', 'correlativo', 'cliente_nombre', 'cliente_rtn', 'items', 'subtotal', 'isv', 'descuento', 'total', 'estado', 'notas', 'sucursal_id', 'creado_por', 'created_at', 'updated_at'],
  ordenes_compra: ['id', 'empresa_id', 'empresa_codigo', 'usuario_id', 'correlativo', 'proveedor_nombre', 'proveedor_rtn', 'items', 'subtotal', 'isv', 'descuento', 'total', 'estado', 'notas', 'bodega_id', 'created_at', 'updated_at'],
  notas: ['id', 'empresa_id', 'empresa_codigo', 'clave', 'datos', 'created_at', 'updated_at']
});

app.post('/api/sync', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const b = req.body || {};
    const tabla = (b.tabla || '').toString().trim();
    const columns = SYNC_SAFE_COLUMNS[tabla];
    if (!columns) return res.status(400).json({ error: `Tabla de sincronización no soportada: ${tabla}` });
    const rows = Array.isArray(b.rows) ? b.rows : (b.row ? [b.row] : []);
    if (!rows.length) return res.status(400).json({ error: 'rows es requerido' });
    const ahora = new Date().toISOString();
    const clean = rows.map(row => {
      const out = { empresa_id: empresa.id, empresa_codigo: tenant };
      columns.forEach(col => {
        if (row && row[col] !== undefined && row[col] !== null) {
          if (col === 'monto' || col === 'subtotal' || col === 'isv' || col === 'descuento' || col === 'total' || col === 'precio_compra' || col === 'precio_venta' || col === 'costo_promedio' || col === 'stock_actual' || col === 'stock_minimo' || col === 'limite_credito' || col === 'saldo_pendiente') {
            out[col] = parseFloat(row[col]) || 0;
          } else if (col === 'activo') {
            out[col] = row[col] === true || row[col] === 'true' || row[col] === 1 || row[col] === '1';
          } else {
            out[col] = row[col];
          }
        }
      });
      return out;
    });
    const { data, error } = await supabase.from(tabla).upsert(clean, { onConflict: 'id' });
    if (error) return res.status(500).json({ error: error.message, tabla });
    const op = (b.operacion || 'upsert').toString().slice(0, 20);
    await registrarAuditoria(tenant, 'Sincronización', `${op} de ${clean.length} fila(s) en ${tabla}`, 'sistema', req.user?.nombre || '', req);
    return res.json({ sincronizadas: clean.length, tabla, data: data || [] });
  } catch (err) { return handleServerError(res, err); }
});

// ═══════════════════════════════════════════════════════════════
// PORTAL PILOT — PLAN ENGINE & USAGE METERING (Bloque 1)
// ═══════════════════════════════════════════════════════════════

// Registro de consumo acumulado en tenant_usage (periodo mensual YYYY-MM).
// Recurso válido: ai_tokens, api_requests, storage, users, documents, automations.
async function registrarUsoTenant(empresaCodigo, recurso, cantidad = 1, periodo = null) {
  if (!supabase) return;
  const tenant = normalizeTenantCode(empresaCodigo || '');
  if (!tenant) return;
  const recursoKey = String(recurso || '').trim().toLowerCase().slice(0, 50);
  if (!recursoKey) return;
  const mes = periodo || new Date().toISOString().slice(0, 7);
  const delta = Math.max(0, Number(cantidad) || 0);
  try {
    const { error: rpcErr } = await supabase.rpc('incrementar_tenant_uso', {
      p_empresa_codigo: tenant, p_recurso: recursoKey, p_periodo: mes, p_cantidad: delta
    });
    if (!rpcErr) return;
    const { data: rows } = await supabase
      .from('tenant_usage')
      .select('cantidad')
      .eq('empresa_codigo', tenant)
      .eq('recurso', recursoKey)
      .eq('periodo', mes)
      .maybeSingle();
    const actual = (rows && Number(rows.cantidad)) || 0;
    await supabase
      .from('tenant_usage')
      .upsert({
        empresa_codigo: tenant,
        recurso: recursoKey,
        periodo: mes,
        cantidad: actual + delta,
        updated_at: new Date().toISOString()
      }, { onConflict: 'empresa_codigo,recurso,periodo' });
  } catch (err) {
    console.warn('[USAGE] No se pudo registrar consumo:', err.message);
  }
}

// ── Estado de autenticación seguro (sin enumeración de correos) ──
app.get('/api/auth/status', authenticate, async (req, res) => {
  try {
    const user = req.user || {};
    const isRoot = isRootUser(req);
    const rol = String(user.rol || '').trim().toLowerCase();
    const tenant = normalizeTenantCode(user.empresa_codigo);
    const area = isRoot ? 'pp' : (['owner', 'administrador', 'admin'].includes(rol) ? 'empresa' : 'workspace');
    let plan = null;
    if (tenant && supabase) {
      const { data: ten } = await supabase.from('tenants').select('plan, estado, created_at').eq('codigo', tenant).maybeSingle();
      if (ten) plan = normalizePlan(ten.plan);
    }
    return res.json({
      authenticated: true,
      sub: user.sub || null,
      email: user.email || null,
      nombre: user.nombre || null,
      rol,
      area,
      empresa_codigo: tenant || null,
      plan,
      config: { area }
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Uso del tenant actual (por periodo YYYY-MM) ─────────────────
app.get('/api/tenant/usage', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const mes = String(req.query?.periodo || '').trim() || new Date().toISOString().slice(0, 7);
    const { data, error } = await supabase
      .from('tenant_usage')
      .select('recurso, cantidad, periodo')
      .eq('empresa_codigo', tenant)
      .eq('periodo', mes);
    if (error) return res.status(500).json({ error: error.message });

    const porRecurso = {};
    for (const row of (data || [])) {
      porRecurso[row.recurso] = (porRecurso[row.recurso] || 0) + (Number(row.cantidad) || 0);
    }

    const { data: ten } = await supabase.from('tenants').select('plan').eq('codigo', tenant).maybeSingle();
    const plan = normalizePlan(ten?.plan);
    const limites = planLimitsFor(plan);

    return res.json({
      empresa_codigo: tenant,
      periodo: mes,
      plan,
      uso: porRecurso,
      limites: {
        ai_tokens: limites.tokens,
        storage: limites.storage,
        users: limites.usuarios,
        automations: limites.bots,
        api_requests: null,
        documents: null
      }
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Registro de consumo (llamado por interno/metering) ──────────
app.post('/api/tenant/usage', authenticate, async (req, res) => {
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const { recurso, cantidad = 1, periodo } = req.body || {};
    const permitidos = ['ai_tokens', 'api_requests', 'storage', 'users', 'documents', 'automations'];
    const recursoKey = String(recurso || '').trim().toLowerCase();
    if (!permitidos.includes(recursoKey)) {
      return res.status(400).json({ error: `Recurso inválido. Permitidos: ${permitidos.join(', ')}` });
    }
    const delta = Math.max(0, Number(cantidad) || 0);
    await registrarUsoTenant(tenant, recursoKey, delta, periodo);
    return res.json({ success: true, empresa_codigo: tenant, recurso: recursoKey, cantidad: delta });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Uso global agregado (solo ROOT, cross-tenant) ───────────────
app.get('/api/usage', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const mes = String(req.query?.periodo || '').trim() || new Date().toISOString().slice(0, 7);
    let q = supabase.from('tenant_usage').select('empresa_codigo, recurso, cantidad');
    if (mes) q = q.eq('periodo', mes);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const global = {};
    const porTenant = {};
    for (const row of (data || [])) {
      global[row.recurso] = (global[row.recurso] || 0) + (Number(row.cantidad) || 0);
      porTenant[row.empresa_codigo] = porTenant[row.empresa_codigo] || {};
      porTenant[row.empresa_codigo][row.recurso] = (porTenant[row.empresa_codigo][row.recurso] || 0) + (Number(row.cantidad) || 0);
    }
    return res.json({ periodo: mes, global, porTenant });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Uso de IA agregado por tenant (solo ROOT) ───────────────────
app.get('/api/ai/usage', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    // ROOT: visión global. Owner/Admin: únicamente su tenant (scope del JWT).
    const scopeAll = isRootUser(req);
    let qU = supabase.from('ai_usage_log')
      .select('empresa_codigo, tokens_total, provider, success, created_at');
    if (!scopeAll) qU = qU.eq('empresa_codigo', normalizeTenantCode(getTenantCode(req)));
    const { data, error } = await qU;
    if (error) return res.status(500).json({ error: error.message });
    const porTenant = {};
    let totalTokens = 0, totalSolicitudes = 0, totalExitosas = 0, totalFallidas = 0;
    for (const row of (data || [])) {
      const t = normalizeTenantCode(row.empresa_codigo);
      porTenant[t] = porTenant[t] || { tokens: 0, solicitudes: 0, exitosas: 0, fallidas: 0 };
      const tokens = Number(row.tokens_total) || 0;
      porTenant[t].tokens += tokens;
      porTenant[t].solicitudes += 1;
      if (row.success) porTenant[t].exitosas += 1; else porTenant[t].fallidas += 1;
      totalTokens += tokens;
      totalSolicitudes += 1;
      if (row.success) totalExitosas += 1; else totalFallidas += 1;
    }
    return res.json({ porTenant, totalTokens, totalSolicitudes, totalExitosas, totalFallidas });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Costos estimados de IA por tenant (solo ROOT) ───────────────
app.get('/api/ai/costs', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    // ROOT: visión global. Owner/Admin: únicamente su tenant (scope del JWT).
    const scopeAllC = isRootUser(req);
    let qC = supabase.from('ai_usage_log').select('empresa_codigo, cost_estimated');
    if (!scopeAllC) qC = qC.eq('empresa_codigo', normalizeTenantCode(getTenantCode(req)));
    const { data, error } = await qC;
    if (error) return res.status(500).json({ error: error.message });
    const porTenant = {};
    let totalCost = 0;
    for (const row of (data || [])) {
      const t = normalizeTenantCode(row.empresa_codigo);
      const c = Number(row.cost_estimated) || 0;
      porTenant[t] = (porTenant[t] || 0) + c;
      totalCost += c;
    }
    return res.json({ totalCost, porTenant });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Proveedores de IA configurados (solo ROOT, nunca expone claves) ──
app.get('/api/ai/providers', authenticate, requireRoot, async (req, res) => {
  const providers = {};
  for (const key of Object.keys(AI_PROVIDERS)) {
    const p = AI_PROVIDERS[key];
    providers[key] = {
      name: p.name,
      configurado: !!p.getKey(),
      models: p.models
    };
  }
  return res.json({ providers });
});

// ── Límites de tokens IA del tenant según su plan ───────────────
app.get('/api/ai/limits', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const { data: ten } = await supabase.from('tenants').select('plan').eq('codigo', tenant).maybeSingle();
    const plan = normalizePlan(ten?.plan);
    const limites = planLimitsFor(plan);
    const { data } = await supabase
      .from('ai_usage_log')
      .select('tokens_total')
      .eq('empresa_codigo', tenant);
    const usados = (data || []).reduce((s, r) => s + (Number(r.tokens_total) || 0), 0);
    return res.json({
      plan,
      limites: limites.tokens,
      usados,
      restantes: Math.max(0, limites.tokens - usados),
      porcentaje: limites.tokens > 0 ? Math.min(100, Math.round((usados / limites.tokens) * 100)) : 0
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Suscripción del tenant actual ───────────────────────────────
app.get('/api/tenant/subscription', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    if (!tenant) return res.status(400).json({ error: 'Empresa no identificada en la sesión' });
    const { data: ten } = await supabase
      .from('tenants')
      .select('plan, estado, created_at')
      .eq('codigo', tenant)
      .maybeSingle();
    if (!ten) return res.status(404).json({ error: 'Empresa no encontrada' });
    const plan = normalizePlan(ten.plan);
    const limites = planLimitsFor(plan);
    const dias = ten.created_at ? Math.floor((Date.now() - new Date(ten.created_at).getTime()) / 86400000) : 0;
    // State machine formal (Blueprint §14): la fila en `subscriptions` es la
    // fuente del ciclo de vida; tenants.estado queda como vista derivada.
    let sub = null;
    try {
      const { data: s } = await supabase.from('subscriptions').select('*').eq('empresa_codigo', tenant).maybeSingle();
      sub = s;
    } catch (e) { /* tabla opcional */ }
    const trialEnds = sub?.trial_ends_at
      || ((plan === 'starter' && ten.created_at) ? new Date(new Date(ten.created_at).getTime() + 15 * 86400000).toISOString() : null);
    const trialVigente = plan === 'starter' && trialEnds ? Date.now() <= new Date(trialEnds).getTime() : false;
    return res.json({
      empresa_codigo: tenant,
      plan,
      estado: sub?.estado || normalizeStatus(ten.estado || 'active'),
      suscripcion: {
        estado: sub?.estado || null,
        trial_started_at: sub?.trial_started_at || null,
        trial_ends_at: sub?.trial_ends_at || null,
        current_period_start: sub?.current_period_start || null,
        current_period_end: sub?.current_period_end || null,
        cancel_at_period_end: sub?.cancel_at_period_end || false,
        proveedor_pago: sub?.proveedor_pago || null
      },
      creada_el: ten.created_at,
      dias_desde_creacion: dias,
      trial_activo: trialVigente,
      trial_ends_at: trialEnds,
      limites
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Catálogo de planes (público; DB primero, fallback constantes) ──
// Moneda operativa: HNL. /api/plans expone el catálogo de referencia (USD) + los montos
// efectivos de facturación local (HNL). El cobro real lo hace amountMap del checkout.
const HNL_MONTHLY = { starter: 0, business: 1499, enterprise: 4999, custom: null };
function toPlanPricing(p) {
  const cl = String(p?.clave || '').toLowerCase();
  const mes = Object.prototype.hasOwnProperty.call(HNL_MONTHLY, cl) ? HNL_MONTHLY[cl] : null;
  return { ...p, moneda: 'HNL', precio_mensual_hnl: mes, precio_anual_hnl: null };
}
app.get('/api/plans', async (req, res) => {
  if (!requireSupabase(res)) return res.json({ plans: PLAN_LIMITS });
  try {
    const { data, error } = await supabase.from('planes').select('*').order('orden', { ascending: true });
    if (!error && data && data.length) return res.json({ moneda: 'HNL', plans: data.map(toPlanPricing) });
    return res.json({ plans: PLAN_LIMITS });
  } catch (err) {
    return res.json({ plans: PLAN_LIMITS });
  }
});

// ── Features y límites de un plan (solo ROOT: lectura + edición como datos) ──
app.get('/api/plans/:id/features', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: planRow } = await supabase.from('planes').select('*').eq('clave', req.params.id).maybeSingle();
    if (!planRow) return res.status(404).json({ error: 'Plan no encontrado' });
    const [{ data: feats }, { data: limits }] = await Promise.all([
      supabase.from('plan_features').select('feature').eq('plan_id', planRow.id),
      supabase.from('plan_limits').select('recurso, maximo, unidad').eq('plan_id', planRow.id)
    ]);
    return res.json({
      plan: planRow,
      features: (feats || []).map(f => f.feature),
      limits: (limits || []).map(l => ({ recurso: l.recurso, maximo: Number(l.maximo), unidad: l.unidad }))
    });
  } catch (err) { return handleServerError(res, err); }
});

app.put('/api/plans/:id/features', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { features } = req.body || {};
    if (!Array.isArray(features)) return res.status(400).json({ error: 'features debe ser un arreglo' });
    const { data: planRow } = await supabase.from('planes').select('id').eq('clave', req.params.id).maybeSingle();
    if (!planRow) return res.status(404).json({ error: 'Plan no encontrado' });
    const clean = [...new Set(features.map(f => String(f).trim()).filter(Boolean))];
    await supabase.from('plan_features').delete().eq('plan_id', planRow.id);
    if (clean.length) {
      await supabase.from('plan_features').insert(clean.map(f => ({ plan_id: planRow.id, feature: f })));
    }
    await registrarAuditoria('ROOT', 'plan_features_actualizado', `Features del plan ${req.params.id} actualizados (${clean.length})`, 'configuracion', req.user?.email || '', req);
    return res.json({ success: true, plan: req.params.id, features: clean });
  } catch (err) { return handleServerError(res, err); }
});

// ── Analytics global (solo ROOT) ────────────────────────────────
app.get('/api/analytics', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const [ten, usr, fac, tok] = await Promise.all([
      supabase.from('tenants').select('id', { count: 'exact', head: true }),
      supabase.from('usuarios').select('id', { count: 'exact', head: true }),
      supabase.from('facturas').select('id', { count: 'exact', head: true }),
      supabase.from('ai_usage_log').select('tokens_total')
    ]);
    const tokens = (tok.data || []).reduce((s, r) => s + (Number(r.tokens_total) || 0), 0);
    return res.json({
      tenants: ten.count || 0,
      usuarios: usr.count || 0,
      facturas: fac.count || 0,
      tokensIA: tokens
    });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Auditoría global (solo ROOT, cross-tenant) ──────────────────
app.get('/api/auditoria', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    let q = supabase
      .from('auditoria')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(req.query?.limit) || 100);
    if (req.query?.empresa) q = q.eq('empresa_codigo', normalizeTenantCode(String(req.query.empresa).trim()));
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ eventos: data || [] });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// ── Bots/RPA por empresa (solo ROOT, cross-tenant) ──────────────
app.get('/api/bots', authenticate, requireRoot, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from('automatizaciones')
      .select('empresa_codigo, estado, activo')
      .limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    const porEmpresa = {};
    for (const b of (data || [])) {
      const t = normalizeTenantCode(b.empresa_codigo);
      porEmpresa[t] = porEmpresa[t] || { total: 0, activos: 0 };
      porEmpresa[t].total += 1;
      if (['activo', 'active'].includes(String(b.estado || b.activo || '').toLowerCase())) porEmpresa[t].activos += 1;
    }
    return res.json({ porEmpresa });
  } catch (err) {
    return handleServerError(res, err);
  }
});

// 🔧 FIX VERCEL: Exportación limpia para serverless
let server;
if (!IS_SERVERLESS) {
  server = app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] SIGINT recibido');
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] Servidor cerrado');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.log('\n[SHUTDOWN] SIGTERM recibido');
  if (server) {
    server.close(() => {
      console.log('[SHUTDOWN] Servidor cerrado');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

module.exports = app;
