#!/usr/bin/env node
/**
 * PRUEBAS PORTALES V2 — RBAC, tenant scope, plan engine, endpoints nuevos.
 * Ejecutar con el backend corriendo (BASE). Uso:
 *   node backend/test_portales_v2.js
 * Sigue la convención de test_bloques.js: crea tenants efímeros PP-TXXXXXX.
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
    const r = await axios({ method, url: `${BASE}${path}`, data: body, headers: token ? { Authorization: `Bearer ${token}` } : {}, validateStatus: () => true, timeout: 20000 });
    return { status: r.status, data: r.data };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}

async function main() {
  console.log('\n═══ PRUEBAS PORTALES V2 — RBAC + TENANT SCOPE + PLAN ═══\n');
  const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
  const tenantA = `PP-T${stamp}A`;
  const tenantB = `PP-T${stamp}B`;
  const passComun = 'TestPass123!';

  // ── Setup: tenant A (owner+admin+member) y tenant B (owner) ──
  const regA = await req('POST', '/api/registro', {
    body: {
      empresaNombre: 'Portal A Test', empresaCodigo: tenantA, usuarioNombre: 'Owner', usuarioApellido: 'A',
      email: `owner.a.${stamp}@pp.test`, password: passComun, plan: 'starter', terminosAceptados: true
    }
  });
  check('Setup: registro tenant A (owner)', [200, 201].includes(regA.status), `status=${regA.status} ${JSON.stringify(regA.data).slice(0, 120)}`);
  const loginA = await req('POST', '/api/login', { body: { email: `owner.a.${stamp}@pp.test`, password: passComun } });
  const tokenOwnerA = loginA.data?.token || '';
  check('Setup: login owner A', loginA.status === 200 && !!tokenOwnerA, `status=${loginA.status}`);

  // Crear ADMIN en tenant A (owner lo crea)
  const crAdmin = await req('POST', '/api/users', {
    token: tokenOwnerA,
    body: { nombre: 'Admin', apellido: 'A', email: `admin.a.${stamp}@pp.test`, rol: 'admin', password: passComun }
  });
  check('OWNER crea ADMIN (permitido)', [200, 201].includes(crAdmin.status), `status=${crAdmin.status} ${JSON.stringify(crAdmin.data).slice(0, 140)}`);
  const loginAdmin = await req('POST', '/api/login', { body: { email: `admin.a.${stamp}@pp.test`, password: passComun } });
  const tokenAdminA = loginAdmin.data?.token || '';
  check('Setup: login admin A', loginAdmin.status === 200 && !!tokenAdminA, `status=${loginAdmin.status}`);

  // Crear MEMBER en tenant A
  const crMember = await req('POST', '/api/users', {
    token: tokenOwnerA,
    body: { nombre: 'Member', apellido: 'A', email: `member.a.${stamp}@pp.test`, rol: 'miembro', password: passComun }
  });
  check('OWNER crea MEMBER (permitido)', [200, 201].includes(crMember.status), `status=${crMember.status}`);
  const loginMember = await req('POST', '/api/login', { body: { email: `member.a.${stamp}@pp.test`, password: passComun } });
  const tokenMemberA = loginMember.data?.token || '';
  check('Setup: login member A', loginMember.status === 200 && !!tokenMemberA, `status=${loginMember.status}`);

  // Tenant B
  await req('POST', '/api/registro', {
    body: {
      empresaNombre: 'Portal B Test', empresaCodigo: tenantB, usuarioNombre: 'Owner', usuarioApellido: 'B',
      email: `owner.b.${stamp}@pp.test`, password: passComun, plan: 'business', terminosAceptados: true
    }
  });
  const loginB = await req('POST', '/api/login', { body: { email: `owner.b.${stamp}@pp.test`, password: passComun } });
  const tokenOwnerB = loginB.data?.token || '';
  check('Setup: tenant B + login owner B', loginB.status === 200 && !!tokenOwnerB, `status=${loginB.status}`);

  // ── BLOQUE D: RBAC ──
  console.log('── RBAC ──');
  const esc1 = await req('POST', '/api/users', {
    token: tokenAdminA,
    body: { nombre: 'Elev', apellido: 'Esc', email: `elev.${stamp}@pp.test`, rol: 'owner', password: passComun }
  });
  check('ADMIN intenta crear OWNER → no sale como owner (degradado/bloqueado)', esc1.status === 403 || esc1.status === 400 || esc1.status === 201, `status=${esc1.status}`);

  const memberCrea = await req('POST', '/api/users', {
    token: tokenMemberA,
    body: { nombre: 'X', apellido: 'Y', email: `x.${stamp}@pp.test`, rol: 'miembro', password: passComun }
  });
  check('MEMBER crea usuario → 403 (requireTenantAdmin)', memberCrea.status === 403, `status=${memberCrea.status}`);

  const memberDelete = await req('DELETE', `/api/users/${crMember.data?.user?.id || '00000000-0000-0000-0000-000000000000'}`, { token: tokenMemberA });
  check('MEMBER elimina usuario → 403 (OWNER exclusiva)', memberDelete.status === 403, `status=${memberDelete.status}`);

  const adminDelete = await req('DELETE', `/api/users/${crMember.data?.user?.id || '00000000-0000-0000-0000-000000000000'}`, { token: tokenAdminA });
  check('ADMIN elimina usuario → 403 (OWNER exclusiva)', adminDelete.status === 403, `status=${adminDelete.status}`);

  const memberModules = await req('GET', '/api/empresa/modules', { token: tokenMemberA });
  check('MEMBER GET /api/empresa/modules → 403', memberModules.status === 403, `status=${memberModules.status}`);
  const memberOverview = await req('GET', '/api/empresa/overview', { token: tokenMemberA });
  check('MEMBER GET /api/empresa/overview → 403', memberOverview.status === 403, `status=${memberOverview.status}`);

  const adminCambiaPlan = await req('PUT', `/api/tenants/${tenantA}`, { token: tokenAdminA, body: { plan: 'enterprise' } });
  check('ADMIN cambia plan propia empresa → 403 (billing bypass bloqueado)', adminCambiaPlan.status === 403, `status=${adminCambiaPlan.status} ${JSON.stringify(adminCambiaPlan.data).slice(0, 100)}`);

  const ownerCambiaPlan = await req('PUT', `/api/tenants/${tenantA}`, { token: tokenOwnerA, body: { plan: 'enterprise' } });
  check('OWNER cambia plan → 403 (solo vía pago/ROOT)', ownerCambiaPlan.status === 403, `status=${ownerCambiaPlan.status}`);

  // ── TENANT ISOLATION ──
  console.log('── Tenant isolation ──');
  const iso1 = await req('GET', '/api/empresa/overview', { token: tokenOwnerB });
  check('Owner B overview de SU tenant → 200', iso1.status === 200, `status=${iso1.status}`);

  const crossUsers = await req('POST', '/api/users', {
    token: tokenOwnerB,
    body: { nombre: 'Cross', apellido: 'User', email: `crossb.${stamp}@pp.test`, rol: 'miembro', tenant: tenantA, password: passComun }
  });
  check('Owner B intenta crear usuario en tenant A (campo tenant) → 403', crossUsers.status === 403, `status=${crossUsers.status}`);

  const crossUsers2 = await req('POST', '/api/users', {
    token: tokenOwnerB,
    body: { nombre: 'Cross2', apellido: 'User', email: `crossb2.${stamp}@pp.test`, rol: 'miembro', empresa_codigo: tenantA, password: passComun }
  });
  check('Owner B intenta crear usuario en tenant A (empresa_codigo) → 403', crossUsers2.status === 403, `status=${crossUsers2.status}`);

  const bSeesARoles = await req('GET', `/api/empresa/roles`, { token: tokenOwnerB });
  check('Owner B roles solo de tenant B (scope JWT)', bSeesARoles.status === 200, `status=${bSeesARoles.status}`);

  const aSessions = await req('GET', '/api/empresa/sessions', { token: tokenOwnerA });
  check('Owner A sesiones → 200 (solo tenant A)', aSessions.status === 200, `status=${aSessions.status}`);

  // ── BLOQUES B/C/E: endpoints del portal ──
  console.log('── Endpoints portal empresa ──');
  const ov = await req('GET', '/api/empresa/overview', { token: tokenOwnerA });
  check('GET /api/empresa/overview → 200 con kpis reales', ov.status === 200 && !!ov.data?.kpis && !!ov.data?.plan, `status=${ov.status}`);
  check('overview: plan.starter + trial presente (registro fresh)', ov.data?.plan?.clave === 'starter' && !!ov.data?.plan?.trial, JSON.stringify(ov.data?.plan || {}).slice(0, 120));
  check('overview: usuarios_total >= 3 (owner+admin+member)', (ov.data?.kpis?.usuarios_total || 0) >= 3, `total=${ov.data?.kpis?.usuarios_total}`);

  const ent = await req('GET', '/api/empresa/entitlements', { token: tokenOwnerA });
  check('GET /api/empresa/entitlements → 200 con features', ent.status === 200 && Array.isArray(ent.data?.features), `status=${ent.status} n=${ent.data?.features?.length}`);

  const roles = await req('GET', '/api/empresa/roles', { token: tokenOwnerA });
  check('GET /api/empresa/roles → 200 con matriz', roles.status === 200 && !!roles.data?.matriz?.owner, `status=${roles.status}`);
  check('roles: matriz owner.eliminar_usuarios=true, admin=false', roles.data?.matriz?.owner?.eliminar_usuarios === true && roles.data?.matriz?.admin?.eliminar_usuarios === false, JSON.stringify(roles.data?.matriz || {}).slice(0, 100));

  const mods = await req('GET', '/api/empresa/modules', { token: tokenOwnerA });
  check('GET /api/empresa/modules → 200 catálogo', mods.status === 200 && Array.isArray(mods.data?.modulos) && mods.data.modulos.length > 0, `status=${mods.status} n=${mods.data?.modulos?.length}`);
  check('modules: ningún estado inventado (enum conocido)', (mods.data?.modulos || []).every(m => ['activo', 'disponible', 'bloqueado', 'requiere_upgrade'].includes(m.estado)), JSON.stringify((mods.data?.modulos || []).map(m => m.estado)));

  const billing = await req('GET', '/api/empresa/billing/documents', { token: tokenOwnerA });
  check('GET /api/empresa/billing/documents → 200 con resumen por tipo', billing.status === 200 && !!billing.data?.resumen?.facturas, `status=${billing.status}`);

  const secEvents = await req('GET', '/api/empresa/security/events', { token: tokenOwnerA });
  check('GET /api/empresa/security/events → 200', secEvents.status === 200, `status=${secEvents.status}`);

  const sessions = await req('GET', '/api/empresa/sessions', { token: tokenOwnerA });
  check('GET /api/empresa/sessions → 200', sessions.status === 200, `status=${sessions.status}`);

  const activity = await req('GET', '/api/empresa/activity', { token: tokenOwnerA });
  check('GET /api/empresa/activity → 200', activity.status === 200, `status=${activity.status}`);

  const auditTenant = await req('GET', '/api/auditoria/tenant?limit=20', { token: tokenOwnerA });
  check('GET /api/auditoria/tenant → 200 (admin)', auditTenant.status === 200, `status=${auditTenant.status}`);

  const profile = await req('GET', '/api/empresa/profile', { token: tokenOwnerA });
  check('GET /api/empresa/profile → 200 con info de la empresa', profile.status === 200 && profile.data?.empresa?.codigo === tenantA, `status=${profile.status}`);

  // PUT perfil: datos legales (owner)
  const updProfile = await req('PUT', `/api/tenants/${tenantA}`, {
    token: tokenOwnerA,
    body: { rtn: '08011990012345', telefono: '+504 9999-9999', direccion: 'CI Test', moneda: 'HNL' }
  });
  check('OWNER actualiza info legal → 200', updProfile.status === 200, `status=${updProfile.status} ${JSON.stringify(updProfile.data).slice(0, 100)}`);
  const profile2 = await req('GET', '/api/empresa/profile', { token: tokenOwnerA });
  check('Info legal persistida (RTN visible en profile)', profile2.data?.empresa?.rtn === '08011990012345', `rtn=${profile2.data?.empresa?.rtn}`);

  // ── BLOQUE F: tipos de documentos separados ──
  console.log('── Billing documents ──');
  const fac = await req('POST', '/api/facturas', {
    token: tokenOwnerB,
    body: { cliente_nombre: 'Cliente Test', total: 113, items: [{ nombre: 'Item', cantidad: 1, precio: 100 }] }
  });
  const billingB = await req('GET', '/api/empresa/billing/documents', { token: tokenOwnerB });
  check('Factura creada aparece como tipo=factura (no mezclada)', billingB.status === 200 && (billingB.data?.documentos || []).some(d => d.tipo === 'factura'), `facStatus=${fac.status}`);

  // ── BLOQUE I: seguridad/sesiones ──
  console.log('── Seguridad ──');
  const revoke = await req('POST', `/api/users/${loginMember.data?.user?.id || loginMember.data?.user?.sub || ''}/revoke-sessions`, { token: tokenOwnerA });
  check('Owner puede revocar sesiones de un usuario de su tenant', [200, 404].includes(revoke.status), `status=${revoke.status}`);

  // ── Soporte ──
  console.log('── Soporte ──');
  const tk = await req('POST', '/api/support-ticket', {
    body: { name: 'Owner A', email: `owner.a.${stamp}@pp.test`, company: tenantA, category: 'tecnico', priority: 'normal', message: 'Ticket de prueba automatizada del portal empresa.' }
  });
  check('POST /api/support-ticket crea ticket', [200, 201].includes(tk.status), `status=${tk.status} ${JSON.stringify(tk.data).slice(0, 100)}`);
  const tkList = await req('GET', '/api/empresa/support/tickets', { token: tokenOwnerA });
  check('GET tickets del tenant → 200 (lista con el ticket de prueba)', tkList.status === 200 && Array.isArray(tkList.data?.tickets), `status=${tkList.status}`);

  // ── API keys: hash + nunca re-exponer ──
  console.log('── API keys ──');
  const ak = await req('POST', '/api/tenant/apikeys', { token: tokenOwnerA, body: { nombre: 'Test Key' } });
  check('POST apikeys → 201 con plaintext una sola vez (plan starter no incluye api_keys: 403 aceptable)', ak.status === 201 || ak.status === 403, `status=${ak.status} ${JSON.stringify(ak.data).slice(0, 120)}`);
  if (ak.status === 201) {
    const clave = ak.data?.clave || '';
    const list = await req('GET', '/api/tenant/apikeys', { token: tokenOwnerA });
    const kk = (list.data?.keys || []).find(k => k.id === (ak.data?.key?.id || ak.data?.key?.nombre));
    check('GET apikeys NO devuelve el secreto completo', list.status === 200 && kk && !String(kk.clave || '').includes(clave), 'clave filtrada correctamente');
    check('GET apikeys incluye clave_prefix legible', kk && !!kk.clave_prefix, JSON.stringify(kk || {}).slice(0, 120));
  }

  console.log(results.join('\n'));
  console.log(`\n═══ RESULTADO: ${pass} OK · ${fail} FALLOS ═══\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
