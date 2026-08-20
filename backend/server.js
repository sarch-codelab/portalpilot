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

const { supabase, requireSupabase } = require('./supabaseClient');
console.log(`[STARTUP] Supabase client: ${supabase ? 'ACTIVO' : 'INACTIVO'}`);

const app = express();

// 🔧 FIX VERCEL: Detectar entorno serverless
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
console.log(`[STARTUP] Environment: ${IS_SERVERLESS ? 'SERVERLESS' : 'LOCAL'}, Node: ${process.version}`);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowedOrigins = [
  ...FRONTEND_URL.split(',').map(origin => origin.trim()).filter(Boolean),
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://portal-pilot.vercel.app',
  'https://www.portal-pilot.vercel.app'
];
const corsOptions = {
  origin: (origin, callback) => {
    // Las vistas previas de Vercel no deben poder consumir la API de producción.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"],
      "script-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "style-src-attr": ["'self'", "'unsafe-inline'"],
      "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      "img-src": ["'self'", "data:", "blob:", "https://images.unsplash.com"],
      "connect-src": [
        "'self'",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com",
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

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token no provisto' });

  jwt.verify(token, localJwtSecret, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

function isRootUser(req) {
  const rawCodigo = req.user?.empresa_codigo;
  const codigo = normalizeTenantCode(rawCodigo);
  const role = (req.user?.rol || '').toString().trim().toLowerCase();
  const rootCodes = ['ROOT', 'ROOT PP'];
  const rootRoles = ['root', 'root pp', 'superadmin'];
  return rootCodes.includes(codigo) || rootRoles.some(r => role === r);
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

const PLAN_ENTITLEMENTS = Object.freeze({
  starter: {
    maxUsers: 5, maxCompanies: 1,
    features: [
      'operacion_basica', 'inventario', 'facturacion_sar', 'web_consulta',
      'pos_basico', 'clientes', 'reportes_basicos'
    ]
  },
  business: {
    maxUsers: 25, maxCompanies: 3,
    features: [
      'operacion_completa', 'inventario', 'facturacion_sar', 'web_admin', 'reportes', 'ia', 'roles', 'auditoria',
      'pos', 'clientes', 'proveedores', 'compras', 'precios', 'promociones',
      'canal_tradicional', 'fiado', 'rutas', 'cobros',
      'reportes_basicos'
    ]
  },
  enterprise: {
    maxUsers: 250, maxCompanies: Number.MAX_SAFE_INTEGER,
    features: [
      'operacion_completa', 'inventario', 'facturacion_sar', 'web_admin', 'reportes', 'ia', 'roles', 'auditoria',
      'pos', 'clientes', 'proveedores', 'compras', 'precios', 'promociones',
      'canal_tradicional', 'fiado', 'rutas', 'cobros',
      'canal_moderno', 'sucursales', 'transferencias', 'inventario_multi_sucursal',
      'membresias', 'socios', 'puntos',
      'api_keys', 'automation', 'fleet', 'multiempresa', 'seguridad_avanzada',
      'reportes_avanzados', 'ia_avanzada'
    ]
  }
});

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();
  if (['enterprise', 'corporativo'].includes(value)) return 'enterprise';
  if (['business', 'pro'].includes(value)) return 'business';
  return 'starter';
}

async function getTenantEntitlements(req) {
  if (isRootUser(req)) return { plan: 'enterprise', ...PLAN_ENTITLEMENTS.enterprise };
  const tenantCode = normalizeTenantCode(getTenantCode(req));
  if (!tenantCode || !supabase) return { plan: 'starter', ...PLAN_ENTITLEMENTS.starter };
  const { data: tenant } = await supabase.from('tenants')
    .select('plan, limite_usuarios, limite_empresas, estado')
    .eq('codigo', tenantCode).maybeSingle();
  const plan = normalizePlan(tenant?.plan);
  const base = PLAN_ENTITLEMENTS[plan];
  return {
    plan,
    maxUsers: Number.isInteger(tenant?.limite_usuarios) ? tenant.limite_usuarios : base.maxUsers,
    maxCompanies: Number.isInteger(tenant?.limite_empresas) ? tenant.limite_empresas : base.maxCompanies,
    features: base.features,
    status: normalizeStatus(tenant?.estado || 'active')
  };
}

function requirePlanFeature(feature) {
  return async (req, res, next) => {
    try {
      const entitlements = await getTenantEntitlements(req);
      if (entitlements.status && entitlements.status !== 'active') {
        return res.status(403).json({ error: 'La empresa no tiene un plan activo.' });
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

function verifyTotp(secret, code) {
  const candidate = String(code || '').trim();
  return [-1, 0, 1].some(offset => {
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

app.use(express.static(path.join(__dirname, '..')));

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
// MÓDULO DE EMAIL
// ======================================================================
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  pool: false, // 🔧 FIX VERCEL: Desactivar pool de sockets para evitar conexiones muertas en serverless
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000
});

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER;
const EMAIL_REPLY_TO = process.env.EMAIL_USER || EMAIL_FROM;

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

    await transporter.sendMail(mailOptions);
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

    await transporter.sendMail(mailOptions);
    console.log(`[Activación] Correo enviado a ${emailDestinatario}`);
    return true;
  } catch (error) {
    console.error('[Activación] Error al enviar correo:', error.message);
    return false;
  }
}

async function enviarOnboardingEmail(emailDestinatario) {
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

    const mailOptions = {
      from: `"Soporte Portal Pilot" <${EMAIL_FROM}>`,
      replyTo: EMAIL_REPLY_TO,
      to: emailDestinatario,
      subject: '🚀 Bienvenido a Portal Pilot: Acceso Concedido',
      text: `Bienvenido a Portal Pilot, ${emailDestinatario}.`,
      html: htmlContent
    };

    await transporter.sendMail(mailOptions);
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

    await transporter.sendMail({
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

    await transporter.sendMail(mailOptions);
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

    await transporter.sendMail({
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

// 🔧 FIX VERCEL: Health check endpoint
app.get('/api/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
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
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
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
    const info = await transporter.sendMail({
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

    if (!email || !password || !empresaCodigo || !usuarioNombre || !usuarioApellido) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const emailNorm = String(email).trim().toLowerCase();

    // Consultar existencia previa en Supabase
    if (supabase) {
      const { data: existing } = await supabase.from('usuarios').select('id').eq('email', emailNorm).maybeSingle();
      if (existing) {
        return res.status(409).json({ error: 'El correo ya está registrado.' });
      }

      const { company_banner, company_logo, profile_banner, profile_pic } = req.body || {};

      // Crear tenant en Supabase
      await supabase.from('tenants').upsert({
        codigo: empresaCodigo,
        nombre_empresa: empresaNombre || 'Portal Pilot',
        plan: plan || 'pro',
        estado: 'activo'
      }, { onConflict: 'codigo' });

      // Hashear contraseña y crear usuario en Supabase
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const userUuid = crypto.randomUUID();
      const { data: newUser, error: userErr } = await supabase.from('usuarios').insert({
        id: userUuid,
        email: emailNorm,
        password_hash: passwordHash,
        password: passwordHash,
        nombre: `${usuarioNombre} ${usuarioApellido}`.trim(),
        apellido: usuarioApellido || '',
        rol: 'admin',
        empresa_codigo: empresaCodigo,
        estado: 'activo',
        activo: true,
        foto_perfil_url: profile_pic || company_logo || null
      });

      if (userErr) {
        console.error('[REGISTRO] Error insertando usuario en Supabase:', JSON.stringify(userErr));
        return res.status(400).json({ error: userErr.message || userErr.details || 'Error al crear usuario en base de datos' });
      }
    }

    // AUTOMATION HOOK: tenant_creado
    dispatchAutomationEvent(empresaCodigo, 'tenant_creado', { empresaCodigo, plan, email }).catch(err => console.warn('[REGISTRO] automation hook error:', err.message));

    return res.status(201).json({ 
      message: 'Tenant creado con éxito',
      empresaCodigo,
      dominioWorkspace: dominioWorkspace || null,
      plan: plan || null
    });
  } catch (error) {
    console.error('[REGISTRO EXCEPCION]:', error.stack || error.message);
    return res.status(500).json({ error: error.message || 'No se pudo completar el registro en este momento.' });
  }
});

// Endpoint para enviar código de verificación de email durante el registro
app.post('/api/enviar-codigo-verificacion', async (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) {
      return res.status(400).json({ error: 'Faltan parámetros: email y codigo son requeridos' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Correo inválido' });
    }
    await transporter.sendMail({
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
      return res.status(401).json({ error: 'Credenciales inválidas. El usuario no está registrado en el sistema.' });
    }

    let isMatch = false;
    const storedHash = userRow.password_hash || userRow.password;
    if (storedHash) {
      if (storedHash.startsWith('$2')) {
        isMatch = await bcrypt.compare(password, storedHash);
      } else {
        console.warn(`[LOGIN] Password stored in plaintext for user ${emailNorm} — auto-hashing now`);
        isMatch = (password === storedHash);
        if (isMatch) {
          const newHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
          try {
            await supabase.from('usuarios').update({ password_hash: newHash, password: newHash }).eq('id', userRow.id);
            console.log(`[LOGIN] Auto-hashed plaintext password for ${emailNorm}`);
          } catch (hashErr) {
            console.error(`[LOGIN] Failed to auto-hash password for ${emailNorm}:`, hashErr.message);
          }
        }
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Contraseña incorrecta. Por favor, verifica tus datos.' });
    }

    if (userRow.two_factor_enabled && userRow.two_factor_secret) {
      const mfaToken = jwt.sign(
        { purpose: 'mfa_login', sub: userRow.id, email: userRow.email },
        localJwtSecret,
        { expiresIn: '5m' }
      );
      return res.status(202).json({ requiresTwoFactor: true, mfaToken });
    }

    const accountToken = jwt.sign(
      {
        sub: userRow.id,
        email: userRow.email,
        rol: userRow.rol || 'admin',
        empresa_codigo: userRow.empresa_codigo || 'ROOT'
      },
      localJwtSecret,
      { expiresIn: '30d' }
    );


    let tenantData = null;
    if (supabase && userRow.empresa_codigo) {
      const { data: t } = await supabase.from('tenants').select('*').eq('codigo', userRow.empresa_codigo).maybeSingle();
      tenantData = t;
    }

    const userArea = tenantData?.area || userRow.area || 'Área Comercial';
    const userPlan = tenantData?.plan || 'pro';
    const activeModules = getModulesForAreaAndPlan(userArea, userPlan);

    return res.status(200).json({
      message: 'Login exitoso',
      token: accountToken,
      user: {
        id: userRow.id,
        nombre: userRow.nombre || '',
        apellido: userRow.apellido || '',
        email: userRow.email,
        rol: userRow.rol || 'admin',
        empresa_codigo: userRow.empresa_codigo || 'ROOT',
        tenant: userRow.empresa_codigo || 'ROOT',
        area: userArea,
        plan: userPlan,
        modulos_activos: activeModules,
        status: userRow.estado || 'activo',
        foto_perfil_url: userRow.avatar_url || userRow.foto_perfil_url || null,
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
    const isTotpValid = verifyTotp(userRow.two_factor_secret, code);
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
      sub: userRow.id, email: userRow.email, rol: userRow.rol || userRow.rol_global || 'user',
      empresa_codigo: userRow.empresa_codigo || 'ROOT'
    }, localJwtSecret, { expiresIn: '30d' });
    await supabase.from('usuarios').update({ ultimo_acceso: new Date().toISOString() }).eq('id', userRow.id);
    return res.json({
      message: 'Login exitoso', token,
      user: {
        id: userRow.id, nombre: userRow.nombre || '', apellido: userRow.apellido || '', email: userRow.email,
        rol: userRow.rol || userRow.rol_global || 'user', empresa_codigo: userRow.empresa_codigo || 'ROOT',
        tenant: userRow.empresa_codigo || 'ROOT', area: userArea, plan: userPlan,
        modulos_activos: getModulesForAreaAndPlan(userArea, userPlan), status: userRow.estado || 'activo', token
      }
    });
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
    if (!verifyTotp(user.two_factor_secret, code)) return res.status(400).json({ error: 'Código 2FA inválido.' });
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
    if (!verifyTotp(user.two_factor_secret, code)) return res.status(400).json({ error: 'Código 2FA inválido.' });
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
    res.json({ success: true, empresa_codigo: tenantCode, area, plan, modulos_activos: modulos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Error consultando módulos' });
  }
});

app.post('/api/confirmar-pago', async (req, res) => {
  try {
    const { email, plan, metodoPago, empresaCodigo } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio y debe ser válido.' });
    }
    if (!plan) {
      return res.status(400).json({ error: 'El plan es obligatorio.' });
    }
    const allowedPlans = ['starter', 'business', 'enterprise'];
    const planLower = String(plan).toLowerCase();
    if (!allowedPlans.includes(planLower)) {
      return res.status(400).json({ error: `Plan inválido. Debe ser uno de: ${allowedPlans.join(', ')}.` });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const planNombre = plan ? String(plan).toUpperCase() : 'PRO';

    // Actualizar plan del tenant en Supabase si existe
    if (supabase && empresaCodigo && !empresaCodigo.includes('XXXX')) {
      await supabase.from('tenants').update({ plan: planNombre.toLowerCase(), estado: 'activo' }).eq('codigo', empresaCodigo);
    }

    // Enviar correo de confirmación de pago
    try {
      await transporter.sendMail({
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

app.post('/api/tigo-money-reference', async (req, res) => {
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

    const amountMap = { STARTER: 'L.499.00', BUSINESS: 'L.1,499.00', ENTERPRISE: 'L.4,999.00' };
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
      { sub: req.user.sub, rol: req.user.rol, empresa_codigo: req.user.empresa_codigo },
      localJwtSecret,
      { expiresIn: '2h' }
    );
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
app.post('/api/support-ticket', async (req, res) => {
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

app.get('/api/tenants', authenticate, async (req, res) => {
  try {
    let tenantsFormat = [];
    const userTenantCode = normalizeTenantCode(getTenantCode(req));
    const userIsRoot = isRootUser(req.user);

    if (supabase) {
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
          domain: t.dominio || `${(t.codigo || 'empresa').toLowerCase()}.portalpilot.app`,
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

    res.status(201).json({
      message: 'Tenant y Administrador creados exitosamente',
      tenant: { codigo, nombre, dominio, plan, pais },
      admin: { email: emailAdmin, status: 'activo' }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/tenant/:id', authenticate, async (req, res) => {
  try {
    const tenantId = req.params.id;
    const tenant = await findTenantByIdentifier(tenantId);

    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const tenantCode = tenant.codigo || tenant.Codigo || tenant.code || tenant.Id || tenant.id;
    const userRole = (req.user.rol || '').toString();
    const userEmpresaCodigo = (req.user.empresa_codigo || '').toString().trim();
    const currentTenantCode = normalizeTenantCode(userEmpresaCodigo);
    const roleLower = userRole.toLowerCase();
    const rootUserCheck = isRootUser(req);
    const isAdmin = rootUserCheck || roleLower === 'administrador' || roleLower.includes('ceo') || roleLower.includes('owner');
    const declaredTenantCode = normalizeTenantCode(tenantCode || tenantId);
    const isOwner = currentTenantCode && declaredTenantCode && currentTenantCode === declaredTenantCode;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Acceso no autorizado al tenant' });
    }

    const preview = {
      id: tenant.codigo || tenantCode,
      name: tenant.nombre_empresa || tenant.nombre || tenant.Nombre,
      domain: tenant.dominio || tenant.Dominio || tenant.email,
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

app.put('/api/tenants/:id', authenticate, requireTenantAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { plan, estado } = req.body;

    if (!assertTenantAccess(req, id)) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este tenant.' });
    }

    const empresa = await findTenantByIdentifier(id);
    if (!empresa) return res.status(404).json({ error: 'Tenant no encontrado' });

    // Update in Supabase
    if (supabase) {
      const supaUpdate = {};
      if (plan) supaUpdate.plan = plan;
      if (estado) supaUpdate.estado = estado;
      if (Object.keys(supaUpdate).length > 0) {
        await supabase.from('tenants').update(supaUpdate).eq('codigo', id);
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
      </ul>`
    );

    res.json({ message: 'Tenant actualizado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.delete('/api/tenants/:id', authenticate, async (req, res) => {
  try {
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

    res.json({ message: 'Tenant y todos sus usuarios eliminados exitosamente', deletedUsers: deletedCount });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/debug/tenants/:id', authenticate, async (req, res) => {
  try {
    if (!isRootUser(req) && req.user?.rol !== 'Administrador') {
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

    await transporter.sendMail({
      from: `"Seguridad Portal Pilot" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
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

    await transporter.sendMail({
      from: `"Seguridad Portal Pilot" <${process.env.EMAIL_USER}>`,
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

        (supaUsers || []).filter(u => u.activo !== false).forEach(u => {
          const email = (u.email || '').toLowerCase();
          if (email && !seenEmails.has(email)) {
            seenEmails.add(email);
            allUsers.push({
              id: u.id,
              displayId: u.id,
              nombre: u.nombre || u.email.split('@')[0],
              apellido: u.apellido || '',
              email: email,
              rol: u.rol || u.rol_global || 'Owner',
              tenant_code: u.empresa_codigo || 'ROOT',
              tenant: u.empresa_codigo || 'Portal Pilot',
              status: 'active',
              registered: u.created_at || new Date().toISOString(),
              lastActivity: u.updated_at || null,
              avatar: u.foto_perfil_url || null,
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
      .select('id, empresa_id, nombre, apellido, email, rol_global, activo, created_at, updated_at, foto_perfil_url')
      .eq('id', id)
      .single();

    if (error || !usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    let codigo = '', empNombre = '';
    if (usuario.empresa_id) {
      const { data: emp } = await supabase.from('empresas').select('nombre, codigo').eq('id', usuario.empresa_id).single();
      if (emp) { codigo = emp.codigo || ''; empNombre = emp.nombre || ''; }
    }

    if (!isRootUser(req) && !assertTenantAccess(req, codigo)) {
      return res.status(403).json({ error: 'No tienes permiso para ver este usuario.' });
    }

    res.json({
      id: usuario.id,
      displayId: usuario.id,
      nombre: usuario.nombre || '',
      apellido: usuario.apellido || '',
      email: usuario.email || '',
      rol: usuario.rol_global || 'user',
      tenant_code: codigo,
      tenant: empNombre || codigo || 'N/A',
      status: usuario.activo ? 'active' : 'inactive',
      registered: usuario.created_at || new Date().toISOString(),
      lastActivity: usuario.updated_at || null,
      avatar: usuario.foto_perfil_url || null,
      notas: '',
      source: 'supabase'
    });
  } catch (error) {
    return handleServerError(res, error);
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

    // 4. Insertar perfil en tabla usuarios
    const { error: insertError } = await supabase.from('usuarios').insert({
      id: authData.user.id,
      empresa_id: empresaRecord.id,
      nombre: nombre.trim(),
      apellido: (apellido || '').trim(),
      email: email.toLowerCase().trim(),
      rol_global: rol || 'user',
      empresa_codigo: empresaCodigo,
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
    const { nombre, apellido, email, rol, tenant, notas, status, password, reason, modulos } = req.body;

    // 1. Fetch current user
    const { data: usuarioActual, error: fetchErr } = await supabase
      .from('usuarios')
      .select('id, empresa_id, nombre, apellido, email, rol_global, activo, empresas(codigo, nombre)')
      .eq('id', id)
      .single();

    if (fetchErr || !usuarioActual) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const codigo = usuarioActual.empresas?.codigo || '';
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
    if (typeof rol !== 'undefined') updateFields.rol_global = rol;
    if (typeof notas !== 'undefined') updateFields.notas = notas;
    if (typeof status !== 'undefined') updateFields.activo = normalizeStatus(status) === 'active';

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

    // Verify target user belongs to same tenant (unless ROOT)
    if (supabase && !userIsRoot && userTenant) {
      let targetUser = null;
      if (id.includes('@')) {
        const { data } = await supabase.from('usuarios').select('empresa_codigo').eq('email', id.toLowerCase()).single();
        targetUser = data;
      } else {
        const { data } = await supabase.from('usuarios').select('empresa_codigo').eq('id', id).single();
        targetUser = data;
      }
      if (targetUser && targetUser.empresa_codigo !== userTenant) {
        return res.status(403).json({ error: 'No tienes permiso para eliminar usuarios de otra empresa.' });
      }
    }

    if (supabase) {
      try {
        await supabase.from('usuario_modulos').delete().eq('usuario_id', id);
} catch (e) { console.warn('[USER_DELETE] Non-critical:', e.message); }

      if (id.includes('@')) {
        await supabase.from('usuarios').delete().eq('email', id.toLowerCase());
      } else {
        await supabase.from('usuarios').delete().eq('id', id);
      }
    }

    return res.json({ success: true, message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('[DELETE USER] Error:', error.message);
    return res.status(500).json({ error: error.message || 'Error al eliminar usuario' });
  }
});

// ═══ SUBIDA DE IMÁGENES (Supabase Storage) ═══
const UPLOADS_BUCKET = 'uploads';

app.post('/api/upload', authenticate, async (req, res) => {
  try {
    const { file, folder, filename } = req.body;
    if (!file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    if (!supabase || !supabase.storage) {
      return res.status(503).json({ error: 'Supabase Storage no está configurado' });
    }

    const match = file.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Formato de imagen inválido' });

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'La imagen no debe superar 5MB' });
    }

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

    res.json({ url: fileUrl, path: `/${filePath}`, size: buffer.length });
  } catch (error) {
    console.error('[UPLOAD] Error:', error.message);
    res.status(500).json({ error: 'Error al subir archivo' });
  }
});

// ═══════════════════════════════════════════════════════════════
// MÓDULO ENTERPRISE: API Keys, IA (Groq), Dashboard, Flota, Seguridad, Automatización
// ═══════════════════════════════════════════════════════════════

function registrarAuditoria(empresaCodigo, accion, descripcion, tipo = 'sistema', usuarioNombre = '', req = null) {
  if (!supabase) return Promise.resolve();
  const payload = {
    empresa_codigo: normalizeTenantCode(empresaCodigo || getTenantCode(req || { user: {} })),
    accion: String(accion || '').slice(0, 200),
    descripcion: String(descripcion || '').slice(0, 2000),
    tipo: String(tipo || 'sistema').slice(0, 50),
    usuario: String(usuarioNombre || '').slice(0, 200),
    ip: (req && req.ip ? String(req.ip).slice(0, 60) : ''),
    created_at: new Date().toISOString()
  };
  if (!payload.empresa_codigo) return Promise.resolve();
  return supabase.from('auditoria').insert([payload]).catch(err => {
    console.warn('[AUDITORIA] No se pudo registrar:', err.message);
  });
}

async function resolverEmpresaSupabase(empresaCodigo) {
  if (!supabase || !empresaCodigo) return null;
  try {
    const { data, error } = await supabase
      .from('empresas')
      .select('id, codigo, nombre')
      .eq('codigo', normalizeTenantCode(empresaCodigo))
      .maybeSingle();
    return (data && !error) ? data : null;
  } catch (err) {
    return null;
  }
}

// ── API Keys por tenant ───────────────────────────────────────
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
    return res.json({ keys: data || [] });
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
    const { data, error } = await supabase.from('api_keys').insert([{
      empresa_codigo: tenant,
      nombre,
      clave,
      activa: true
    }]);
    if (error) return res.status(500).json({ error: error.message });

    const row = Array.isArray(data) ? data[0] : (data || { id: null, clave, nombre });
    await registrarAuditoria(tenant, 'API Key creada', `Se generó la clave de API "${nombre}"`, 'config', req.user?.nombre || '', req);
    return res.status(201).json({ key: row, clave });
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
      chat: 'llama-3.3-70b-versatile',
      vision: 'llama-4-scout-17b-16e-instruct',
      fast: 'llama-3.1-8b-instant'
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

const AI_PROVIDER_ORDER = ['groq', 'openrouter'];

async function callAIGateway({ provider, modelRole, messages, temperature, maxTokens, imageBase64 }) {
  const providers = provider ? [provider] : AI_PROVIDER_ORDER;

  for (const provKey of providers) {
    const prov = AI_PROVIDERS[provKey];
    if (!prov) continue;
    const apiKey = prov.getKey();
    if (!apiKey) continue;

    const modelId = modelRole ? (prov.models[modelRole] || prov.models.chat) : prov.models.chat;

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
      console.warn(`[AI_GATEWAY] ${prov.name} failed:`, err.response?.status || err.message);
      continue;
    }
  }

  return { success: false, error: 'Todos los proveedores de IA fallaron o no están configurados' };
}

async function logAIUsage({ empresaCodigo, empresaId, usuarioId, provider, model, funcion, tokensInput, tokensOutput, tokensTotal, durationMs, success, errorMessage }) {
  try {
    if (supabase) {
      await supabase.from('ai_usage_log').insert({
        empresa_codigo: empresaCodigo,
        empresa_id: empresaId,
        usuario_id: usuarioId,
        provider,
        model,
        funcion,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        tokens_total: tokensTotal,
        duration_ms: durationMs,
        success,
        error_message: errorMessage || null
      });
    }
  } catch (e) {
    console.warn('[AI_GATEWAY] Usage log failed:', e.message);
  }
}

// ── AI Chat (centralized) ──────────────────────────────────────
app.post('/api/ai/chat', authenticate, requirePlanFeature('ia'), async (req, res) => {
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

    await logAIUsage({
      empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub,
      provider: result.provider, model: result.model, funcion: 'vision',
      tokensInput: result.tokensInput, tokensOutput: result.tokensOutput, tokensTotal: result.tokensTotal,
      durationMs: result.durationMs, success: true
    });
    await registrarAuditoria(tenant, 'Vision IA', 'Análisis de imagen de producto', 'ai', req.user?.nombre || '', req);

    return res.json({ reply: result.reply, model: result.model, provider: result.provider });
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
    const { data: products } = await supabase.from('productos')
      .select('id, codigo, nombre, descripcion, categoria, marca, presentacion, unidad_medida, precio_venta, stock_actual, imagen_url, barcode')
      .eq('empresa_id', empresa.id)
      .or(`barcode.eq.${code},codigo.eq.${code}`)
      .limit(5);

    if (products && products.length > 0) {
      return res.json({ found: true, products, source: 'database' });
    }
    return res.json({ found: false, products: [], source: 'database', message: 'Producto no encontrado en catálogo' });
  } catch (err) {
    console.error('[AI/BARCODE] Error:', err.message);
    return res.status(500).json({ error: 'Error al buscar producto' });
  }
});

// ── AI: Dashboard natural language queries ────────────────────
app.post('/api/ai/dashboard', authenticate, requirePlanFeature('ia'), async (req, res) => {
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
      return res.status(reply.status || 500).json({ error: reply.error });
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
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const { message, dateRange } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Fetch recent sales/transactions
    let query = supabase.from('transacciones').select('id, tipo, categoria, monto, fecha, descripcion, metadata').eq('empresa_id', empresa.id).eq('tipo', 'venta').order('fecha', { ascending: false }).limit(200);
    if (dateRange?.from) query = query.gte('fecha', dateRange.from);
    if (dateRange?.to) query = query.lte('fecha', dateRange.to);
    const { data: ventas } = await query;

    const systemPrompt = `Eres el analista de ventas de POS de Portal Pilot para "${empresa.nombre || tenant}".
Datos de ventas recientes:
${JSON.stringify(ventas || [], null, 2)}

Responde preguntas sobre:
- Top productos vendidos
- Tendencias de ventas (diarias, semanales)
- Comparativas de períodos
- Sugerencias para mejorar ventas

Sé conciso. Usa los datos reales, no inventes.`;

    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt.slice(0, 4000) });
    messages.push({ role: 'user', content: message.slice(0, 4000) });
    const reply = await callAIGateway({ modelRole: 'chat', messages, maxTokens: 500 });
    if (!reply.success) return res.status(reply.status || 500).json({ error: reply.error });

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'pos_analysis', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/POS] Error:', err.message);
    return res.status(500).json({ error: 'Error al analizar ventas' });
  }
});

// ── AI: CRM customer summaries ──────────────────────────────
app.post('/api/ai/crm/customer', authenticate, requirePlanFeature('ia'), async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    const { message, customerId } = req.body;
    if (!message) return res.status(400).json({ error: 'Mensaje requerido' });

    // Fetch customer context
    let customerData = null;
    if (customerId) {
      const { data: cliente } = await supabase.from('usuarios').select('id, nombre, email, telefono, created_at, rol_global').eq('empresa_id', empresa.id).eq('id', customerId).single();
      customerData = cliente;
    }

    // Fetch recent interactions (tickets, facturas for this customer)
    const [ticketsRes, facturasRes] = await Promise.all([
      customerId ? supabase.from('support_tickets').select('id, nombre, estado, created_at').eq('empresa_id', empresa.id).limit(10) : { data: [] },
      customerId ? supabase.from('facturas').select('id, total, estado, created_at').eq('empresa_id', empresa.id).eq('usuario_id', customerId).limit(10) : { data: [] }
    ]);

    const systemPrompt = `Eres el asistente CRM de Portal Pilot para "${empresa.nombre || tenant}".
${customerData ? `Datos del cliente:\n${JSON.stringify(customerData, null, 2)}` : 'No se especificó un cliente específico.'}
Tickets recientes: ${JSON.stringify(ticketsRes.data || [], null, 2)}
Facturas recientes: ${JSON.stringify(facturasRes.data || [], null, 2)}

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
    if (!reply.success) return res.status(reply.status || 500).json({ error: reply.error });

    await logAIUsage({ empresaCodigo: tenant, empresaId: empresa?.id, usuarioId: req.user?.sub, provider: reply.provider, model: reply.model, funcion: 'crm_customer', tokensInput: reply.tokensInput, tokensOutput: reply.tokensOutput, tokensTotal: reply.tokensTotal, durationMs: reply.durationMs, success: true });

    return res.json({ reply: reply.reply, provider: reply.provider, model: reply.model });
  } catch (err) {
    console.error('[AI/CRM] Error:', err.message);
    return res.status(500).json({ error: 'Error al procesar consulta CRM' });
  }
});

// ── AI: Support ticket assistant ─────────────────────────────
app.post('/api/ai/support', authenticate, requirePlanFeature('ia'), async (req, res) => {
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
    if (!reply.success) return res.status(reply.status || 500).json({ error: reply.error });

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
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    const empresaId = empresa?.id || null;

    let users = [], facturas = [], transacciones = [], productos = [];
    if (empresaId) {
      const [uRes, fRes, tRes, pRes] = await Promise.all([
        supabase.from('usuarios').select('id, rol_global, activo, created_at').eq('empresa_id', empresaId),
        supabase.from('facturas').select('id, total, estado, created_at').eq('empresa_id', empresaId),
        supabase.from('transacciones').select('id, tipo, categoria, monto, fecha').eq('empresa_id', empresaId),
        supabase.from('productos').select('id, stock_actual, stock_minimo').eq('empresa_id', empresaId)
      ]);
      users = uRes.data || users;
      facturas = fRes.data || facturas;
      transacciones = tRes.data || transacciones;
      productos = pRes.data || productos;
    }

    const usuariosActivos = users.filter(u => u.activo !== false).length;
    const facturasCount = facturas.length;
    const facturasTotal = facturas.reduce((s, f) => s + (Number(f.total) || 0), 0);
    const facturasPendientes = facturas.filter(f => (f.estado || 'emitida') === 'pendiente').length;

    const ahora = new Date();
    const hoy = ahora.toISOString().slice(0, 10);
    const enMes = t => t && t.slice(0, 7) === hoy.slice(0, 7);
    const ingresoMes = transacciones.filter(t => t.tipo === 'ingreso' && enMes(t.fecha || t.created_at)).reduce((s, t) => s + (Number(t.monto) || 0), 0);
    const gastoMes = transacciones.filter(t => t.tipo === 'gasto' && enMes(t.fecha || t.created_at)).reduce((s, t) => s + (Number(t.monto) || 0), 0);
    const transaccionesHoy = transacciones.filter(t => (t.fecha || t.created_at || '').slice(0, 10) === hoy).length;

    const lowStock = productos.filter(p => (Number(p.stock_actual) || 0) <= (Number(p.stock_minimo) || 0)).length;

    // Uso últimos 7 días
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(ahora);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dias.push({ fecha: key, label: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getDay()], facturas: 0, transacciones: 0 });
    }
    facturas.forEach(f => {
      const k = (f.created_at || '').slice(0, 10);
      const slot = dias.find(d => d.fecha === k);
      if (slot) slot.facturas++;
    });
    transacciones.forEach(t => {
      const k = (t.fecha || t.created_at || '').slice(0, 10);
      const slot = dias.find(d => d.fecha === k);
      if (slot) slot.transacciones++;
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
    facturas.forEach(f => eventos.push({ tipo: 'factura', descripcion: `Factura ${f.correlativo || 's/n'} por $${Number(f.total).toFixed(2)}`, fecha: f.created_at, meta: 'Facturación' }));
    transacciones.forEach(t => eventos.push({ tipo: t.tipo, descripcion: `${t.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} — ${t.categoria || ''} ${t.descripcion || ''} ($${Number(t.monto).toFixed(2)})`, fecha: t.fecha || t.created_at, meta: 'Contabilidad' }));
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
        usuariosActivos,
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
app.get('/api/security/audit', authenticate, requireTenantAdmin, requirePlanFeature('seguridad_avanzada'), async (req, res) => {
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
    if (req.query.search) query = query.or(`nombre.ilike.%${req.query.search}%,codigo.ilike.%${req.query.search}%,barcode.ilike.%${req.query.search}%`);
    if (req.query.barcode) query = query.eq('barcode', req.query.barcode);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { data, error, count } = await query.order('nombre', { ascending: true }).range(offset, offset + limit - 1);
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
    const { error } = await supabase
      .from('productos').delete()
      .eq('id', req.params.id).eq('empresa_id', empresa.id);
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
    const { data: ventaData, error: ventaErr } = await supabase.from('transacciones').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      usuario_id: req.user?.sub || null,
      tipo: 'venta_pos',
      categoria: 'venta',
      descripcion: `Venta POS - ${items.length} item(s)`,
      monto: total,
      metodo_pago: (b.metodo_pago || 'efectivo').toString().slice(0, 50),
      referencia: (b.referencia || '').toString().slice(0, 200),
      metadata: JSON.stringify({
        items, subtotal, isv, descuento,
        cliente_nombre: b.cliente_nombre || '',
        numero_venta: b.numero_venta || '',
        sucursal_id: b.sucursal_id || null
      }),
      sucursal_id: b.sucursal_id || null,
      fecha: new Date().toISOString()
    }]).select().maybeSingle();
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

app.get('/api/facturas', authenticate, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    let query = supabase.from('facturas').select('*').eq('empresa_id', empresa.id);
    if (req.query.estado) query = query.eq('estado', req.query.estado);
    if (req.query.tipo_documento) query = query.eq('tipo_documento', req.query.tipo_documento);
    if (req.query.search) query = query.or(`correlativo.ilike.%${req.query.search}%,cliente_nombre.ilike.%${req.query.search}%`);
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
    const tenant = normalizeTenantCode(getTenantCode(req));
    const empresa = await resolverEmpresaSupabase(tenant);
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const { data, error } = await supabase
      .from('facturas').select('*')
      .eq('id', req.params.id).eq('empresa_id', empresa.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Factura no encontrada' });
    return res.json({ factura: data });
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
    const { data, error } = await supabase.from('facturas').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      usuario_id: req.user?.sub || null,
      correlativo: (b.correlativo || '').toString().slice(0, 50),
      cliente_nombre: b.cliente_nombre.toString().slice(0, 200),
      cliente_rtn: (b.cliente_rtn || '').toString().slice(0, 20),
      cliente_email: (b.cliente_email || '').toString().slice(0, 100),
      subtotal, isv, descuento, total,
      estado: 'emitida',
      tipo_documento: (b.tipo_documento || 'factura').toString().slice(0, 30),
      metodo_pago: (b.metodo_pago || '').toString().slice(0, 50),
      notas: (b.notas || '').toString().slice(0, 500),
      sucursal_id: b.sucursal_id || null,
      bodega_id: b.bodega_id || null,
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
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
    if (req.query.search) query = query.or(`nombre.ilike.%${req.query.search}%,rtn.ilike.%${req.query.search}%,email.ilike.%${req.query.search}%`);
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
      limite_credito: parseFloat(b.limite_credito) || 0,
      saldo_pendiente: 0,
      notas: (b.notas || '').toString().slice(0, 500),
      activo: true,
      created_at: new Date().toISOString()
    }]).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
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
      .from('productos_precios')
      .select('*, listas_precios(nombre, moneda)')
      .eq('producto_id', req.params.id)
      .eq('empresa_id', empresa.id);
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
      const search = req.query.search.trim();
      query = query.or('nombre.ilike.%' + search + '%,numero_socio.ilike.%' + search + '%,email.ilike.%' + search + '%');
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
