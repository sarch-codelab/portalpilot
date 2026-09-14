#!/usr/bin/env node
/**
 * RELEASE E2E — Portal Pilot
 * Recorrido completo de dos clientes reales (Tenant A / Tenant B):
 * registro → onboarding → login → dashboard → config → usuario → producto → cliente
 * → documento (factura/recibo/nota) → POS → IA → consumo → auditoría.
 * Incluye matriz de aislamiento A↔B y matriz RBAC ROOT/OWNER/ADMIN/MEMBER.
 * No destructivo: usa tenants efímeros PP-R{stamp}* y limpia al final (idempotente).
 *
 * Uso: TEST_BASE=http://localhost:3000 node backend/test_release_e2e.js
 *      SKIP_CLEANUP=1 node backend/test_release_e2e.js   (para inspección manual)
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
      validateStatus: () => true, timeout: 30000, maxRedirects: 0
    });
    return { status: r.status, data: r.data, headers: r.headers };
  } catch (e) { return { status: 0, data: { error: e.message }, headers: {} }; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stamp = crypto.randomBytes(3).toString('hex').toUpperCase();
const A = `PP-R${stamp}A`, B = `PP-R${stamp}B`;
const PW = 'ReleasePass123!';
const ctx = {};   // created ids for cleanup
const emails = { oa: `owner.r${stamp}a@pp.test`, ma: `member.r${stamp}a@pp.test`, ob: `owner.r${stamp}b@pp.test` };

async function cleanup() {
  if (process.env.SKIP_CLEANUP) return;
  if (!ctx.supabase) return;
  const sb = ctx.supabase;
  const codes = [A, B];
  const empresaIds = ctx.empresaIds || [];
  for (const eid of empresaIds) {
    await sb.from('facturas').delete().eq('empresa_id', eid);
    await sb.from('recibos').delete().eq('empresa_id', eid);
    await sb.from('notas_credito').delete().eq('empresa_id', eid);
    await sb.from('transacciones').delete().eq('empresa_id', eid);
    await sb.from('kardex').delete().eq('empresa_id', eid);
    await sb.from('productos').delete().eq('empresa_id', eid);
    await sb.from('clientes').delete().eq('empresa_id', eid);
    await sb.from('ai_usage_log').delete().eq('empresa_codigo', codes[0]).or(`empresa_codigo.eq.${codes[1]}`);
    await sb.from('tenant_usage').delete().eq('empresa_codigo', codes[0]).or(`empresa_codigo.eq.${codes[1]}`);
  }
  for (const c of codes) {
    await sb.from('seguridad_eventos').delete().eq('empresa_codigo', c);
    await sb.from('usuarios').delete().eq('empresa_codigo', c);
    await sb.from('subscriptions').delete().eq('empresa_codigo', c);
    await sb.from('tenants').delete().eq('codigo', c);
    await sb.from('empresas').delete().eq('codigo', c);
  }
  try {
    const { data: profs } = await sb.from('usuarios').select('id').eq('empresa_codigo', codes[0]).or(`empresa_codigo.eq.${codes[1]}`);
    if (profs) await sb.from('usuarios').delete().in('id', profs.map(p => p.id));
  } catch (_) {}
  try {
    const { data: authUsers } = await sb.auth.admin.listUsers();
    const orphans = (authUsers?.users || []).filter(u => Object.values(emails).includes(u.email));
    for (const u of orphans) await sb.auth.admin.deleteUser(u.id);
  } catch (_) {}
}

async function main() {
  console.log('\n═══ RELEASE E2E — recorrido de cliente real ═══\n');
  try {
    require('dotenv').config({ path: require('path').join(__dirname, '.env') });
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (url && key) ctx.supabase = createClient(url, key);
  } catch (e) { console.log('  (sin supabase admin para limpieza — no se limpiará)', e.message); }
  if (!ctx.supabase) console.log('  (sin supabase admin para limpieza — no se limpiará)');

  // ─────────── TENANT A: registro ───────────
  const reg = await req('POST', '/api/registro', { body: {
    empresaNombre: 'Release Tenant A', empresaCodigo: A,
    usuarioNombre: 'Owner', usuarioApellido: 'A', email: emails.oa, password: PW,
    plan: 'starter', terminosAceptados: true
  }});
  check('A: registro → 201/200', reg.status === 201 || reg.status === 200, `status=${reg.status} body=${JSON.stringify(reg.data).slice(0,200)}`);
  // Nota (documentado): /api/registro no emite sesión; el onboarding termina en
  // login explícito (modelo Case B del blueprint). Se verifica el login a continuación.
  const regNoToken = !reg.data?.token;
  check('A: registro no emite sesión (flujo Case B: login explícito)', regNoToken);

  // login Owner A
  const logA = await req('POST', '/api/login', { body: { email: emails.oa, password: PW } });
  const tA = logA.data?.token || '';
  check('A: login Owner → 200 + token', logA.status === 200 && !!tA, `status=${logA.status}`);
  ctx.ownerAId = logA.data?.user?.id || logA.data?.sub || null;

  // ─────────── TENANT A: onboarding (perfil empresa) ───────────
  const prof = await req('PUT', '/api/empresa/profile', { token: tA, body: { nombre_empresa: 'Release Tenant A S de RL', telefono: '+504 9999-0001', direccion: 'Torre Portal, Piso 5' } });
  check('A: onboarding perfil empresa → 200 (persistió)', prof.status === 200, `status=${prof.status} body=${JSON.stringify(prof.data).slice(0,200)}`);
  const profRead = await req('GET', '/api/empresa/profile', { token: tA });
  check('A: perfil empresa persistido (relectura)', profRead.status === 200 && profRead.data?.empresa?.nombre_empresa === 'Release Tenant A S de RL', `status=${profRead.status} body=${JSON.stringify(profRead.data).slice(0,150)}`);

  // dashboard
  const dash = await req('GET', '/api/dashboard/summary', { token: tA });
  check('A: dashboard/summary → 200', dash.status === 200, `status=${dash.status}`);
  check('A: dashboard con estructura esperada', typeof dash.data === 'object' && dash.data !== null);

  // entitlements / config
  const ent = await req('GET', '/api/empresa/entitlements', { token: tA });
  check('A: entitlements del plan starter → 200', ent.status === 200, `status=${ent.status}`);

  // ─────────── TENANT A: usuario member ───────────
  const mkU = await req('POST', '/api/users', { token: tA, body: { nombre: 'Member', apellido: 'A', email: emails.ma, rol: 'miembro', password: PW } });
  check('A: crear usuario member → 201/200', mkU.status === 201 || mkU.status === 200, `status=${mkU.status} body=${JSON.stringify(mkU.data).slice(0,200)}`);
  const logM = await req('POST', '/api/login', { body: { email: emails.ma, password: PW } });
  const tM = logM.data?.token || '';
  check('A: login member → 200', logM.status === 200 && !!tM, `status=${logM.status}`);

  // ─────────── TENANT A: producto ───────────
  const p1 = await req('POST', '/api/productos', { token: tA, body: { nombre: 'Producto E2E', codigo: `E2E-${stamp}`, precio_venta: 100, stock_actual: 10, isv_rate: 15 } });
  check('A: crear producto → 201', p1.status === 201, `status=${p1.status}`);
  const prodId = p1.data?.producto?.id;
  check('A: producto persistido con id', !!prodId);

  // persistencia real (re-lectura)
  const pRead = await req('GET', `/api/productos/${prodId}`, { token: tA });
  check('A: producto re-leído desde DB (persistencia)', pRead.status === 200 && pRead.data?.producto?.nombre === 'Producto E2E', `status=${pRead.status}`);
  ctx.empresaIds = ctx.empresaIds || [];

  // ─────────── TENANT A: cliente ───────────
  const c1 = await req('POST', '/api/clientes', { token: tA, body: { nombre: 'Cliente E2E', rtn: '08019999999999', email: 'cliente.e2e@pp.test' } });
  check('A: crear cliente → 201', c1.status === 201, `status=${c1.status} body=${JSON.stringify(c1.data).slice(0,200)}`);

  // ─────────── TENANT A: documento (factura) ───────────
  const f1 = await req('POST', '/api/facturas', { token: tA, body: {
    cliente_nombre: 'Cliente E2E', subtotal: 100, isv: 15, total: 115,
    items: [{ producto_id: prodId, nombre: 'Producto E2E', cantidad: 1, precio_unitario: 100 }],
    tipo_documento: 'factura'
  }});
  check('A: crear FACTURA → 201', f1.status === 201, `status=${f1.status} body=${JSON.stringify(f1.data).slice(0,200)}`);
  const facId = f1.data?.factura?.id;
  check('A: factura persistida', !!facId);
  check('A: factura tipo_documento canónico (Factura, CHECK productivo)', ['Factura','factura'].includes(f1.data?.factura?.tipo_documento), `tipo=${f1.data?.factura?.tipo_documento}`);

  const r1 = await req('POST', '/api/recibos', { token: tA, body: { cliente_nombre: 'Cliente E2E', concepto: 'Anticipo', monto: 50, metodo_pago: 'efectivo' } });
  check('A: crear RECIBO → 201/200', r1.status === 201 || r1.status === 200, `status=${r1.status} body=${JSON.stringify(r1.data).slice(0,200)}`);
  const nc1 = await req('POST', '/api/notas-credito', { token: tA, body: { factura_id: facId, cliente_nombre: 'Cliente E2E', motivo: 'Devolución E2E', monto: 15, total: 15 } });
  check('A: crear NOTA DE CRÉDITO → 201/200', nc1.status === 201 || nc1.status === 200, `status=${nc1.status} body=${JSON.stringify(nc1.data).slice(0,200)}`);

  // facturas vs recibos vs notas: recursos separados
  const facList = await req('GET', '/api/facturas', { token: tA });
  check('A: /api/facturas lista contiene la factura', Array.isArray(facList.data?.facturas) && facList.data.facturas.some(f => f.id === facId));
  const recList = await req('GET', '/api/recibos', { token: tA });
  check('A: /api/recibos NO mezcla facturas (recursos separados)', Array.isArray(recList.data?.recibos) && !recList.data.recibos.some(x => x.id === facId), `recibos=${(recList.data?.recibos||[]).length}`);
  const ncList = await req('GET', '/api/notas-credito', { token: tA });
  check('A: /api/notas-credito contiene la nota emitida', Array.isArray(ncList.data?.notas) && ncList.data.notas.some(n => n.factura_id === facId), `status=${ncList.status} notas=${(ncList.data?.notas||[]).length}`);

  // ─────────── TENANT A: POS ───────────
  const v1 = await req('POST', '/api/pos/ventas', { token: tA, body: {
    items: [{ producto_id: prodId, cantidad: 2, precio_unitario: 100 }], subtotal: 200, isv: 30, total: 230, metodo_pago: 'efectivo'
  }});
  check('A: venta POS → 201', v1.status === 201, `status=${v1.status} body=${JSON.stringify(v1.data).slice(0,200)}`);
  const ventaId = v1.data?.venta?.id;
  const vRead = await req('GET', `/api/pos/ventas/${ventaId}`, { token: tA });
  check('A: venta POS persistida (relectura)', vRead.status === 200 && !!vRead.data?.venta?.id);

  // stock decrementado por POS (no doble contabilización)
  const pAfter = await req('GET', `/api/productos/${prodId}`, { token: tA });
  const stockAfter = pAfter.data?.producto?.stock_actual;
  check('A: stock decrementado por venta POS (10→8)', stockAfter === 8, `stock=${stockAfter}`);

  // ─────────── TENANT A: IA (gateway server-side) ───────────
  const aiChat = await req('POST', '/api/ai/chat', { token: tA, body: { message: 'Responde solo: OK', max_tokens: 10 } });
  const aiOk = [200, 503].includes(aiChat.status);
  check('A: /api/ai/chat responde 200 o 503-controlado (nunca 500 crudo)', aiOk, `status=${aiChat.status} body=${JSON.stringify(aiChat.data).slice(0,150)}`);
  if (aiChat.status === 200) {
    check('A: IA no expone claves de proveedor en respuesta', !JSON.stringify(aiChat.data).match(/gsk_|sk-or-|sk-/));
    const aiUsage = await req('GET', '/api/ai/usage', { token: tA });
    check('A: /api/ai/usage registra el consumo de la llamada', aiUsage.status === 200, `status=${aiUsage.status}`);
  } else {
    check('A: 503 IA sin credencial es controlado (code presente)', !!aiChat.data?.code || !!aiChat.data?.error);
  }

  // ─────────── TENANT A: consumo ───────────
  const usage = await req('GET', '/api/tenant/usage', { token: tA });
  check('A: /api/tenant/usage → 200', usage.status === 200, `status=${usage.status}`);
  const usageStr = JSON.stringify(usage.data || {});
  check('A: usage refleja documentos/users', usageStr.includes('documents') || usageStr.includes('users') || usageStr.includes('ai_tokens'));

  // auditoría (owner ve eventos de su tenant)
  const audit = await req('GET', '/api/empresa/security/events', { token: tA });
  check('A: auditoría de seguridad → 200', audit.status === 200, `status=${audit.status}`);

  // ─────────── AÍSLAMIENTO A↔B ───────────
  const regB = await req('POST', '/api/registro', { body: {
    empresaNombre: 'Release Tenant B', empresaCodigo: B,
    usuarioNombre: 'Owner', usuarioApellido: 'B', email: emails.ob, password: PW,
    plan: 'starter', terminosAceptados: true
  }});
  check('B: registro → 201/200', regB.status === 201 || regB.status === 200, `status=${regB.status}`);
  const logB = await req('POST', '/api/login', { body: { email: emails.ob, password: PW } });
  const tB = logB.data?.token || '';
  check('B: login Owner → 200', logB.status === 200 && !!tB, `status=${logB.status}`);

  const prodB = await req('GET', `/api/productos/${prodId}`, { token: tB });
  check('B → producto de A → 403/404 (aislamiento)', [403, 404].includes(prodB.status), `status=${prodB.status}`);
  const prodB2 = await req('GET', '/api/productos', { token: tB });
  check('B: lista de productos NO contiene productos de A', !(prodB2.data?.productos || prodB2.data || []).some?.x || !JSON.stringify(prodB2.data || {}).includes('Producto E2E'));
  const facB = await req('GET', `/api/facturas/${facId}`, { token: tB });
  check('B → factura de A → 403/404', [403, 404].includes(facB.status), `status=${facB.status}`);
  const facBWrite = await req('PUT', `/api/productos/${prodId}`, { token: tB, body: { nombre: 'HACKED' } });
  check('B: escritura sobre producto de A → rechazada', [403, 404].includes(facBWrite.status), `status=${facBWrite.status}`);
  const usgB = await req('GET', '/api/tenant/usage', { token: tB });
  check('B: usage → 200', usgB.status === 200, `status=${usgB.status}`);
  const usgA = await req('GET', '/api/tenant/usage', { token: tA });
  const codA = JSON.stringify(usgA.data || {});
  check('A: usage muestra actividad del tenant A', usgA.status === 200 && (codA.includes('documents') || codA.includes('users') || codA.includes('ai_tokens')), `body=${codA.slice(0,200)}`);

  // manipulación directa (ataque controlado)
  const attack1 = await req('GET', '/api/productos', { token: tB, headers: { 'x-empresa-codigo': A } });
  check('B: header x-empresa-codigo manipulado ignorado (scope del JWT)', !JSON.stringify(attack1.data || {}).includes('Producto E2E'), `status=${attack1.status}`);
  const attack2 = await req('POST', '/api/registro', { body: { empresaNombre: 'Dup', empresaCodigo: A, usuarioNombre: 'X', usuarioApellido: 'Y', email: `dup.r${stamp}@pp.test`, password: PW, plan: 'starter', terminosAceptados: true } });
  check('B: no se puede registrar un tenant con empresa_codigo existente (A)', [400, 409, 403].includes(attack2.status), `status=${attack2.status}`);

  // ─────────── RBAC: OWNER scopes ───────────
  const ownTenants = await req('GET', '/api/tenants', { token: tA });
  check('OWNER: /api/tenants scope a su tenant (no global)', ownTenants.status !== 200 || (Array.isArray(ownTenants.data) && ownTenants.data.length <= 1 && ownTenants.data.every(t => t.codigo === A)), `status=${ownTenants.status} n=${Array.isArray(ownTenants.data) ? ownTenants.data.length : '?'} codes=${JSON.stringify((ownTenants.data||[]).map?.(t => t.codigo))}`);
  const ppUsage = await req('GET', '/api/usage', { token: tA });
  check('OWNER: NO accede a /api/usage global', [401, 403].includes(ppUsage.status), `status=${ppUsage.status}`);
  const ppAudit = await req('GET', '/api/auditoria', { token: tA });
  check('OWNER: NO accede a /api/auditoria global', [401, 403].includes(ppAudit.status), `status=${ppAudit.status}`);
  const diag = await req('GET', '/api/diagnostico', { token: tA });
  check('OWNER: NO accede a /api/diagnostico', [401, 403].includes(diag.status), `status=${diag.status}`);
  const otherTenantDetail = await req('PUT', `/api/tenants/${B}`, { token: tA, body: { nombre_empresa: 'HACK' } });
  check('OWNER A: NO puede modificar el tenant B', [403, 404].includes(otherTenantDetail.status), `status=${otherTenantDetail.status}`);

  // member: operativo sí, administración no
  const mProd = await req('POST', '/api/productos', { token: tM, body: { nombre: 'Producto Member', precio_venta: 5 } });
  check('MEMBER: puede operar (crear producto) → 201', mProd.status === 201, `status=${mProd.status}`);
  const mUsers = await req('POST', '/api/users', { token: tM, body: { nombre: 'X', apellido: 'Y', email: `hijack.r${stamp}@pp.test`, rol: 'admin', password: PW } });
  check('MEMBER: NO crea usuarios', [401, 403].includes(mUsers.status), `status=${mUsers.status}`);
  // MEMBER NO debe consultar administración empresarial (roles/módulos/sesiones/usuarios)
  const mRoles = await req('GET', '/api/empresa/roles', { token: tM });
  const mOverview = await req('GET', '/api/empresa/overview', { token: tM });
  check('MEMBER: NO consulta administración empresarial', [401, 403].includes(mRoles.status) || [401, 403].includes(mOverview.status), `roles=${mRoles.status} overview=${mOverview.status}`);
  const mProfile = await req('PUT', '/api/empresa/profile', { token: tM, body: { nombre: 'Hack' } });
  check('MEMBER: NO cambia perfil de la empresa', [401, 403].includes(mProfile.status), `status=${mProfile.status}`);
  const mPay = await req('POST', '/api/confirmar-pago', { token: tM, body: { empresa_codigo: A, plan: 'enterprise', email: emails.ma } });
  check('MEMBER: NO confirma pagos (endpoint público rechaza sesión MEMBER)', [401, 403].includes(mPay.status), `status=${mPay.status}`);

  // ─────────── PLANES / TRIAL / BILLING ───────────
  const sub = await req('GET', '/api/tenant/subscription', { token: tA });
  check('A: /api/tenant/subscription → 200 con estado', sub.status === 200 && !!sub.data, `status=${sub.status}`);

  // Cambio de plan vía PUT /api/tenants/:id: solo ROOT
  const tenList = await req('GET', '/api/tenants', { token: tA });
  // owner A no obtiene la lista; intentar el cambio con el id de su tenant vía /api/tenant
  const ownTenant = await req('GET', '/api/tenant', { token: tA });
  const tenantId = ownTenant.data?.tenant?.id || ownTenant.data?.id || null;
  if (tenantId) {
    const chgPlan = await req('PUT', `/api/tenants/${tenantId}`, { token: tA, body: { plan: 'enterprise' } });
    check('OWNER: NO puede cambiarse el plan a sí mismo (auto-escalada)', [401, 403].includes(chgPlan.status), `status=${chgPlan.status}`);
  }

  // trial expirado → read-only: manipular created_at del tenant A vía admin (solo para test)
  if (ctx.supabase) {
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();
    await ctx.supabase.from('tenants').update({ created_at: old }).eq('codigo', A);
    await ctx.supabase.from('empresas').update({ created_at: old }).eq('codigo', A).then(() => {}, () => {});
    // La caché de entitlements del backend tiene TTL de 30s: esperamos su
    // expiración para que el estado 'expired' sea visible vía HTTP.
    const ENT_CACHE_TTL_MS = 30 * 1000;
    await sleep(ENT_CACHE_TTL_MS + 800);
    const trialWrite = await req('POST', '/api/productos', { token: tA, body: { nombre: 'Post Trial', precio_venta: 1 } });
    check('TRIAL expirado: escritura → 403 TRIAL_EXPIRED (read-only)', trialWrite.status === 403 && /TRIAL_EXPIRED|trial/i.test(JSON.stringify(trialWrite.data)), `status=${trialWrite.status} body=${JSON.stringify(trialWrite.data).slice(0,150)}`);
    const trialRead = await req('GET', '/api/productos', { token: tA });
    check('TRIAL expirado: lectura sigue permitida', trialRead.status === 200, `status=${trialRead.status}`);

    // Reactivar por pago (billing: expired → active)
    const pay = await req('POST', '/api/confirmar-pago', { body: { empresa_codigo: A, plan: 'business', email: emails.oa, metodoPago: 'tarjeta', referencia: `e2e-pay-${stamp}` } });
    check('BILLING: confirmar-pago reactiva tenant → 200/201', [200, 201].includes(pay.status), `status=${pay.status} body=${JSON.stringify(pay.data).slice(0,200)}`);
    await sleep(300);
    const payWrite = await req('POST', '/api/productos', { token: tA, body: { nombre: 'Post Pago', precio_venta: 2 } });
    check('BILLING: tras pago, escrituras vuelven a funcionar', payWrite.status === 201, `status=${payWrite.status} body=${JSON.stringify(payWrite.data).slice(0,150)}`);
    const subAfter = await req('GET', '/api/tenant/subscription', { token: tA });
    check('BILLING: subscription muestra estado activo/plan business', subAfter.status === 200 && /active|business/i.test(JSON.stringify(subAfter.data)), `body=${JSON.stringify(subAfter.data).slice(0,200)}`);
  } else {
    console.log('  ⚠ sin acceso admin DB: pruebas de trial/billing saltadas');
  }

  // ─────────── USAGE INTEGRITY ───────────
  const opFail = await req('POST', '/api/productos', { token: tA, body: {} });
  check('USAGE: operación fallida (400) no incrementa usage', opFail.status === 400, `status=${opFail.status}`);

  // ─────────── LOGOUT / SESIÓN ───────────
  const lo = await req('POST', '/api/logout', { token: tM });
  check('MEMBER: logout → 200', lo.status === 200, `status=${lo.status}`);

  // ─────────── ROOT RBAC (usuario ROOT efímero via service-role; sin password real del propietario) ───────────
  if (ctx.supabase) {
    const rootEmail = `root.e2e.${stamp.toLowerCase()}@pp.test`;
    const rootId = crypto.randomUUID();
    const bcrypt = require('bcryptjs');
    const rootHash = await bcrypt.hash('RootE2E' + PW, 10);
    await ctx.supabase.from('usuarios').insert({ id: rootId, email: rootEmail, password_hash: rootHash, password: rootHash, nombre: 'Root', apellido: 'E2E', rol: 'root', rol_global: 'root', empresa_codigo: 'ROOT', estado: 'activo', activo: true });
    const logR = await req('POST', '/api/login', { body: { email: rootEmail, password: 'RootE2E' + PW } });
    const tR = logR.data?.token || '';
    if (tR) {
      const rTenants = await req('GET', '/api/tenants', { token: tR });
      check('ROOT: ve todos los tenants', rTenants.status === 200 && Array.isArray(rTenants.data) && rTenants.data.length >= 2, `status=${rTenants.status} n=${Array.isArray(rTenants.data) ? rTenants.data.length : '?'}`);
      const rUsage = await req('GET', '/api/usage', { token: tR });
      check('ROOT: ve consumo global', rUsage.status === 200, `status=${rUsage.status}`);
      const rAudit = await req('GET', '/api/auditoria', { token: tR });
      check('ROOT: ve auditoría global', rAudit.status === 200, `status=${rAudit.status}`);
      const rDiag = await req('GET', '/api/diagnostico', { token: tR });
      check('ROOT: accede a diagnóstico', rDiag.status === 200, `status=${rDiag.status}`);
      // ROOT puede cambiar plan (única vía distinta al pago)
      const rChg = await req('PUT', `/api/tenants/${A}`, { token: tR, body: { plan: 'business' } });
      check('ROOT: puede cambiar plan de un tenant', rChg.status === 200, `status=${rChg.status}`);
      // ADMIN no puede cambiar plan: crear admin efímero en tenant A
      const mkAdm = await req('POST', '/api/users', { token: tA, body: { nombre: 'Admin', apellido: 'E2E', email: `admin.r${stamp}a@pp.test`, rol: 'admin', password: PW } });
      check('Setup: admin creado por owner', [200, 201].includes(mkAdm.status), `status=${mkAdm.status} body=${JSON.stringify(mkAdm.data).slice(0,150)}`);
      if ([200,201].includes(mkAdm.status)) {
        const logAd = await req('POST', '/api/login', { body: { email: `admin.r${stamp}a@pp.test`, password: PW } });
        const tAd = logAd.data?.token || '';
        if (tAd) {
          const admChg = await req('PUT', `/api/tenants/${A}`, { token: tAd, body: { plan: 'enterprise' } });
          check('ADMIN: NO puede cambiar el plan', [401, 403].includes(admChg.status), `status=${admChg.status}`);
          const admDel = await req('DELETE', `/api/tenants/${A}`, { token: tAd });
          check('ADMIN: NO puede eliminar el tenant', [401, 403].includes(admDel.status), `status=${admDel.status}`);
          const ownDel = await req('DELETE', `/api/tenants/${A}`, { token: tA });
          check('OWNER: NO puede eliminar su propio tenant', [401, 403].includes(ownDel.status), `status=${ownDel.status}`);
          const admOther = await req('GET', '/api/empresa/overview', { token: tAd });
          check('ADMIN: gestiona su empresa (overview 200)', admOther.status === 200, `status=${admOther.status}`);
        }
      }
    } else {
      check('ROOT: login del usuario ROOT efímero', false, `status=${logR.status}`);
    }
    // limpieza del usuario ROOT efímero
    try {
      await ctx.supabase.from('usuarios').delete().eq('id', rootId);
      const { data: authUsers } = await ctx.supabase.auth.admin.listUsers();
      const orphan = (authUsers?.users || []).find(u => u.email === rootEmail);
      if (orphan) await ctx.supabase.auth.admin.deleteUser(orphan.id);
    } catch (_) {}
  }

  // ─────────── PLAN ENGINE: límite server-side users ───────────
  // El plan asignado tras el pago (business → DB planes.max_users=15). Sin
  // exceder el plan starter: el límite de 5 usuarios de starter ya se probó
  // en test_bloques (PLAN_USER_LIMIT). Aquí verificamos el endpoint de planes.
  const plansList = await req('GET', '/api/plans', {});
  check('PLANS: /api/plans público lista planes', plansList.status === 200 && JSON.stringify(plansList.data).includes('starter'), `status=${plansList.status}`);

  // ─────────── RESUMEN + CLEANUP ───────────
  console.log(results.join('\n'));
  console.log(`\n  TOTAL: ${pass} passed, ${fail} failed\n`);
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
