const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
let supabase = null;
let requireSupabase = (res) => { res.status(503).json({ error: 'Supabase no disponible' }); return false; };
try {
  const sb = require('./supabaseClient');
  supabase = sb.supabase;
  requireSupabase = sb.requireSupabase;
  console.log(`[STARTUP] Supabase client: ${supabase ? 'ACTIVO' : 'INACTIVO (sin config)'}`);
} catch (err) {
  console.error('[STARTUP] Error cargando supabaseClient:', err.message);
  console.warn('[STARTUP] El servidor funcionará solo con NocoDB');
}

// 🔧 FIX VERCEL: dotenv solo en desarrollo local
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

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
const JWT_SECRET = process.env.JWT_SECRET;

if (!process.env.JWT_SECRET || !API_TOKEN) {
  console.warn('[STARTUP] WARNING: JWT_SECRET o NOCODB_API_TOKEN no están definidas localmente. Algunas rutas locales de API fallarán, pero el servidor estático funcionará.');
}
if (!process.env.JWT_SECRET && !IS_SERVERLESS) {
  console.error('[STARTUP] CRÍTICO: JWT_SECRET no está definido. Los tokens JWT no funcionarán correctamente.');
}

console.log(`[NocoDB] URL=${NOCODB_URL} TOKEN_CONFIGURED=${!!API_TOKEN}`);

function requireNocoDbToken(res) {
  if (!API_TOKEN) {
    res.status(503).json({ error: 'NocoDB API token no configurado. El servicio de base de datos no está disponible.' });
    return false;
  }
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
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: IS_SERVERLESS ? 'serverless' : 'local',
    nocodb_configured: !!API_TOKEN,
    supabase_configured: !!supabase,
    jwt_configured: !!process.env.JWT_SECRET
  });
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
    const empresaSectorNormalizado = normalizeSectorValue(empresaSector);
    const existingUsers = await nocodbApi.get(USUARIOS_TABLE, {
      params: { where: buildNocoWhereFilter('email', emailNorm), limit: 1 }
    });

    if ((existingUsers.data?.list || []).length > 0) {
      return res.status(409).json({ error: 'El correo ya está registrado.' });
    }

    const empresaData = {
      nombre: empresaNombre || 'Portal Pilot',
      codigo: empresaCodigo,
      dominio: dominioWorkspace || null,
      land_page: landPage || null,
      size: empresaSize || null,
      sise: sise || null,
      sector: empresaSectorNormalizado || null,
      pais: empresaCountry || null,
      zona_horaria: zonaHoraria || null,
      plan: plan || 'startup',
      logo_url: logoUrl || null,
      banner_url: bannerUrl || null,
      status: 'active',
      Status: 'active',
      estado: 'active',
      Estado: 'active'
    };

    try {
      const empresaExistenteRes = await nocodbApi.get(EMPRESAS_TABLE, {
        params: { where: buildNocoWhereFilter('codigo', empresaCodigo), limit: 1 }
      });
      const empresaExistente = empresaExistenteRes.data?.list?.[0] || null;

      if (empresaExistente) {
        const empresaRecordId = extractNocoRecordId(empresaExistente);
        if (empresaRecordId) {
          await nocodbApi.patch(buildNocoRecordPath(EMPRESAS_TABLE, empresaRecordId), empresaData);
        } else {
          await nocodbApi.post(EMPRESAS_TABLE, empresaData);
        }
      } else {
        await nocodbApi.post(EMPRESAS_TABLE, empresaData);
      }
    } catch (err) {
      console.error('[REGISTRO] Error al crear/actualizar la empresa:', err.response?.data || err.message);
      throw err;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const nuevoUsuario = {
      nombre: usuarioNombre,
      apellido: usuarioApellido,
      email: emailNorm,
      cargo: cargo || null,
      area: area || 'Sin asignar',
      rango: rango || 'Administrador',
      rol: 'owner',
      foto_perfil_url: perfilFotoUrl || null,
      banner_perfil_url: perfilBannerUrl || null,
      password: passwordHash,
      dosfa_activo: dosFaActivo || false,
      dosfa_secret: dosFaSecret || null,
      dosfa_backup_codes: dosFaBackupCodes ? JSON.stringify(dosFaBackupCodes) : null,
      terminos_aceptados: terminosAceptados || false,
      empresa_codigo: empresaCodigo,
      dominio_workspace: dominioWorkspace || null,
      status: 'active',
      Status: 'active',
      estado: 'active',
      Estado: 'active'
    };

    await nocodbApi.post(USUARIOS_TABLE, nuevoUsuario);

    await enviarOnboardingEmail(emailNorm);

    res.status(201).json({ 
      message: 'Tenant creado con éxito',
      empresaCodigo,
      dominioWorkspace: dominioWorkspace || null,
      plan: plan || null
    });
  } catch (error) {
    return handleNocoDbError(res, error, 'No se pudo completar el registro en este momento.');
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
    console.log('[LOGIN] start', { hasToken: !!API_TOKEN, body: req.body });

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Por favor, proporciona email y contraseña.' });
    }

    const emailNorm = email.trim().toLowerCase();

    // ═══ PASO 1: Intentar login en NocoDB (owners/admins) ═══
    let nocodbUser = null;
    if (API_TOKEN) {
      try {
        const r1 = await nocodbApi.get(USUARIOS_TABLE, {
          params: { where: `(email,eq,${emailNorm})`, limit: 10 }
        });
        const responseData = r1.data.list || [];

        if (responseData.length > 0) {
          const matchedUsers = (await Promise.all(responseData.map(async usuario => {
            if (!usuario.password) return null;
            const isMatch = await bcrypt.compare(password, usuario.password);
            if (isMatch) return usuario;
            return null;
          }))).filter(Boolean);

          if (matchedUsers.length > 0) {
            nocodbUser = matchedUsers[0];
          }
        }
      } catch (err) {
        console.warn('[LOGIN] NocoDB lookup falló, intentando Supabase:', err.message);
      }
    }

    // ═══ PASO 2: Si no se encontró en NocoDB, intentar Supabase Auth (trabajadores) ═══
    if (!nocodbUser && supabase) {
      try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: emailNorm,
          password: password
        });

        if (!authError && authData?.user) {
          // Buscar perfil en tabla usuarios (sin FK join)
          const { data: perfil } = await supabase
            .from('usuarios')
            .select('id, empresa_id, nombre, apellido, email, rol_global, activo, foto_perfil_url, banner_perfil_url')
            .eq('id', authData.user.id)
            .single();

          if (perfil) {
            let empresaCodigo = '', empresaNombre = 'Portal Pilot';
            if (perfil.empresa_id) {
              const { data: emp } = await supabase.from('empresas').select('nombre, codigo').eq('id', perfil.empresa_id).single();
              if (emp) { empresaCodigo = emp.codigo || ''; empresaNombre = emp.nombre || empresaCodigo || 'Portal Pilot'; }
            }

            const accountToken = jwt.sign(
              {
                sub: perfil.id,
                rol: perfil.rol_global || 'user',
                empresa_codigo: empresaCodigo,
                empresa_nombre: empresaNombre
              },
              JWT_SECRET,
              { expiresIn: '2h' }
            );

            await enviarAlertaNuevoAcceso(emailNorm, req, true);

            return res.status(200).json({
              message: 'Login exitoso',
              token: accountToken,
              user: {
                id: perfil.id,
                nombre: perfil.nombre || '',
                apellido: perfil.apellido || '',
                email: perfil.email || emailNorm,
                rol: perfil.rol_global || 'user',
                empresa_codigo: empresaCodigo,
                empresa_nombre: empresaNombre,
                tenant: empresaCodigo,
                status: perfil.activo ? 'active' : 'inactive',
                foto_perfil_url: perfil.foto_perfil_url || null,
                banner_perfil_url: perfil.banner_perfil_url || null,
                token: accountToken
              },
              accounts: []
            });
          }
        }
      } catch (err) {
        console.warn('[LOGIN] Supabase Auth falló:', err.message);
      }
    }

    // ═══ PASO 3: Si se encontró en NocoDB, procesar respuesta ═══
    if (nocodbUser) {
      const loginAccounts = await Promise.all([nocodbUser].map(async usuario => {
        const rawEmpresa = usuario.empresa_codigo || usuario.Empresa_Codigo || usuario.EmpresaCodigo || usuario.empresaCodigo || 'ROOT';
        const rawRole = usuario.rol || usuario.Rol || usuario.role || usuario.Role || '';
        const rawStatus = usuario.status || usuario.Status || usuario.estado || usuario.Estado || 'active';
        const rawEmail = usuario.email || usuario.Email || usuario.EMAIL || '';
        const rawName = usuario.nombre || usuario.Nombre || `${usuario.firstName || ''} ${usuario.lastName || ''}`.trim();

        let normalizedEmpresa = rawEmpresa.toString().trim();
        const userRole = rawRole.toString().trim().toLowerCase();
        const userStatus = normalizeStatus(rawStatus);

        if (userRole.includes('root') || userRole.includes('superadmin') || normalizedEmpresa.toUpperCase() === 'ROOT') {
          normalizedEmpresa = 'ROOT';
        }
        normalizedEmpresa = normalizedEmpresa.toString().trim().toUpperCase() || 'ROOT';

        let empresaNombre = 'Portal Pilot';
        if (normalizedEmpresa !== 'ROOT') {
          try {
            const tenantInfo = await findTenantByIdentifier(normalizedEmpresa);
            if (tenantInfo) {
              empresaNombre = tenantInfo.nombre || tenantInfo.Nombre || normalizedEmpresa;
            } else {
              empresaNombre = normalizedEmpresa;
            }
          } catch (e) {
            console.warn('[LOGIN] Error al buscar empresa:', e.message);
            empresaNombre = normalizedEmpresa;
          }
        }

        const accountToken = jwt.sign(
          {
            sub: usuario.id || usuario.ID || usuario.Id || usuario._id,
            rol: rawRole,
            empresa_codigo: normalizedEmpresa,
            empresa_nombre: empresaNombre
          },
          JWT_SECRET,
          { expiresIn: '2h' }
        );

        return {
          id: usuario.id || usuario.ID || usuario.Id || usuario._id,
          nombre: rawName || rawEmail,
          apellido: usuario.apellido || usuario.Apellido || '',
          email: rawEmail,
          rol: rawRole,
          empresa_codigo: normalizedEmpresa,
          empresa_nombre: empresaNombre,
          tenant: normalizedEmpresa,
          status: userStatus,
          foto_perfil_url: usuario.foto_perfil_url || usuario.Foto_Perfil_Url || null,
          banner_perfil_url: usuario.banner_perfil_url || usuario.Banner_Perfil_Url || null,
          token: accountToken
        };
      }));

      const hasPendingAccount = loginAccounts.some(acc => acc.status === 'pending');
      const pendingAccount = loginAccounts.find(acc => acc.status === 'pending');
      const rootAccount = loginAccounts.find(acc =>
        (acc.empresa_codigo || '').toString().trim().toUpperCase() === 'ROOT' ||
        (acc.rol || '').toString().toLowerCase().includes('root')
      );
      const selectedAccount = pendingAccount || rootAccount || loginAccounts[0];

      if (!hasPendingAccount) {
        await enviarAlertaNuevoAcceso(selectedAccount.email, req, true);
      }

      return res.status(200).json({
        message: 'Login exitoso',
        token: selectedAccount.token,
        user: selectedAccount,
        accounts: loginAccounts
      });
    }

    // ═══ PASO 4: No se encontró en ninguna base ═══
    await enviarAlertaNuevoAcceso(emailNorm, req, false);
    return res.status(401).json({ error: 'Credenciales inválidas (usuario no encontrado).' });

  } catch (error) {
    return handleNocoDbError(res, error, 'No se pudo validar el inicio de sesión en este momento.');
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

app.get('/api/tenants', authenticate, async (req, res) => {
  if (!requireNocoDbToken(res)) return;
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 10), 200);
    const response = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit } });
    const empresas = response.data.list || [];

    // 🔧 FIX VERCEL: Reducir límite de usuarios
    const usuariosRes = await nocodbApi.get(USUARIOS_TABLE, { params: { limit: 500 } });
    const usuariosList = usuariosRes.data.list || [];

    const activeUsers = usuariosList.filter(u => !isDeletedStatus(u.status || u.Status || u.estado || u.Estado || 'active'));
    const usersCountByEmpresa = activeUsers.reduce((acc, user) => {
      const code = user.empresa_codigo || user.Empresa_Codigo || user.codigo || user.Codigo || '';
      if (!code) return acc;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});

    const tenantsFormat = empresas
      .filter(emp => !isDeletedStatus(emp.status || emp.Status || emp.estado || emp.Estado || 'active'))
      .map(emp => {
        const tenantCode = emp.codigo || emp.Codigo || emp.id || emp.Id || '';
        return {
          id: String(tenantCode || `ID-${emp.Id || emp.id}`),
          name: emp.nombre || emp.Nombre || 'Sin Nombre',
          domain: emp.dominio || emp.Dominio || 'N/A',
          plan: emp.plan || emp.Plan || 'starter',
          status: normalizeStatus(emp.status || emp.Status || emp.estado || emp.Estado || 'active'),
          users: usersCountByEmpresa[tenantCode] || 0,
          registered: emp.CreatedAt || emp.created_at || new Date().toISOString(),
          country: emp.pais || emp.Pais || 'N/A'
        };
      });

    res.json(tenantsFormat);
  } catch (error) {
    return handleServerError(res, error);
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

    // ═══ SUPABASE: Usuarios trabajadores ═══
    if (supabase) {
      try {
        let query = supabase
          .from('usuarios')
          .select('id, empresa_id, nombre, apellido, email, rol_global, activo, created_at, updated_at, foto_perfil_url');

        if (!isRootUser(req)) {
          const currentTenant = getTenantCode(req);
          if (!currentTenant) return res.status(403).json({ error: 'Acceso restringido.' });
          const { data: emp } = await supabase.from('empresas').select('id').eq('codigo', currentTenant).single();
          if (emp) query = query.eq('empresa_id', emp.id);
        } else if (req.query.empresa) {
          const { data: emp } = await supabase.from('empresas').select('id').eq('codigo', req.query.empresa).single();
          if (emp) query = query.eq('empresa_id', emp.id);
        }

        const { data: supaUsers, error: supaErr } = await query.order('created_at', { ascending: false });
        if (supaErr) console.warn('[GET USERS] Supabase error:', supaErr.message);

        // Load empresas for name resolution
        let empresasMap = {};
        if (supaUsers && supaUsers.length > 0) {
          const empIds = [...new Set(supaUsers.map(u => u.empresa_id).filter(Boolean))];
          if (empIds.length > 0) {
            const { data: emps } = await supabase.from('empresas').select('id, nombre, codigo');
            if (emps) emps.forEach(e => { empresasMap[e.id] = e; });
          }
        }

        (supaUsers || []).filter(u => u.activo !== false).forEach(u => {
          const emp = empresasMap[u.empresa_id] || {};
          const email = (u.email || '').toLowerCase();
          if (email && !seenEmails.has(email)) {
            seenEmails.add(email);
            allUsers.push({
              id: u.id,
              displayId: u.id,
              nombre: u.nombre || '',
              apellido: u.apellido || '',
              email: email,
              rol: u.rol_global || 'user',
              tenant_code: emp.codigo || '',
              tenant: emp.nombre || emp.codigo || 'N/A',
              status: u.activo ? 'active' : 'inactive',
              registered: u.created_at || new Date().toISOString(),
              lastActivity: u.updated_at || null,
              avatar: u.foto_perfil_url || null,
              notas: '',
              source: 'supabase'
            });
          }
        });
      } catch (err) {
        console.warn('[GET USERS] Supabase falló:', err.message);
      }
    }

    // ═══ NOCODB: Owners/Admins registrados ═══
    if (isRootUser(req) || !req.query.empresa) {
      try {
        const nocoParams = { limit: 500 };
        const nocoResp = await nocodbApi.get(USUARIOS_TABLE, { params: nocoParams });
        const nocoUsers = nocoResp.data?.list || [];

        nocoUsers.forEach(u => {
          const email = (u.email || u.Email || '').toLowerCase();
          const rawEstado = (u.estado || u.Estado || 'Activo').toString().trim().toLowerCase();
          const isActive = !['inactivo', 'inactive', 'suspendido', 'suspended'].includes(rawEstado);
          if (email && !seenEmails.has(email) && isActive) {
            seenEmails.add(email);
            const empresaCodigo = u.empresa_codigo || u.Empresa_Codigo || u.EmpresaCodigo || 'ROOT';
            allUsers.push({
              id: u.Id || u.id || u.ID || email,
              displayId: u.Id || u.id || email,
              nombre: u.nombre || u.Nombre || '',
              apellido: u.apellido || u.Apellido || '',
              email: email,
              rol: u.rol || u.Rol || u.rol_global || 'Owner',
              tenant_code: empresaCodigo,
              tenant: empresaCodigo,
              status: 'active',
              registered: u.created_at || u.Created_at || u.fecha_registro || new Date().toISOString(),
              lastActivity: u.updated_at || null,
              avatar: u.foto_perfil_url || u.banner_perfil_url || null,
              notas: '',
              source: 'nocodb'
            });
          }
        });
      } catch (err) {
        console.warn('[GET USERS] NocoDB falló:', err.message);
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
    const source = req.query.source || 'supabase';

    if (source === 'nocodb') {
      // ═══ NOCODB: Delete owner/admin by email or ID ═══
      try {
        let nocoUser = null;
        // Try by record ID first
        try {
          const resp = await nocodbApi.get(`${USUARIOS_TABLE}/${id}`);
          nocoUser = resp.data;
        } catch (_) {}
        // Try by email (id might be email)
        if (!nocoUser && id.includes('@')) {
          const resp = await nocodbApi.get(USUARIOS_TABLE, {
            params: { where: `(email,eq,${id})`, limit: 1 }
          });
          nocoUser = resp.data?.list?.[0] || null;
        }

        if (!nocoUser) return res.status(404).json({ error: 'Usuario no encontrado en NocoDB.' });

        const recordId = extractNocoRecordId(nocoUser);
        const nombreUsuario = nocoUser.nombre || nocoUser.Nombre || '';
        const emailUsuario = nocoUser.email || nocoUser.Email || 'N/A';

        if (recordId) {
          await deleteNocoRecord(USUARIOS_TABLE, recordId);
        } else {
          const whereEmail = buildNocoWhereFilter('email', emailUsuario);
          if (whereEmail) await deleteNocoRecordByFilter(USUARIOS_TABLE, whereEmail);
        }

        return res.json({ message: 'Usuario eliminado de NocoDB exitosamente' });
      } catch (err) {
        console.warn('[DELETE USER NOCODB] Error:', err.message);
        return handleServerError(res, err);
      }
    }

    // ═══ SUPABASE: Delete trabajador ═══
    if (!requireSupabase(res)) return;

    // 1. Fetch user data before deleting
    const { data: userRecord } = await supabase
      .from('usuarios')
      .select('id, nombre, apellido, email')
      .eq('id', id)
      .single();

    const nombreUsuario = userRecord ? `${userRecord.nombre || ''} ${userRecord.apellido || ''}`.trim() : `ID: ${id}`;
    const emailUsuario = userRecord?.email || 'N/A';

    // 2. Delete module assignments
    await supabase.from('usuario_modulos').delete().eq('usuario_id', id);

    // 3. Delete profile
    await supabase.from('usuarios').delete().eq('id', id);

    // 4. Delete Supabase Auth user
    const { error: authErr } = await supabase.auth.admin.deleteUser(id);
    if (authErr) console.warn('[SUPABASE] Error eliminando auth user:', authErr.message);

    // 5. Notify admin
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER,
      '🗑️ Trabajador Eliminado',
      'Eliminación de Trabajador',
      'Se ha eliminado un trabajador.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>ID:</strong> ${id}</li>
        <li><strong>Nombre:</strong> ${nombreUsuario}</li>
        <li><strong>Email:</strong> ${emailUsuario}</li>
      </ul>`
    );

    res.json({ message: 'Trabajador eliminado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
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
