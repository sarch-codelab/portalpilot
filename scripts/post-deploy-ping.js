#!/usr/bin/env node
/* =============================================================
   scripts/post-deploy-ping.js
   Se ejecuta automáticamente después de cada `vercel deploy`.
   Llama al endpoint /api/ping-search-engines para notificar
   a Google y Bing que el sitio fue actualizado.
   ============================================================= */

const https = require('https');

const SITE_URL   = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://portal-pilot.vercel.app';

const SECRET     = process.env.PING_SECRET || '';
const ENDPOINT   = `${SITE_URL}/api/ping-search-engines`;

function post(url, secret) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify({ secret });
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-ping-secret' : secret,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('\n🔔 Portal Pilot — Post-deploy ping');
  console.log(`   Endpoint: ${ENDPOINT}`);
  console.log(`   Time    : ${new Date().toISOString()}\n`);

  try {
    const result = await post(ENDPOINT, SECRET);
    console.log('✅ Ping completado:', JSON.stringify(result, null, 2));

    if (result.body?.pings) {
      const { google, bing } = result.body.pings;
      console.log(`\n   Google sitemap ping : ${google?.status}`);
      console.log(`   Bing   sitemap ping : ${bing?.status}`);
    }

    if (result.body?.indexing) {
      const idx = result.body.indexing;
      if (idx.skipped) {
        console.log('\n   Google Indexing API : ⏭️  Omitida (sin credenciales configuradas)');
        console.log('   → Para activarla, añade GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en Vercel.\n');
      } else {
        console.log('\n   Google Indexing API resultados:');
        idx.forEach(({ url, status }) => console.log(`   ${status === 200 ? '✅' : '⚠️ '} ${status} — ${url}`));
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error en post-deploy ping:', err.message);
    process.exit(0); // no fallar el deploy por esto
  }
})();
