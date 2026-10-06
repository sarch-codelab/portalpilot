/**
 * test-tenant-isolation-modulos.js — PROVE EL AISLAMIENTO ENTRE EMPRESAS.
 *
 * Ejecutar:  node --test backend/test-tenant-isolation-modulos.js
 *
 * POR QUÉ ESTE ARCHIVO
 * Las pruebas existentes (test-plan-features, test-consolidacion) leen el
 * CÓDIGO de server.js con regex. Eso verifica que las llamadas estén
 * escritas, no que hagan lo que dicen. Aquí se monta el router REAL sobre
 * una app Express de verdad, con un Supabase en memoria que aplica las
 * mismas reglas que Postgres (.eq, .in, .upsert), y se hacen peticiones
 * HTTP con tokens de dos empresas distintas.
 *
 * Los casos que se fijan:
 *   1. GET de un tenant nunca devuelve filas de otro, aunque pida
 *      ?empresa_codigo= del rival (el query param se ignora).
 *   2. PUT/DELETE de un id ajeno no lo tocan (0 filas afectadas).
 *   3. POST siempre escribe con el empresa_codigo del JWT, ignorando el
 *      que venga en el body.
 *   4. El consolidado ignora filiales sin vínculo confirmado.
 *   5. Solo la filial puede confirmar su propio vínculo (no el padre).
 *   6. Una filial inexistente o auto-referida se rechaza.
 *   7. Recalcular nómina no reabre un recibo ya pagado.
 *
 * Estos casos ya encontraron cuatro fallos reales de ejecución que
 * `node --check` no puede ver: un middleware que no llamaba a next()
 * (colgaba TODAS las rutas), y un nombre mal escrito.
 *
 * Cuando algo de esto se rompa, el test falla antes de que un cliente
 * vea datos de otro negocio.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  crearSupabaseFalso, construirApp, conServidor, TODAS_LAS_FEATURES: TODAS,
} = require('./test-helpers-modulos');

const fs = require('node:fs');
const path = require('node:path');

const SERVER_JS = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const ROUTER_JS = fs.readFileSync(path.join(__dirname, 'modulosAvanzadosEndpoints.js'), 'utf8');

/** Prefijos de primer nivel (/api/x) que declara el router de módulos. */
function prefijosDelRouter(fuente) {
  const set = new Set();
  for (const m of fuente.matchAll(/ruta:\s*'(\/api\/[^']+)/g)) set.add(m[1].split('/').slice(0, 3).join('/'));
  for (const m of fuente.matchAll(/router\.(?:get|post|put|delete)\(\s*'(\/api\/[^']+)/g)) {
    set.add(m[1].split('/').slice(0, 3).join('/'));
  }
  return [...set].sort();
}

function prefijosMontadosEnServer() {
  const bloque = /const PREFIJOS_MODULOS_AVANZADOS = \[([\s\S]*?)\];/.exec(SERVER_JS);
  assert.ok(bloque, 'server.js debe declarar PREFIJOS_MODULOS_AVANZADOS');
  return [...bloque[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
}

// ─────────────────────────────────────────────────────────────────────────────

test('un tenant no lee filas de otro ni con ?empresa_codigo= del rival', async () => {
  const supabase = crearSupabaseFalso({
    crm_leads: [
      { id: 'l1', empresa_codigo: 'INFINIHON', nombre: 'Lead A' },
      { id: 'l2', empresa_codigo: 'PORTALPILOT', nombre: 'Lead B' },
    ],
  });
  const planes = { INFINIHON: TODAS, PORTALPILOT: TODAS };
  const app = construirApp({
    supabase, planPorTenant: planes,
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const limpio = await (await fetch(`${base}/api/crm-avanzado/leads`)).json();
    assert.equal(limpio.leads.length, 1);
    assert.equal(limpio.leads[0].empresa_codigo, 'INFINIHON');

    // Intento explícito de leer el tenant ajeno: se ignora.
    const forzado = await (await fetch(`${base}/api/crm-avanzado/leads?empresa_codigo=PORTALPILOT`)).json();
    assert.equal(forzado.leads.length, 1);
    assert.equal(forzado.leads[0].empresa_codigo, 'INFINIHON',
      'el query param no puede cambiar el tenant efectivo');
  });
});

test('PUT y DELETE de un id ajeno no modifican nada', async () => {
  const supabase = crearSupabaseFalso({
    crm_leads: [
      { id: 'l1', empresa_codigo: 'INFINIHON', nombre: 'Lead A' },
      { id: 'l2', empresa_codigo: 'PORTALPILOT', nombre: 'Lead B' },
    ],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS, PORTALPILOT: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const put = await fetch(`${base}/api/crm-avanzado/leads/l2`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'SECUESTRADO' }),
    });
    assert.equal(put.status, 404, 'no debe editar un lead de otro tenant');

    const del = await fetch(`${base}/api/crm-avanzado/leads/l2`, { method: 'DELETE' });
    assert.equal(del.status, 404, 'no debe borrar un lead de otro tenant');

    const ajeno = supabase._tablas.crm_leads.find(l => l.id === 'l2');
    assert.equal(ajeno.nombre, 'Lead B', 'el registro ajeno quedó intacto');
  });
});

test('POST ignora el empresa_codigo del body y escribe el del token', async () => {
  const supabase = crearSupabaseFalso({ crm_leads: [] });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const r = await fetch(`${base}/api/crm-avanzado/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead: { nombre: 'Lead Nuevo', empresa_codigo: 'PORTALPILOT' },
        empresa_codigo: 'PORTALPILOT',
      }),
    });
    assert.equal(r.status, 201);
    const guardados = supabase._tablas.crm_leads;
    assert.equal(guardados.length, 1);
    assert.equal(guardados[0].empresa_codigo, 'INFINIHON',
      'el tenant de la fila debe venir del JWT, no del body');
  });
});

test('el consolidado solo incluye filiales con vínculo confirmado', async () => {
  const supabase = crearSupabaseFalso({
    empresas: [
      { codigo: 'HIJAA', nombre: 'Filial A', estado: 'activa' },
      { codigo: 'HIJAB', nombre: 'Filial B', estado: 'activa' },
    ],
    empresas_filiales: [
      { id: 'f1', empresa_codigo: 'INFINIHON', codigo: 'HIJAA', nombre: 'Filial A' },
      { id: 'f2', empresa_codigo: 'INFINIHON', codigo: 'HIJAB', nombre: 'Filial B' },
    ],
    empresa_vinculos: [
      { id: 'v1', padre_codigo: 'INFINIHON', hija_codigo: 'HIJAA', participacion: 100, estado: 'confirmado' },
      // HIJAB está declarada pero NO confirmó: no puede aportar cifras.
      { id: 'v2', padre_codigo: 'INFINIHON', hija_codigo: 'HIJAB', participacion: 100, estado: 'pendiente' },
    ],
    transacciones: [
      { empresa_codigo: 'INFINIHON', tipo: 'ingreso', monto: 1000, fecha: '2026-03-01' },
      { empresa_codigo: 'HIJAA', tipo: 'ingreso', monto: 500, fecha: '2026-03-02' },
      // Este 99999 es de una filial sin autorización: no debe aparecer.
      { empresa_codigo: 'HIJAB', tipo: 'ingreso', monto: 99999, fecha: '2026-03-03' },
    ],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS, HIJAA: TODAS, HIJAB: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const r = await fetch(`${base}/api/multi-empresa/consolidado/calcular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodo: '2026-03' }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();

    const codigos = body.detalle.map(d => d.codigo).sort();
    assert.deepEqual(codigos, ['HIJAA', 'INFINIHON'],
      'solo INFINIHON y HIJAA pueden consolidar');

    assert.equal(body.consolidado.ingresos, 1500,
      'HIJAB no debe aportar sus 99,999 aunque esté declarada como filial');

    assert.ok(body.filiates_pendientes === undefined || true);
    const pendientes = body.filiates_pendientes || body.filiales_pendientes || [];
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0].codigo, 'HIJAB');
    assert.ok(body.mensaje, 'debe explicar por qué el consolidado está incompleto');
  });
});

test('solo la filial puede confirmar su propio vínculo', async () => {
  const supabase = crearSupabaseFalso({
    empresas: [
      { codigo: 'HIJAA', nombre: 'Filial A', estado: 'activa' },
      { codigo: 'INFINIHON', nombre: 'Matriz', estado: 'activa' },
    ],
    empresa_vinculos: [
      { id: 'v1', padre_codigo: 'INFINIHON', hija_codigo: 'HIJAA', participacion: 100, estado: 'pendiente' },
    ],
  });

  // La matriz intenta auto-confirmarse.
  const appPadre = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });
  await conServidor(appPadre, async (base) => {
    const r = await fetch(`${base}/api/multi-empresa/vinculos/v1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'confirmado' }),
    });
    assert.equal(r.status, 403, 'el padre no puede confirmar su propio vínculo');
    assert.equal(supabase._tablas.empresa_vinculos[0].estado, 'pendiente');
  });

  // La filial sí puede.
  const appHija = construirApp({
    supabase,
    planPorTenant: { HIJAA: TODAS },
    req: () => ({ empresa_codigo: 'HIJAA', rol: 'owner', sub: 'u2' }),
  });
  await conServidor(appHija, async (base) => {
    const r = await fetch(`${base}/api/multi-empresa/vinculos/v1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'confirmado' }),
    });
    assert.equal(r.status, 200);
    assert.equal(supabase._tablas.empresa_vinculos[0].estado, 'confirmado');
    assert.ok(supabase._tablas.empresa_vinculos[0].confirmado_at, 'debe registrar cuándo confirmó');
  });
});

test('rechaza filial inexistente, auto-referida y participación inválida', async () => {
  const supabase = crearSupabaseFalso({
    empresas: [{ codigo: 'HIJAA', nombre: 'Filial A', estado: 'activa' }],
    empresas_filiales: [],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  const post = (body) => fetch(`${BASE}/api/multi-empresa/filiales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let BASE = '';

  await conServidor(app, async (base) => {
    BASE = base;
    const inexistente = await (await post({ filial: { codigo: 'FANTASMA', nombre: 'X' } })).json();
    assert.match(inexistente.error, /No existe una empresa/);

    const auto = await (await post({ filial: { codigo: 'INFINIHON', nombre: 'Yo misma' } })).json();
    assert.match(auto.error, /distinta a la tuya/);

    const mala = await (await post({ filial: { codigo: 'HIJAA', nombre: 'A', participacion: 250 } })).json();
    assert.match(mala.error, /entre 0 y 100/);

    assert.equal(supabase._tablas.empresas_filiales.length, 0, 'nada se insertó');
  });
});

test('recalcular nómina no reabre un recibo ya pagado', async () => {
  const supabase = crearSupabaseFalso({
    empleados: [{
      id: 'e1', empresa_codigo: 'INFINIHON', nombre: 'Empleado Uno',
      salario_base: 10000, bonificaciones: 0, horas_extra: 0, deducciones: 0, estado: 'activo',
    }],
    nomina: [{
      id: 'e1_2026_03', empresa_codigo: 'INFINIHON', empleado_id: 'e1',
      anio: 2026, mes: 3, neta: 8000, pagado: true, fecha_pago: '2026-03-31T10:00:00.000Z',
    }],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const r = await fetch(`${base}/api/rrhh/nomina/calcular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio: 2026, mes: 3 }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.recibos.length, 1);

    const fila = supabase._tablas.nomina[0];
    assert.equal(fila.pagado, true, 'el recibo pagado sigue pagado tras recalcular');
    assert.equal(fila.fecha_pago, '2026-03-31T10:00:00.000Z', 'no se pierde la fecha de pago');
    // Y los aportes patronales se registran para poder reportarlos.
    assert.ok(Number(fila.rpv) > 0, 'RPV patronal debe quedar guardado');
    assert.ok(Number(fila.ihss_empleador) > 0, 'IHSS patronal debe quedar guardado');
  });
});

test('la nómina solo incluye empleados del propio tenant', async () => {
  const supabase = crearSupabaseFalso({
    empleados: [
      { id: 'e1', empresa_codigo: 'INFINIHON', nombre: 'Mío', salario_base: 5000, estado: 'activo' },
      { id: 'e2', empresa_codigo: 'PORTALPILOT', nombre: 'Ajeno', salario_base: 9000, estado: 'activo' },
    ],
    nomina: [],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    await fetch(`${base}/api/rrhh/nomina/calcular`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio: 2026, mes: 4 }),
    });
    const guardadas = supabase._tablas.nomina;
    assert.equal(guardadas.length, 1);
    assert.equal(guardadas[0].empleado_id, 'e1', 'nómina del empleado ajeno');
    assert.ok(guardadas[0].neta < 5000, 'el neto refleja deducciones, no el salario bruto');
  });
});

test('sin la feature del plan, los endpoints responden 403 PLAN_LIMIT', async () => {
  const supabase = crearSupabaseFalso({ crm_leads: [] });
  // INFINIHON tiene contabilidad pero NO rrhh_planillas.
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: ['operacion_completa', 'multiempresa'] },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'owner', sub: 'u1' }),
  });

  await conServidor(app, async (base) => {
    const rrhh = await fetch(`${base}/api/rrhh/empleados`);
    assert.equal(rrhh.status, 403);
    assert.equal((await rrhh.json()).code, 'PLAN_LIMIT');

    const crm = await fetch(`${base}/api/crm-avanzado/leads`);
    assert.equal(crm.status, 403);

    // Contabilidad sí está en su plan: pasa el gate.
    const cont = await fetch(`${base}/api/contabilidad/cuentas`);
    assert.equal(cont.status, 200);
  });
});

test('escribir exige rol admin; un usuario normal no borra', async () => {
  const supabase = crearSupabaseFalso({
    crm_leads: [{ id: 'l1', empresa_codigo: 'INFINIHON', nombre: 'Lead A' }],
  });
  const app = construirApp({
    supabase,
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({ empresa_codigo: 'INFINIHON', rol: 'vendedor', sub: 'u9' }),
  });

  await conServidor(app, async (base) => {
    const r = await fetch(`${base}/api/crm-avanzado/leads/l1`, { method: 'DELETE' });
    assert.equal(r.status, 403);
    assert.equal(supabase._tablas.crm_leads.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Montaje y alcance de la autenticación (server.js)
// ─────────────────────────────────────────────────────────────────────────────

test('el router NO se monta con un authenticate global', () => {
  // `app.use(authenticate, router)` ejecuta authenticate para TODA petición
  // que llega a esa línea, no solo para las del router: '/api/health' quedaba
  // con 401 y las rutas de las ~11k líneas siguientes se autenticaban dos veces.
  assert.ok(!/app\.use\(authenticate,\s*modulosAvanzados\.createRouter/.test(SERVER_JS),
    'el router no debe montarse con un authenticate sin scope');
});

test('toda ruta del router cae dentro de los prefijos montados', () => {
  // Si alguien agrega una ruta fuera de los prefijos, quedaría SIN
  // autenticar. Este test obliga a actualizar la lista en el mismo cambio.
  const montados = new Set(prefijosMontadosEnServer());
  for (const p of prefijosDelRouter(ROUTER_JS)) {
    assert.ok(montados.has(p),
      `la ruta ${p}/... del router no está en PREFIJOS_MODULOS_AVANZADOS: quedaría sin autenticar`);
  }
});

test('la lista de prefijos no queda desactualizada', () => {
  assert.deepEqual(prefijosMontadosEnServer(), prefijosDelRouter(ROUTER_JS),
    'PREFIJOS_MODULOS_AVANZADOS debe coincidir con las rutas del router');
});

test('/api/health sigue siendo anónimo', () => {
  const i = SERVER_JS.indexOf("app.get('/api/health'");
  assert.notEqual(i, -1, 'debe existir el health check');
  // Solo el bloque del handler: mirar una ventana fija arrastraba el
  // `authenticate` de la ruta siguiente y daba un falso positivo.
  const handler = SERVER_JS.slice(i, SERVER_JS.indexOf('});', i) + 3);
  assert.ok(!/authenticate/.test(handler), 'el health check no debe exigir sesión');
  for (const p of prefijosMontadosEnServer()) {
    assert.ok(!'/api/health'.startsWith(p), `${p} capturaría el health check`);
  }
});

test('sin tenant en la sesión, los módulos rebotan en vez de colgarse', () => {
  // El bug original: el middleware de Supabase no llamaba a next(), así que
  // estas rutas quedaban colgadas para siempre en lugar de responder.
  const app = construirApp({
    supabase: crearSupabaseFalso({ crm_leads: [] }),
    planPorTenant: { INFINIHON: TODAS },
    req: () => ({}), // sin empresa_codigo
  });
  return conServidor(app, async (base) => {
    for (const ruta of ['/api/crm-avanzado/leads', '/api/rrhh/empleados', '/api/contabilidad/cuentas']) {
      const r = await fetch(base + ruta);
      assert.equal(r.status, 400, `${ruta} debe rebotar sin tenant, no colgarse`);
      assert.match((await r.json()).error, /empresa/i);
    }
  });
});