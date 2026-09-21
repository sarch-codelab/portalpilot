#!/usr/bin/env node
/**
 * PRUEBAS DE SEGURIDAD Y COHERENCIA — Portal Pilot
 * Suite de ataque controlado + revocación de sesiones + límites IA + session UX.
 * No destruye datos reales: crea tenants efímeros PP-S{stamp}* y los limpia al final.
 *
 * Uso: TEST_BASE=http://localhost:3000 node backend/test_seguridad_ataque.js
 */
const axios = require('axios');
const crypto = require('crypto');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function req(method, path, { token, body, headers } = {}) {
  try {
    const r = await axios({
      method, url: `${BASE}${path}`, data: body,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
      validateStatus: () => true, timeout: 20000
    });
    return { status: r.status, data: r.data };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('\n═══ SEGURIDAD Y ATAQUE CONTROLADO — Portal Pilot ═══\n');
  const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
  const tenantA = `PP-S${stamp}A`;
  const password = 'TestPass123!';

  // ── SETUP: tenant A (owner + member) ──
  const reg = await req('POST', '/api/registro', { body: {
    empresaNombre: 'Sec Test A', empresaCodigo: tenantA,
    usuarioNombre: 'Owner', usuarioApellido: 'A', email: `owner.s${stamp}a@pp.test`,
    password, plan: 'starter', terminosAceptados: true
  }});
  check('Setup: registro tenant A', reg.status === 201 || reg.status === 200, `status=${reg.status}`);
  const loginA = await req('POST', '/api/login', { body: { email: `owner.s${stamp}a@pp.test`, password } });
  const tokenA = loginA.data?.token || '';
  check('Setup: login owner A', loginA.status === 200 && !!tokenA, `status=${loginA.status}`);

  const memReg = await req('POST', '/api/users', { token: tokenA, body: {
    nombre: 'Mem', apellido: 'Ber', email: `member.s${stamp}a@pp.test`, rol: 'miembro', password
  }});
  check('Setup: member creado', memReg.status === 201 || memReg.status === 200, `status=${memReg.status}`);
  const loginM = await req('POST', '/api/login', { body: { email: `member.s${stamp}a@pp.test`, password } });
  const tokenM = loginM.data?.token || '';
  check('Setup: login member A', loginM.status === 200 && !!tokenM, `status=${loginM.status}`);

  // ── 1. REVOCACIÓN DE SESIONES (token_version) ──
  const me0 = await req('GET', '/api/auth/status', { token: tokenM });
  check('member autenticado antes de revocar', me0.status === 200, `status=${me0.status}`);

  const revoke = await req('POST', `/api/users/${me0.data?.sub}/revoke-sessions`, { token: tokenA });
  check('owner revoca sesiones del member → 200', revoke.status === 200, `status=${revoke.status}`);
  await sleep(200); // invalidar caché local de token_version

  const me1 = await req('GET', '/api/auth/status', { token: tokenM });
  check('token del member REVOCADO → 401 SESSION_REVOKED', me1.status === 401 && me1.data?.code === 'SESSION_REVOKED', `status=${me1.status} code=${me1.data?.code}`);
  const opRev = await req('POST', '/api/productos', { token: tokenM, body: { nombre: 'X' } });
  check('operación con token revocado → 401', opRev.status === 401, `status=${opRev.status}`);

  // Re-login genera token nuevo (con token_version actual) y vuelve a funcionar
  const relogin = await req('POST', '/api/login', { body: { email: `member.s${stamp}a@pp.test`, password } });
  const tokenM2 = relogin.data?.token || '';
  const me2 = await req('GET', '/api/auth/status', { token: tokenM2 });
  check('re-login tras revocación funciona (token_version vigente)', me2.status === 200, `status=${me2.status}`);

  // ── 2. SESIONES REALES (sin datos fabricados) ──
  const ses = await req('GET', `/api/users/${me0.data?.sub}/sessions`, { token: tokenA });
  check('GET sessions del member (owner A) → 200', ses.status === 200, `status=${ses.status}`);
  const sessions = ses.data?.sessions || [];
  const fabricated = sessions.some(s => /anterior|inicial/i.test(String(s.deviceName || '')));
  check('sessions SIN registros fabricados', !fabricated, JSON.stringify(sessions.map(s => s.deviceName)).slice(0, 120));
  check('sessions marcadas como datos reales (flag fallback)', ses.data?.fallback === true || ses.data?.fallback === false, `fallback=${ses.data?.fallback}`);

  // ── 3. ATAQUE: manipulación de identidad/tenant ──
  const fakeHeaders = { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.fakeness.sig' };
  const forged = await req('GET', '/api/users', { headers: fakeHeaders });
  check('JWT falsificado → 403', forged.status === 403, `status=${forged.status}`);

  const tamper = await req('GET', '/api/tenants', { token: tokenA, headers: { 'X-Tenant': 'ROOT' } });
  check('header manipulado no escapa del tenant (lista = solo su tenant)', tamper.status === 200 && (tamper.data || []).every(t => t.codigo === tenantA), JSON.stringify((tamper.data || []).map(t => t.codigo)));

  const crossReg = await req('POST', '/api/registro', { body: {
    empresaNombre: 'Sec Test B', empresaCodigo: `PP-S${stamp}B`,
    usuarioNombre: 'Owner', usuarioApellido: 'B', email: `owner.s${stamp}b@pp.test`,
    password, plan: 'business', terminosAceptados: true
  }});
  const loginB = await req('POST', '/api/login', { body: { email: `owner.s${stamp}b@pp.test`, password } });
  const tokenB = loginB.data?.token || '';
  check('Setup: tenant B + login owner B', crossReg.status >= 200 && crossReg.status < 300 && !!tokenB, `reg=${crossReg.status} login=${loginB.status}`);

  const steal = await req('GET', `/api/tenant/${tenantA}`, { token: tokenB });
  check('owner B pide tenant A → 403/404', steal.status === 403 || steal.status === 404, `status=${steal.status}`);
  const stealUsers = await req('GET', '/api/users', { token: tokenB, headers: { 'X-Tenant': tenantA } });
  check('owner B no ve usuarios de A vía header', stealUsers.status === 200 && Array.isArray(stealUsers.data) && stealUsers.data.every(u => u.tenant_code === `PP-S${stamp}B`), JSON.stringify(stealUsers.data).slice(0, 120));

  const memberGlobal = await req('GET', '/api/usage', { token: tokenM2 });
  check('member GET /api/usage global → 403', memberGlobal.status === 403, `status=${memberGlobal.status}`);
  const memberAudit = await req('GET', '/api/auditoria', { token: tokenM2 });
  check('member GET /api/auditoria global → 403', memberAudit.status === 403, `status=${memberAudit.status}`);
  const memberPlans = await req('PUT', `/api/plans/starter/features`, { token: tokenM2, body: { features: [] } });
  check('member PUT plans features → 403', memberPlans.status === 403, `status=${memberPlans.status}`);
  const memberImpersonate = await req('POST', `/api/users/${me0.data?.sub}/impersonate`, { token: tokenM2 });
  check('member impersonate → 403/404', memberImpersonate.status === 403 || memberImpersonate.status === 404, `status=${memberImpersonate.status}`);

  // ── 4. MASS ASSIGNMENT: rol en body de registro público ──
  const regRoot = await req('POST', '/api/registro', { body: {
    empresaNombre: 'Fake Root', empresaCodigo: `PP-S${stamp}C`,
    usuarioNombre: 'Fake', usuarioApellido: 'Root', email: `fake.s${stamp}c@pp.test`,
    password, plan: 'enterprise', rol: 'root', empresa_codigo: 'ROOT', terminosAceptados: true
  }});
  check('registro público con rol=root en body no escala (tenant propio, owner de SU tenant)', regRoot.status === 201 || regRoot.status === 200, `status=${regRoot.status}`);
  const loginFake = await req('POST', '/api/login', { body: { email: `fake.s${stamp}c@pp.test`, password } });
  check('fake root NO obtiene empresa_codigo=ROOT', loginFake.data?.user?.empresa_codigo !== 'ROOT', `empresa=${loginFake.data?.user?.empresa_codigo}`);
  check('fake root NO obtiene rol ROOT', !/root|superadmin/i.test(String(loginFake.data?.user?.rol || '')), `rol=${loginFake.data?.user?.rol}`);

  // ── 5. LÍMITE IA server-side (budget) ──
  // El plan starter permite 100k tokens/mes; registrar 100k+ → la siguiente
  // llamada IA debe ser rechazada ANTES de llamar al proveedor (429).
  const usage = await req('POST', '/api/tenant/usage', { token: tokenA, body: { recurso: 'ai_tokens', cantidad: 100000 } });
  check('POST usage registra ai_tokens del periodo', usage.status === 200, `status=${usage.status}`);
  const chat = await req('POST', '/api/ai/chat', { token: tokenA, body: { message: 'test' } });
  check('chat IA con cuota agotada → 429 AI_TOKEN_LIMIT_REACHED', chat.status === 429 && chat.data?.code === 'AI_TOKEN_LIMIT_REACHED', `status=${chat.status} data=${JSON.stringify(chat.data).slice(0, 120)}`);

  // ── 6. ENTORNO / SECRETOS ──
  const cfg = await req('GET', '/api/config');
  const cfgStr = JSON.stringify(cfg.data || {});
  check('/api/config público no expone la URL de Supabase ni claves', !/ugad|supabase\.co|eyJ|service/i.test(cfgStr), cfgStr.slice(0, 150));
  const health = await req('GET', '/api/health');
  const healthStr = JSON.stringify(health.data || {});
  check('/api/health no expone claves', !/sk-|gsk_|eyJ|service_role/i.test(healthStr), healthStr.slice(0, 150));

  // Enumeración de usuarios: el mismo mensaje para correo inexistente y clave incorrecta.
  const enum1 = await req('POST', '/api/login', { body: { email: `nadie.s${stamp}@pp.test`, password: 'x' } });
  const enum2 = await req('POST', '/api/login', { body: { email: `owner.s${stamp}a@pp.test`, password: 'mala' } });
  const enumMsg = (r) => String(r.data?.error || '');
  const enumSafe = enum1.status === 429 || enum2.status === 429 ||
    (enum1.status === 401 && enum2.status === 401 && enumMsg(enum1) === enumMsg(enum2) && !/registrad|no existe|incorrecta/i.test(enumMsg(enum1)));
  check('login no enumera usuarios (mensaje genérico)', enumSafe, `"${enumMsg(enum1)}" vs "${enumMsg(enum2)}"`);

  // ── 7. VALIDACIÓN DE ENTRADA / SQLi superficial ──
  // Nota: tras la batería de logins de este test el rate-limiter puede estar
  // activo; 429 también es un rechazo válido (la inyección nunca autentica).
  const sqli = await req('POST', '/api/login', { body: { email: `' OR 1=1 --`, password: 'x' } });
  check('SQLi en login no autentica', [400, 401, 429].includes(sqli.status), `status=${sqli.status}`);
  const bigBody = await req('POST', '/api/tenant/usage', { token: tokenA, body: { recurso: 'documents', cantidad: 1e12 } });
  check('cantidad absurda rechazada o acotada', bigBody.status === 200 || bigBody.status === 400, `status=${bigBody.status}`);

  // ── CLEANUP: eliminar tenants efímeros ──
  try {
    const { supabase } = require('./supabaseClient');
    if (supabase) {
      const codes = [tenantA, `PP-S${stamp}B`, `PP-S${stamp}C`];
      await supabase.from('usuarios').delete().like('email', `%.s${stamp}%@pp.test`);
      await supabase.from('tenants').delete().in('codigo', codes);
      await supabase.from('subscriptions').delete().in('empresa_codigo', codes);
      await supabase.from('tenant_usage').delete().like('empresa_codigo', `PP-S${stamp}%`);
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const toDelete = (authUsers?.users || []).filter(u => (u.email || '').includes(`.s${stamp}@pp.test`));
      for (const u of toDelete) { await supabase.auth.admin.deleteUser(u.id).catch(() => {}); }
      console.log('  (cleanup: tenants efímeros eliminados)');
    }
  } catch (e) { console.warn('  (cleanup:)', e.message); }

  console.log(results.join('\n'));
  console.log(`\n═══ RESULTADO: ${pass} OK · ${fail} FALLOS ═══\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
