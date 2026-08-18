/* =========================================================
   api/ping-search-engines.js — Vercel Serverless
   Pings Google & Bing with the sitemap after each deploy.
   Optionally submits key URLs to the Google Indexing API.

   SETUP (una sola vez):
   1. Google Cloud Console → habilitar "Indexing API"
   2. Crear Service Account → descargar JSON de credenciales
   3. En Vercel → Settings → Environment Variables:
      - GOOGLE_SERVICE_ACCOUNT_EMAIL  (client_email del JSON)
      - GOOGLE_PRIVATE_KEY            (private_key del JSON, con saltos de línea reales)
   4. En Google Search Console → Configuración → Usuarios y permisos
      → Añadir el service account email como "Propietario"
   ========================================================= */

const https = require('https');
const crypto = require('crypto');

const SITE_URL   = 'https://portal-pilot.vercel.app';
const SITEMAP    = `${SITE_URL}/sitemap.xml`;
const SECRET_KEY = process.env.PING_SECRET || '';   // clave simple para proteger el endpoint

/* URLs de alta prioridad que Google indexará inmediatamente */
const PRIORITY_URLS = [
  `${SITE_URL}/`,
  `${SITE_URL}/download.html`,
  `${SITE_URL}/pay_plan.html`,
  `${SITE_URL}/documentacion.html`,
  `${SITE_URL}/support.html`,
  `${SITE_URL}/registrov2.html`,
];

/* ── Helpers HTTP ─────────────────────────────────────── */

function httpGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      resolve({ status: res.statusCode, url });
    });
    req.on('error', (err) => resolve({ status: 'ERROR', url, error: err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 'TIMEOUT', url }); });
  });
}

function httpPost(hostname, path, body, headers) {
  return new Promise((resolve) => {
    const data   = JSON.stringify(body);
    const opts   = { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } };
    const req    = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', (err) => resolve({ status: 'ERROR', error: err.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ status: 'TIMEOUT' }); });
    req.write(data);
    req.end();
  });
}

/* ── JWT para Google Indexing API ────────────────────── */

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getGoogleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) return null;   // credenciales no configuradas → saltar

  const now = Math.floor(Date.now() / 1000);
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss  : email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud  : 'https://oauth2.googleapis.com/token',
    iat  : now,
    exp  : now + 3600,
  })));

  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig     = base64url(sign.sign(key));
  const jwt     = `${header}.${payload}.${sig}`;

  const res = await httpPost('oauth2.googleapis.com', '/token', null, {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': 0,
  }).catch(() => null);

  /* Usar fetch nativo de Node 18 para el form POST */
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method : 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body   : new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion : jwt,
      }),
    });
    const json = await tokenRes.json();
    return json.access_token || null;
  } catch {
    return null;
  }
}

/* ── Google Indexing API ──────────────────────────────── */

async function submitToIndexingAPI(accessToken, urls) {
  if (!accessToken) return { skipped: true, reason: 'No credentials' };

  const results = [];
  for (const url of urls) {
    try {
      const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
        method : 'POST',
        headers: {
          Authorization  : `Bearer ${accessToken}`,
          'Content-Type' : 'application/json',
        },
        body: JSON.stringify({ url, type: 'URL_UPDATED' }),
      });
      results.push({ url, status: res.status });
    } catch (err) {
      results.push({ url, status: 'ERROR', error: err.message });
    }
  }
  return results;
}

/* ── Sitemap ping ────────────────────────────────────── */

async function pingSitemaps() {
  const encoded = encodeURIComponent(SITEMAP);
  const [google, bing] = await Promise.all([
    httpGet(`https://www.google.com/ping?sitemap=${encoded}`),
    httpGet(`https://www.bing.com/ping?sitemap=${encoded}`),
  ]);
  return { google, bing };
}

/* ── Handler principal ───────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  /* Protección: sólo POST con la clave correcta (o GET sin clave en desarrollo) */
  if (req.method === 'POST' && SECRET_KEY) {
    const provided = req.headers['x-ping-secret'] || req.body?.secret;
    if (provided !== SECRET_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log(`[ping-search-engines] Iniciando ping — ${new Date().toISOString()}`);

  try {
    /* 1. Ping sitemaps (siempre) */
    const sitemapPing = await pingSitemaps();
    console.log('[ping-search-engines] Sitemap ping:', sitemapPing);

    /* 2. Google Indexing API (si hay credenciales) */
    const accessToken   = await getGoogleAccessToken();
    const indexingResult = await submitToIndexingAPI(accessToken, PRIORITY_URLS);
    console.log('[ping-search-engines] Indexing API:', indexingResult);

    return res.status(200).json({
      success  : true,
      timestamp: new Date().toISOString(),
      sitemap  : SITEMAP,
      pings    : sitemapPing,
      indexing : indexingResult,
    });

  } catch (err) {
    console.error('[ping-search-engines] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
