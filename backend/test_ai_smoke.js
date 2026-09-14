#!/usr/bin/env node
/**
 * SMOKE TEST IA — llamada real al AI Gateway en producción.
 * Crea un tenant efímero PP-G{stamp}A, invoca /api/ai/chat, verifica que el
 * consumo quedó registrado en ai_usage_log (provider/modelo/tokens/coste) y
 * limpia todos los datos creados. No destructivo.
 *
 * Uso: TEST_BASE=https://portal-pilot.vercel.app node backend/test_ai_smoke.js
 * Salida esperada: AI SMOKE PASS (200 con contenido, sin secretos, usage logueado)
 */
const axios = require('axios');
const crypto = require('crypto');
const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
const CODE = `PP-G${stamp}A`;
const EMAIL = `ai.smoke.r${stamp.toLowerCase()}@pp.test`;
const PW = 'AiSmoke123!';
const ctx = {};

async function req(method, path, { token, body } = {}) {
  const r = await axios({ method, url: `${BASE}${path}`, data: body,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    validateStatus: () => true, timeout: 60000 });
  return { status: r.status, data: r.data };
}

async function cleanup() {
  if (!ctx.supabase) return;
  const sb = ctx.supabase;
  await sb.from('ai_usage_log').delete().eq('empresa_codigo', CODE);
  await sb.from('tenant_usage').delete().eq('empresa_codigo', CODE);
  await sb.from('seguridad_eventos').delete().eq('empresa_codigo', CODE);
  await sb.from('usuarios').delete().eq('empresa_codigo', CODE);
  await sb.from('subscriptions').delete().eq('empresa_codigo', CODE);
  await sb.from('tenants').delete().eq('codigo', CODE);
  await sb.from('empresas').delete().eq('codigo', CODE);
  try {
    const { data: authUsers } = await sb.auth.admin.listUsers();
    const orphan = (authUsers?.users || []).find(u => u.email === EMAIL);
    if (orphan) await sb.auth.admin.deleteUser(orphan.id);
  } catch (_) {}
}

(async () => {
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '.env') });
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (url && key) ctx.supabase = createClient(url, key);
  } catch (_) {}

  const reg = await req('POST', '/api/registro', { body: {
    empresaNombre: 'AI Smoke', empresaCodigo: CODE,
    usuarioNombre: 'AI', usuarioApellido: 'Smoke', email: EMAIL, password: PW,
    plan: 'starter', terminosAceptados: true } });
  if (![200, 201].includes(reg.status)) { console.log('AI SMOKE FAIL — registro', reg.status, JSON.stringify(reg.data).slice(0, 200)); await cleanup(); process.exit(1); }
  const log = await req('POST', '/api/login', { body: { email: EMAIL, password: PW } });
  const t = log.data?.token;
  if (!t) { console.log('AI SMOKE FAIL — login'); await cleanup(); process.exit(1); }

  const chat = await req('POST', '/api/ai/chat', { token: t, body: { message: 'Responde solo: OK', max_tokens: 10 } });
  const bodyStr = JSON.stringify(chat.data || {});
  const leaksSecret = /gsk_|sk-or-|sk-[a-zA-Z0-9]{20,}/.test(bodyStr);
  if (chat.status === 200) {
    if (leaksSecret) { console.log('AI SMOKE FAIL — secreto expuesto en respuesta'); await cleanup(); process.exit(1); }
    let usageRow = null;
    if (ctx.supabase) {
      const { data } = await ctx.supabase.from('ai_usage_log').select('provider, modelo, total_tokens, estimated_cost').eq('empresa_codigo', CODE).limit(1);
      usageRow = data?.[0] || null;
    }
    if (ctx.supabase && !usageRow) { console.log('AI SMOKE FAIL — llamada 200 pero sin registro en ai_usage_log'); await cleanup(); process.exit(1); }
    console.log('AI SMOKE PASS — provider real respondió, sin secretos, usage registrado:', usageRow ? JSON.stringify(usageRow) : '(verificación de log omitida: sin service-role local)');
  } else if (chat.status === 503 || chat.status === 429) {
    console.log(`AI SMOKE BLOCKED (${chat.status}) —`, bodyStr.slice(0, 160), '→ configuración del propietario requerida (GROQ_API_KEY / cuota)');
  } else {
    console.log('AI SMOKE FAIL —', chat.status, bodyStr.slice(0, 200));
  }
  await cleanup();
  process.exit(chat.status === 200 ? 0 : 2);
})();
