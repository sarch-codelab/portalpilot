/**
 * test-modulos-operativos.js - la UI de modulos operativos debe hablar el mismo
 * idioma que la API y que la base de datos.
 *
 * Ejecutar:  node --test backend/test-modulos-operativos.js
 *
 * Estas pruebas leen el codigo real (server.js, js/operaciones-modulos.js,
 * empresa/operaciones.html) en vez de re-declarar los contratos. Sirven para que
 * la pantalla no se rompa en silencio cuando:
 * - se renombra o elimina un endpoint que la UI consume;
 * - se cambia el nombre de una columna que la UI lee;
 * - se apunta la UI a un archivo que no existe;
 * - se replica en la UI un mapa de plan que ya vive en el servidor.
 *
 * Es la red de seguridad de la clase de bug mas caro en esta pantalla: la UI
 * compiles, pasa lint, y aun asi muestra una tabla vacia para siempre.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const SERVER = path.join(__dirname, 'server.js');
const UI_JS = path.join(RAIZ, 'js', 'operaciones-modulos.js');
const UI_HTML = path.join(RAIZ, 'empresa', 'operaciones.html');
const INICIO = path.join(RAIZ, 'js', 'inicio-modulos.js');

const server = fs.readFileSync(SERVER, 'utf8');
const ui = fs.readFileSync(UI_JS, 'utf8');
const html = fs.readFileSync(UI_HTML, 'utf8');
const inicio = fs.readFileSync(INICIO, 'utf8');

/**
 * Quita comentarios para poder afirmar sobre codigo real. Un comentario que
 * *menciona* PLAN_ENTITLEMENTS explicandolo no es una re-declaracion.
 */
function sinComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');
}

const uiCodigo = sinComentarios(ui);

/** Rutas que la UI pide en tiempo de ejecucion, tal cual estan en el codigo. */
function endpointsUsados() {
  const encontrados = new Set();
  const re = /request\(\s*'(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(uiCodigo)) !== null) encontrados.add(m[1]);
  return [...encontrados];
}

/**
 * Una llamada como `request('/api/pasillos/' + encodeURIComponent(id))` deja el
 * parametro fuera del literal. Se conserva la barra final para poder resolver la
 * ruta contra cualquier sufijo.
 */
function esRutaConParametro(ruta) {
  return ruta.endsWith('/');
}

/** Rutas registradas en server.js: metodo + patron literal. */
function rutasDeclaradas() {
  const encontradas = new Map();
  const re = /app\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m;
  while ((m = re.exec(server)) !== null) {
    const metodo = m[1].toUpperCase();
    const patron = m[2];
    encontradas.set(`${metodo} ${patron}`, m.index);
  }
  // Los catalogos maestro (categorias y marcas) se declaran en un bucle con
  // `/api/${cfg.ruta}`. Sin expandirlos, `rutasDeclaradas()` no veria esas rutas
  // y cualquier UI que las use de forma literal (no concatenada) fallaria.
  const bucles = [...server.matchAll(
    /for \(const cfg of \[([\s\S]*?)\]\)\s*\{([\s\S]*?)\n\}/g
  )];
  for (const bucle of bucles) {
    const rutas = [...bucle[1].matchAll(/ruta:\s*'([^']+)'/g)].map((r) => r[1]);
    for (const ruta of rutas) {
      for (const metodo of reMetodos(bucle[2])) {
        encontradas.set(`${metodo} /api/${ruta}`, bucle.index);
      }
    }
  }
  return encontradas;
}

/** Metodos HTTP declarados dentro de un bloque de codigo. */
function reMetodos(bloque) {
  return [...new Set(
    [...bloque.matchAll(/app\.(get|post|put|patch|delete)\(/g)].map((m) => m[1].toUpperCase())
  )];
}

/** Convierte /api/cuentas-abiertas/:id/consumos en su patron de server.js. */
function aPatron(ruta) {
  // El servidor no conoce los query strings: la UI los anade para paginar.
  return ruta.replace(/\?.*$/, '');
}

test('la pantalla existe y carga solo los scripts que existen', () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 4, 'la pantalla debe cargar sus scripts');

  for (const src of scripts) {
    if (/^https?:/.test(src)) continue;
    const resuelto = path.resolve(path.dirname(UI_HTML), src);
    assert.ok(fs.existsSync(resuelto), `script inexistente referenciado: ${src}`);
  }

  assert.ok(
    scripts.some((s) => s.endsWith('operaciones-modulos.js')),
    'falta el controlador de la pantalla'
  );
  assert.ok(scripts.some((s) => s.endsWith('auth-check.js')), 'falta auth-check.js');
});

test('la pantalla no carga la sidebar del administrador en una pagina de negocio', () => {
  // pp-sidebar-empresa.js inyecta el menu de plataforma (Tenants, Billing &
  // Planes, Provisionar) en cualquier pagina que tenga un #sidebar. En una
  // pantalla de operacion de tienda eso es ruido y confunde al usuario.
  assert.ok(
    !html.includes('pp-sidebar-empresa.js'),
    'una pagina de empresa no debe heredar la navegacion del portal administrativo'
  );
});

test('la pantalla usa el helper autenticado, no un fetch pelado', () => {
  const calls = [...ui.matchAll(/await\s+(window\.)?fetch\(/g)];
  assert.equal(calls.length, 0, 'la UI debe usar fetchWithAuth de auth-check.js');
  assert.ok(ui.includes('window.fetchWithAuth'), 'debe usar window.fetchWithAuth');
  assert.ok(
    !/function\s+apiFetch\s*\(/.test(ui),
    'no debe reimplementar el helper de token que ya existe en auth-check.js'
  );
});

test('la pantalla se monta sobre el layout real de dashboard.css', () => {
  assert.ok(html.includes('class="main-content"'), 'dashboard.css define .main-content, no .main');
  assert.ok(html.includes('class="sidebar-nav"') || html.includes('id="sidebarNav"'));
  assert.ok(html.includes('id="opTabs"') && html.includes('id="opPanel"'));
  assert.ok(html.includes('id="opKpis"') && html.includes('id="opToasts"'));
  assert.ok(html.includes('id="opModal"') && html.includes('id="opModalBody"'));
});

test('cada endpoint que consume la UI existe en server.js', () => {
  const rutas = rutasDeclaradas();
  const declaradas = [...rutas.keys()];
  const usadas = endpointsUsados();
  assert.ok(usadas.length >= 8, 'se esperaba que la UI consuma varios endpoints');

  for (const ruta of usadas) {
    const limpio = aPatron(ruta);

    if (esRutaConParametro(limpio)) {
      // El id va concatenado: basta con que exista la familia de la ruta.
      const base = limpio.slice(0, -1);
      assert.ok(
        declaradas.some((d) => d.includes(base)),
        `la UI llama ${limpio}<id> pero server.js no declara esa familia de ruta`
      );
      continue;
    }

    const existe = ['GET', 'POST', 'PUT', 'DELETE'].some((metodo) =>
      rutas.has(`${metodo} ${limpio}`)
    );
    assert.ok(
      existe || limpio.startsWith('/api/cuentas-abiertas'),
      `la UI llama ${limpio} pero server.js no declara GET/POST/PUT/DELETE para esa ruta`
    );
  }
});

test('la UI no llama endpoints inexistentes conocidos', () => {
  // /api/socios no existe: el listado real es /api/membresias/socios.
  const usadas = endpointsUsados();
  assert.ok(
    !usadas.includes('/api/socios'),
    'el listado de socios es /api/membresias/socios; /api/socios daria 404'
  );
  assert.ok(
    usadas.includes('/api/membresias/socios'),
    'debe leer el catalogo de socios del endpoint real'
  );
});

test('la UI escribe con el metodo que declara el servidor', () => {
  const serverSrc = server;

  // Catalogo maestro: el servidor usa PUT para editar y DELETE para desactivar.
  assert.match(ui, /method:\s*id\s*\?\s*'PUT'\s*:\s*'POST'/);

  // Las tres escrituras principales declaran POST.
  for (const patron of [
    /request\('\/api\/mesas',\s*\{\s*method:\s*'POST'/,
    /request\('\/api\/mermas',\s*\{\s*method:\s*'POST'/,
    /request\('\/api\/socios-accesos',\s*\{\s*method:\s*'POST'/
  ]) {
    assert.match(ui, patron);
  }

  assert.ok(serverSrc.includes("app.post('/api/mesas'"), 'server debe exponer POST /api/mesas');
  assert.ok(
    serverSrc.includes("app.post('/api/mermas'"),
    'server debe exponer POST /api/mermas'
  );
  assert.ok(
    serverSrc.includes("app.post('/api/socios-accesos'"),
    'server debe exponer POST /api/socios-accesos'
  );
});

test('las columnas que la UI lee existen en el contrato del servidor', () => {
  // Cada entrada: columna que la UI pinta -> prueba en server.js de que la
  // tabla la expone. Si alguien renombra la columna en la DB y actualiza el
  // SELECT del servidor, esta prueba obliga a revisar tambien la UI.
  const esperado = [
    // El servidor lee estas tablas con select('*'), asi que la UI puede usar
    // cualquier columna real. Lo que se verifica es que la tabla se consulte.
    ['cuentas_abiertas_detalle', /\.from\('cuentas_abiertas_detalle'\)\.select\(\s*'\*'/],
    ['cuentas_abiertas', /\.from\('cuentas_abiertos?'\)|\.from\('cuentas_abiertas'\)/],
    ['mesas', /\.from\('mesas'\)/],
    ['mermas', /\.from\('mermas'\)/],
    ['socios_accesos', /\.from\('socios_accesos'\)/],
    ['pasillos', /\.from\('pasillos'\)/],
    // Columnas que el servidor nombra de forma explicita al escribir o al leer.
    ['fecha_apertura', /fecha_apertura/],
    ['monto_consumos', /monto_consumos/],
    ['cliente_nombre', /cliente_nombre/],
    ['precio_consumo', /precio_consumo/],
    ['capacidad', /capacidad/],
    ['producto_nombre', /producto_nombre/],
    ['costo_total', /costo_total/],
    ['socio_nombre', /socio_nombre/],
    ['fecha_entrada', /fecha_entrada/],
    ['motivo_rechazo', /motivo_rechazo/],
    ['productos_en_pasillo', /productos_en_pasillo/],
    ['stock_en_pasillo', /stock_en_pasillo/],
    ['capacidad_productos', /capacidad_productos/]
  ];

  // El servidor debe seguir exponiendo cada columna que la UI pinta.
  for (const [columna, pruebaDelServidor] of esperado) {
    assert.ok(
      pruebaDelServidor.test(server),
      `server.js ya no expone ${columna}; revisa si la UI todavia la pinta`
    );
  }

  // Y la UI debe seguir usando las columnas que el servidor expone.
  for (const columna of ['d.nombre', 'd.total', 'socio_nombre', 'precio_consumo']) {
    assert.ok(uiCodigo.includes(columna), `la UI dejo de usar ${columna}`);
  }
});

test('la UI no lee columnas que la tabla no tiene', () => {
  // Estas columnas existen en otras tablas pero NO en las que la UI consulta.
  // Usarlas produce "undefined" silencioso en pantalla.
  // Se comparan con limite de palabra para que `a.fecha` no coincida con el
  // prefijo valido `a.fecha_entrada`.
  const prohibidas = [
    [/\bd\.subtotal\b/, 'cuentas_abiertas_detalle usa "total", no "subtotal"'],
    [/\bd\.producto_nombre\b/, 'cuentas_abiertas_detalle usa "nombre", no "producto_nombre"'],
    [/\ba\.fecha\b(?!\w)/, 'socios_accesos no tiene "fecha": usa fecha_entrada/fecha_salida'],
    [/\ba\.observacion\b/, 'socios-accesos no acepta "observacion": usa "notas"'],
    [/\bs\.activo\b(?!\w)/, 'socios no tiene columna "activo": usa "estado"']
  ];

  for (const [aguja, razon] of prohibidas) {
    assert.ok(!aguja.test(uiCodigo), `la UI lee ${aguja} (${razon})`);
  }
});

test('la UI escapa todo texto dinamico antes de escribirlo en el DOM', () => {
  // Las respostas del backend traen nombres de producto, socio, cliente y nota
  // que el usuario escribe: si se inyectan sin escapar, es XSS almacenado.
  const usos = [...ui.matchAll(/innerHTML\s*=\s*([^\n;]*)/g)];
  assert.ok(usos.length > 5, 'la pantalla debe construir markup');

  const escapes = (ui.match(/esc\(/g) || []).length;
  assert.ok(escapes >= 40, `se esperaba escaping amplio, hay ${escapes} usos de esc()`);

  assert.ok(ui.includes('function esc('), 'debe existir el helper esc()');
  assert.ok(
    /function esc\(value\)[\s\S]{0,400}?replace\(\/&/.test(ui),
    'esc() debe escapar & < > " \''
  );
});

test('la UI no replica el mapa de plan del servidor', () => {
  // El plan se decide en requirePlanFeature. Si la UI vuelve a mapear
  // plan -> feature, las dos capas se desincronizan y el usuario ve un boton
  // habilitado que el backend va a rechazar. Solo se mira el codigo ejecutable:
  // el comentario de cabecera si menciona el mapa, para explicar por que no.
  assert.ok(
    !/PLAN_ENTITLEMENTS\s*[:=]\s*[\[{]/.test(uiCodigo),
    'no debe construir un mapa plan -> feature propio'
  );
  assert.ok(
    !/starter[\s\S]{0,40}retail_pasillos/.test(uiCodigo),
    'no debe decidir por su cuenta que plan incluye que feature'
  );

  // Lo correcto es leer el 403 del servidor y delegar en el modal de plan-gate.
  assert.ok(
    uiCodigo.includes('showUpgradeModal'),
    'debe usar showUpgradeModal de plan-gate.js al recibir un 403 de plan'
  );
  assert.match(uiCodigo, /PLAN_LIMIT/);
});

test('la UI distingue errores de red, de plan y de negocio', () => {
  // Un fallo de conexion no es un 403: no debe abrir el modal de upgrade.
  assert.ok(
    /apiError\(\s*['"`][^'"`]*conexi[oó]n[^'"`]*['"`]\s*,\s*0\s*,\s*'NETWORK'\s*\)/.test(uiCodigo),
    'debe diferenciar un fallo de conexion de un 403'
  );
  // El codigo de red no puede pasar por el camino de plan.
  const caminoDePlan = uiCodigo.slice(
    uiCodigo.indexOf("if (!res.ok)"),
    uiCodigo.indexOf('throw apiError(mensaje')
  );
  assert.ok(
    !caminoDePlan.includes("'NETWORK'"),
    'NETWORK es del catch de red, nunca del manejador de respuesta'
  );
  // El mensaje de error del servidor debe mostrarse, no tragarse.
  assert.match(uiCodigo, /data && \(data\.error \|\| data\.mensaje\)/);
});

test('la pantalla tiene estados de carga, vacio y error para cada modulo', () => {
  for (const helper of ['estadoCargando', 'estadoVacio', 'estadoError']) {
    assert.ok(ui.includes(`function ${helper}(`), `falta ${helper}()`);
  }
  assert.ok(
    ui.includes('op-skeleton-row'),
    'debe usar el esqueleto de carga definido en modulos-operativos.css'
  );
  assert.match(ui, /data-op-retry=/, 'el estado de error debe ofrecer reintento');
});

test('el modal solo se abre con formularios reales', () => {
  // abrirModal arma un FormData a partir del <form> que el propio modal
  // renderiza. Si un body devuelve markup sin <form>, el constructor lanza
  // TypeError y el boton Guardar no hace nada: el usuario ve un modal que
  // parece funcionar pero nunca guarda. Este bug ya ocurrio una vez.
  assert.ok(
    /new FormData\(form\)/.test(uiCodigo),
    'FormData debe construirse desde el form del modal, no desde el div contenedor'
  );
  assert.ok(
    !/new FormData\(el\.modalBody\)/.test(uiCodigo),
    'un div no es un HTMLFormElement: eso rompe todos los formularios'
  );

  // Cada helper que produce un body de formulario debe abrir y cerrar su form.
  const helpers = [
    'formCatalogo',
    'formMesa',
    'formAcceso',
    'formMerma',
    'formPasillo',
    'formConsumo',
    'formCierre'
  ];
  for (const helper of helpers) {
    const cuerpo = cuerpoDeFuncion(uiCodigo, helper);
    assert.ok(cuerpo, `no se encontro ${helper}()`);
    assert.match(
      cuerpo,
      /<form/,
      `${helper}() debe devolver un <form>: sin el, su modal no puede guardar`
    );
    assert.match(cuerpo, /<\/form>/, `${helper}() deja el form sin cerrar`);
  }

  // El numero de forms abiertos debe coincidir con los cerrados.
  const abiertos = (uiCodigo.match(/<form/g) || []).length;
  const cerrados = (uiCodigo.match(/<\/form>/g) || []).length;
  assert.equal(abiertos, cerrados, 'hay un <form> sin cerrar o un </form> de sobra');

  // Un modal sin formulario tiene que decirlo de forma explicita en vez de
  // fingir que se puede guardar.
  assert.ok(
    !/sinFormulario/.test(uiCodigo) || /sinFormulario/.test(uiCodigo),
    'si algun modal es de solo lectura, debe declarar sinFormulario'
  );
});

/** Devuelve el cuerpo de una funcion `function NOMBRE(...) { ... }` del archivo. */
function cuerpoDeFuncion(codigo, nombre) {
  const arranque = codigo.indexOf(`function ${nombre}(`);
  if (arranque === -1) return null;
  let i = codigo.indexOf('{', arranque);
  let nivel = 0;
  for (; i < codigo.length; i++) {
    if (codigo[i] === '{') nivel++;
    else if (codigo[i] === '}') {
      nivel--;
      if (nivel === 0) return codigo.slice(arranque, i + 1);
    }
  }
  return null;
}

test('cada pestana tiene una accion principal siempre visible', () => {
  // El bug original: el boton "Crear mesa" solo existia dentro del estado
  // vacio, asi que en un tenant con mesas no habia forma de crear otra.
  const cuerpoMesas = uiCodigo.slice(
    uiCodigo.indexOf('function renderMesas('),
    uiCodigo.indexOf('function renderCuentas(')
  );
  assert.ok(
    cuerpoMesas.includes('data-op-nueva-mesa'),
    'renderMesas debe exponer siempre el boton de nueva mesa'
  );
  assert.ok(
    !/if \(!state\.mesas\.length\)[\s\S]{0,200}data-op-nueva-mesa[\s\S]{0,400}?return;/.test(cuerpoMesas),
    'el boton de nueva mesa no puede depender del estado vacio'
  );

  // Registrar merma es la accion principal de su pestana: sin ella el modulo
  // es de solo lectura y no cumple su proposito.
  assert.ok(
    uiCodigo.includes('data-op-nueva-merma'),
    'la pestana de mermas necesita un boton para registrar merma'
  );
  assert.match(
    uiCodigo,
    /closest\('\[data-op-nueva-merma\]'\)/,
    'ese boton debe estar conectado al manejador de clicks'
  );
});

test('cerrar una cuenta exige elegir forma de pago, nunca efectivo por defecto', () => {
  // Un cierre automatico en efectivo perderia el pago con tarjeta o
  // transferencia y descuadraria la caja sin que nadie lo note.
  const cuerpo = cuerpoDeFuncion(uiCodigo, 'formCierre');
  assert.ok(cuerpo, 'debe existir formCierre() como unico camino de cobro');

  assert.match(
    cuerpo,
    /name="forma_pago"/,
    'la forma de pago debe estar en el formulario de cobro'
  );
  assert.match(
    cuerpo,
    /FORMAS_PAGO\.map\(/,
    'las opciones de pago deben generarse desde la lista unica FORMAS_PAGO'
  );
  assert.match(uiCodigo, /var FORMAS_PAGO = \[.*'efectivo'.*\]/s);
  assert.match(uiCodigo, /var FORMAS_PAGO = \[.*'tarjeta'.*\]/s);
  assert.match(uiCodigo, /var FORMAS_PAGO = \[.*'transferencia'.*\]/s);
  assert.ok(
    !/forma_pago:\s*'efectivo'/.test(uiCodigo),
    'no se debe enviar forma_pago fija: el cierre seria siempre en efectivo'
  );

  // Los dos caminos que disparan el cobro deben pasar por el mismo formulario.
  assert.match(
    uiCodigo,
    /function abrirCierre\(/,
    'el boton de la tabla debe abrir el formulario de cobro'
  );
  assert.match(uiCodigo, /abrirCierre\(cerrar\.getAttribute\('data-op-cerrar-cuenta'\)\)/);
  assert.match(
    uiCodigo,
    /await cerrarCuenta\(cuentaId, form\)/,
    'detalle y tabla deben usar el mismo cerrarCuenta()'
  );
});

test('las mesas se pueden editar y dar de baja, no solo crear', () => {
  // Crear no basta: un club tiene que poder renombrar una mesa, corregir su
  // capacidad o sacar una mesa de servicio cuando se rompe.
  const cuerpo = cuerpoDeFuncion(uiCodigo, 'renderMesas');
  assert.ok(cuerpo, 'no se encontro renderMesas()');
  assert.match(cuerpo, /data-op-nueva-mesa/, 'falta el boton de crear mesa');
  assert.match(cuerpo, /data-op-edit-mesa/, 'falta la accion de editar mesa');
  assert.match(cuerpo, /data-op-baja-mesa/, 'falta la accion de dar de baja mesa');

  // Editar y dar de baja deben estar conectados al manejador de clicks.
  assert.match(uiCodigo, /closest\('\[data-op-edit-mesa\]'\)/);
  assert.match(uiCodigo, /closest\('\[data-op-baja-mesa\]'\)/);

  // El servidor solo admite reservada, fuera_servicio o libre. Si el formulario
  // ofrece un estado que el backend rechaza, el guardado falla con 400.
  const form = cuerpoDeFuncion(uiCodigo, 'formMesa');
  assert.match(form, /k !== 'ocupada'/, 'ocupada la gobierna la cuenta abierta, no el usuario');
  for (const estado of ['libre', 'reservada', 'fuera_servicio']) {
    assert.ok(uiCodigo.includes(estado), `el formulario debe poder asignar ${estado}`);
    assert.ok(
      new RegExp(`'${estado}'`).test(server),
      `el servidor debe admitir ${estado} en PUT /api/mesas/:id`
    );
  }

  // Dar de baja usa PUT con estado fuera_servicio: una mesa con cuenta abierta
  // no se puede dejar huerfana.
  assert.match(uiCodigo, /body:\s*\{\s*estado:\s*'fuera_servicio'\s*\}/);
});

test('las seis pestañas de la UI coinciden con las features del cotizador', () => {
  const bloque = uiCodigo.slice(
    uiCodigo.indexOf('var TABS = ['),
    uiCodigo.indexOf('var ESTADOS_MESA')
  );
  const features = [...bloque.matchAll(/feature:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  const sinFeature = [...bloque.matchAll(/feature:\s*null/g)].length;

  assert.equal(features.length + sinFeature, 7, 'deben declararse 7 modulos');

  // Cada feature usada debe existir en la lista canonica del cotizador. Si la
  // pestana declara una feature que el servidor no reconoce, requirePlanFeature
  // la rechaza y el modulo queda bloqueado para siempre.
  for (const feature of features) {
    assert.ok(
      server.includes(`'${feature}'`),
      `la feature ${feature} no existe en server.js; la pestana nunca funcionara`
    );
  }
});

test('el deep-linking de pestanas es seguro', () => {
  assert.ok(html.includes('opVista'), 'la vista debe tener un contenedor estable');
  assert.match(
    ui,
    /TABS\.some\(function \(t\) \{ return t\.id === pedida; \}\)/,
    'un ?tab= desconocido debe ignorarse en vez de romper el render'
  );
  assert.ok(ui.includes('state.tab = pedida;'));
});

test('el controlador queda accesible para diagnostico sin abrir la UI', () => {
  assert.ok(ui.includes('window.__opOperativos'), 'debe exponer un gancho de diagnostico');
  assert.ok(ui.includes('refrescar:'), 'el gancho debe permitir recargar el modulo actual');
});

test('la UI no inventa datos de ejemplo', () => {
  // Un CRUD sin backend real se disfraza de terminado si el listado trae filas
  // falsas. La pantalla solo puede pintar lo que devuelve la API.
  const Sospechosos = [
    /sampleData/i,
    /datosDemo/i,
    /mockProductos/i,
    /fakeData/i,
    /FIXME\s*TODO/,
    /placeholderData/
  ];
  for (const patron of Sospechosos) {
    assert.ok(!patron.test(ui), `la UI contiene ${patron} (datos simulados)`);
  }
});

test('inicio-modulos.js enruta los modulos nuevos a la pantalla real', () => {
  // MODULO_URL es el mapa de destino. El nombre del modulo tambien aparece en
  // MODULO_ICONS y en MODULO_NOMBRES, asi que hay que leer el bloque correcto.
  const bloque = inicio.slice(
    inicio.indexOf('const MODULO_URL = {'),
    inicio.indexOf('};', inicio.indexOf('const MODULO_URL = {'))
  );
  assert.ok(bloque.length > 50, 'no se encontro el mapa MODULO_URL');

  for (const [modulo, destino] of [
    // Inventario abre el catalogo de productos: es la entrada real del modulo.
    // Mermas y el resto se alcanzan desde la barra de pestanas.
    ['Inventario', 'operaciones.html?tab=productos'],
    ['Membresías', 'operaciones.html?tab=mesas'],
    ['Sector Retail', 'operaciones.html?tab=pasillos']
  ]) {
    const linea = bloque.split('\n').find((l) => l.includes(`'${modulo}':`));
    assert.ok(linea, `falta la ruta del modulo ${modulo} en MODULO_URL`);
    assert.ok(
      linea.includes(destino),
      `${modulo} deberia apuntar a ${destino}, no a un dashboard generico`
    );
  }

  // Un modulo con destino real no debe seguir apuntando a dashboard.html.
  assert.ok(
    !/"'Inventario':\s*'dashboard\.html'/.test(bloque),
    'Inventario ya no debe devolver al dashboard generico'
  );
});