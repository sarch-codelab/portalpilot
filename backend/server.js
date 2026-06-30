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

// 🔧 FIX VERCEL: dotenv solo en desarrollo local
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const app = express();

// 🔧 FIX VERCEL: Detectar entorno serverless
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
console.log(`[STARTUP] Environment: ${IS_SERVERLESS ? 'SERVERLESS' : 'LOCAL'}, Node: ${process.version}`);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOptions = {
  origin: FRONTEND_URL,
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
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
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
app.use(express.json());

function handleServerError(res, error) {
  console.error('[ERROR]', error?.message || error);
  return res.status(500).json({ error: 'Ha ocurrido un error interno en el servidor' });
}

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

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token no provisto' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
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

if (!process.env.JWT_SECRET || !API_TOKEN) {
  console.warn('[STARTUP] WARNING: JWT_SECRET o NOCODB_API_TOKEN no están definidas localmente. Algunas rutas locales de API fallarán, pero el servidor estático funcionará.');
}

console.log(`[NocoDB] URL=${NOCODB_URL} TOKEN_CONFIGURED=${!!API_TOKEN}`);

function requireNocoDbToken(res) {
  if (!API_TOKEN) {
    res.status(500).json({ error: 'NocoDB API token no configurado.' });
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
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
    pass: process.env.EMAIL_PASS
  }
});

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'portalpilot.hn@gmail.com';
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
    jwt_configured: !!process.env.JWT_SECRET
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

app.post('/api/registro', async (req, res) => {
  try {
    const {
      empresaNombre, empresaCodigo, empresaSector,
      usuarioNombre, usuarioApellido, email, rol,
      password, dosFaActivo, terminosAceptados
    } = req.body;

    if (!email || !password || !empresaCodigo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    try {
      await nocodbApi.post(EMPRESAS_TABLE, {
        nombre: empresaNombre,
        codigo: empresaCodigo,
        sector: empresaSector
      });
    } catch (err) {
      console.log('Nota: La empresa podría ya existir.', err.response?.data || err.message);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const nuevoUsuario = {
      nombre: usuarioNombre,
      apellido: usuarioApellido,
      email: email,
      rol: rol,
      password: passwordHash,
      dosfa_activo: dosFaActivo,
      terminos_aceptados: terminosAceptados,
      empresa_codigo: empresaCodigo
    };

    await nocodbApi.post(USUARIOS_TABLE, nuevoUsuario);

    // 🔧 FIX VERCEL: await en lugar de dispatchEmailAsync
    await enviarOnboardingEmail(email);

    res.status(201).json({ message: 'Usuario y Empresa registrados con éxito' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const routeStart = Date.now();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Por favor, proporciona email y contraseña.' });
    }

    const emailNorm = email.trim().toLowerCase();
    const queryStart = Date.now();

    const r1 = await nocodbApi.get(USUARIOS_TABLE, {
      params: { where: `(email,eq,${emailNorm})`, limit: 10 }
    });
    const responseData = r1.data.list || [];
    const queryDuration = Date.now() - queryStart;

    const usuariosEncontrados = responseData;

    if (!usuariosEncontrados || usuariosEncontrados.length === 0) {
      if (emailNorm.includes('@')) {
        // 🔧 FIX VERCEL: await en lugar de fire-and-forget
        await enviarAlertaNuevoAcceso(emailNorm, req, false);
      }
      return res.status(401).json({ error: 'Credenciales inválidas (usuario no encontrado).' });
    }

    const pwdStart = Date.now();
    const matchedUsers = (await Promise.all(usuariosEncontrados.map(async usuario => {
      if (!usuario.password) return null;
      const isMatch = await bcrypt.compare(password, usuario.password);
      if (isMatch) return usuario;
      if (usuario.password === password) return usuario;
      return null;
    }))).filter(Boolean);
    const pwdDuration = Date.now() - pwdStart;

    if (matchedUsers.length === 0) {
      const hasPendingUser = usuariosEncontrados.some(u => normalizeStatus(u.status || u.Status || u.estado || u.Estado || '') === 'pending');
      if (!hasPendingUser) {
        await enviarAlertaNuevoAcceso(usuariosEncontrados[0].email || email, req, false);
      }
      return res.status(401).json({ error: 'Credenciales inválidas (contraseña incorrecta).' });
    }

    const loginAccounts = await Promise.all(matchedUsers.map(async usuario => {
      const rawEmpresa = usuario.empresa_codigo || usuario.Empresa_Codigo || usuario.EmpresaCodigo || usuario.empresaCodigo || 'ROOT';
      const rawRole = usuario.rol || usuario.Rol || usuario.role || usuario.Role || '';
      const rawStatus = usuario.status || usuario.Status || usuario.estado || usuario.Estado || 'active';
      const rawEmail = usuario.email || usuario.Email || usuario.EMAIL || '';
      const rawName = usuario.nombre || usuario.Nombre || `${usuario.firstName || ''} ${usuario.lastName || ''}`.trim();

      let normalizedEmpresa = rawEmpresa.toString().trim();
      const userRole = rawRole.toString().trim().toLowerCase();
      const userStatus = normalizeStatus(rawStatus);

      // Solo forzar a ROOT a los roles de superusuario global o si ya pertenece a ROOT
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
        process.env.JWT_SECRET,
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

    // 🔧 FIX VERCEL: await en lugar de setTimeout
    if (!hasPendingAccount) {
      await enviarAlertaNuevoAcceso(selectedAccount.email, req, true);
    }

    res.status(200).json({
      message: 'Login exitoso',
      token: selectedAccount.token,
      user: selectedAccount,
      accounts: loginAccounts
    });

  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/refresh', authenticate, (req, res) => {
  try {
    const newToken = jwt.sign(
      { sub: req.user.sub, rol: req.user.rol, empresa_codigo: req.user.empresa_codigo },
      process.env.JWT_SECRET,
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
        process.env.JWT_SECRET,
        { expiresIn: '6h' }
      );
    } catch (e) {
      console.warn('[CREAR_TENANT] No se pudo generar token:', e.message);
    }

    // 🔧 FIX VERCEL: await en lugar de void
    await enviarAlertaActivacionCuenta(emailAdmin, passwordTemporal, activationToken, nombre);

    // 🔧 FIX VERCEL: await en lugar de setImmediate
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
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
      process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
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

    if (targetTenantId) {
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
          console.warn(`[DELETE USER] Falló para ${userRecordId}:`, err.message);
          await patchNocoRecordByFilter(USUARIOS_TABLE, buildNocoWhereFilter('email', user.email), { estado: 'Inactivo' });
        }
      });

      try {
        if (recordId) {
          await deleteNocoRecord(EMPRESAS_TABLE, recordId);
        } else {
          const tenantWhereByCode = buildNocoWhereFilter('codigo', finalTenantCode);
          if (tenantWhereByCode) await deleteNocoRecordByFilter(EMPRESAS_TABLE, tenantWhereByCode);
          else await deleteNocoRecord(EMPRESAS_TABLE, targetTenantId);
        }
      } catch (err) {
        console.warn(`[DELETE TENANT] Falló:`, err.message);
        const filterToPatch = buildNocoWhereFilter('codigo', finalTenantCode);
        if (filterToPatch) await patchNocoRecordByFilter(EMPRESAS_TABLE, filterToPatch, { estado: 'Inactivo' });
      }
    }

    res.json({ message: 'Tenant y usuarios asociados eliminados exitosamente' });
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

app.post('/api/alerta-no-autorizado', async (req, res) => {
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
          <li><strong>Página:</strong> ${url}</li>
          <li><strong>Referrer:</strong> ${referrer || 'Directo'}</li>
          <li><strong>IP:</strong> ${ip}</li>
          <li><strong>Ubicación:</strong> ${ubicacion}</li>
          <li><strong>Dispositivo:</strong> ${dispositivo}</li>
          <li><strong>Fecha:</strong> ${fechaActual}</li>
        </ul>
      </div>
    `;

    await transporter.sendMail({
      from: `"Seguridad Portal Pilot" <${process.env.EMAIL_USER || 'portalpilot.hn@gmail.com'}>`,
      to: process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
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
      from: `"Seguridad Portal Pilot" <${process.env.EMAIL_USER || 'portalpilot.hn@gmail.com'}>`,
      to: email,
      subject: '🔑 Código de Verificación',
      html: htmlContent
    });

    console.log(`[Recuperación] Código enviado a ${email}`);
    res.json({ message: 'Si el correo está registrado, se ha enviado un código.' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/recuperacion/verificar', recoveryLimiter, async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Faltan campos obligatorios.' });
    }

    let found = null;
    try {
      const resp = await nocodbApi.get(RECOVERY_CODES_TABLE, {
        params: { where: `(email,eq,${email}),(code,eq,${code.trim()})`, limit: 1 }
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
    return handleServerError(res, error);
  }
});

app.get('/api/users', authenticate, async (req, res) => {
  if (!requireNocoDbToken(res)) return;
  try {
    const empresasRes = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
    const empresasList = empresasRes.data.list || [];
    const codigoToName = {};
    empresasList.forEach(e => {
      const codigo = e.codigo || e.Codigo || e.id || e.Id;
      const nombre = e.nombre || e.Nombre || '';
      if (codigo) codigoToName[codigo] = nombre;
    });

    let whereFilter = null;
    let tenantFilterCode = null;
    if (req.query.empresa) {
      const q = req.query.empresa;
      tenantFilterCode = q;
      whereFilter = `(empresa_codigo,eq,${formatNocoFilter(tenantFilterCode)})`;
    }

    const params = { limit: 200 };
    if (!isRootUser(req)) {
      const currentTenant = getTenantCode(req);
      if (!currentTenant) return res.status(403).json({ error: 'Acceso restringido.' });
      params.where = `(empresa_codigo,eq,${formatNocoFilter(currentTenant)})`;
    } else if (whereFilter) {
      params.where = whereFilter;
    }

    const response = await nocodbApi.get(USUARIOS_TABLE, { params });
    const list = response.data.list || [];
    const visibleUsers = list.filter(u => !isDeletedStatus(u.status || u.Status || u.estado || u.Estado || 'active'));

    const usersMapped = visibleUsers.map(u => {
      const codigo = u.empresa_codigo || u.Empresa_Codigo || '';
      const rawId = u._id || u._recordId || u.recordId || u.id || u.Id || '';
      return {
        id: String(rawId),
        displayId: String(u.Id || u.id || rawId),
        nombre: u.nombre || u.Nombre || '',
        apellido: u.apellido || u.Apellido || '',
        email: u.email || u.Email || '',
        rol: u.rol || u.Rol || 'viewer',
        tenant_code: codigo || '',
        tenant: codigoToName[codigo] || codigo || 'N/A',
        status: normalizeStatus(u.status || u.Status || u.estado || u.Estado || 'active'),
        registered: u.CreatedAt || u.created_at || new Date().toISOString(),
        lastActivity: u.last_activity || null,
        notas: u.notas || ''
      };
    });

    res.json(usersMapped);
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const empresasRes = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
    const empresasList = empresasRes.data.list || [];
    const codigoToName = {};
    empresasList.forEach(e => {
      const codigo = e.codigo || e.Codigo || e.id || e.Id;
      const nombre = e.nombre || e.Nombre || '';
      if (codigo) codigoToName[codigo] = nombre;
    });

    let usuario = null;
    try {
      const response = await nocodbApi.get(`${USUARIOS_TABLE}/${encodeURIComponent(id)}`);
      usuario = response.data;
    } catch (err) {
      const response = await nocodbApi.get(USUARIOS_TABLE, {
        params: { where: `(Id,eq,${formatNocoFilter(id, { numeric: true })})`, limit: 1 }
      });
      usuario = response.data.list?.[0];
    }

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const codigo = usuario.empresa_codigo || usuario.Empresa_Codigo || '';
    if (!isRootUser(req) && !assertTenantAccess(req, codigo)) {
      return res.status(403).json({ error: 'No tienes permiso para ver este usuario.' });
    }

    const rawId = usuario._id || usuario._recordId || usuario.recordId || usuario.id || usuario.Id || '';
    res.json({
      id: String(rawId),
      displayId: String(usuario.Id || usuario.id || rawId),
      nombre: usuario.nombre || usuario.Nombre || '',
      apellido: usuario.apellido || usuario.Apellido || '',
      email: usuario.email || usuario.Email || '',
      rol: usuario.rol || usuario.Rol || 'viewer',
      tenant_code: codigo || '',
      tenant: codigoToName[codigo] || codigo || 'N/A',
      status: normalizeStatus(usuario.status || usuario.Status || usuario.estado || usuario.Estado || 'active'),
      registered: usuario.CreatedAt || usuario.created_at || new Date().toISOString(),
      lastActivity: usuario.last_activity || null,
      notas: usuario.notas || ''
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.post('/api/users', authenticate, async (req, res) => {
  try {
    const { nombre, apellido, email, rol, tenant, notas, password } = req.body;

    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: 'Nombre, Email y Rol son obligatorios.' });
    }

    const passwordTemporal = password || generateSecurePassword();
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(passwordTemporal, salt);

    let empresaCodigo = tenant || '';
    if (tenant && tenant.toString().trim().toUpperCase() !== 'ROOT') {
      try {
        const empresasRes = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
        const found = (empresasRes.data.list || []).find(e => {
          const n = e.nombre || e.Nombre || '';
          const c = e.codigo || e.Codigo || e.id || e.Id;
          return (tenant === n) || (tenant === c);
        });
        if (found) empresaCodigo = found.codigo || found.Codigo || found.id || found.Id;
      } catch (e) { /* continuar */ }
    }

    if (!empresaCodigo && !isRootUser(req)) empresaCodigo = getTenantCode(req);
    if (!isRootUser(req) && empresaCodigo && empresaCodigo !== getTenantCode(req)) {
      return res.status(403).json({ error: 'No puedes crear usuarios fuera de tu tenant.' });
    }

    const nuevoUsuario = {
      nombre, apellido: apellido || '', email, rol, password: passwordHash,
      empresa_codigo: empresaCodigo,
      status: 'pending', Status: 'pending', estado: 'pending', Estado: 'pending',
      notas: notas || ''
    };

    const existingResponse = await nocodbApi.get(USUARIOS_TABLE, {
      params: { where: `(email,eq,${email})`, limit: 1 }
    });
    if (existingResponse.data.list && existingResponse.data.list.length > 0) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    const response = await nocodbApi.post(USUARIOS_TABLE, nuevoUsuario);
    const creado = response.data;

    let tenantDisplayName = null;
    try {
      if (empresaCodigo) {
        const foundTenant = await findTenantByIdentifier(empresaCodigo);
        tenantDisplayName = foundTenant?.nombre || foundTenant?.Nombre || null;
      }
    } catch (e) { /* continuar */ }

    // 🔧 FIX VERCEL: await en lugar de dispatchEmailAsync
    await enviarAlertaActivacionCuenta(email, passwordTemporal, null, tenantDisplayName);

    // 🔧 FIX VERCEL: await en lugar de fire-and-forget
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
      '👤 Nuevo Usuario Registrado',
      'Nuevo Usuario Creado',
      'Se ha creado un nuevo usuario.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>Nombre:</strong> ${nombre} ${apellido || ''}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Rol:</strong> ${rol}</li>
        <li><strong>Tenant:</strong> ${tenant || req.user.empresa_codigo || 'N/A'}</li>
      </ul>`
    );

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: creado._id || creado._recordId || creado.recordId || creado.id || creado.Id,
        nombre: creado.nombre, email: creado.email, rol: creado.rol, status: 'pending'
      }
    });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, email, rol, tenant, notas, status, password, reason } = req.body;

    let usuarioActual = null;
    try {
      const currentResponse = await nocodbApi.get(`${USUARIOS_TABLE}/${encodeURIComponent(id)}`);
      usuarioActual = currentResponse.data;
    } catch (err) {
      const currentResponse = await nocodbApi.get(USUARIOS_TABLE, {
        params: { where: `(Id,eq,${formatNocoFilter(id, { numeric: true })})`, limit: 1 }
      });
      usuarioActual = currentResponse.data.list?.[0];
    }

    if (!usuarioActual) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const actualTenant = usuarioActual.empresa_codigo || usuarioActual.Empresa_Codigo || '';
    if (!isRootUser(req) && !assertTenantAccess(req, actualTenant)) {
      return res.status(403).json({ error: 'No tienes permiso para modificar este usuario.' });
    }

    if (email && email !== usuarioActual.email) {
      const existingResponse = await nocodbApi.get(USUARIOS_TABLE, {
        params: { where: `(email,eq,${email})`, limit: 1 }
      });
      if (existingResponse.data.list && existingResponse.data.list.length > 0) {
        return res.status(400).json({ error: 'El correo ya está en uso.' });
      }
    }

    let empresaCodigoActualizado = tenant;
    if (tenant && tenant.toString().trim().toUpperCase() !== 'ROOT') {
      try {
        const empresasRes = await nocodbApi.get(EMPRESAS_TABLE, { params: { limit: 200 } });
        const found = (empresasRes.data.list || []).find(e => {
          const n = e.nombre || e.Nombre || '';
          const c = e.codigo || e.Codigo || e.id || e.Id;
          return tenant === n || tenant === c;
        });
        if (found) empresaCodigoActualizado = found.codigo || found.Codigo || found.id || found.Id;
      } catch (e) { /* continuar */ }
    }

    const targetRecordId = usuarioActual._id || usuarioActual._recordId || usuarioActual.recordId || usuarioActual.id || usuarioActual.Id || id;
    const normalizedStatus = typeof status !== 'undefined' ? normalizeStatus(status) : undefined;
    const updateFields = {};

    if (typeof nombre !== 'undefined') updateFields.nombre = nombre;
    if (typeof apellido !== 'undefined') updateFields.apellido = apellido;
    if (typeof email !== 'undefined') updateFields.email = email;
    if (typeof rol !== 'undefined') updateFields.rol = rol;
    if (typeof notas !== 'undefined') updateFields.notas = notas;
    if (typeof normalizedStatus !== 'undefined') {
      updateFields.status = normalizedStatus;
      updateFields.Status = normalizedStatus;
      updateFields.estado = normalizedStatus;
      updateFields.Estado = normalizedStatus;
    }
    if (typeof empresaCodigoActualizado !== 'undefined') {
      updateFields.empresa_codigo = empresaCodigoActualizado;
    }
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    }

    const patchPayload = { id: targetRecordId, Id: targetRecordId, ...updateFields };
    await nocodbApi.patch(USUARIOS_TABLE, patchPayload);

    const currentStatus = normalizeStatus(usuarioActual.status || usuarioActual.Status || usuarioActual.estado || usuarioActual.Estado || '');
    const shouldSendOnboarding = currentStatus === 'pending' && normalizedStatus === 'active';
    const updatedEmail = email || usuarioActual.email;

    if (shouldSendOnboarding && updatedEmail) {
      await enviarOnboardingEmail(updatedEmail);
    }

    if (normalizedStatus && ['active', 'suspended'].includes(normalizedStatus) && updatedEmail) {
      await enviarCambioEstadoUsuario(updatedEmail, normalizedStatus, req.user.email || 'admin@portalpilot.io', reason || '');
    }

    // 🔧 FIX VERCEL: await en lugar de dispatchEmailAsync
    const esAccion = status === 'suspended' ? 'Suspensión' : status === 'active' ? 'Activación' : 'Actualización';
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
      `✏️ ${esAccion} de Usuario`,
      `Usuario ${esAccion}`,
      `Operación de ${esAccion} realizada.`,
      `<ul style="list-style: none; padding: 0;">
        <li><strong>ID:</strong> ${id}</li>
        ${nombre ? `<li><strong>Nombre:</strong> ${nombre} ${apellido || ''}</li>` : ''}
        ${email ? `<li><strong>Email:</strong> ${email}</li>` : ''}
        ${rol ? `<li><strong>Rol:</strong> ${rol}</li>` : ''}
        ${status ? `<li><strong>Estado:</strong> ${status.toUpperCase()}</li>` : ''}
      </ul>`
    );

    res.json({ message: 'Usuario actualizado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
  }
});

app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    console.info(`[DELETE USER] Intenta eliminar usuario ID=${id}`);

    let nombreUsuario = `ID: ${id}`, emailUsuario = 'N/A';
    let userRecord = null;
    try {
      // Intentar GET directo primero
      const findRes = await nocodbApi.get(`${USUARIOS_TABLE}/${encodeURIComponent(id)}`);
      userRecord = findRes.data;
    } catch (err) {
      try {
        const findRes = await nocodbApi.get(USUARIOS_TABLE, {
          params: { where: `(Id,eq,${formatNocoFilter(id, { numeric: true })})` }
        });
        userRecord = findRes.data.list?.[0];
      } catch (err2) {
        try {
          const findRes = await nocodbApi.get(USUARIOS_TABLE, {
            params: { where: `(id,eq,${formatNocoFilter(id)})` }
          });
          userRecord = findRes.data.list?.[0];
        } catch (err3) {
          // continuar con userRecord como null
        }
      }
    }

    if (userRecord) {
      nombreUsuario = `${userRecord.nombre || ''} ${userRecord.apellido || ''}`.trim() || `ID: ${id}`;
      emailUsuario = userRecord.email || 'N/A';
    }

    const userIdentifier = extractNocoRecordId(userRecord) || id;
    let deleted = false;

    try {
      if (userIdentifier && !isBusinessRecordCode(userIdentifier)) {
        await deleteNocoRecord(USUARIOS_TABLE, userIdentifier);
        deleted = true;
      } else {
        const userWhereByEmail = userRecord?.email ? buildNocoWhereFilter('email', userRecord.email) : null;
        if (userWhereByEmail) {
          await deleteNocoRecordByFilter(USUARIOS_TABLE, userWhereByEmail);
          deleted = true;
        }
      }
    } catch (deleteError) {
      console.warn(`[DELETE USER] DELETE falló: ${deleteError.message}`);
      if (!deleted) {
        try {
          const patchFilter = userRecord?.email ? buildNocoWhereFilter('email', userRecord.email) : null;
          if (patchFilter) {
            await patchNocoRecordByFilter(USUARIOS_TABLE, patchFilter, {
              estado: 'Inactivo', eliminado_en: new Date().toISOString()
            });
            deleted = true;
          }
        } catch (patchError) {
          console.error(`[DELETE USER] Soft delete falló: ${patchError.message}`);
          throw patchError;
        }
      }
    }

    // 🔧 FIX VERCEL: await en lugar de dispatchEmailAsync
    await enviarCorreoPortalPilot(
      process.env.EMAIL_USER || 'portalpilot.hn@gmail.com',
      '🗑️ Usuario Eliminado',
      'Eliminación de Usuario',
      'Se ha eliminado un usuario.',
      `<ul style="list-style: none; padding: 0;">
        <li><strong>ID:</strong> ${id}</li>
        <li><strong>Nombre:</strong> ${nombreUsuario}</li>
        <li><strong>Email:</strong> ${emailUsuario}</li>
      </ul>`
    );

    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    return handleServerError(res, error);
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
