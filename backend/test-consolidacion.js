/**
 * test-consolidacion.js — FASE 4: una sola fuente de verdad por concepto.
 * Ejecutar:  node --test backend/test-consolidacion.js
 *
 * Estas pruebas fijan las decisiones de consolidación y, sobre todo, los
 * defectos que la encontré y que pueden volver: doble contabilización de la
 * misma venta y metadata doble-codificado (que dejaba los reportes vacíos).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');

/** Devuelve el bloque de código de una función declarada con nombre. */
function bloqueDeFuncion(nombre) {
  const i = src.indexOf(`function ${nombre}`);
  assert.notEqual(i, -1, `no existe la función ${nombre}`);
  // La firma puede terminar en `{ tenant, empresa }` (desestructuración de
  // parámetros). Buscar el primer `{` devolvía ESA firma y no el cuerpo, así que
  // las aserciones veían un bloque de 60 caracteres y todas fallaban. Se salta
  // la lista de parámetros balanceando paréntesis hasta el `{` que abre el
  // cuerpo real.
  const abreParametros = src.indexOf('(', i);
  let profundidadParen = 0;
  let cierraParametros = -1;
  for (let j = abreParametros; j < src.length; j++) {
    if (src[j] === '(') profundidadParen++;
    else if (src[j] === ')') {
      profundidadParen--;
      if (profundidadParen === 0) { cierraParametros = j; break; }
    }
  }
  assert.notEqual(cierraParametros, -1, `no se pudo cerrar la firma de ${nombre}`);
  const desde = src.indexOf('{', cierraParametros);
  let profundidad = 0;
  for (let j = desde; j < src.length; j++) {
    if (src[j] === '{') profundidad++;
    else if (src[j] === '}') {
      profundidad--;
      if (profundidad === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`no se pudo cerrar ${nombre}`);
}

/**
 * Extrae la expresión que empieza en `declaracion` y termina en su cierre de
 * llave. Necesario cuando la misma clave (por ejemplo `empresa_codigo: tenant`)
 * aparece en varias partes de una función y la prueba debe apuntar a una en
 * concreto: afirmar sobre el bloque entero daba un falso positivo.
 */
function bloqueDeExpresion(declaracion) {
  const i = src.indexOf(declaracion);
  assert.notEqual(i, -1, `no existe la expresión: ${declaracion}`);
  const desde = src.indexOf('{', i);
  let profundidad = 0;
  for (let j = desde; j < src.length; j++) {
    if (src[j] === '{') profundidad++;
    else if (src[j] === '}') {
      profundidad--;
      if (profundidad === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`no se pudo cerrar la expresión: ${declaracion}`);
}

/**
 * Quita comentarios para poder afirmar sobre CÓDIGO y no sobre la prosa que lo
 * explica. Varios de estos defectos ya están corregidos y el arreglo está
 * documentado junto al código ("nunca JSON.stringify", "ver FASE 4"), así que un
 * /JSON\.stringify/ sobre el archivo completo detectaba su propia explicación.
 */
function sinComentarios(texto) {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/**
 * Devuelve el cuerpo del handler de una ruta, para no contaminar vecindarios.
 * `POST /api/pos/ventas` es el nombre canónico: es el que usan el cliente
 * Flutter (db_service.dart), las pruebas de release y la documentacion.
 */
function handlerDeRuta(metodo, patron) {
  const re = new RegExp(`app\\.${metodo}\\('${patron.replace(/[/:]/g, '\\$&')}'`);
  const m = re.exec(src);
  assert.ok(m, `no existe la ruta ${metodo.toUpperCase()} ${patron}`);
  const ventana = src.slice(m.index, m.index + 6000);
  // Si el patrón también coincide con una ruta más corta (p. ej. `/api/x`
  // dentro de `/api/x/y`), se toma la más larga para no leer un handler ajeno.
  return ventana;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defecto 1: metadata doble-codificado
// ─────────────────────────────────────────────────────────────────────────────

test('el POS registra metadata como objeto jsonb, no como texto', () => {
  const pos = sinComentarios(handlerDeRuta('post', '/api/pos/ventas'));
  // Un JSON.stringify() sobre una columna jsonb deja el valor como string y
  // hace que metadata->>'subtotal' devuelva NULL.
  assert.ok(!/JSON\.stringify/.test(pos),
    'metadata no debe enviarse como texto: produce metadata doble-codificado');
  assert.ok(/metadata:\s*\{/.test(pos), 'metadata debe enviarse como objeto');
});

test('la proyeccion de sync offline tambien escribe metadata como objeto', () => {
  const bloque = sinComentarios(bloqueDeFuncion('proyectarVentasPosAContable'));
  assert.ok(!/JSON\.stringify/.test(bloque),
    'la proyeccion offline no debe stringifyar metadata');
  assert.ok(/metadata:\s*\{/.test(bloque), 'la proyeccion debe enviar metadata como objeto');
});

test('ninguna escritura de transacciones convierte metadata a texto', () => {
  // Se afirma la invariante real: TODA escritura de `metadata` es un objeto.
  // La versión anterior buscaba `metadata: <identificador>` y exigía que
  // existiera alguna, lo cual solo se cumple si el defecto sigue presente.
  const codigo = sinComentarios(src);
  const escrituras = [...codigo.matchAll(/metadata:\s*/g)];
  assert.ok(escrituras.length > 0, 'debe existir al menos una escritura de metadata');
  for (const e of escrituras) {
    const resto = codigo.slice(e.index + e[0].length);
    assert.ok(/^\s*\{/.test(resto),
      `metadata debe enviarse como objeto jsonb, se encontró: ${resto.slice(0, 60).split('\n')[0]}`);
    assert.ok(!/JSON\.stringify/.test(resto.slice(0, 120)),
      'metadata no debe enviarse como texto: queda doble-codificado');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Defecto 2: la misma venta contabilizada dos veces
// ─────────────────────────────────────────────────────────────────────────────

test('el POS es idempotente: consulta la venta existente antes de insertar', () => {
  const pos = sinComentarios(handlerDeRuta('post', '/api/pos/ventas'));
  assert.ok(/numero_venta/.test(pos), 'debe considerar numero_venta');
  const consulta = pos.indexOf(".eq('referencia'");
  const insercion = pos.indexOf('insertVenta');
  assert.ok(consulta !== -1, 'debe consultar por la referencia de negocio');
  assert.ok(consulta < insercion, 'la consulta de idempotencia precede al insert');
  // Comprobar solo el orden de las llamadas no basta: la consulta puede quedar
  // en el código pero nunca ejecutarse. Se exige que esté condicionada al
  // numero de venta y que el reintento devuelva la venta ya registrada.
  const guarda = /if \(\s*b\.numero_venta\s*\)/.exec(pos);
  assert.ok(guarda, 'la consulta de idempotencia debe depender de numero_venta');
  assert.ok(guarda.index < consulta,
    'la consulta debe estar dentro de la guarda de numero_venta');
  assert.ok(/duplicada:\s*true/.test(pos),
    'un reintento debe devolver la venta existente, no crear otra');
});

test('una carrera por el indice unico devuelve la venta ganadora, no un 500', () => {
  const pos = sinComentarios(handlerDeRuta('post', '/api/pos/ventas'));
  assert.ok(/23505/.test(pos), 'debe detectar la violacion de unicidad');
  assert.ok(/ventaGanadora/.test(pos), 'debe recuperar la venta ya registrada');
});

test('la referencia de venta se deriva del numero de venta del cliente', () => {
  const pos = sinComentarios(handlerDeRuta('post', '/api/pos/ventas'));
  assert.ok(/venta_pos:\$\{b\.numero_venta/.test(pos),
    'la clave de idempotencia debe ser el numero de venta, no un id del servidor');
});

// ─────────────────────────────────────────────────────────────────────────────
// Proyección POS offline → libro canónico
// ─────────────────────────────────────────────────────────────────────────────

test('las ventas del POS offline se proyectan a transacciones', () => {
  const sync = handlerDeRuta('post', '/api/sync');
  assert.ok(/proyectarVentasPosAContable/.test(sync),
    '/api/sync debe proyectar pos_ventas al libro canonico');
});

test('la proyeccion offline no duplica una venta ya contabilizada', () => {
  const bloque = bloqueDeFuncion('proyectarVentasPosAContable');
  const chequeo = bloque.indexOf('.eq(\'referencia\'');
  const insercion = bloque.indexOf('.insert(');
  assert.ok(chequeo !== -1 && chequeo < insercion,
    'debe verificar si la venta ya existe antes de insertar');
});

test('la proyeccion offline conserva el detalle de la venta en el ledger', () => {
  const bloque = bloqueDeFuncion('proyectarVentasPosAContable');
  for (const clave of ['items', 'subtotal', 'isv', 'descuento', 'total', 'numero_venta']) {
    assert.ok(bloque.includes(clave), `la proyección debe preservar ${clave}`);
  }
  assert.ok(/origen_tipo:\s*'venta_pos_offline'/.test(bloque),
    'debe marcar el origen para poder auditar la sincronizacion');
});

test('la proyeccion offline no acepta tenant del cuerpo', () => {
  const bloque = bloqueDeFuncion('proyectarVentasPosAContable');
  const empresaDeFila = /empresa_codigo:\s*row\./.test(bloque);
  assert.ok(!empresaDeFila, 'el tenant debe venir de la sesion, nunca de la fila');
});

// ─────────────────────────────────────────────────────────────────────────────
// Autorización y aislamiento de las nuevas rutas
// ─────────────────────────────────────────────────────────────────────────────

test('la proyeccion exige sesion y plan', () => {
  const re = /app\.post\('\/api\/sync'/;
  const m = re.exec(src);
  assert.ok(m, 'debe existir /api/sync');
  assert.ok(src.slice(m.index, m.index + 60).includes('authenticate'),
    '/api/sync debe exigir sesion');
});

test('la sincronizacion solo permite tablas de la lista blanca', () => {
  assert.ok(/SYNC_SAFE_COLUMNS\[tabla\]/.test(src),
    'debe validar la tabla contra SYNC_SAFE_COLUMNS');
});

// ─────────────────────────────────────────────────────────────────────────────
// Fuentes unicas: las tablas retiradas no deben reaparecer
// ─────────────────────────────────────────────────────────────────────────────

const TABLAS_RETIRADAS = [
  'ordenes_compra', 'compra_items', 'orden_compra_items',
  'fiado_abonos', 'puntos_historial',
];

test('ninguna tabla retirada vuelve a leerse o escribirse desde el backend', () => {
  for (const tabla of TABLAS_RETIRADAS) {
    assert.ok(!new RegExp(`\\.from\\('${tabla}'\\)`).test(src),
      `el backend no debe tocar la tabla eliminada ${tabla}`);
  }
  assert.ok(!/\.from\('ventas'\)/.test(src),
    'el ledger financiero es transacciones, no ventas');
});

test('las tablas retiradas no estan en la lista blanca de sincronizacion', () => {
  const i = src.indexOf('const SYNC_SAFE_COLUMNS');
  assert.notEqual(i, -1, 'debe existir SYNC_SAFE_COLUMNS');
  const bloque = src.slice(i, src.indexOf('const SYNC_CONFLICT_TARGET', i));
  for (const tabla of TABLAS_RETIRADAS) {
    assert.ok(!new RegExp(`^\\s*${tabla}:`, 'm').test(bloque),
      `${tabla} no debe seguir sincronizandose`);
  }
});

test('compras es la unica fuente de compra y guarda lineas normalizadas', () => {
  const helper = bloqueDeFuncion('registrarCompraEnLedger');
  assert.ok(helper.includes(".from('compras')"),
    'el helper debe escribir en compras');
  assert.ok(helper.includes(".from('compras_detalle')"),
    'el helper debe escribir las lineas en compras_detalle');
  // El detalle no puede volver a guardarse como un JSONB items.
  assert.ok(!/items:\s*o\.items/.test(helper),
    'el detalle no debe guardarse como un unico JSONB');
});

test('ordenes-compra sigue funcionando, pero sobre compras', () => {
  const get = handlerDeRuta('get', '/api/ordenes-compra');
  const post = handlerDeRuta('post', '/api/ordenes-compra');
  assert.ok(get.includes('registrarCompraEnLedger') === false || get.includes('cargarDetalleCompras'),
    'la lectura debe reusar el helper de detalle, no la tabla retirada');
  assert.ok(post.includes('registrarCompraEnLedger'),
    'la escritura debe pasar por la unica implementacion de compra');
  assert.ok(post.includes("requirePlanFeature('compras')"),
    'ordenes-compra debe exigir el plan de compras');
});

test('ordenes-compra ya no acepta el total del cliente', () => {
  const post = handlerDeRuta('post', '/api/ordenes-compra');
  assert.ok(!/total:\s*parseFloat\(o\.total\)/.test(post),
    'el total se calcula en el ledger, no lo manda el cliente');
  assert.ok(post.includes('proveedores'),
    'debe resolver el proveedor dentro del tenant');
});

test('el total de compra descuenta el descuento', () => {
  const helper = bloqueDeFuncion('registrarCompraEnLedger');
  assert.ok(/total:\s*subtotal \+ isv - descuento/.test(helper),
    'el total debe ser subtotal + isv - descuento');
});

test('una compra sin lineas no deja encabezado huerfano', () => {
  const helper = bloqueDeFuncion('registrarCompraEnLedger');
  assert.ok(/compras'\)\.delete\(\)\.eq\('id'/.test(helper),
    'si falla el detalle se revierte el encabezado');
});

test('las lineas de compra son aislables por tenant', () => {
  // Debe afirmarse sobre el `.map()` que arma las LINEAS, no sobre el
  // encabezado: `empresa_codigo: tenant` también aparece en el encabezado, así
  // que buscarlo en toda la función daba un falso positivo.
  const lineas = sinComentarios(bloqueDeExpresion('const detalle = items.map'));
  assert.ok(/empresa_codigo:\s*tenant/.test(lineas),
    'cada linea debe heredar el tenant del encabezado');
  assert.ok(/empresa_id:\s*empresa\.id/.test(lineas),
    'cada linea debe heredar la empresa del encabezado');
  // Y el tenant no puede romperse al mezclar el detalle con el encabezado.
  const helper = sinComentarios(bloqueDeFuncion('registrarCompraEnLedger'));
  const insercionDetalle = helper.indexOf(".from('compras_detalle')");
  assert.ok(!/empresa_codigo:\s*o\.|empresa_codigo:\s*body\./.test(helper),
    'el tenant de la linea no puede venir del cuerpo de la peticion');
  assert.ok(insercionDetalle !== -1, 'el detalle debe insertarse en compras_detalle');
});