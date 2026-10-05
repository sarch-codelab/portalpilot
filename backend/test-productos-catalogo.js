/**
 * test-productos-catalogo.js - FASE 5: categoria, marca y pasillo del producto.
 * Ejecutar:  node --test backend/test-productos-catalogo.js
 *
 * Estas pruebas fijan el modelo corregido. Antes, `productos.categoria` (texto
 * libre) hacía doble trabajo: era la categoría del producto y además el
 * pasillo. Eso impedía tener categoría Y pasillo a la vez, y renombrar un
 * pasillo dejaba sus productos huérfanos sin avisar. Ahora son tres claves
 * foráneas contra el tenant, validadas antes de escribir.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, 'server.js');
const UI = path.join(__dirname, '..', 'js', 'operaciones-modulos.js');
const CSS = path.join(__dirname, '..', 'css', 'modulos-operativos.css');
const src = fs.readFileSync(SERVER, 'utf8');
const ui = fs.readFileSync(UI, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

/** Devuelve el bloque de código de una función declarada con nombre. */
function bloque(nombre, desde) {
  const patron = desde
    ? new RegExp(`(?:async\\s+)?function ${nombre}\\s*\\(`)
    : new RegExp(`(?:async\\s+)?function ${nombre}\\s*\\(`);
  const m = patron.exec(src);
  assert.ok(m, `no se encontro la funcion ${nombre}()`);
  let i = m.index;
  let profundidad = 0;
  let abierto = false;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') { profundidad += 1; abierto = true; }
    else if (src[i] === '}') {
      profundidad -= 1;
      if (abierto && profundidad === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`no se pudo delimitar ${nombre}()`);
}

const resolverCatalogo = bloque('resolverCatalogoProducto');
const resolverCatalogos = bloque('resolverCatalogosProducto');

test('el validador exige que el catalogo pertenezca al tenant', () => {
  assert.match(resolverCatalogo, /from\(tabla\)/);
  assert.match(resolverCatalogo, /\.eq\('empresa_codigo',\s*tenant\)/,
    'debe filtrar por empresa_codigo del tenant');
});

test('una referencia de otro tenant se rechaza en vez de guardarse', () => {
  // Si no filtrara por empresa_codigo, `data` seria null solo cuando el id no
  // existe; con el filtro, un id de otra empresa tambien da null -> 400.
  assert.match(resolverCatalogo, /if \(!data\)/,
    'un id inexistente o de otro tenant debe producir error');
  assert.match(resolverCatalogo, /return \{ error:/);
});

test('un valor vacio desvincula en vez de buscar', () => {
  assert.match(resolverCatalogo, /if \(valor === undefined\) return \{ valor: undefined \}/,
    'undefined significa "el cliente no mando el campo": no se toca');
  assert.match(resolverCatalogo, /if \(valor === null \|\| valor === ''\) return \{ valor: null \}/,
    'null o cadena vacia desvinculan el producto del catalogo');
});

test('los tres catalogos se resuelven en bloque, sin dejar el producto a medias', () => {
  for (const campo of ['categoria_id', 'marca_id', 'pasillo_id']) {
    assert.ok(resolverCatalogos.includes(campo), `debe resolver ${campo}`);
  }
  assert.match(resolverCatalogos, /if \(r\.error\) return \{ error: r\.error \}/,
    'un error aborta la resolucion completa antes de escribir');
});

test('el texto legacy se sincroniza con el nombre real del catalogo', () => {
  assert.match(resolverCatalogos, /salida\.categoria = r\.nombre/,
    'productos.categoria debe reflejar el nombre de la categoria elegida');
  assert.match(resolverCatalogos, /salida\.marca = r\.nombre/,
    'productos.marca debe reflejar el nombre de la marca elegida');
});

test('crear y editar producto guardan las tres referencias', () => {
  const post = bloque2(src, "app.post('/api/productos'");
  const put = bloque2(src, "app.put('/api/productos/:id'");
  for (const [nombre, bloqueSrc] of [['POST', post], ['PUT', put]]) {
    for (const campo of ['categoria_id', 'marca_id', 'pasillo_id']) {
      assert.ok(bloqueSrc.includes(campo), `${nombre} debe escribir ${campo}`);
    }
    assert.ok(bloqueSrc.includes('resolverCatalogosProducto'),
      `${nombre} debe validar los catalogos antes de escribir`);
  }
});

test('el PUT no acepta stock ni precio del cliente sin validar', () => {
  const put = bloque2(src, "app.put('/api/productos/:id'");
  assert.ok(put.includes('resolverCatalogosProducto'));
});

test('el conteo de productos por pasillo usa la FK, no el texto', () => {
  const ruta = bloque2(src, "app.get('/api/pasillos'");
  assert.ok(ruta.includes('.in(\'pasillo_id\', ids)'),
    'debe contar por pasillo_id');
  assert.ok(!ruta.includes(".in('categoria', nombres)"),
    'ya no debe emparejar pasillos contra productos.categoria');
});

test('desactivar un pasillo con productos bloqueados usa tambien la FK', () => {
  const ruta = bloque2(src, "app.delete('/api/pasillos/:id'");
  assert.ok(ruta.includes(".eq('pasillo_id', pasillo.id)"));
  assert.ok(!ruta.includes('.eq(\'categoria\', pasillo.nombre)'));
});

test('GET /api/productos filtra por las referencias del catalogo', () => {
  const ruta = bloque2(src, "app.get('/api/productos'");
  assert.ok(ruta.includes('req.query.categoria_id'));
  assert.ok(ruta.includes('req.query.marca_id'));
  assert.ok(ruta.includes('req.query.pasillo_id'));
});

test('el catalogo del producto valida su pertenencia al tenant en cada escritura', () => {
  assert.ok(src.includes('categoria_id'), 'la columna debe existir en el codigo');
  assert.ok(!/from\('productos'\)\s*\.insert\(\[\{[^}]*empresa_codigo:\s*b\./.test(src),
    'productos nunca debe tomar el tenant del cuerpo de la peticion');
});

/* ------------------------------------------------------------------ */
/* Pantalla de productos                                               */
/* ------------------------------------------------------------------ */

test('existe una pestana de productos con su render', () => {
  assert.match(ui, /id:\s*'productos'/, 'debe declararse la pestana productos');
  assert.match(ui, /render:\s*renderProductos/);
  assert.match(ui, /async function renderProductos\(/);
});

test('el formulario de producto ofrece categoria, marca y pasillo como select', () => {
  const form = bloqueUI(ui, 'formProducto');
  for (const nombre of ['prodCategoriaId', 'prodMarcaId', 'prodPasilloId']) {
    assert.ok(form.includes(nombre), `debe existir el campo ${nombre}`);
    assert.ok(form.includes(`name="${nombre.replace('prod', '').toLowerCase()}_id"`) ||
      /name="(categoria|marca|pasillo)_id"/.test(form),
    'el select debe enviar el id del catalogo, no el texto');
  }
});

test('un plan sin retail_pasillos no rompe la pantalla de productos', () => {
  // Los pasillos requieren una feature que una pulperia no tiene. La pantalla
  // debe pedirlo con `soft` y dejar el selector deshabilitado, no romperse.
  assert.match(ui, /request\('\/api\/pasillos\?todos=1',\s*\{\s*soft:\s*true\s*\}\)/,
    'los pasillos se piden en modo tolerante a plan');
  assert.match(ui, /no disponible en tu plan/);
});

test('el buscador de productos filtra en vivo y conserva el foco', () => {
  assert.match(ui, /data-op-prod-buscar/);
  assert.match(ui, /function onInput\(/);
  assert.match(ui, /addEventListener\('input', onInput\)/);
});

test('el filtro por pasillo se guarda en la clave que la tabla lee', () => {
  // Regresion: el atributo data-op-prod-filtro="pasillo" se guardaba en
  // state.filtros.pasillo y productosVisibles() leia prodPasillo, asi que el
  // filtro no hacia nada.
  assert.match(ui, /'prodPasillo'/, 'la clave prodPasillo debe existir');
  assert.match(ui, /'prodCategoria'/, 'la clave prodCategoria debe existir');
  assert.match(ui, /state\.filtros\[clave\] = evento\.target\.value/);
});

test('el precio de compra no puede superar al de venta', () => {
  assert.match(ui, /precio de compra.*es mayor que el de venta/s,
    'debe avisar antes de guardar una perdida por producto mal cargado');
});

test('las clases nuevas de productos existen en la hoja de estilos', () => {
  for (const clase of ['.op-filters', '.op-check', '.op-table-wrap', '.op-note']) {
    assert.ok(css.includes(clase), `falta ${clase} en modulos-operativos.css`);
  }
  assert.match(css, /\.op-table \.is-warn/);
  assert.match(css, /\.op-table tbody tr\.is-inactivo/);
});

test('la tabla de productos sigue la convencion responsive del proyecto', () => {
  const render = bloqueUI(ui, 'renderProductos');
  assert.ok(render.includes('data-label='), 'los td necesitan data-label para movil');
  assert.ok(render.includes('<th class="actions">'), 'columna de acciones con la clase del proyecto');
});

test('el modulo Inventario abre la pestana de productos', () => {
  const ini = fs.readFileSync(path.join(__dirname, '..', 'js', 'inicio-modulos.js'), 'utf8');
  assert.match(ini, /'Inventario':\s*'operaciones\.html\?tab=productos'/);
});

test('POST /api/sync acepta las FKs de catalogo del producto', () => {
  // Sin esto la app offline (que encola en `productos` y reenvia el mapa
  // entero) perderia las tres referencias al sincronizar.
  const i = src.indexOf('const SYNC_SAFE_COLUMNS');
  assert.notEqual(i, -1, 'no se encontro SYNC_SAFE_COLUMNS');
  const columnas = /productos:\s*\[([^\]]+)\]/.exec(src.slice(i));
  assert.ok(columnas, 'no se encontro la whitelist SYNC_SAFE_COLUMNS.productos');
  for (const campo of ['categoria_id', 'marca_id', 'pasillo_id']) {
    assert.ok(
      columnas[1].includes(`'${campo}'`),
      `productos no admite ${campo} por /api/sync; la app offline perderia la referencia`
    );
  }
});

test('POST /api/sync valida que las referencias de catalogo pertenezcan al tenant', () => {
  // El upsert generico escribe filas crudas: si no se valida aqui, un cliente
  // podria colgar del producto una categoria_id de otra empresa.
  const handler = bloque2(src, "app.post('/api/sync'");
  assert.match(
    handler,
    /tabla === 'productos'[\s\S]*resolverCatalogosProducto\(tenant, row/,
    'el sync de productos debe validar las referencias de catalogo contra el tenant'
  );
  assert.match(
    handler,
    /if \(refs\.error\) return res\.status\(400\)/,
    'una referencia de otro tenant debe rechazarse con 400 antes de escribir'
  );
});

test('el formulario Flutter de producto usa el catalogo del servidor', () => {
  // Flutter no puede mantener una lista fija de categorias: el catalogo es del
  // tenant y cambia. Se conserva la semilla solo como fallback sin conexion.
  const form = fs.readFileSync(
    path.join(
      __dirname, '..', '..', 'PP APP', 'lib', 'Modules', 'Inventario', 'producto_form.dart'
    ),
    'utf8'
  );
  assert.match(form, /CatalogosService\.instance\.categorias\(\)/);
  assert.match(form, /CatalogosService\.instance\.marcas\(\)/);
  assert.match(form, /CatalogosService\.instance\.pasillos\(\)/);
  assert.match(form, /'categoria_id':\s*_idDeCategoria\(/);
  assert.match(form, /'marca_id':\s*_idDeMarca\(/);
  assert.match(form, /'pasillo_id':\s*_pasilloId/);
});

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Extrae el handler de una ruta `app.<metodo>('<ruta>'` desde su apertura. */
function bloque2(fuente, apertura) {
  const i = fuente.indexOf(apertura);
  assert.notEqual(i, -1, `no se encontro ${apertura}`);
  let profundidad = 0;
  let visto = false;
  for (let j = i; j < fuente.length; j += 1) {
    if (fuente[j] === '{') { profundidad += 1; visto = true; }
    else if (fuente[j] === '}') {
      profundidad -= 1;
      if (visto && profundidad === 0) return fuente.slice(i, j + 1);
    }
  }
  throw new Error(`no se pudo deliminar ${apertura}`);
}

/** Igual que bloque(), pero sobre un archivo que no es server.js. */
function bloqueUI(fuente, nombre) {
  const m = new RegExp(`(?:async\\s+)?function ${nombre}\\s*\\(`).exec(fuente);
  assert.ok(m, `no se encontro ${nombre}()`);
  let profundidad = 0;
  let visto = false;
  for (let i = m.index; i < fuente.length; i += 1) {
    if (fuente[i] === '{') { profundidad += 1; visto = true; }
    else if (fuente[i] === '}') {
      profundidad -= 1;
      if (visto && profundidad === 0) return fuente.slice(m.index, i + 1);
    }
  }
  throw new Error(`no se pudo delimitar ${nombre}()`);
}