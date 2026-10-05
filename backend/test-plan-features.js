/**
 * test-plan-features.js — el plan que se vende debe ser el plan que se puede usar.
 *
 * Ejecutar:  node --test backend/test-plan-features.js
 *
 * Extrae las definiciones reales de server.js (no las re-declara) para que el
 * test rompa en cuanto alguien edite un plan sin actualizar la otra capa.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');

/**
 * Extrae `const NOMBRE = <expr>;` de server.jsMidiendo paréntesis y llaves, y
 * respetando cadenas y comentarios, para support definiciones multilínea.
 * Se evalúa en aislamiento porque las constantes no dependen de nada externo.
 */
function extraerConstante(nombre, deps = {}) {
  const decl = `const ${nombre} =`;
  const inicio = src.indexOf(decl);
  assert.ok(inicio !== -1, `no se encontro ${nombre} en server.js`);
  assert.ok(src.slice(0, inicio).trim().endsWith(decl.slice(0, -1).trim()) || true);

  let i = inicio + decl.length;
  while (i < src.length && /\s/.test(src[i])) i++;

  const PARES = { '(': ')', '[': ']', '{': '}' };
  const pila = [];
  let enComilla = null;
  let enComentario = false;

  for (; i < src.length; i++) {
    const c = src[i];
    const s = src[i + 1];

    if (enComentario === 'linea') { if (c === '\n') enComentario = false; continue; }
    if (enComentario === 'bloque') { if (c === '*' && s === '/') { enComentario = false; i++; } continue; }
    if (enComilla) {
      if (c === '\\') { i++; continue; }
      if (c === enComilla) enComilla = null;
      continue;
    }
    if (c === '/' && s === '/') { enComentario = 'linea'; i++; continue; }
    if (c === '/' && s === '*') { enComentario = 'bloque'; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { enComilla = c; continue; }

    if (PARES[c]) {
      // `Object.freeze(` abre un paréntesis de llamada: sirve de ancla inicial.
      pila.push(c);
    } else if (c === ')' || c === ']' || c === '}') {
      if (!pila.length || PARES[pila.pop()] !== c) continue;
      if (pila.length === 0) {
        const nombres = Object.keys(deps);
        const valores = nombres.map((n) => deps[n]);
        const expr = src.slice(inicio + decl.length, i + 1);
        return Function(...nombres, `"use strict"; return (${expr});`)(...valores);
      }
    }
  }
  throw new Error(`no se pudo cerrar ${nombre} en server.js`);
}

const ALL_PLAN_FEATURES = extraerConstante('ALL_PLAN_FEATURES');
const MODULOS_COTIZADOR = extraerConstante('MODULOS_COTIZADOR');
const PLAN_CATALOGO_MODULOS = extraerConstante('PLAN_CATALOGO_MODULOS', { MODULOS_COTIZADOR });
const MODULO_APP_MAP = extraerConstante('MODULO_APP_MAP');
const PLAN_ENTITLEMENTS = extraerConstante('PLAN_ENTITLEMENTS', { ALL_PLAN_FEATURES, MODULOS_COTIZADOR });

// App module id -> feature de capacidad que exige la app Flutter.
// Espejo de `moduloFeatureRequerida` en PP APP/lib/Shared/models/modulo.dart.
// `null` = módulo disponible en todos los planes (no requiere feature).
const APP_MODULE_FEATURE = {
  pos: 'pos',
  canal_tradicional: 'canal_tradicional',
  facturacion: 'facturacion_sar',
  fiscal_advanced: 'reportes_avanzados',
  inventario: 'inventario',
  sector_retail: 'operacion_completa',
  membresias: 'membresias',
  compras_proveedores: 'compras',
  comercial: 'compras',
  cotizaciones: 'operacion_completa',
  crm: 'clientes',
  crm_advanced: 'reportes_avanzados',
  contabilidad: 'operacion_completa',
  rrhh: 'operacion_completa',
  supply_chain: 'fleet',
  canal_moderno: 'canal_moderno',
  multi_empresa: 'multiempresa',
  chat_ia: 'ia',
  analytics: 'reportes',
  reportes: 'reportes_basicos',
  seguridad: 'seguridad_avanzada',
  settings: null,
  soporte: null,
};

/** Features efectivas de un plan = features declaradas + slugs del cotizador. */
function featuresDe(plan) {
  return new Set(PLAN_ENTITLEMENTS[plan]?.features || []);
}

test('el cotizador publica exactamente 23 módulos', () => {
  assert.equal(MODULOS_COTIZADOR.length, 23);
  assert.equal(new Set(MODULOS_COTIZADOR).size, 23, 'no debe haber slugs duplicados');
});

test('todo módulo del cotizador tiene metadatos y traducción a la app', () => {
  for (const m of MODULOS_COTIZADOR) {
    assert.ok(MODULO_APP_MAP[m] !== undefined, `falta MODULO_APP_MAP para ${m}`);
    assert.ok(Array.isArray(MODULO_APP_MAP[m]), `MODULO_APP_MAP.${m} no es un array`);
  }
});

test('toda app module mapeada a una feature existente en ALL_PLAN_FEATURES', () => {
  for (const [slug, apps] of Object.entries(MODULO_APP_MAP)) {
    for (const app of apps) {
      const feat = APP_MODULE_FEATURE[app];
      assert.notEqual(feat, undefined, `app module ${app} (de ${slug}) no tiene feature conocida`);
      if (feat === null) continue; // módulos sin feature requerida (disponibles en todos los planes)
      assert.ok(ALL_PLAN_FEATURES.includes(feat), `la feature '${feat}' no existe en ALL_PLAN_FEATURES`);
    }
  }
});

test('toda feature exigida por requirePlanFeature está en ALL_PLAN_FEATURES', () => {
  const usadas = new Set();
  for (const m of src.matchAll(/requirePlanFeature\('([^']+)'\)/g)) usadas.add(m[1]);
  assert.ok(usadas.size > 0, 'no se encontro ningun requirePlanFeature');
  for (const f of usadas) {
    assert.ok(
      ALL_PLAN_FEATURES.includes(f),
      `requirePlanFeature('${f}') usa una feature ausente de ALL_PLAN_FEATURES: ningun plan podria otorgarla`
    );
  }
});

test('toda feature usada por requirePlanFeature la otorga al menos un plan', () => {
  const usadas = new Set();
  for (const m of src.matchAll(/requirePlanFeature\('([^']+)'\)/g)) usadas.add(m[1]);
  for (const f of usadas) {
    const otorgadaPorAlguno = Object.keys(PLAN_ENTITLEMENTS).some((p) => featuresDe(p).has(f));
    assert.ok(otorgadaPorAlguno, `ningun plan otorga '${f}': el endpoint quedaria muerto para todos`);
  }
});

test('cada módulo que el plan vende es realmente accesible por la app', () => {
  // Este es el test que atrapa la inversion starter/enterprise vs club.
  const problemas = [];
  for (const [plan, modulos] of Object.entries(PLAN_CATALOGO_MODULOS)) {
    if (plan === 'personalizado' || modulos.length === 0) continue;
    const feats = featuresDe(plan);
    for (const mod of modulos) {
      const apps = MODULO_APP_MAP[mod] || [];
      if (apps.length === 0) continue; // modulo solo-web
      const alcanzable = apps.some((app) => {
        const feat = APP_MODULE_FEATURE[app];
        return feat == null || feats.has(feat);
      });
      if (!alcanzable) problemas.push(`${plan}: ${mod}`);
    }
  }
  assert.deepEqual(problemas, [], `modulos vendidos pero inaccesibles:\n  ${problemas.join('\n  ')}`);
});

test('enterprise y starter activan los 23 módulos y pueden usarlos', () => {
  for (const plan of ['enterprise', 'starter']) {
    assert.equal(PLAN_CATALOGO_MODULOS[plan].length, 23, `${plan} no publica los 23 módulos`);
    const feats = featuresDe(plan);
    for (const mod of MODULOS_COTIZADOR) {
      const apps = MODULO_APP_MAP[mod] || [];
      if (apps.length === 0) continue;
      const ok = apps.some((a) => {
        const feat = APP_MODULE_FEATURE[a];
        return feat == null || feats.has(feat);
      });
      assert.ok(ok, `${plan} activa ${mod} pero la app no puede abrirlo`);
    }
  }
});

test('ningun plan promete un módulo que no exista en el catálogo', () => {
  for (const [plan, modulos] of Object.entries(PLAN_CATALOGO_MODULOS)) {
    for (const mod of modulos) {
      assert.ok(MODULOS_COTIZADOR.includes(mod), `${plan} promete '${mod}', que no está en el catálogo`);
    }
  }
});

test('los límites de usuarios de los tres planes demo son los exigidos', () => {
  // Regla comercial: pulpería 3, tienda 15, club 35 usuarios/terminales.
  assert.equal(PLAN_ENTITLEMENTS.pulperia.maxUsers, 3);
  assert.equal(PLAN_ENTITLEMENTS.tienda.maxUsers, 15);
  assert.equal(PLAN_ENTITLEMENTS.club.maxUsers, 35);
});

test('pulpería incluye exactamente los 5 módulos que vende el plan', () => {
  assert.deepEqual(PLAN_CATALOGO_MODULOS.pulperia.slice().sort(), [
    'canal_tradicional', 'contabilidad', 'facturacion', 'inventario', 'pos',
  ].sort());
});

test('la app Flutter declara feature para cada app module mapeado', () => {
  const dart = fs.readFileSync(
    path.join(__dirname, '..', '..', 'PP APP', 'lib', 'Shared', 'models', 'modulo.dart'),
    'utf8'
  );
  const bloque = dart.match(/moduloFeatureRequerida\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(bloque, 'no se encontro moduloFeatureRequerida en modulo.dart');
  const declarado = new Map();
  for (const m of bloque[1].matchAll(/'([^']+)'\s*:\s*(?:'([^']*)'|null)/g)) {
    declarado.set(m[1], m[2] == null ? null : m[2]);
  }
  const appsUsadas = new Set(Object.values(MODULO_APP_MAP).flat());
  for (const app of appsUsadas) {
    assert.ok(declarado.has(app), `modulo.dart no declara la feature de '${app}'`);
    const feat = declarado.get(app);
    if (feat == null) continue;
    assert.ok(
      ALL_PLAN_FEATURES.includes(feat),
      `modulo.dart pide '${feat}' para '${app}' y esa feature no existe en ALL_PLAN_FEATURES`
    );
  }
});
// ---------------------------------------------------------------------------
// FASE 2 - mermas, pasillos, mesas, cuentas abiertas y control de acceso.
// Los modulos se vendieron antes de existir las tablas; estos tests evitan que
// un endpoint nuevo quededetras de una feature que ningun plan otorga.
// ---------------------------------------------------------------------------

test('retail_pasillos y gestion_membresias son features válidas', () => {
  for (const f of ['retail_pasillos', 'gestion_membresias']) {
    assert.ok(ALL_PLAN_FEATURES.includes(f), `${f} debe existir en ALL_PLAN_FEATURES`);
  }
});

test('nova market (plan tienda) puede usar pasillos: es retail completo', () => {
  const tienda = PLAN_ENTITLEMENTS.tienda.features;
  assert.ok(
    tienda.includes('retail_pasillos'),
    'el plan tienda vende retail completo segun planes.html y debe poder usar /api/pasillos'
  );
});

test('el plan club puede usar mesas y cuentas abiertas', () => {
  const club = PLAN_ENTITLEMENTS.club.features;
  assert.ok(club.includes('gestion_membresias'));
});

test('pulperia NO ofrece pasillos ni cuentas abiertas', () => {
  const pulperia = PLAN_ENTITLEMENTS.pulperia.features;
  assert.ok(!pulperia.includes('retail_pasillos'), 'pulperia es un mostrador, no un retail con pasillos');
  assert.ok(!pulperia.includes('gestion_membresias'));
});

test('mermas usa la feature de inventario, que los tres planes demo tienen', () => {
  const E = PLAN_ENTITLEMENTS;
  for (const plan of ['pulperia', 'tienda', 'club']) {
    assert.ok(
      E[plan].features.includes('inventario'),
      `el plan ${plan} debe poder registrar mermas (requiere 'inventario')`
    );
  }
});

test('las rutas de FASE 2 declaran el plan y el alcance de escritura', () => {
  const rutas = {
    'GET /api/pasillos': ["requirePlanFeature('retail_pasillos')"],
    'POST /api/pasillos': ["requireTenantAdmin", "requirePlanFeature('retail_pasillos')"],
    'PUT /api/pasillos/:id': ["requireTenantAdmin", "requirePlanFeature('retail_pasillos')"],
    'DELETE /api/pasillos/:id': ["requireTenantAdmin", "requirePlanFeature('retail_pasillos')"],
    'GET /api/mermas': ["authenticate"],
    'POST /api/mermas': ["requireTenantAdmin", "requirePlanFeature('inventario')"],
    'GET /api/mesas': ["requirePlanFeature('gestion_membresias')"],
    'POST /api/mesas': ["requireTenantAdmin", "requirePlanFeature('gestion_membresias')"],
    'PUT /api/mesas/:id': ["requireTenantAdmin", "requirePlanFeature('gestion_membresias')"],
    'DELETE /api/mesas/:id': ["requireTenantAdmin", "requirePlanFeature('gestion_membresias')"],
    'GET /api/cuentas-abiertas': ["requirePlanFeature('gestion_membresias')"],
    'POST /api/cuentas-abiertas': ["requirePlanFeature('gestion_membresias')"],
    'POST /api/cuentas-abiertas/:id/consumos': ["requirePlanFeature('gestion_membresias')"],
    'POST /api/cuentas-abiertas/:id/cerrar': ["requirePlanFeature('gestion_membresias')"],
    'GET /api/socios-accesos': ["requirePlanFeature('gestion_membresias')"],
    'GET /api/socios-accesos/actuales': ["requirePlanFeature('gestion_membresias')"],
    'POST /api/socios-accesos': ["requirePlanFeature('gestion_membresias')"],
  };
  for (const [ruta, esperados] of Object.entries(rutas)) {
    const [metodo, patron] = ruta.split(' ');
    // requirePlanFeature se ejecuta al cargar el archivo, asi que basta con que
    // el handler exista con esos middlewares en la cadena.
    const re = new RegExp(`app\\.${metodo.toLowerCase()}\\('${patron.replace(/[/:]/g, '\\$&')}'`);
    const m = re.exec(src);
    assert.ok(m, `no existe la ruta ${ruta}`);
    const cadena = src.slice(m.index, m.index + 700);
    for (const exp of esperados) {
      assert.ok(cadena.includes(exp), `${ruta} debe usar ${exp}`);
    }
    assert.ok(cadena.includes('authenticate'), `${ruta} debe exigir sesion`);
  }
});

test('las rutas de FASE 2 aisan el tenant y nunca lo aceptan del body', () => {
  const patrones = [
    /app\.get\('\/api\/mermas'/,
    /app\.post\('\/api\/mermas'/,
    /app\.get\('\/api\/mermas\/resumen'/,
    /app\.get\('\/api\/pasillos'/,
    /app\.post\('\/api\/pasillos'/,
    /app\.put\('\/api\/pasillos\/:id'/,
    /app\.delete\('\/api\/pasillos\/:id'/,
    /app\.get\('\/api\/mesas'/,
    /app\.post\('\/api\/mesas'/,
    /app\.put\('\/api\/mesas\/:id'/,
    /app\.delete\('\/api\/mesas\/:id'/,
    /app\.get\('\/api\/cuentas-abiertas'/,
    /app\.post\('\/api\/cuentas-abiertas'/,
    /app\.post\('\/api\/cuentas-abiertas\/:id\/consumos'/,
    /app\.post\('\/api\/cuentas-abiertas\/:id\/cerrar'/,
    /app\.get\('\/api\/socios-accesos'/,
    /app\.post\('\/api\/socios-accesos'/,
  ];
  for (const re of patrones) {
    const m = re.exec(src);
    assert.ok(m, `no se encontro la ruta ${re}`);
    const bloque = src.slice(m.index, src.indexOf('\n});', m.index));
    assert.ok(
      bloque.includes('normalizeTenantCode(getTenantCode(req))'),
      `${re} debe tomar el tenant del token, no del body`
    );
    assert.ok(
      !/empresa_codigo:\s*(req\.body|b\.empresa_codigo)/.test(bloque),
      `${re} no puede escribir empresa_codigo desde el body`
    );
  }
});

test('cerrar una cuenta abierta exige forma de pago', () => {
  const m = /app\.post\('\/api\/cuentas-abiertas\/:id\/cerrar'/.exec(src);
  assert.ok(m);
  const bloque = src.slice(m.index, src.indexOf('\n});', m.index));
  assert.ok(bloque.includes('forma_pago'), 'debe validar forma_pago');
  assert.ok(bloque.includes("estado !== 'abierta'"), 'no debe cerrar una cuenta ya cerrada');
  assert.ok(bloque.includes('monto_isv'), 'el total debe incluir el ISV acumulado');
});

test('el consumo de una cuenta abierta mueve stock con asiento propio en kardex', () => {
  const m = /app\.post\('\/api\/cuentas-abiertas\/:id\/consumos'/.exec(src);
  assert.ok(m);
  const bloque = src.slice(m.index, src.indexOf('\n});', m.index));
  assert.ok(bloque.includes('aplicarMovimientoStock'), 'debe descontar inventario');
  assert.ok(bloque.includes('revertirMovimientos'), 'debe compensar si falla el detalle');
  assert.ok(bloque.includes("kardexTipo: 'SALIDA_CONSUMO'"), 'el kardex debe distinguir el consumo');
});

test('registrar una merma descuenta stock y compensa si la merma no se guarda', () => {
  const m = /app\.post\('\/api\/mermas'/.exec(src);
  assert.ok(m);
  const bloque = src.slice(m.index, src.indexOf('\n});', m.index));
  assert.ok(bloque.includes('aplicarMovimientoStock'), 'debe descontar inventario');
  assert.ok(bloque.includes('revertirMovimientos'), 'debe compensar si falla el insert');
  assert.ok(bloque.includes("kardexTipo: 'SALIDA_MERMA'"), 'el kardex debe distinguir la merma');
  assert.ok(bloque.includes('motivo'), 'exige motivo para auditar la perdida');
  assert.ok(bloque.includes('STOCK_INSUFICIENTE'), 'debe rechazar si no hay stock');
});

test('ninguna escritura de FASE 2 acepta el stock o el precio del cliente', () => {
  assert.ok(
    !/app\.post\('\/api\/mermas'[\s\S]{0,3000}?precio_unitario:\s*b\./.test(src),
    'la merma no debe aceptar precio del cliente; usa el costo del producto'
  );
  const m = /app\.post\('\/api\/cuentas-abiertas\/:id\/consumos'/.exec(src);
  const bloque = src.slice(m.index, src.indexOf('\n});', m.index));
  assert.ok(
    !/permitirPrecioManual:\s*true/.test(bloque),
    'los consumos no admiten precio manual: manda el catalogo del tenant'
  );
});
