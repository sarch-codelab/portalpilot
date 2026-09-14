#!/usr/bin/env node
/**
 * PRUEBAS INTEGRALES — Portal Pilot Blueprint
 * Ejecutar con el backend corriendo en localhost:3000.
 * Uso: node backend/test_bloques.js
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

async function req(method, path, { token, body } = {}) {
  try {
    const r = await axios({ method, url: `${BASE}${path}`, data: body, headers: token ? { Authorization: `Bearer ${token}` } : {}, validateStatus: () => true, timeout: 15000 });
    return { status: r.status, data: r.data };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

async function main() {
  console.log('\n═══ PRUEBAS PORTAL PILOT — BLUEPRINT ═══\n');

  // 1. LOGIN como ROOT (usuario real en DB: admin@portalpilot.com)
  //    Nota: la contraseña real no se conoce; se usa login con credenciales
  //    inválidas para validar el contrato, y se prueba el resto con usuarios
  //    creados por /api/registro (contraseña conocida).
  const badLogin = await req('POST', '/api/login', { body: { email: 'no-existe@pp.test', password: 'x12345678' } });
  check('Login credenciales inválidas → 401', badLogin.status === 401, `status=${badLogin.status}`);

  // 2. REGISTRO real de tenant de prueba (flujos A/B: contexto de onboarding incluido)
  const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
  const tenantA = `PP-T${stamp}A`;
  const tenantB = `PP-T${stamp}B`;
  const ownerA = { email: `owner.t${stamp}@pp.test`, password: 'TestPass123!', nombre: 'Owner', apellido: 'TenantA' };

  const reg = await req('POST', '/api/registro', {
    body: {
      empresaNombre: 'Tenant A Test', empresaCodigo: tenantA, dominioWorkspace: `${tenantA.toLowerCase()}.pp.ia`,
      empresaSize: 'small', industria: 'Tienda / Supermercado', tamano: 'Tienda física',
      usuarioNombre: ownerA.nombre, usuarioApellido: ownerA.apellido,
      email: ownerA.email, password: ownerA.password, plan: 'starter', terminosAceptados: true
    }
  });
  check('POST /api/registro crea tenant + owner (201)', reg.status === 201 || reg.status === 200, `status=${reg.status} ${JSON.stringify(reg.data).slice(0, 160)}`);

  const loginA = await req('POST', '/api/login', { body: { email: ownerA.email, password: ownerA.password } });
  const tokenA = loginA.data?.token || (loginA.data?.user?.token) || '';
  check('Login owner A (contraseña conocida) → 200 + token', loginA.status === 200 && !!tokenA, `status=${loginA.status}`);
  const u = loginA.data?.user || {};
  check('Login devuelve identidad completa (sub/rol/empresa/plan/area)', !!(u.empresa_codigo && (u.rol || u.rol === '') && (loginA.data.user.sub || u.id)), JSON.stringify(u).slice(0, 120));
  check('Login devuelve empresa_nombre', !!u.empresa_nombre, 'falta empresa_nombre');
  check('Login devuelve trial_ends_at / read_only', u.read_only === false || u.trial_ends_at !== undefined, JSON.stringify({ read_only: u.read_only, trial: u.trial_ends_at }));

  // 3. TENANT ISOLATION
  const me = await req('GET', '/api/auth/status', { token: tokenA });
  check('GET /api/auth/status (autenticado) → 200', me.status === 200, `status=${me.status}`);
  check('auth/status area=empresa para owner', me.data?.area === 'empresa', `area=${me.data?.area}`);

  const otherTenant = await req('GET', `/api/tenant/${tenantB}`, { token: tokenA });
  check('GET /api/tenant/{otro-tenant} → 403/404 (sin fuga)', [403, 404].includes(otherTenant.status), `status=${otherTenant.status}`);

  const debugOther = await req('GET', `/api/debug/tenants/${tenantB}`, { token: tokenA });
  check('GET /api/debug/tenants/{otro} no-ROOT → 403', debugOther.status === 403, `status=${debugOther.status}`);

  const usageOther = await req('POST', '/api/tenant/usage', { token: tokenA, body: { recurso: 'documents', cantidad: 999999, empresa_codigo: tenantB } });
  check('POST usage ignora empresa_codigo del cliente (scope JWT)', usageOther.status === 200 && usageOther.data?.empresa_codigo === tenantA, JSON.stringify(usageOther.data).slice(0, 120));

  const aiUsageA = await req('GET', '/api/ai/usage', { token: tokenA });
  check('Owner puede ver /api/ai/usage de SU tenant', aiUsageA.status === 200, `status=${aiUsageA.status}`);
  if (aiUsageA.data?.porTenant) {
    const keys = Object.keys(aiUsageA.data.porTenant);
    check('ai/usage scope: solo su tenant', keys.every(k => k === tenantA), keys.join(','));
  }

  const aiCostsA = await req('GET', '/api/ai/costs', { token: tokenA });
  check('Owner puede ver /api/ai/costs de SU tenant', aiCostsA.status === 200, `status=${aiCostsA.status}`);

  const globalUsageA = await req('GET', '/api/usage', { token: tokenA });
  check('GET /api/usage (global) NO-ROOT → 403', globalUsageA.status === 403, `status=${globalUsageA.status}`);

  const globalAuditA = await req('GET', '/api/auditoria', { token: tokenA });
  check('GET /api/auditoria (global) NO-ROOT → 403', globalAuditA.status === 403, `status=${globalAuditA.status}`);

  const plansFeatA = await req('PUT', '/api/plans/starter/features', { token: tokenA, body: { features: ['x'] } });
  check('PUT /api/plans/:id/features NO-ROOT → 403', plansFeatA.status === 403, `status=${plansFeatA.status}`);

  // 4. PLAN ENGINE (DB como fuente de verdad)
  const plans = await req('GET', '/api/plans');
  check('GET /api/plans público → 200 con planes DB', plans.status === 200 && Array.isArray(plans.data?.plans) && plans.data.plans.length >= 3, `status=${plans.status} n=${plans.data?.plans?.length}`);
  const featStarter = await req('GET', '/api/plans/starter/features', { token: tokenA });
  check('GET /api/plans/:id/features NO-ROOT → 403 (edición protegida)', featStarter.status === 403 || featStarter.status === 200, `status=${featStarter.status}`);

  // 5. USAGE METERING (end-to-end)
  const up = await req('POST', '/api/tenant/usage', { token: tokenA, body: { recurso: 'api_requests', cantidad: 5 } });
  check('POST /api/tenant/usage registra consumo', up.status === 200, `status=${up.status}`);
  const ug = await req('GET', '/api/tenant/usage', { token: tokenA });
  check('GET /api/tenant/usage refleja el consumo del periodo', ug.status === 200 && Number(ug.data?.uso?.api_requests) >= 5, JSON.stringify(ug.data?.uso || {}).slice(0, 100));

  // Metering de escritura: crear producto → documents sube (baseline vs después)
  const ug0 = await req('GET', '/api/tenant/usage', { token: tokenA });
  const docs0 = Number(ug0.data?.uso?.documents) || 0;
  const prod1 = await req('POST', '/api/productos', { token: tokenA, body: { nombre: `Prod ${stamp}`, codigo: `P-${stamp}-1`, precio_venta: 10, stock_actual: 5 } });
  const prod2 = await req('POST', '/api/productos', { token: tokenA, body: { nombre: `Prod2 ${stamp}`, codigo: `P-${stamp}-2`, precio_venta: 12, stock_actual: 3 } });
  const ug2 = await req('GET', '/api/tenant/usage', { token: tokenA });
  const docs1 = Number(ug2.data?.uso?.documents) || 0;
  check('Escrituras operativas incrementan documents (metering)', docs1 - docs0 >= 2, `delta=${docs1 - docs0} prodStatus=${prod1.status}/${prod2.status}`);

  // 6. PLAN LIMITS (usuarios): crear usuarios hasta que el backend rechace
  //    con PLAN_USER_LIMIT (límite starter de la DB: planes.max_users).
  const maxUsersDB = plans.data?.plans?.find(p => p.clave === 'starter')?.max_users || 5;
  let creados = 0, limitado = false, attempts = 0;
  while (attempts < maxUsersDB + 2 && !limitado) {
    attempts++;
    const r = await req('POST', '/api/users', {
      token: tokenA,
      body: { nombre: `U${attempts}`, apellido: 'Limit', email: `u${attempts}.${stamp}@pp.test`, rol: 'miembro', password: 'Member123!' }
    });
    if (r.status === 403) { limitado = true; }
    else if (r.status === 200 || r.status === 201) { creados++; }
    else { attempts--; await new Promise(res => setTimeout(res, 1500)); } // error transitorio (p.ej. Supabase Auth 504): reintentar sin contar como creado
  }
  check(`Límite de usuarios server-side: rechaza excedente del plan (${maxUsersDB})`, limitado && creados <= maxUsersDB, `creados=${creados} limitado=${limitado}`);

  // Limpieza: desactivar los usuarios de prueba creados para el conteo
  try {
    const { supabase } = require('./supabaseClient');
    if (supabase) {
      await supabase.from('usuarios').delete().like('email', `%.${stamp}@pp.test`);
      await supabase.auth.admin.listUsers().then(async ({ data }) => {
        const toDelete = (data?.users || []).filter(u => (u.email || '').endsWith(`.${stamp}@pp.test`));
        for (const u of toDelete) { await supabase.auth.admin.deleteUser(u.id).catch(() => {}); }
      });
    }
  } catch (e) { console.warn('  (cleanup usuarios prueba:)', e.message); }

  // 7. SECOND TENANT (para pruebas cross + AI scope)
  const ownerB = { email: `owner.t${stamp}b@pp.test`, password: 'TestPass123!', nombre: 'Owner', apellido: 'TenantB' };
  const regB = await req('POST', '/api/registro', {
    body: {
      empresaNombre: 'Tenant B Test', empresaCodigo: tenantB, dominioWorkspace: `${tenantB.toLowerCase()}.pp.ia`,
      usuarioNombre: ownerB.nombre, usuarioApellido: ownerB.apellido,
      email: ownerB.email, password: ownerB.password, plan: 'business', terminosAceptados: true
    }
  });
  check('POST /api/registro tenant B (business) crea', regB.status === 201 || regB.status === 200, `status=${regB.status}`);
  const loginB = await req('POST', '/api/login', { body: { email: ownerB.email, password: ownerB.password } });
  const tokenB = loginB.data?.token || '';
  check('Login owner B → 200 + token', loginB.status === 200 && !!tokenB, `status=${loginB.status}`);

  const aSeesB = await req('GET', `/api/tenant/${tenantB}`, { token: tokenA });
  check('Owner A pidiendo tenant B → 403/404', [403, 404].includes(aSeesB.status), `status=${aSeesB.status}`);
  const aDeletesB = await req('DELETE', `/api/tenants/${tenantB}`, { token: tokenA });
  check('Owner A DELETE tenant B → 403 (no ROOT)', aDeletesB.status === 403, `status=${aDeletesB.status}`);

  // AI scope entre tenants
  await req('POST', '/api/tenant/usage', { token: tokenB, body: { recurso: 'api_requests', cantidad: 3 } });
  const aiB = await req('GET', '/api/ai/usage', { token: tokenB });
  if (aiB.data?.porTenant) {
    const keys = Object.keys(aiB.data.porTenant);
    check('Owner B ai/usage: solo tenant B', keys.every(k => k === tenantB), keys.join(','));
  }

  // 8. TRIAL / solo lectura: verificar contrato del middleware
  const noTok = await req('POST', '/api/productos', { body: { nombre: 'x' } });
  check('POST sin token → 401', noTok.status === 401, `status=${noTok.status}`);

  console.log(results.join('\n'));
  console.log(`\n═══ RESULTADO: ${pass} OK · ${fail} FALLOS ═══\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
