const path = require('path');
try {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
  }
} catch (e) {}

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
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
  FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://portal-pilot.vercel.app',
  'https://www.portal-pilot.vercel.app'
];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /https:\/\/.*\.vercel\.app$/i.test(origin)) {
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
  console.log('[REQUEST]', req.method, req.path);
  next();
});
app.use(express.json({ limit: '10mb' }));

function handleServerError(res, error) {
  console.error('[ERROR]', error?.message || error);
  return res.status(500).json({ error: 'Ha ocurrido un error interno en el servidor' });
}

function handleNocoDbError(res, error, fallbackMessage = 'Error al comunicarse con la base de datos') {
  const status = error?.response?.status;
  const message = error?.response?.data?.msg || error?.response?.data?.error || error?.message || fallbackMessage;
  const responseStatus = status === 401 || status === 403 ? 503 : (status || 503);
  return res.status(responseStatus).json({ error: message });
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

const JWT_SECRET = process.env.JWT_SECRET || 'portalpilot_production_jwt_secret_key_2026_secure';

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token no provisto' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
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
  const rootRoles = ['root', 'root pp', 'superadmin', 'admin', 'administrador'];
  return !rawCodigo || rootCodes.includes(codigo) || rootRoles.some(r => role === r || role.includes(r));
}

function getTenantCode(req) {
  return (req.user?.empresa_codigo || '').toString().trim();
}

function normalizeTenantCode(code) {
  return (code || '').toString().trim().toUpperCase();
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

function formatNocoFilter(value, options = {}) {
  if (value === undefined || value === null) return value;
  const str = String(value).trim();
  if (options.numeric === true) return str;
  return `'${str.replace(/'/g, "''")}'`;
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
const NOCODB_URL = process.env.NOCODB_URL || 'https://app.nocodb.com';
const API_TOKEN = process.env.NOCODB_API_TOKEN || process.env.NOCODB_API_KEY || '';
// JWT Secret verification
if (!process.env.JWT_SECRET || !API_TOKEN) {
  console.warn('[STARTUP] WARNING: JWT_SECRET o NOCODB_API_TOKEN no están definidas localmente. Algunas rutas locales de API fallarán, pero el servidor estático funcionará.');
}
if (!process.env.JWT_SECRET && !IS_SERVERLESS) {
  console.error('[STARTUP] CRÍTICO: JWT_SECRET no está definido. Los tokens JWT no funcionarán correctamente.');
}

console.log(`[NocoDB] URL=${NOCODB_URL} TOKEN_CONFIGURED=${!!API_TOKEN}`);

function requireNocoDbToken(res) {
  return true;
}

// 🔧 FIX VERCEL: Desactivar keepAlive en serverless (causa conexiones stale)
const httpAgent = new http.Agent({
  keepAlive: !IS_SERVERLESS,
  maxSockets: IS_SERVERLESS ? 5 : 50,
  timeout: 10000
});
const httpsAgent = new https.Agent({
  keepAlive: !IS_SERVERLESS,
  maxSockets: IS_SERVERLESS ? 5 : 50,
  timeout: 10000
});

const nocodbApi = axios.create({
  baseURL: NOCODB_URL,
  headers: {
    'xc-token': API_TOKEN,
    'Content-Type': 'application/json'
  },
  timeout: IS_SERVERLESS ? 10000 : 15000, // 🔧 FIX VERCEL: timeout más corto en serverless
  httpAgent,
  httpsAgent,
  validateStatus: status => status >= 200 && status < 300
});

// 🔧 FIX VERCEL: Reintentos reducidos en serverless
nocodbApi.interceptors.response.use(
  response => response,
  async error => {
    const config = error.config;
    if (!config) return Promise.reject(error);

    config.__retryCount = config.__retryCount || 0;
    const status = error.response?.status;
    const isThrottled = status === 429;
    const isServerError = status >= 500 && status < 600;
    const isNetworkError = !error.response || error.code === 'ECONNABORTED';

    if (!(isThrottled || isServerError || isNetworkError)) {
      return Promise.reject(error);
    }

    // 🔧 FIX VERCEL: Menos reintentos en serverless
    const MAX_RETRIES = IS_SERVERLESS ? 2 : 4;
    if (config.__retryCount >= MAX_RETRIES) {
      return Promise.reject(error);
    }

    config.__retryCount += 1;

    // 🔧 FIX VERCEL: Backoff más corto en serverless
    const baseDelay = IS_SERVERLESS ? 500 : 2000;
    const maxDelay = IS_SERVERLESS ? 3000 : 16000;
    const backoff = Math.min(baseDelay * Math.pow(2, config.__retryCount - 1), maxDelay);
    const jitter = Math.floor(Math.random() * 300);
    const delay = backoff + jitter;

    console.warn(`[NOCODB RETRY] Attempt ${config.__retryCount}/${MAX_RETRIES} in ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));

    return nocodbApi.request(config);
  }
);

const EMPRESAS_TABLE = '/api/v2/tables/mfmktdwy014a8l5/records';
const USUARIOS_TABLE = '/api/v2/tables/mv83zjc2acolkh6/records';
const RECOVERY_CODES_TABLE = '/api/v2/tables/recovery_codes/records';

function extractNocoRecordId(record) {
  if (!record || typeof record !== 'object') return null;
  const identifiers = ['_id', '_recordId', 'recordId', 'record_id', 'recordid', 'row_id', 'rowid', 'rowId', '_rowid', '_rowId', 'ROWID', '_ROWID'];
  for (const key of identifiers) {
    if (record[key]) return record[key];
  }
  if (record.id && !isBusinessRecordCode(record.id)) return record.id;
  if (record.Id && !isBusinessRecordCode(record.Id)) return record.Id;
  if (record.ID && !isBusinessRecordCode(record.ID)) return record.ID;
  return null;
}

function buildNocoRecordPath(tablePath, recordId) {
  if (!recordId) return tablePath;
  return `${tablePath}/${encodeURIComponent(recordId)}`;
}

function isBusinessRecordCode(value) {
  if (value === undefined || value === null) return false;
  const str = String(value).trim();
  return /^PP-\d{4,}$/i.test(str);
}

function buildNocoWhereFilter(field, value, options = {}) {
  if (!field || value === undefined || value === null) return null;
  return `(${field},eq,${formatNocoFilter(value, options)})`;
}

function buildNocoCompoundWhereFilter(filters = []) {
  return filters.filter(Boolean).join('~and~');
}

async function runBatched(items, handler, batchSize = IS_SERVERLESS ? 2 : 3, delayMs = IS_SERVERLESS ? 600 : 400) {
  if (!Array.isArray(items) || items.length === 0) return;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(item => handler(item)));
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function findNocoRecordByFilter(tablePath, whereFilter) {
  if (!whereFilter) return null;
  const response = await nocodbApi.get(tablePath, { params: { where: whereFilter, limit: 1 } });
  return response.data?.list?.[0] || null;
}

async function deleteNocoRecordByFilter(tablePath, whereFilter) {
  if (!whereFilter) throw new Error('Where filter no definido para delete');
  const record = await findNocoRecordByFilter(tablePath, whereFilter);
  if (!record) {
    const err = new Error('NocoDB delete by filter failed (record not found)');
    err.response = { status: 404, data: { error: 'ERR_RECORD_NOT_FOUND' } };
    throw err;
  }
  const recordId = extractNocoRecordId(record);
  if (!recordId) throw new Error('No se pudo extraer recordId para delete by filter');
  return await deleteNocoRecord(tablePath, recordId);
}

async function patchNocoRecordByFilter(tablePath, whereFilter, data = {}) {
  if (!whereFilter) throw new Error('Where filter no definido para patch');
  const record = await findNocoRecordByFilter(tablePath, whereFilter);
  if (!record) {
    const err = new Error('NocoDB patch by filter failed (record not found)');
    err.response = { status: 404, data: { error: 'ERR_RECORD_NOT_FOUND' } };
    throw err;
  }
  const recordId = extractNocoRecordId(record);
  if (!recordId) throw new Error('No se pudo extraer recordId para patch by filter');
  return await patchNocoRecordById(tablePath, recordId, data);
}

async function deleteNocoRecord(tablePath, recordId) {
  if (!recordId) throw new Error('Record ID no definido');
  try {
    const recordPath = buildNocoRecordPath(tablePath, recordId);
    await nocodbApi.delete(recordPath);
    return recordPath;
  } catch (err) {
    console.warn(`[NocoDB] Falló delete por URL path (${recordId}), intentando por payload...`);
    try {
      // Intento 1: Payload de objeto con Id y id (NocoDB v2 requiere 'Id')
      await nocodbApi.delete(tablePath, { data: { Id: recordId, id: recordId } });
      return tablePath;
    } catch (err2) {
      try {
        // Intento 2: Payload de array de objetos con Id y id (algunas configuraciones de NocoDB v2 lo requieren)
        await nocodbApi.delete(tablePath, { data: [{ Id: recordId, id: recordId }] });
        return tablePath;
      } catch (err3) {
        console.error(`[NocoDB] Todos los intentos de eliminación fallaron para ID=${recordId}:`, err3.message);
        throw err3;
      }
    }
  }
}

async function patchNocoRecordById(tablePath, recordId, data = {}) {
  if (!recordId) throw new Error('Record ID no definido para patch by id');
  const recordPath = buildNocoRecordPath(tablePath, recordId);
  const response = await nocodbApi.patch(recordPath, data);
  return recordPath;
}

async function deleteNocoRecordByPayload(tablePath, recordId) {
  return await deleteNocoRecord(tablePath, recordId);
}

async function softDeleteNocoRecord(tablePath, recordId, data = {}) {
  if (!recordId) throw new Error('Record ID no definido para soft delete');
  const payload = { id: recordId, ...data };
  const response = await nocodbApi.patch(tablePath, payload);
  return tablePath;
}

function simplifyDebugRecord(record) {
  if (!record || typeof record !== 'object') return record;
  return {
    id: record.id || record.Id || null,
    codigo: record.codigo || record.Codigo || record.CODIGO || null,
    name: record.nombre || record.Nombre || null,
    status: record.estado || record.Estado || record.status || record.Status || null,
    createdAt: record.CreatedAt || record.created_at || null
  };
}

async function findTenantByIdentifier(identifier) {
  if (!identifier) return null;
  const normalizedIdentifier = String(identifier).trim();

  try {
    const response = await nocodbApi.get(EMPRESAS_TABLE, {
      params: { where: `(codigo,eq,${formatNocoFilter(normalizedIdentifier)})`, limit: 1 }
    });
    const found = response.data.list?.[0];
    if (found) return found;
  } catch (err) {
    // Ignorar
  }

  try {
    const response = await nocodbApi.get(`${EMPRESAS_TABLE}/${encodeURIComponent(normalizedIdentifier)}`);
    if (response.data) return response.data;
  } catch (_err) {
    // Ignorar
  }

  try {
    const response = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
    const empresas = response.data.list || [];
    const needle = normalizedIdentifier.toLowerCase();

    return empresas.find(emp => {
      const values = [
        emp.codigo, emp.Codigo, emp.CODIGO,
        emp.code, emp.Code, emp.CODE,
        emp.id, emp.Id, emp.ID,
        emp.tenant_code, emp.tenant,
        emp.empresa_codigo, emp.Empresa_Codigo, emp.Empresa_codigo
      ].filter(v => v !== undefined && v !== null).map(v => String(v).trim().toLowerCase());
      return values.includes(needle);
    }) || null;
  } catch (err) {
    return null;
  }
}

async function findTenantByIdentifierDebug(identifier) {
  const debug = {
    identifier: identifier || null,
    normalizedIdentifier: identifier ? String(identifier).trim() : null,
    attempts: [],
    foundBy: null,
    foundTenant: null,
    directFetch: null,
    listSearchCount: 0
  };
  if (!identifier) return debug;

  const normalizedIdentifier = String(identifier).trim();

  try {
    const where = `(codigo,eq,${formatNocoFilter(normalizedIdentifier)})`;
    const response = await nocodbApi.get(EMPRESAS_TABLE, { params: { where, limit: 1 } });
    const found = response.data.list?.[0] || null;
    debug.attempts.push({ field: 'codigo', where, result: found ? 'found' : 'not found', record: simplifyDebugRecord(found) });
    if (found) {
      debug.foundBy = 'codigo';
      debug.foundTenant = simplifyDebugRecord(found);
      return debug;
    }
  } catch (err) {
    debug.attempts.push({ field: 'codigo', error: err.response?.data || err.message });
  }

  try {
    const url = `${EMPRESAS_TABLE}/${encodeURIComponent(normalizedIdentifier)}`;
    const response = await nocodbApi.get(url);
    debug.directFetch = { url, response: simplifyDebugRecord(response.data) };
    if (response.data) {
      debug.foundBy = 'directRecordFetch';
      debug.foundTenant = simplifyDebugRecord(response.data);
      return debug;
    }
  } catch (err) {
    debug.directFetch = { url, error: err.response?.data || err.message };
  }

  try {
    const response = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
    const empresas = response.data.list || [];
    debug.listSearchCount = empresas.length;
    const needle = normalizedIdentifier.toLowerCase();

    for (const emp of empresas) {
      const values = [
        emp.codigo, emp.Codigo, emp.CODIGO,
        emp.code, emp.Code, emp.CODE,
        emp.id, emp.Id, emp.ID,
        emp.tenant_code, emp.tenant,
        emp.empresa_codigo, emp.Empresa_Codigo, emp.Empresa_codigo
      ].filter(v => v !== undefined && v !== null).map(v => String(v).trim().toLowerCase());
      if (values.includes(needle)) {
        debug.foundBy = 'listScan';
        debug.foundTenant = simplifyDebugRecord(emp);
        break;
      }
    }
  } catch (err) {
    debug.listSearchError = err.response?.data || err.message;
  }

  return debug;
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
      path.join(__dirname, '../enterprise/EMAIL enterprise/Nuevo Acceso.html'),
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
      path.join(__dirname, '../enterprise/EMAIL enterprise/Activación de Cuenta.html'),
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
      path.join(__dirname, '../enterprise/EMAIL enterprise/Nuevo Acceso.html'),
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
  let dbStatus = 'ok';
  if (supabase) {
    const { error } = await supabase.from('tenants').select('count', { count: 'exact', head: true });
    if (error) dbStatus = 'error: ' + error.message;
  }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: IS_SERVERLESS ? 'serverless' : 'local',
    supabase_configured: !!supabase,
    database_status: dbStatus,
    jwt_configured: !!process.env.JWT_SECRET
  });
});

// ======================================================================
// NOTIFICACIONES API (SUPABASE REAL)
// ======================================================================
app.get('/api/notificaciones', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { data: notifs, error } = await supabase
      .from('notificaciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    const unreadCount = (notifs || []).filter(n => !n.leida).length;
    res.json({ notificaciones: notifs || [], unread_count: unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al obtener notificaciones' });
  }
});

app.put('/api/notificaciones/:id/read', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { id } = req.params;
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

app.post('/api/notificaciones', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { empresa_codigo, titulo, mensaje, tipo, prioridad } = req.body;
    const { data, error } = await supabase
      .from('notificaciones')
      .insert({
        empresa_codigo: empresa_codigo || 'ROOT',
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
app.post('/api/upload-image', async (req, res) => {
  try {
    if (!requireSupabase(res)) return;
    const { imageBase64, filename, contentType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Base64 image data missing' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filePath = `uploads/${Date.now()}_${filename || 'image.png'}`;
    const mime = contentType || 'image/png';

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

app.get('/api/check-email', async (req, res) => {
  try {
    const resp = await nocodbApi.get(USUARIOS_TABLE, { params: { limit: 50 } });
    const users = (resp.data.list || []).map(u => ({
      id: u.Id || u.id,
      email: u.email || u.Email || u.EMAIL || '(sin email)',
      rol: u.rol || u.Rol || '(sin rol)',
      status: u.status || u.Status || u.estado || '(sin status)',
      tiene_password: !!(u.password || u.Password),
      password_tipo: u.password ? (u.password.startsWith('$2') ? 'bcrypt-hash' : 'texto-plano') : 'ninguno'
    }));
    res.json({ total: users.length, usuarios: users });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.msg || err.message });
  }
});

app.get('/api/diagnostico', async (req, res) => {
  const result = {
    entorno: process.env.NODE_ENV || 'no definido',
    is_serverless: IS_SERVERLESS,
    nocodb_url: process.env.NOCODB_URL ? '✅ DEFINIDO' : '❌ FALTA',
    nocodb_token: process.env.NOCODB_API_TOKEN ? '✅ DEFINIDO' : '❌ FALTA',
    email_user: process.env.EMAIL_USER ? '✅ DEFINIDO' : '❌ FALTA',
    email_pass: process.env.EMAIL_PASS ? '✅ DEFINIDO' : '❌ FALTA',
    jwt_secret: process.env.JWT_SECRET ? '✅ DEFINIDO' : '❌ FALTA',
    tabla_usuarios: USUARIOS_TABLE,
    nocodb_test: null,
    nocodb_error: null
  };

  try {
    const resp = await nocodbApi.get(USUARIOS_TABLE, { params: { limit: 1 } });
    result.nocodb_test = `✅ CONEXIÓN OK - Total: ${resp.data?.pageInfo?.totalRows ?? 'desconocido'}`;
  } catch (err) {
    result.nocodb_error = `❌ ERROR: ${err.response?.status || ''} ${err.response?.data?.msg || err.message}`;
  }

  res.json(result);
});

app.get('/api/test-email', async (req, res) => {
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
    if (!requireNocoDbToken(res)) return;
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
        isMatch = (password === storedHash);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: 'Contraseña incorrecta. Por favor, verifica tus datos.' });
    }

    const jwtSecret = JWT_SECRET || process.env.JWT_SECRET || 'portalpilot_production_jwt_secret_key_2026_secure';
    const accountToken = jwt.sign(
      {
        sub: userRow.id,
        email: userRow.email,
        rol: userRow.rol || 'admin',
        empresa_codigo: userRow.empresa_codigo || 'ROOT'
      },
      jwtSecret,
      { expiresIn: '30d' }
    );

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

app.post('/api/confirmar-pago', async (req, res) => {
  try {
    const { email, plan, metodoPago, empresaCodigo } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'El correo electrónico es obligatorio y debe ser válido.' });
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
              <p style="margin:4px 0;font-size:14px;"><strong>Método de pago:</strong> ${metodoPago === 'tarjeta' ? 'Tarjeta de Crédito/Débito Digital' : 'Transferencia Bancaria'}</p>
              <p style="margin:4px 0;font-size:14px;"><strong>Estado:</strong> <span style="color:#30d158;font-weight:700;">ACTIVO</span></p>
              <p style="margin:4px 0;font-size:14px;"><strong>ID de Empresa:</strong> ${empresaCodigo || 'ROOT'}</p>
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

app.post('/api/refresh', authenticate, (req, res) => {
  try {
    const newToken = jwt.sign(
      { sub: req.user.sub, rol: req.user.rol, empresa_codigo: req.user.empresa_codigo },
      JWT_SECRET,
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
      name: escapeHtml(name).slice(0, 200),
      email: escapeHtml(email).slice(0, 200),
      company: escapeHtml(company || '').slice(0, 200),
      plan: escapeHtml(plan || 'none').slice(0, 50),
      category: escapeHtml(category).slice(0, 50),
      priority: escapeHtml(priority || 'normal').slice(0, 20),
      message: escapeHtml(message).slice(0, 5000),
      status: 'open',
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
    if (supabase) {
      const { data: supaTenants, error } = await supabase.from('tenants').select('*');
      if (!error && supaTenants && supaTenants.length > 0) {
        tenantsFormat = supaTenants.map(t => ({
          id: t.id || t.codigo || 'ROOT',
          codigo: t.codigo || t.id || 'ROOT',
          name: t.nombre_empresa || t.nombre || t.codigo || 'Empresa',
          domain: t.dominio || `${(t.codigo || 'empresa').toLowerCase()}.portalpilot.app`,
          plan: t.plan || 'enterprise',
          status: t.estado || 'activo',
          users: 1,
          registered: t.created_at || new Date().toISOString(),
          country: t.pais || 'Honduras',
          logo_url: t.logo_url || null,
          banner_url: t.banner_url || null
        }));
      }
    }

    if (tenantsFormat.length === 0) {
      tenantsFormat = [{
        id: 'ROOT',
        codigo: 'ROOT',
        name: 'Portal Pilot Honduras',
        domain: 'portalpilot.pp.ia',
        plan: 'enterprise',
        status: 'activo',
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

app.post('/api/tenants', authenticate, async (req, res) => {
  try {
    const { nombre, dominio, plan, emailAdmin, pais, zonaHoraria, notas } = req.body;
    const codigo = `PP-${Date.now().toString().slice(-6)}`;

    await nocodbApi.post(EMPRESAS_TABLE, {
      nombre, codigo, dominio, plan,
      status: 'pending', Status: 'pending', estado: 'pending', Estado: 'pending',
      pais, zona_horaria: zonaHoraria, notas
    });

    const passwordTemporal = generateSecurePassword();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordTemporal, salt);

    const existingResponse = await nocodbApi.get(USUARIOS_TABLE, {
      params: { where: `(email,eq,${emailAdmin})`, limit: 1 }
    });
    if (existingResponse.data.list && existingResponse.data.list.length > 0) {
      return res.status(400).json({ error: 'El correo del administrador ya está registrado' });
    }

    const creadoRes = await nocodbApi.post(USUARIOS_TABLE, {
      nombre: 'Owner', apellido: 'Tenant', email: emailAdmin, rol: 'Owner',
      password: passwordHash, empresa_codigo: codigo,
      status: 'pending', Status: 'pending', estado: 'pending', Estado: 'pending',
      notas: 'Cuenta Owner pendiente de activación'
    });

    let activationToken = null;
    try {
      const createdId = creadoRes.data?.id || creadoRes.data?.Id || creadoRes.data?.ID;
      activationToken = jwt.sign(
        { sub: createdId, rol: 'Owner', empresa_codigo: codigo },
        JWT_SECRET,
        { expiresIn: '6h' }
      );
    } catch (e) {
      console.warn('[CREAR_TENANT] No se pudo generar token:', e.message);
    }

    // 🔧 FIX VERCEL: await en lugar de void
    await enviarAlertaActivacionCuenta(emailAdmin, passwordTemporal, activationToken, nombre);

    // 🔧 FIX VERCEL: await en lugar de setImmediate
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      '🏢 Nuevo Tenant Registrado',
      'Nueva Empresa Registrada',
      'Se ha registrado una nueva empresa en Portal Pilot.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>Nombre:</strong> ${nombre}</li>
        <li><strong>Código:</strong> ${codigo}</li>
        <li><strong>Plan:</strong> ${plan.toUpperCase()}</li>
        <li><strong>Email Admin:</strong> ${emailAdmin}</li>
      </ul>`
    );

    res.status(201).json({
      message: 'Tenant y Administrador creados exitosamente',
      tenant: { codigo, nombre, dominio, plan, pais },
      admin: { email: emailAdmin, status: 'pending' }
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
      id: tenantCode,
      name: tenant.nombre || tenant.Nombre,
      domain: tenant.dominio || tenant.Dominio,
      plan: tenant.plan || tenant.Plan,
      status: tenant.estado || tenant.Estado,
      country: tenant.pais || tenant.Pais
    };

    let detail = null;
    if (isAdmin) {
      detail = {
        notes: tenant.notas,
        timezone: tenant.zona_horaria,
        createdAt: tenant.CreatedAt,
        updatedAt: tenant.UpdatedAt
      };
    }

    res.json({ preview, detail });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.put('/api/tenants/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { plan, estado } = req.body;

    const empresa = await findTenantByIdentifier(id);
    if (!empresa) return res.status(404).json({ error: 'Tenant no encontrado' });

    const targetId = extractNocoRecordId(empresa) || empresa.Id || empresa.id || id;
    const updateFields = { id: targetId, Id: targetId };
    if (plan) updateFields.plan = plan;
    if (estado) updateFields.estado = estado;

    await nocodbApi.patch(EMPRESAS_TABLE, updateFields);

    // 🔧 FIX VERCEL: await en lugar de setImmediate
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

    const tenantCode = tenant.codigo || tenant.Codigo || tenant.id || tenant.Id;
    const recordId = extractNocoRecordId(tenant);
    const targetTenantId = recordId || tenant.Id || tenant.id || id;
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
          // 1. Obtener todos los usuarios de esta empresa
          const { data: supaUsers } = await supabase
            .from('usuarios').select('id').eq('empresa_id', empRecord.id);

          // 2. Eliminar módulos de cada usuario
          for (const u of (supaUsers || [])) {
            await supabase.from('usuario_modulos').delete().eq('usuario_id', u.id);
          }

          // 3. Eliminar usuarios de la tabla
          await supabase.from('usuarios').delete().eq('empresa_id', empRecord.id);
          deletedCount += (supaUsers || []).length;

          // 4. Eliminar empresa
          await supabase.from('empresas').delete().eq('id', empRecord.id);

          // 5. Intentar eliminar auth users (puede fallar si no tiene permisos)
          for (const u of (supaUsers || [])) {
            try { await supabase.auth.admin.deleteUser(u.id); } catch (_) {}
          }

          console.log(`[DELETE TENANT SUPABASE] Empresa ${finalTenantCode}: ${(supaUsers || []).length} usuarios + empresa eliminados`);
        }
      } catch (err) {
        console.warn(`[DELETE TENANT SUPABASE] Error:`, err.message);
      }
    }

    // ── NOCODB: Eliminar usuarios y empresa ──
    if (targetTenantId) {
      try {
        const usersResponse = await nocodbApi.get(USUARIOS_TABLE, {
          params: { where: `(empresa_codigo,eq,${formatNocoFilter(finalTenantCode)})`, limit: 500 }
        });
        const usersToDelete = usersResponse.data.list || [];

        await runBatched(usersToDelete, async user => {
          const userRecordId = extractNocoRecordId(user);
          try {
            if (userRecordId) {
              await deleteNocoRecord(USUARIOS_TABLE, userRecordId);
            } else {
              const userWhereByEmail = buildNocoWhereFilter('email', user.email);
              if (userWhereByEmail) await deleteNocoRecordByFilter(USUARIOS_TABLE, userWhereByEmail);
            }
          } catch (err) {
            console.warn(`[DELETE USER NOCODB] Falló para ${userRecordId}:`, err.message);
          }
        });
      } catch (err) {
        console.warn(`[DELETE TENANT NOCODB] Error listando usuarios:`, err.message);
      }

      try {
        if (recordId) {
          await deleteNocoRecord(EMPRESAS_TABLE, recordId);
        } else {
          const tenantWhereByCode = buildNocoWhereFilter('codigo', finalTenantCode);
          if (tenantWhereByCode) await deleteNocoRecordByFilter(EMPRESAS_TABLE, tenantWhereByCode);
          else await deleteNocoRecord(EMPRESAS_TABLE, targetTenantId);
        }
      } catch (err) {
        console.warn(`[DELETE TENANT NOCODB] Error eliminando empresa:`, err.message);
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
    const debugResult = await findTenantByIdentifierDebug(req.params.id);
    return res.json({ message: 'Debug tenant lookup', debug: debugResult });
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
    if (!requireNocoDbToken(res)) return;

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Correo electrónico requerido.' });

    const response = await nocodbApi.get(USUARIOS_TABLE, { params: { where: `(email,eq,${email})` } });
    const usuarios = response.data.list;

    if (!usuarios || usuarios.length === 0) {
      return res.json({ message: 'Si el correo está registrado, se ha enviado un código.' });
    }

    const code = generateVerificationCode(6);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    try {
      const existing = await nocodbApi.get(RECOVERY_CODES_TABLE, { params: { where: `(email,eq,${email})` } });
      const list = existing.data.list || [];
      await runBatched(list, async item => {
        const recId = extractNocoRecordId(item);
        if (recId) {
          try { await deleteNocoRecord(RECOVERY_CODES_TABLE, recId); } catch (e) { /* continuar */ }
        }
      }, 2, 300);
    } catch (err) {
      console.warn('[RECOVERY] No se pudo limpiar códigos antiguos:', err.message);
    }

    try {
      await nocodbApi.post(RECOVERY_CODES_TABLE, { email, code, expires_at: expiresAt });
    } catch (err) {
      console.error('[RECOVERY] Error guardando código:', err.message);
      return res.status(500).json({ error: 'No se pudo generar el código' });
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
      to: email,
      subject: '🔑 Código de Verificación',
      html: htmlContent
    });

    console.log(`[Recuperación] Código enviado a ${email}`);
    res.json({ message: 'Si el correo está registrado, se ha enviado un código.' });
  } catch (error) {
    return handleNocoDbError(res, error, 'No se pudo procesar la recuperación en este momento.');
  }
});

app.post('/api/recuperacion/verificar', recoveryLimiter, async (req, res) => {
  try {
    if (!requireNocoDbToken(res)) return;

    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    let found = null;
    try {
      const emailNorm = String(email).trim().toLowerCase();
      const compoundFilter = buildNocoCompoundWhereFilter([
        buildNocoWhereFilter('email', emailNorm),
        buildNocoWhereFilter('code', code.trim())
      ]);
      const resp = await nocodbApi.get(RECOVERY_CODES_TABLE, {
        params: { where: compoundFilter, limit: 1 }
      });
      found = resp.data.list?.[0] || null;
    } catch (err) {
      console.error('[RECOVERY] Error buscando código:', err.message);
      return handleServerError(res, err);
    }

    if (!found) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const expiresAt = found.expires_at || found.expiresAt || found.expires || null;
    if (!expiresAt || new Date() > new Date(expiresAt)) {
      const recId = extractNocoRecordId(found);
      if (recId) { try { await deleteNocoRecord(RECOVERY_CODES_TABLE, recId); } catch (e) { /* ignore */ } }
      return res.status(400).json({ error: 'El código ha expirado.' });
    }

    const recId = extractNocoRecordId(found);
    if (recId) { try { await deleteNocoRecord(RECOVERY_CODES_TABLE, recId); } catch (e) { /* ignore */ } }

    const response = await nocodbApi.get(USUARIOS_TABLE, { params: { where: `(email,eq,${email})` } });
    const usuarios = response.data.list;
    if (!usuarios || usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const usuario = usuarios[0];
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await nocodbApi.patch(USUARIOS_TABLE, {
      id: usuario.id, Id: usuario.id, password: passwordHash
    });

    res.json({ message: 'Contraseña restablecida con éxito.' });
  } catch (error) {
    return handleNocoDbError(res, error, 'No se pudo restablecer la contraseña en este momento.');
  }
});

app.get('/api/users', authenticate, async (req, res) => {
  try {
    const allUsers = [];
    const seenEmails = new Set();

    if (supabase) {
      try {
        const { data: supaUsers, error: supaErr } = await supabase
          .from('usuarios')
          .select('*')
          .order('created_at', { ascending: false });

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
    const source = req.query.source || 'supabase';

    // ═══ NOCODB: Look up owner/admin ═══
    if (source === 'nocodb') {
      try {
        let nocoUser = null;
        try {
          const resp = await nocodbApi.get(`${USUARIOS_TABLE}/${id}`);
          nocoUser = resp.data;
        } catch (_) {}
        if (!nocoUser && id.includes('@')) {
          const resp = await nocodbApi.get(USUARIOS_TABLE, {
            params: { where: `(email,eq,${id})`, limit: 1 }
          });
          nocoUser = resp.data?.list?.[0] || null;
        }
        if (!nocoUser) return res.status(404).json({ error: 'Usuario no encontrado en NocoDB.' });

        const empresaCodigo = nocoUser.empresa_codigo || nocoUser.Empresa_Codigo || 'ROOT';
        return res.json({
          id: nocoUser.Id || nocoUser.id || id,
          displayId: nocoUser.Id || nocoUser.id || id,
          nombre: nocoUser.nombre || nocoUser.Nombre || '',
          apellido: nocoUser.apellido || nocoUser.Apellido || '',
          email: nocoUser.email || nocoUser.Email || '',
          rol: nocoUser.rol || nocoUser.Rol || 'Owner',
          tenant_code: empresaCodigo,
          tenant: empresaCodigo,
          status: 'active',
          registered: nocoUser.created_at || nocoUser.Created_at || new Date().toISOString(),
          lastActivity: nocoUser.updated_at || null,
          avatar: nocoUser.foto_perfil_url || null,
          notas: '',
          source: 'nocodb'
        });
      } catch (err) {
        return handleServerError(res, err);
      }
    }

    // ═══ SUPABASE ═══
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

app.post('/api/users', authenticate, async (req, res) => {
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

app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    if (supabase) {
      try {
        await supabase.from('usuario_modulos').delete().eq('usuario_id', id);
      } catch (e) {}

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

    const subDir = folder || 'general';
    const safeName = (filename || `img_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeName}_${Date.now()}.${ext}`;
    const filePath = `${subDir}/${fileName}`;

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
app.get('/api/tenant/apikeys', authenticate, async (req, res) => {
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

app.post('/api/tenant/apikeys', authenticate, async (req, res) => {
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

app.delete('/api/tenant/apikeys/:id', authenticate, async (req, res) => {
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

// ── Proxy de IA (Groq) ────────────────────────────────────────
app.post('/api/ai/chat', authenticate, async (req, res) => {
  try {
    const { message, history, systemPrompt, temperature } = req.body || {};
    const text = (message || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'Campo message requerido' });

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return res.status(503).json({ error: 'GROQ_API_KEY no está configurada en el servidor' });

    const messages = [];
    if (systemPrompt && String(systemPrompt).trim()) {
      messages.push({ role: 'system', content: String(systemPrompt).slice(0, 4000) });
    }
    if (Array.isArray(history)) {
      for (const m of history.slice(-12)) {
        if (m && m.role && m.content) {
          const role = m.role === 'assistant' ? 'assistant' : 'user';
          messages.push({ role, content: String(m.content).slice(0, 4000) });
        }
      }
    }
    messages.push({ role: 'user', content: text.slice(0, 4000) });

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        max_tokens: 800
      },
      { headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const reply = (response.data?.choices?.[0]?.message?.content || '').trim();
    await registrarAuditoria(getTenantCode(req), 'Consulta IA', text.slice(0, 200), 'ai', req.user?.nombre || '', req);
    return res.json({ reply, model: response.data?.model || 'llama-3.3-70b-versatile' });
  } catch (err) {
    console.error('[AI/CHAT] Error:', err.response?.data || err.message);
    const status = err.response?.status;
    if (status === 401 || status === 403) return res.status(502).json({ error: 'La clave de Groq no es válida o fue rechazada' });
    if (status === 429) return res.status(429).json({ error: 'Límite de solicitudes de IA alcanzado. Intenta de nuevo en unos segundos.' });
    return res.status(500).json({ error: 'No se pudo procesar la consulta de IA' });
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
app.get('/api/fleet', authenticate, async (req, res) => {
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

app.post('/api/fleet', authenticate, async (req, res) => {
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

app.patch('/api/fleet/:id', authenticate, async (req, res) => {
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
app.get('/api/security/audit', authenticate, async (req, res) => {
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
app.get('/api/automation', authenticate, async (req, res) => {
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

app.post('/api/automation', authenticate, async (req, res) => {
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
    }]).catch(() => {});
    return res.status(201).json({ agent: row });
  } catch (err) {
    return handleServerError(res, err);
  }
});

app.patch('/api/automation/:id', authenticate, async (req, res) => {
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
      }]).catch(() => {});
    }
    return res.json({ agent: row, success: true });
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
