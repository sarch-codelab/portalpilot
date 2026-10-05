/*
 * Modulos operativos de la empresa.
 *
 * Pantalla unica con pestanas para los modulos que el backend expone y que
 * antes solo existian como API: mesas, cuentas abiertas, accesos de socios,
 * mermas, pasillos y catalogos maestro (categorias / marcas).
 *
 * Reglas que este archivo respeta:
 * - Sin datos de ejemplo: cada fila viene de la API del tenant. Si un endpoint
 *   responde 403 por plan, la pestana se marca como bloqueada y se llama al
 *   modal de upgrade de plan-gate.js en vez de inventar contenido.
 * - El plan se decide en el servidor (requirePlanFeature). La UI no replica
 *   PLAN_ENTITLEMENTS: por eso una pestana bloqueada se determina leyendo el
 *   `code: 'PLAN_LIMIT'` que devuelve el backend, no comparando planes aqui.
 * - Toda escritura pasa por fetchWithAuth (auth-check.js) para que el Bearer
 *   token y la cuenta activa sean siempre los de la sesion real.
 * - Todo texto que venga de la API se escapa antes de tocar innerHTML.
 */
(function () {
  'use strict';

  var API_ERROR_CODES = { PLAN_LIMIT: 1, PLAN_LIMIT_REACHED: 1, TRIAL_EXPIRED: 1 };

  /* ---------------------------------------------------------------- */
  /* Definicion de pestanas                                            */
  /* ---------------------------------------------------------------- */

  var TABS = [
    {
      id: 'productos',
      label: 'Productos',
      icon: 'fa-box',
      feature: 'inventario',
      desc: 'Catalogo de productos: precio, stock, categoria, marca y pasillo.',
      render: renderProductos
    },
    {
      id: 'mesas',
      label: 'Mesas',
      icon: 'fa-table-cells',
      feature: 'gestion_membresias',
      desc: 'Mapa de mesas del club, su estado y la cuenta abierta asociada.',
      render: renderMesas
    },
    {
      id: 'cuentas',
      label: 'Cuentas abiertas',
      icon: 'fa-receipt',
      feature: 'gestion_membresias',
      desc: 'Consumos en curso por mesa: agregar items, ver el total y cerrar el cobro.',
      render: renderCuentas
    },
    {
      id: 'accesos',
      label: 'Accesos socios',
      icon: 'fa-id-card',
      feature: 'gestion_membresias',
      desc: 'Registrar entrada y salida de socios y ver quien sigue dentro.',
      render: renderAccesos
    },
    {
      id: 'mermas',
      label: 'Mermas',
      icon: 'fa-triangle-exclamation',
      feature: 'inventario',
      desc: 'Perdidas de inventario: descuentan stock y dejan asiento en kardex.',
      render: renderMermas
    },
    {
      id: 'pasillos',
      label: 'Pasillos',
      icon: 'fa-grip-lines',
      feature: 'retail_pasillos',
      desc: 'Organizacion del salon retail y cuantos productos tiene cada pasillo.',
      render: renderPasillos
    },
    {
      id: 'catalogos',
      label: 'Categorias y marcas',
      icon: 'fa-tags',
      feature: null,
      desc: 'Catalogos maestro de productos. Se desactivan, no se borran.',
      render: renderCatalogos
    }
  ];

  var ESTADOS_MESA = {
    libre: { label: 'Libre', cls: 'is-libre' },
    reservada: { label: 'Reservada', cls: 'is-reservada' },
    ocupada: { label: 'Ocupada', cls: 'is-ocupada' },
    fuera_servicio: { label: 'Fuera de servicio', cls: 'is-fuera' }
  };

  var TIPOS_MERMA = [
    ['merma', 'Merma'],
    ['desperdicio', 'Desperdicio'],
    ['vencimiento', 'Vencimiento'],
    ['robo', 'Robo'],
    ['dano', 'Dano'],
    ['devolucion', 'Devolucion'],
    ['ajuste', 'Ajuste']
  ];

  var TIPOS_ACCESO = [
    ['entrada', 'Entrada'],
    ['salida', 'Salida'],
    ['entrada_salida', 'Entrada y salida'],
    ['rechazado', 'Rechazado']
  ];

  var FORMAS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'credito'];

  var state = {
    tab: 'productos',
    locked: {},
    counts: {},
    cache: {},
    filtros: { mermaTipo: '', pasilloQuery: '', prodQuery: '', prodPasillo: '', prodCategoria: '', prodInactivos: false },
    mesas: [],
    productos: [],
    clientes: [],
    socios: [],
    catalogos: { categorias: [], marcas: [], pasillos: [] }
  };

  var el = {};

  /* ---------------------------------------------------------------- */
  /* Utilidades de presentacion                                        */
  /* ---------------------------------------------------------------- */

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function money(value) {
    return 'L ' + num(value).toLocaleString('es-HN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function fecha(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-HN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function capitalize(value) {
    var texto = String(value == null ? '' : value);
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
  }

  function badge(text, cls) {
    return '<span class="op-badge ' + esc(cls || '') + '">' + esc(text) + '</span>';
  }

  function estadoMesaBadge(estado) {
    var meta = ESTADOS_MESA[estado] || { label: estado || '—', cls: 'is-inactivo' };
    return badge(meta.label, meta.cls);
  }

  function toast(message, kind) {
    var host = el.toasts;
    if (!host) return;
    var node = document.createElement('div');
    node.className = 'op-toast ' + (kind === 'error' ? 'is-error' : 'is-ok');
    node.innerHTML =
      '<i class="fas ' + (kind === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check') + '"></i>' +
      '<div>' + esc(message) + '</div>';
    host.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(function () { node.remove(); }, 220);
    }, kind === 'error' ? 6500 : 4000);
  }

  /* ---------------------------------------------------------------- */
  /* Capa de red                                                       */
  /* ---------------------------------------------------------------- */

  function apiError(message, status, code) {
    var err = new Error(message || 'Error inesperado');
    err.status = status || 0;
    err.code = code || '';
    return err;
  }

  async function request(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {})
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    var res;
    try {
      res = await window.fetchWithAuth(path, init);
    } catch (networkErr) {
      throw apiError('No se pudo conectar con el servidor. Revisa tu conexion.', 0, 'NETWORK');
    }

    var texto = await res.text();
    var data = null;
    if (texto) {
      try { data = JSON.parse(texto); } catch (e) { data = null; }
    }

    if (!res.ok) {
      var mensaje = (data && (data.error || data.mensaje)) || ('Error ' + res.status);
      // `soft` se usa para listados de apoyo: si fallan por plan no se bloquea
      // la pestana activa, porque el modulo puede seguir siendo utilizable.
      if (!options.soft && API_ERROR_CODES[data && data.code]) {
        marcarBloqueada(state.tab);
        if (typeof window.showUpgradeModal === 'function') {
          window.showUpgradeModal((data && data.code) === 'TRIAL_EXPIRED' ? 'la operacion' : currentFeature());
        }
      }
      throw apiError(mensaje, res.status, data && data.code);
    }
    return data;
  }

  function currentFeature() {
    var tab = TABS.find(function (t) { return t.id === state.tab; });
    return tab ? tab.feature : '';
  }

  function marcarBloqueada(tabId) {
    state.locked[tabId] = true;
    pintarTabs();
  }

  /* ---------------------------------------------------------------- */
  /* Estados de pantalla                                               */
  /* ---------------------------------------------------------------- */

  function estadoCargando(host, filas) {
    var barra = [];
    for (var i = 0; i < (filas || 6); i += 1) barra.push('<div class="op-skeleton-row"></div>');
    host.innerHTML = '<div class="op-skeleton-rows">' + barra.join('') + '</div>';
  }

  function estadoVacio(host, icono, titulo, texto, accion) {
    host.innerHTML =
      '<div class="op-state">' +
      '<div class="op-state-icon"><i class="fas ' + esc(icono) + '"></i></div>' +
      '<div class="op-state-title">' + esc(titulo) + '</div>' +
      '<p class="op-state-text">' + esc(texto) + '</p>' +
      (accion || '') +
      '</div>';
  }

  function estadoError(host, mensaje, reintentar) {
    host.innerHTML =
      '<div class="op-state is-error">' +
      '<div class="op-state-icon"><i class="fas fa-triangle-exclamation"></i></div>' +
      '<div class="op-state-title">No se pudo cargar</div>' +
      '<p class="op-state-text">' + esc(mensaje) + '</p>' +
      '<button class="btn btn-ghost" data-op-retry="' + esc(reintentar) + '">' +
      '<i class="fas fa-rotate-right"></i> Reintentar</button>' +
      '</div>';
  }

  /* ---------------------------------------------------------------- */
  /* Pints de pestanas y KPIs                                          */
  /* ---------------------------------------------------------------- */

  function pintarTabs() {
    el.tabs.innerHTML = TABS.map(function (tab) {
      var bloqueada = !!state.locked[tab.id];
      var count = state.counts[tab.id];
      var candado = bloqueada
        ? ' <i class="fas fa-lock" title="Requiere un plan superior"></i>'
        : '';
      var badge = count === undefined || count === null
        ? ''
        : '<span class="op-tab-count">' + esc(count) + '</span>';
      return '<button class="op-tab' + (state.tab === tab.id ? ' active' : '') + '"' +
        ' data-op-tab="' + esc(tab.id) + '"' +
        (bloqueada ? ' disabled' : '') +
        ' title="' + esc(bloqueada ? 'Requiere un plan superior' : tab.desc) + '">' +
        '<i class="fas ' + esc(tab.icon) + '"></i><span>' + esc(tab.label) + '</span>' +
        candado + badge +
        '</button>';
    }).join('');

    var activa = TABS.find(function (t) { return t.id === state.tab; });
    el.subtitle.textContent = activa ? activa.desc : '';
  }

  function pintarKpis(items) {
    el.kpis.innerHTML = (items || []).map(function (kpi) {
      var clase = kpi.kind ? ' is-' + kpi.kind : '';
      var money = kpi.money ? ' is-money' : '';
      return '<div class="op-kpi">' +
        '<div class="op-kpi-label">' + esc(kpi.label) + '</div>' +
        '<div class="op-kpi-value' + clase + money + '">' +
        (kpi.money ? esc(money(kpi.value)) : esc(kpi.value)) +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- */
  /* Modal de formulario                                               */
  /* ---------------------------------------------------------------- */

  function abrirModal(config) {
    el.modalTitle.textContent = config.title;
    el.modalAlert.textContent = '';
    el.modalAlert.classList.remove('show');
    el.modalBody.innerHTML = config.body;
    el.modalFoot.innerHTML =
      '<button class="btn btn-ghost" data-op-modal-cancel>Cancelar</button>' +
      '<button class="btn btn-acc" data-op-modal-submit>' +
      '<i class="fas ' + esc(config.icon || 'fa-check') + '"></i> ' +
      esc(config.submitLabel || 'Guardar') + '</button>';

    var guardar = el.modal.querySelector('[data-op-modal-submit]');
    guardar.onclick = async function () {
      // El cuerpo del modal es un div, no un form: FormData solo acepta
      // HTMLFormElement. Hay que tomar el form que el propio modal renderizo.
      var form = el.modalBody.querySelector('form');
      if (!form) {
        mostrarErrorModal('Este formulario no se pudo preparar. Cierra y vuelve a abrirlo.');
        return;
      }
      guardar.disabled = true;
      try {
        await config.onSubmit(new FormData(form), el.modalAlert);
      } catch (err) {
        mostrarErrorModal(err.message);
      } finally {
        guardar.disabled = false;
      }
    };

    el.modal.classList.add('open');
    if (typeof config.onOpen === 'function') config.onOpen();

    // Enfocar el primer campo ahorra un clic y deja claro donde escribir.
    var primero = el.modalBody.querySelector('input:not([type=hidden]), select, textarea');
    if (primero && !primero.dataset.opSinFoco) primero.focus();
  }

  function cerrarModal() {
    el.modal.classList.remove('open');
    el.modalBody.innerHTML = '';
  }

  function mostrarErrorModal(mensaje) {
    el.modalAlert.textContent = mensaje;
    el.modalAlert.classList.add('show');
  }

  /* ---------------------------------------------------------------- */
  /* Confirmacion destructiva                                          */
  /* ---------------------------------------------------------------- */

  function confirmar(texto, onOk) {
    if (!window.confirm(texto)) return;
    Promise.resolve(onOk()).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ---------------------------------------------------------------- */
  /* Productos: catalogo maestro de la empresa                         */
  /* ---------------------------------------------------------------- */

  // Un producto referencia categoria, marca y pasillo por id. Los tres se
  // resuelven con `soft: true` porque un plan puede tener inventario sin tener
  // retail_pasillos (una pulperia, por ejemplo): en ese caso el selector de
  // pasillo queda deshabilitado con una explicacion en vez de romper la pantalla.
  async function cargarCatalogosProducto() {
    var [categorias, marcas, pasillos] = await Promise.all([
      request('/api/categorias?todos=1', { soft: true }).catch(function () { return null; }),
      request('/api/marcas?todos=1', { soft: true }).catch(function () { return null; }),
      request('/api/pasillos?todos=1', { soft: true }).catch(function () { return null; })
    ]);
    state.catalogos.categorias = (categorias && categorias.catalogo) || [];
    state.catalogos.marcas = (marcas && marcas.catalogo) || [];
    state.catalogos.pasillos = (pasillos && pasillos.pasillos) || [];
  }

  function activoDe(catalogo, id) {
    if (!id) return null;
    for (var i = 0; i < catalogo.length; i += 1) {
      if (String(catalogo[i].id) === String(id)) return catalogo[i];
    }
    return null;
  }

  function productosVisibles() {
    var q = state.filtros.prodQuery.trim().toLowerCase();
    var pasillo = state.filtros.prodPasillo;
    var categoria = state.filtros.prodCategoria;
    return state.productos.filter(function (p) {
      if (!state.filtros.prodInactivos && p.activo === false) return false;
      if (pasillo && String(p.pasillo_id || '') !== pasillo) return false;
      if (categoria && String(p.categoria_id || '') !== categoria) return false;
      if (!q) return true;
      return [p.nombre, p.codigo, p.barcode, p.categoria, p.marca]
        .filter(Boolean)
        .some(function (v) { return String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  function optionCatalogo(seleccionado, lista, placeholder, sinPermiso) {
    if (sinPermiso) {
      return '<option value="">' + esc(placeholder) + ' (no disponible en tu plan)</option>';
    }
    return '<option value="">' + esc(placeholder) + '</option>' + lista
      .filter(function (c) { return c.activo !== false; })
      .map(function (c) {
        var sel = String(seleccionado || '') === String(c.id) ? ' selected' : '';
        return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.nombre) + '</option>';
      }).join('');
  }

  async function renderProductos(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);
    // A diferencia de las listas de apoyo, aqui el catalogo es el contenido de la
    // pestana: si el plan no incluye `inventario` debe quedar bloqueada con la
    // invitacion a mejorar el plan, no una tabla vacia que parece un error.
    var data = await request('/api/productos');
    state.productos = (data && data.productos) || [];
    await cargarCatalogosProducto();

    var visibles = productosVisibles();
    var bajoStock = visibles.filter(function (p) {
      return num(p.stock_actual) <= num(p.stock_minimo);
    });
    var valorInventario = visibles.reduce(function (acc, p) {
      return acc + num(p.stock_actual) * num(p.precio_compra);
    }, 0);

    state.counts.productos = visibles.length;
    pintarKpis([
      { label: 'Productos', value: visibles.length },
      { label: 'Activos', value: visibles.filter(function (p) { return p.activo !== false; }).length, kind: 'ok' },
      { label: 'Bajo minimo', value: bajoStock.length, kind: bajoStock.length ? 'danger' : undefined },
      { label: 'Valor inventario', value: valorInventario, money: true }
    ]);

    var sinPasillos = state.catalogos.pasillos.length === 0;
    host.innerHTML =
      '<div class="op-panel"><div class="op-panel-head">' +
      '<h2 class="op-panel-title"><i class="fas fa-box"></i> Catalogo de productos</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-acc" data-op-nuevo-producto>' +
      '<i class="fas fa-plus"></i> Nuevo producto</button>' +
      '</div></div>' +
      '<div class="op-filters">' +
      '<input class="op-input" data-op-prod-buscar placeholder="Buscar por nombre, codigo o barcode" ' +
      'value="' + esc(state.filtros.prodQuery) + '">' +
      '<select class="op-select" data-op-prod-filtro="pasillo">' +
      optionCatalogo(state.filtros.prodPasillo, state.catalogos.pasillos, 'Todos los pasillos') +
      '</select>' +
      '<select class="op-select" data-op-prod-filtro="categoria">' +
      optionCatalogo(state.filtros.prodCategoria, state.catalogos.categorias, 'Todas las categorias') +
      '</select>' +
      '<label class="op-check"><input type="checkbox" data-op-prod-inactivos' +
      (state.filtros.prodInactivos ? ' checked' : '') + '> Ver inactivos</label>' +
      '</div>' +
      '<div class="op-panel-body" data-op-productos></div></div>';

    var cuerpo = host.querySelector('[data-op-productos]');
    if (!visibles.length) {
      var hayFiltro = state.filtros.prodQuery || state.filtros.prodPasillo ||
        state.filtros.prodCategoria || state.filtros.prodInactivos;
      estadoVacio(
        cuerpo,
        'fa-box-open',
        hayFiltro ? 'Sin resultados' : 'Aun no hay productos',
        hayFiltro
          ? 'Ningun producto coincide con la busqueda o los filtros aplicados.'
          : 'Registra tu primer producto para poder vender, controlar stock y generar mermas.',
        hayFiltro
          ? '<button class="btn btn-ghost btn-sm" data-op-prod-limpiar>Limpiar filtros</button>'
          : ''
      );
      return;
    }

    cuerpo.innerHTML =
      '<div class="op-table-wrap"><table class="op-table">' +
      '<thead><tr>' +
      '<th>Codigo</th><th>Producto</th><th>Categoria</th><th>Marca</th><th>Pasillo</th>' +
      '<th class="num">Stock</th><th class="num">Costo</th><th class="num">Precio</th><th class="actions">Acciones</th>' +
      '</tr></thead><tbody>' +
      visibles.map(function (p) {
        var stock = num(p.stock_actual);
        var minimo = num(p.stock_minimo);
        var claseStock = stock <= 0 ? 'is-danger' : (stock <= minimo ? 'is-warn' : '');
        var pasillo = (activoDe(state.catalogos.pasillos, p.pasillo_id) || {}).nombre;
        return '<tr' + (p.activo === false ? ' class="is-inactivo"' : '') + '>' +
          '<td data-label="Codigo" class="mono">' + esc(p.codigo || '-') + '</td>' +
          '<td data-label="Producto"><span class="op-strong">' + esc(p.nombre) + '</span>' +
          (p.activo === false ? ' ' + badge('Inactivo', 'is-inactivo') : '') + '</td>' +
          '<td data-label="Categoria">' + esc(p.categoria || '-') + '</td>' +
          '<td data-label="Marca">' + esc(p.marca || '-') + '</td>' +
          '<td data-label="Pasillo">' + esc(pasillo || '-') + '</td>' +
          '<td data-label="Stock" class="num ' + claseStock + '">' + esc(stock) +
          (minimo ? ' <span class="op-muted">/ ' + esc(minimo) + '</span>' : '') + '</td>' +
          '<td data-label="Costo" class="num">' + esc(money(p.precio_compra)) + '</td>' +
          '<td data-label="Precio" class="num"><span class="op-strong">' + esc(money(p.precio_venta)) + '</span></td>' +
          '<td class="actions">' +
          '<button class="op-icon-btn" data-op-edit-producto="' + esc(p.id) + '" ' +
          'title="Editar" aria-label="Editar ' + esc(p.nombre) + '"><i class="fas fa-pen"></i></button>' +
          '</td></tr>';
      }).join('') +
      '</tbody></table></div>';

    if (sinPasillos) {
      cuerpo.insertAdjacentHTML('beforeend',
        '<p class="op-note"><i class="fas fa-circle-info"></i> ' +
        'Este plan no incluye pasillos. Se habilitan con el modulo de retail.</p>');
    }
  }

  function formProducto(producto) {
    var cats = state.catalogos.categorias;
    var marcas = state.catalogos.marcas;
    var pasillos = state.catalogos.pasillos;
    var p = producto || {};
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field"><label for="prodNombre">Nombre</label>' +
      '<input class="op-input" id="prodNombre" name="nombre" required maxlength="200" ' +
      'value="' + esc(p.nombre || '') + '" placeholder="Ej. Café molido 250g"></div>' +
      '<div class="op-field"><label for="prodCodigo">Codigo</label>' +
      '<input class="op-input" id="prodCodigo" name="codigo" maxlength="100" ' +
      'value="' + esc(p.codigo || '') + '" placeholder="Ej. CAF-001"></div>' +
      '<div class="op-field"><label for="prodBarcode">Codigo de barras</label>' +
      '<input class="op-input" id="prodBarcode" name="barcode" maxlength="100" inputmode="numeric" ' +
      'value="' + esc(p.barcode || '') + '"></div>' +
      '<div class="op-field"><label for="prodPresentacion">Presentacion</label>' +
      '<input class="op-input" id="prodPresentacion" name="presentacion" maxlength="100" ' +
      'value="' + esc(p.presentacion || '') + '" placeholder="Ej. 250g, unidad, caja"></div>' +
      '<div class="op-field"><label for="prodCategoriaId">Categoria</label>' +
      '<select class="op-select" id="prodCategoriaId" name="categoria_id">' +
      optionCatalogo(p.categoria_id, cats, 'Sin categoria') + '</select></div>' +
      '<div class="op-field"><label for="prodMarcaId">Marca</label>' +
      '<select class="op-select" id="prodMarcaId" name="marca_id">' +
      optionCatalogo(p.marca_id, marcas, 'Sin marca') + '</select></div>' +
      '<div class="op-field"><label for="prodPasilloId">Pasillo</label>' +
      '<select class="op-select" id="prodPasilloId" name="pasillo_id">' +
      optionCatalogo(p.pasillo_id, pasillos, 'Sin pasillo', pasillos.length === 0) + '</select></div>' +
      '<div class="op-field"><label for="prodBodega">Bodega</label>' +
      '<input class="op-input" id="prodBodega" name="bodega" maxlength="100" ' +
      'value="' + esc(p.bodega || '') + '" placeholder="Ej. Principal"></div>' +
      '<div class="op-field"><label for="prodCosto">Precio de compra</label>' +
      '<input class="op-input" id="prodCosto" name="precio_compra" type="number" min="0" step="0.01" required ' +
      'value="' + esc(p.precio_compra !== undefined && p.precio_compra !== null ? num(p.precio_compra) : '') + '"></div>' +
      '<div class="op-field"><label for="prodPrecio">Precio de venta</label>' +
      '<input class="op-input" id="prodPrecio" name="precio_venta" type="number" min="0" step="0.01" required ' +
      'value="' + esc(p.precio_venta !== undefined && p.precio_venta !== null ? num(p.precio_venta) : '') + '"></div>' +
      '<div class="op-field"><label for="prodStock">Stock inicial</label>' +
      '<input class="op-input" id="prodStock" name="stock_actual" type="number" min="0" step="1" ' +
      'value="' + esc(p.stock_actual !== undefined ? num(p.stock_actual) : 0) + '"></div>' +
      '<div class="op-field"><label for="prodMinimo">Stock minimo</label>' +
      '<input class="op-input" id="prodMinimo" name="stock_minimo" type="number" min="0" step="1" ' +
      'value="' + esc(p.stock_minimo !== undefined ? num(p.stock_minimo) : 0) + '"></div>' +
      '<div class="op-field"><label for="prodIsv">ISV %</label>' +
      '<input class="op-input" id="prodIsv" name="isv_rate" type="number" min="0" max="100" step="0.01" ' +
      'value="' + esc(p.isv_rate !== undefined && p.isv_rate !== null ? num(p.isv_rate) : 15) + '"></div>' +
      '<div class="op-field"><label for="prodUnidad">Unidad de medida</label>' +
      '<input class="op-input" id="prodUnidad" name="unidad_medida" maxlength="50" ' +
      'value="' + esc(p.unidad_medida || 'Unidad') + '"></div>' +
      '<div class="op-field span-2"><label for="prodDescripcion">Descripcion</label>' +
      '<textarea class="op-textarea" id="prodDescripcion" name="descripcion" maxlength="500">' +
      esc(p.descripcion || '') + '</textarea></div>' +
      '<div class="op-field span-2"><label class="op-check">' +
      '<input type="checkbox" name="exento"' + (p.exento ? ' checked' : '') + '> Exento de ISV</label></div>' +
      '</form>';
  }

  function abrirFormularioProducto(producto) {
    abrirModal({
      title: producto ? 'Editar producto' : 'Nuevo producto',
      submitLabel: producto ? 'Guardar cambios' : 'Crear producto',
      icon: 'fa-floppy-disk',
      body: formProducto(producto),
      onSubmit: async function (form) {
        var nombre = String(form.get('nombre') || '').trim();
        if (!nombre) throw new Error('El nombre del producto es requerido.');

        var venta = num(form.get('precio_venta'));
        var costo = num(form.get('precio_compra'));
        if (venta <= 0) throw new Error('El precio de venta debe ser mayor a 0.');
        if (costo > venta && venta > 0) {
          throw new Error('El precio de compra (' + money(costo) +
            ') es mayor que el de venta (' + money(venta) + ').');
        }

        var cuerpo = {
          nombre: nombre,
          codigo: String(form.get('codigo') || '').trim(),
          barcode: String(form.get('barcode') || '').trim(),
          presentacion: String(form.get('presentacion') || '').trim(),
          descripcion: String(form.get('descripcion') || '').trim(),
          bodega: String(form.get('bodega') || '').trim(),
          unidad_medida: String(form.get('unidad_medida') || 'Unidad').trim(),
          precio_compra: costo,
          precio_venta: venta,
          stock_actual: parseInt(form.get('stock_actual'), 10) || 0,
          stock_minimo: parseInt(form.get('stock_minimo'), 10) || 0,
          isv_rate: num(form.get('isv_rate')),
          exento: form.get('exento') === 'on',
          categoria_id: form.get('categoria_id') || null,
          marca_id: form.get('marca_id') || null,
          pasillo_id: form.get('pasillo_id') || null
        };

        if (producto) {
          await request('/api/productos/' + encodeURIComponent(producto.id), {
            method: 'PUT', body: cuerpo
          });
          toast('Producto actualizado.', 'ok');
        } else {
          await request('/api/productos', { method: 'POST', body: cuerpo });
          toast('Producto creado.', 'ok');
        }
        cerrarModal();
        refrescar();
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Catalogos maestro: categorias y marcas                            */
  /* ---------------------------------------------------------------- */

  function panelCatalogo(titulo, ruta, icono, conColor) {
    return '<section class="op-panel" data-op-panel-catalogo="' + esc(ruta) + '">' +
      '<div class="op-panel-head">' +
      '<h2 class="op-panel-title"><i class="fas ' + esc(icono) + '"></i> ' + esc(titulo) + '</h2>' +
      '<button class="btn btn-acc btn-sm" data-op-nuevo-catalogo="' + esc(ruta) + '">' +
      '<i class="fas fa-plus"></i> Nuevo</button>' +
      '</div>' +
      '<div class="op-panel-body is-flush" data-op-catalogo-body></div>' +
      '</section>';
  }

  async function renderCatalogos(host) {
    pintarKpis(null);
    host.innerHTML =
      '<div class="op-split">' +
      panelCatalogo('Categorias', 'categorias', 'fa-tags', true) +
      panelCatalogo('Marcas', 'marcas', 'fa-certificate', false) +
      '</div>';

    var rutas = ['categorias', 'marcas'];
    var resultados = await Promise.all(
      rutas.map(function (ruta) { return request('/api/' + ruta + '?todos=1'); })
    );

    rutas.forEach(function (ruta, i) {
      var cuerpo = host.querySelector('[data-op-catalogo-body="' + ruta + '"]');
      var filas = (resultados[i] && resultados[i].catalogo) || [];
      state.counts[ruta] = filas.filter(function (f) { return f.activo; }).length;
      if (!filas.length) {
        estadoVacio(
          cuerpo,
          'fa-inbox',
          'Sin registros',
          'Crea el primer registro para ' + (ruta === 'marcas' ? 'marca' : 'categoria') + '.',
          '<button class="btn btn-acc btn-sm" data-op-nuevo-catalogo="' + esc(ruta) + '">' +
          '<i class="fas fa-plus"></i> Crear</button>'
        );
        return;
      }

      var tieneColor = ruta === 'categorias';
      var html = '<div class="op-table"><thead><tr>' +
        '<th>Nombre</th>' +
        (tieneColor ? '<th>Color</th>' : '') +
        '<th>Descripcion</th>' +
        '<th>Estado</th>' +
        '<th class="actions">Acciones</th>' +
        '</tr></thead><tbody>';

      html += filas.map(function (fila) {
        var color = tieneColor && fila.color
          ? '<span class="op-badge" style="background:' + esc(fila.color) + ';color:#fff">' +
            esc(fila.color) + '</span>'
          : '<span class="op-muted">—</span>';
        return '<tr>' +
          '<td data-label="Nombre"><span class="op-strong">' + esc(fila.nombre) + '</span></td>' +
          (tieneColor ? '<td data-label="Color">' + color + '</td>' : '') +
          '<td data-label="Descripcion">' + esc(fila.descripcion || '—') + '</td>' +
          '<td data-label="Estado">' + (fila.activo ? badge('Activo', 'is-verde') : badge('Inactivo', 'is-inactivo')) + '</td>' +
          '<td class="actions">' +
          '<button class="btn btn-ghost btn-sm" data-op-edit-cat="' + esc(ruta) + '" data-op-id="' + esc(fila.id) + '">' +
          '<i class="fas fa-pen"></i></button>' +
          (fila.activo
            ? '<button class="btn btn-ghost btn-sm" data-op-del-cat="' + esc(ruta) + '" data-op-id="' + esc(fila.id) + '"' +
              ' data-op-nombre="' + esc(fila.nombre) + '"><i class="fas fa-ban"></i></button>'
            : '') +
          '</td></tr>';
      }).join('');

      cuerpo.innerHTML = html + '</tbody></div>';
    });
  }

  function formCatalogo(ruta, fila) {
    var conColor = ruta === 'categorias';
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field span-2">' +
      '<label for="catNombre">Nombre</label>' +
      '<input class="op-input" id="catNombre" name="nombre" required maxlength="80" ' +
      'value="' + esc(fila ? fila.nombre : '') + '" placeholder="Ej. Abarrotes">' +
      '</div>' +
      (conColor
        ? '<div class="op-field">' +
          '<label for="catColor">Color</label>' +
          '<input class="op-input" id="catColor" name="color" type="color" ' +
          'value="' + esc(fila && fila.color ? fila.color : '#8b5cf6') + '">' +
          '</div>'
        : '') +
      '<div class="op-field' + (conColor ? '' : ' span-2') + '">' +
      '<label for="catDesc">Descripcion</label>' +
      '<input class="op-input" id="catDesc" name="descripcion" maxlength="200" ' +
      'value="' + esc(fila ? fila.descripcion : '') + '">' +
      '</div>' +
      '</form>';
  }

  function guardarCatalogo(ruta, id, datos) {
    return request('/api/' + ruta + (id ? '/' + encodeURIComponent(id) : ''), {
      method: id ? 'PUT' : 'POST',
      body: datos
    });
  }

  /* ---------------------------------------------------------------- */
  /* Mesas                                                              */
  /* ---------------------------------------------------------------- */

  async function renderMesas(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);
    var data = await request('/api/mesas');
    var mesas = (data && data.mesas) || [];
    state.mesas = mesas;

    var libres = mesas.filter(function (m) { return m.estado === 'libre' && !m.tiene_cuenta_abierta; }).length;
    var ocupadas = mesas.filter(function (m) { return m.tiene_cuenta_abierta; }).length;
    var fuera = mesas.filter(function (m) { return m.estado === 'fuera_servicio'; }).length;
    var consumo = mesas.reduce(function (acc, m) {
      return acc + num(m.cuenta_abierta && m.cuenta_abierta.total);
    }, 0);

    state.counts.mesas = mesas.length;
    pintarKpis([
      { label: 'Mesas', value: mesas.length },
      { label: 'Libres', value: libres, kind: 'ok' },
      { label: 'Con cuenta', value: ocupadas },
      { label: 'Fuera de servicio', value: fuera, kind: fuera ? 'danger' : undefined },
      { label: 'Consumo abierto', value: consumo, money: true }
    ]);

    // El boton de crear vive en el encabezado, no en el estado vacio: si solo
    // apareciera cuando no hay mesas, un club con mesas no tendria como
    // agregar otra ni Admin una para una zona nueva.
    host.innerHTML =
      '<div class="op-panel"><div class="op-panel-head">' +
      '<h2 class="op-panel-title"><i class="fas fa-table-cells"></i> Mapa de mesas</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button class="btn btn-acc" data-op-nueva-mesa>' +
      '<i class="fas fa-plus"></i> Crear mesa</button>' +
      '</div></div>' +
      '<div class="op-panel-body" data-op-mesas></div></div>';
    var cuerpo = host.querySelector('[data-op-mesas]');

    if (!mesas.length) {
      estadoVacio(
        cuerpo,
        'fa-table-cells',
        'Aun no hay mesas',
        'Crea las mesas del club para poder abrir cuentas y registrar consumos.'
      );
      return;
    }

    cuerpo.innerHTML = '<div class="op-mesas">' + mesas.map(function (m) {
      var cuenta = m.cuenta_abierta;
      var ocupada = Boolean(cuenta);
      return '<div class="op-mesa-wrap">' +
        '<button class="op-mesa" data-op-mesa="' + esc(m.id) + '"' +
        (m.estado === 'fuera_servicio' ? ' disabled' : '') + '>' +
        '<div class="op-mesa-top">' +
        '<span class="op-mesa-name">' + esc(m.nombre) + '</span>' +
        estadoMesaBadge(m.estado) +
        '</div>' +
        '<div class="op-mesa-meta">' +
        '<span><i class="fas fa-user-group"></i> ' + esc(m.capacidad || 0) + '</span>' +
        (m.zona ? '<span><i class="fas fa-location-dot"></i> ' + esc(m.zona) + '</span>' : '') +
        '</div>' +
        (cuenta
          ? '<div class="op-mesa-cuenta">' +
            '<span class="op-muted">' + esc(cuenta.cliente_nombre || 'Cuenta abierta') + '</span>' +
            '<span class="monto">' + esc(money(cuenta.total)) + '</span>' +
            '</div>'
          : '') +
        '</button>' +
        // Editar y dar de baja solo cuando la mesa no esta en uso: cambiar el
        // nombre o la capacidad de una mesa con cuenta abierta deja el consumo
        // ya registrado sin relacion coherente.
        (ocupada
          ? ''
          : '<div class="op-mesa-acciones">' +
            '<button class="op-icon-btn" data-op-edit-mesa="' + esc(m.id) + '" ' +
            'title="Editar mesa" aria-label="Editar ' + esc(m.nombre) + '">' +
            '<i class="fas fa-pen"></i></button>' +
            '<button class="op-icon-btn is-danger" data-op-baja-mesa="' + esc(m.id) + '" ' +
            'title="Dar de baja" aria-label="Dar de baja ' + esc(m.nombre) + '">' +
            '<i class="fas fa-ellipsis"></i></button>' +
            '</div>') +
        '</div>';
    }).join('') + '</div>';
  }

  function formMesa(mesa) {
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field"><label for="mesaNombre">Nombre</label>' +
      '<input class="op-input" id="mesaNombre" name="nombre" required maxlength="60" ' +
      'value="' + esc(mesa ? mesa.nombre : '') + '" placeholder="Ej. Mesa 1"></div>' +
      '<div class="op-field"><label for="mesaCodigo">Codigo</label>' +
      '<input class="op-input" id="mesaCodigo" name="codigo" maxlength="20" ' +
      'value="' + esc(mesa ? mesa.codigo : '') + '" placeholder="Ej. M-01"></div>' +
      '<div class="op-field"><label for="mesaZona">Zona</label>' +
      '<input class="op-input" id="mesaZona" name="zona" maxlength="60" ' +
      'value="' + esc(mesa ? mesa.zona : '') + '" placeholder="Ej. Terraza"></div>' +
      '<div class="op-field"><label for="mesaCapacidad">Capacidad</label>' +
      '<input class="op-input" id="mesaCapacidad" name="capacidad" type="number" min="1" max="60" ' +
      'value="' + esc(mesa ? mesa.capacidad : 4) + '"></div>' +
      '<div class="op-field"><label for="mesaPrecio">Precio consumo</label>' +
      '<input class="op-input" id="mesaPrecio" name="precio_consumo" type="number" min="0" step="0.01" ' +
      'value="' + esc(mesa ? num(mesa.precio_consumo) : 0) + '"></div>' +
      '<div class="op-field"><label for="mesaEstado">Estado</label>' +
      '<select class="op-select" id="mesaEstado" name="estado">' +
      Object.keys(ESTADOS_MESA)
        .filter(function (k) { return k !== 'ocupada'; })
        .map(function (k) {
          var sel = mesa && mesa.estado === k ? ' selected' : '';
          return '<option value="' + esc(k) + '"' + sel + '>' + esc(ESTADOS_MESA[k].label) + '</option>';
        }).join('') +
      '</select></div>' +
      '</form>';
  }

  /* ---------------------------------------------------------------- */
  /* Cuentas abiertas                                                  */
  /* ---------------------------------------------------------------- */

  async function renderCuentas(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);
    var data = await request('/api/cuentas-abiertas');
    var cuentas = ((data && data.cuentas) || []).filter(function (c) { return c.estado === 'abierta'; });
    state.counts.cuentas = cuentas.length;

    var total = cuentas.reduce(function (acc, c) { return acc + num(c.total); }, 0);
    var consumos = cuentas.reduce(function (acc, c) { return acc + num(c.monto_consumos); }, 0);

    pintarKpis([
      { label: 'Cuentas abiertas', value: cuentas.length },
      { label: 'Consumos', value: consumos, money: true },
      { label: 'Por cobrar', value: total, money: true },
      { label: 'Ticket promedio', value: cuentas.length ? total / cuentas.length : 0, money: true }
    ]);

    host.innerHTML = '<div class="op-panel"><div class="op-panel-body is-flush" data-op-cuentas></div></div>';
    var cuerpo = host.querySelector('[data-op-cuentas]');

    if (!cuentas.length) {
      estadoVacio(
        cuerpo,
        'fa-receipt',
        'No hay cuentas abiertas',
        'Abre una cuenta desde la pestana Mesas para empezar a registrar consumos.',
        '<button class="btn btn-acc" data-op-ir-mesas><i class="fas fa-table-cells"></i> Ir a Mesas</button>'
      );
      return;
    }

    var mesaPorId = {};
    state.mesas.forEach(function (m) { mesaPorId[m.id] = m; });

    cuerpo.innerHTML = '<div class="op-table"><thead><tr>' +
      '<th>Mesa</th><th>Cliente</th><th>Abierta</th>' +
      '<th class="num">Consumos</th><th class="num">Total</th>' +
      '<th class="actions">Acciones</th>' +
      '</tr></thead><tbody>' +
      cuentas.map(function (c) {
        var mesa = mesaPorId[c.mesa_id];
        return '<tr>' +
          '<td data-label="Mesa"><span class="op-strong">' + esc(mesa ? mesa.nombre : 'Mesa ' + c.mesa_id) + '</span></td>' +
          '<td data-label="Cliente">' + esc(c.cliente_nombre || '—') + '</td>' +
          '<td data-label="Abierta"><span class="op-muted">' + esc(fecha(c.fecha_apertura)) + '</span></td>' +
          '<td data-label="Consumos" class="num">' + esc(money(c.monto_consumos)) + '</td>' +
          '<td data-label="Total" class="num"><span class="op-strong">' + esc(money(c.total)) + '</span></td>' +
          '<td class="actions">' +
          '<button class="btn btn-ghost btn-sm" data-op-ver-cuenta="' + esc(c.id) + '">' +
          '<i class="fas fa-eye"></i> Ver</button>' +
          '<button class="btn btn-acc btn-sm" data-op-agregar-consumo="' + esc(c.id) + '">' +
          '<i class="fas fa-plus"></i> Consumo</button>' +
          '<button class="btn btn-ghost btn-sm" data-op-cerrar-cuenta="' + esc(c.id) + '">' +
          '<i class="fas fa-check"></i> Cerrar</button>' +
          '</td></tr>';
      }).join('') + '</tbody></div>';
  }

  async function verCuenta(cuentaId) {
    var data = await request('/api/cuentas-abiertas/' + encodeURIComponent(cuentaId));
    var cuenta = data.cuenta || {};
    var detalle = data.detalle || [];

    var lineas = detalle.length
      ? detalle.map(function (d) {
        return '<tr>' +
          '<td data-label="Producto"><span class="op-strong">' + esc(d.nombre || '—') + '</span></td>' +
          '<td data-label="Cant" class="num">' + esc(num(d.cantidad)) + '</td>' +
          '<td data-label="Precio" class="num">' + esc(money(d.precio_unitario)) + '</td>' +
          '<td data-label="Subtotal" class="num">' + esc(money(d.total)) + '</td>' +
          '</tr>';
      }).join('')
      : '<tr><td colspan="4" class="op-muted">Sin consumos registrados.</td></tr>';

    abrirModal({
      title: 'Cuenta ' + (data.mesa ? data.mesa.nombre : ''),
      submitLabel: 'Cerrar y cobrar',
      icon: 'fa-check',
      body:
        '<div class="op-summary" style="margin-bottom:16px">' +
        '<div class="op-summary-row"><span>Cliente</span><span class="val">' +
        esc(cuenta.cliente_nombre || '—') + '</span></div>' +
        '<div class="op-summary-row"><span>Abierta</span><span class="val">' +
        esc(fecha(cuenta.fecha_apertura)) + '</span></div>' +
        '<div class="op-summary-row"><span>Consumos</span><span class="val">' +
        esc(money(cuenta.monto_consumos)) + '</span></div>' +
        (num(cuenta.descuento)
          ? '<div class="op-summary-row"><span>Descuento</span><span class="val">-' +
            esc(money(cuenta.descuento)) + '</span></div>'
          : '') +
        '<div class="op-summary-row is-total"><span>Total</span><span class="val">' +
        esc(money(cuenta.total)) + '</span></div>' +
        '</div>' +
        '<div class="op-table"><thead><tr><th>Producto</th>' +
        '<th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th>' +
        '</tr></thead><tbody>' + lineas + '</tbody></div>',
      onSubmit: async function (form) { await cerrarCuenta(cuentaId, form); }
    });
  }

  /**
   * Cierre de cuenta. Vive aparte porque hay dos caminos que lo disparan: el
   * detalle de la cuenta y el boton de la tabla. Ambos deben pasar por el mismo
   * formulario, y en ninguno se admite una forma de pago fija: cerrarla en
   * efectivo sin preguntar descuadra la caja de forma silenciosa.
   */
  function formCierre(cuenta) {
    var conDescuento = cuenta && cuenta.tiene_consumos !== false;
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field span-2"><label for="cierreForma">Forma de pago</label>' +
      '<select class="op-select" id="cierreForma" name="forma_pago" data-op-sin-foco>' +
      FORMAS_PAGO.map(function (f) {
        return '<option value="' + esc(f) + '">' + esc(capitalize(f)) + '</option>';
      }).join('') +
      '</select></div>' +
      (conDescuento
        ? '<div class="op-field span-2"><label for="cierreDescuento">Descuento aplicado</label>' +
          '<input class="op-input" id="cierreDescuento" name="descuento" type="number" ' +
          'min="0" step="0.01" value="0">' +
          '<small class="op-hint">Se resta del total antes de registrar el cobro.</small>' +
          '</div>'
        : '') +
      '</form>';
  }

  async function cerrarCuenta(cuentaId, form) {
    var datos = {
      forma_pago: String(form.get('forma_pago') || '').trim(),
      descuento: num(form.get('descuento'))
    };
    if (!datos.forma_pago) throw new Error('Selecciona la forma de pago.');

    var previa = await request('/api/cuentas-abiertas/' + encodeURIComponent(cuentaId));
    var total = previa && previa.cuenta ? previa.cuenta.total : 0;

    await request('/api/cuentas-abiertas/' + encodeURIComponent(cuentaId) + '/cerrar', {
      method: 'POST',
      body: datos
    });
    cerrarModal();
    toast(
      'Cuenta cerrada: ' + money(num(total) - datos.descuento) + ' cobrado por ' + datos.forma_pago + '.',
      'ok'
    );
    refrescar();
  }

  function abrirCierre(cuentaId) {
    request('/api/cuentas-abiertas/' + encodeURIComponent(cuentaId)).then(function (data) {
      var cuenta = data && data.cuenta;
      if (!cuenta) throw new Error('La cuenta ya no existe.');
      abrirModal({
        title: 'Cobrar cuenta',
        submitLabel: 'Confirmar cobro',
        body:
          '<div class="op-summary" style="margin-bottom:16px">' +
          '<div class="op-summary-row"><span>Cliente</span><span class="val">' +
          esc(cuenta.cliente_nombre || '—') + '</span></div>' +
          '<div class="op-summary-row is-total"><span>Total a cobrar</span><span class="val">' +
          esc(money(cuenta.total)) + '</span></div>' +
          '</div>' +
          formCierre(cuenta),
        onSubmit: async function (form) { await cerrarCuenta(cuentaId, form); }
      });
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  function formConsumo(productos) {
    var opciones = productos.map(function (p) {
      return '<option value="' + esc(p.id) + '" data-precio="' + esc(num(p.precio_venta)) + '">' +
        esc(p.nombre) + (num(p.stock_actual) ? ' (stock ' + esc(num(p.stock_actual)) + ')' : '') +
        '</option>';
    }).join('');

    var linea = '<div class="op-line" data-op-line>' +
      '<div class="op-field"><label>Producto</label>' +
      '<select class="op-select" data-op-producto>' + opciones + '</select></div>' +
      '<div class="op-field"><label>Cantidad</label>' +
      '<input class="op-input" data-op-cantidad type="number" min="1" step="1" value="1"></div>' +
      '<div class="op-field"><label>Subtotal</label>' +
      '<div class="op-line-total" data-op-subtotal>—</div></div>' +
      '<button type="button" class="op-line-remove" data-op-quitar-linea title="Quitar">' +
      '<i class="fas fa-xmark"></i></button>' +
      '</div>';

    return '<form class="op-lines-form" autocomplete="off">' +
      '<div class="op-lines" data-op-lines>' + linea + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-op-add-line style="margin-top:12px">' +
      '<i class="fas fa-plus"></i> Agregar linea</button>' +
      '<input type="hidden" name="items" value="">' +
      (productos.length ? '' :
        '<p class="op-state-text" style="margin-top:14px">Este tenant no tiene productos activos, ' +
        'por lo que todavia no se pueden registrar consumos.</p>') +
      '</form>';
  }

  function agregarConsumo(cuentaId) {
    request('/api/productos', { soft: true }).then(function (data) {
      var productos = (data && data.productos) || [];
      state.productos = productos;

      abrirModal({
        title: 'Agregar consumo',
        submitLabel: 'Registrar consumo',
        body: formConsumo(productos),
        onOpen: function () { recalcularLineas(); },
        onSubmit: async function (form, alert) {
          var items = JSON.parse(form.get('items') || '[]');
          if (!items.length) throw new Error('Agrega al menos un producto.');
          await request('/api/cuentas-abiertas/' + encodeURIComponent(cuentaId) + '/consumos', {
            method: 'POST',
            body: { items: items }
          });
          cerrarModal();
          toast('Consumo registrado.', 'ok');
          refrescar();
        }
      });
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  function recalcularLineas() {
    var items = [];
    el.modalBody.querySelectorAll('[data-op-line]').forEach(function (linea) {
      var select = linea.querySelector('[data-op-producto]');
      var cantidad = Math.max(1, parseInt(linea.querySelector('[data-op-cantidad]').value, 10) || 1);
      var precio = num(select.options[select.selectedIndex] && select.options[select.selectedIndex].dataset.precio);
      var subtotal = precio * cantidad;
      linea.querySelector('[data-op-subtotal]').textContent = money(subtotal);
      items.push({ producto_id: select.value, cantidad: cantidad });
    });
    var hidden = el.modalBody.querySelector('input[name="items"]');
    if (hidden) hidden.value = JSON.stringify(items);
  }

  function abrirCuenta(mesa) {
    request('/api/clientes').then(function (data) {
      state.clientes = (data && data.clientes) || [];
      var opciones = '<option value="">— Cliente nuevo —</option>' +
        state.clientes.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.nombre) + '</option>';
        }).join('');

      abrirModal({
        title: 'Abrir cuenta en ' + mesa.nombre,
        submitLabel: 'Abrir cuenta',
        body:
          '<form class="op-form-grid" autocomplete="off">' +
          '<div class="op-field span-2"><label for="acctCliente">Cliente</label>' +
          '<select class="op-select" id="acctCliente" name="cliente_id">' + opciones + '</select></div>' +
          '<div class="op-field span-2"><label for="acctNombre">Nombre del cliente</label>' +
          '<input class="op-input" id="acctNombre" name="cliente_nombre" maxlength="120" ' +
          'placeholder="Nombre que se mostrara en la cuenta"></div>' +
          '</form>',
        onSubmit: async function (form) {
          var clienteId = String(form.get('cliente_id') || '').trim();
          var nombre = String(form.get('cliente_nombre') || '').trim();
          var elegido = state.clientes.find(function (c) { return String(c.id) === clienteId; });
          var clienteNombre = nombre || (elegido ? elegido.nombre : '');
          if (!clienteNombre) throw new Error('Indica el nombre del cliente.');

          await request('/api/cuentas-abiertas', {
            method: 'POST',
            body: { mesa_id: mesa.id, cliente_nombre: clienteNombre, cliente_id: clienteId || null }
          });
          cerrarModal();
          toast('Cuenta abierta en ' + mesa.nombre + '.', 'ok');
          state.tab = 'cuentas';
          refrescar();
        }
      });
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  /* ---------------------------------------------------------------- */
  /* Accesos de socios                                                 */
  /* ---------------------------------------------------------------- */

  async function renderAccesos(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);

    var dentro = await request('/api/socios-accesos/actuales');
    var historial = await request('/api/socios-accesos');
    var dentroList = (dentro && dentro.dentro) || [];
    var accesos = (historial && historial.accesos) || [];
    var socios = await request('/api/membresias/socios', { soft: true })
      .catch(function () { return { socios: [] }; });
    state.socios = (socios && socios.socios) || [];

    state.counts.accesos = dentroList.length;
    pintarKpis([
      { label: 'Adentro ahora', value: dentroList.length, kind: 'ok' },
      { label: 'Revisados', value: num(dentro.revisados) },
      { label: 'Accesos registrados', value: accesos.length },
      {
        label: 'Socios activos',
        value: state.socios.filter(function (s) {
          var estado = String(s.estado || '').toLowerCase();
          return !estado || ['activo', 'active'].includes(estado);
        }).length
      }
    ]);

    host.innerHTML =
      '<div class="op-panel" style="margin-bottom:16px">' +
      '<div class="op-panel-head"><h2 class="op-panel-title">' +
      '<i class="fas fa-user-check"></i> Dentro ahora</h2>' +
      '<button class="btn btn-acc btn-sm" data-op-nuevo-acceso>' +
      '<i class="fas fa-plus"></i> Registrar acceso</button></div>' +
      '<div class="op-panel-body is-flush" data-op-dentro></div></div>' +
      '<div class="op-panel"><div class="op-panel-head"><h2 class="op-panel-title">' +
      '<i class="fas fa-clock-rotate-left"></i> Historial de accesos</h2></div>' +
      '<div class="op-panel-body is-flush" data-op-historial></div></div>';

    var cuerpoDentro = host.querySelector('[data-op-dentro]');
    if (!dentroList.length) {
      estadoVacio(cuerpoDentro, 'fa-door-open', 'No hay socios dentro',
        'Registra una entrada para comenzar a controlar el acceso.');
    } else {
      cuerpoDentro.innerHTML = '<div class="op-table"><thead><tr>' +
        '<th>Socio</th><th>Desde</th><th>Turno</th><th>Estado</th>' +
        '</tr></thead><tbody>' +
        dentroList.map(function (s) {
          return '<tr>' +
            '<td data-label="Socio"><span class="op-strong">' +
            esc(s.socio_nombre || 'Socio') + '</span></td>' +
            '<td data-label="Desde"><span class="op-muted">' +
            esc(fecha(s.fecha_entrada)) + '</span></td>' +
            '<td data-label="Turno">' + esc(s.turno || '—') + '</td>' +
            '<td data-label="Estado">' + badge('Dentro', 'is-verde') + '</td>' +
            '</tr>';
        }).join('') + '</tbody></div>';
    }

    var cuerpoHist = host.querySelector('[data-op-historial]');
    if (!accesos.length) {
      estadoVacio(cuerpoHist, 'fa-clock-rotate-left', 'Sin historial',
        'Los accesos que registres apareceran aqui.');
    } else {
      cuerpoHist.innerHTML = '<div class="op-table"><thead><tr>' +
        '<th>Socio</th><th>Tipo</th><th>Fecha</th><th>Notas</th>' +
        '</tr></thead><tbody>' +
        accesos.slice(0, 100).map(function (a) {
          var tipo = TIPOS_ACCESO.find(function (t) { return t[0] === a.tipo_acceso; });
          var clase = a.tipo_acceso === 'rechazado' ? 'is-rojo'
            : a.tipo_acceso === 'salida' ? 'is-azul' : 'is-verde';
          var nota = a.notas || a.motivo_rechazo || '';
          return '<tr>' +
            '<td data-label="Socio"><span class="op-strong">' +
            esc(a.socio_nombre || 'Socio') + '</span></td>' +
            '<td data-label="Tipo">' + badge(tipo ? tipo[1] : a.tipo_acceso, clase) + '</td>' +
            '<td data-label="Fecha"><span class="op-muted">' +
            esc(fecha(a.fecha_entrada || a.fecha_salida)) + '</span></td>' +
            '<td data-label="Notas">' + esc(nota || '—') + '</td>' +
            '</tr>';
        }).join('') + '</tbody></div>';
    }
  }

  function formAcceso() {
    var socios = state.socios.filter(function (s) {
      var estado = String(s.estado || '').toLowerCase();
      return !estado || ['activo', 'active'].includes(estado);
    });
    if (!socios.length) {
      return '<p class="op-state-text">Este tenant no tiene socios activos. ' +
        'Registra socios en el modulo de Membresias para poder controlar accesos.</p>' +
        '<input type="hidden" name="vacio" value="1">';
    }
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field span-2"><label for="accSocio">Socio</label>' +
      '<select class="op-select" id="accSocio" name="socio_id">' +
      socios.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.nombre) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="op-field"><label for="accTipo">Tipo</label>' +
      '<select class="op-select" id="accTipo" name="tipo_acceso">' +
      TIPOS_ACCESO.map(function (t) {
        return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="op-field"><label for="accPuerta">Puerta</label>' +
      '<input class="op-input" id="accPuerta" name="puerta" maxlength="60" placeholder="Ej. Principal"></div>' +
      '<div class="op-field span-2"><label for="accObs">Notas</label>' +
      '<input class="op-input" id="accObs" name="notas" maxlength="200"></div>' +
      '</form>';
  }

  /* ---------------------------------------------------------------- */
  /* Mermas                                                             */
  /* ---------------------------------------------------------------- */

  async function renderMermas(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);
    var data = await request('/api/mermas?limite=200');
    var resumen = await request('/api/mermas/resumen');
    var mermas = (data && data.mermas) || [];

    state.counts.mermas = (resumen && resumen.total_eventos) || mermas.length;
    pintarKpis([
      { label: 'Eventos', value: num(resumen.total_eventos) },
      { label: 'Unidades perdidas', value: num(resumen.unidades_perdidas), kind: 'danger' },
      { label: 'Costo perdido', value: num(resumen.costo_total), money: true, kind: 'danger' },
      { label: 'Tipo principal', value: resumen.por_tipo && resumen.por_tipo[0]
        ? resumen.por_tipo[0].tipo : '—' }
    ]);

    host.innerHTML =
      '<div class="op-panel" style="margin-bottom:16px"><div class="op-panel-head">' +
      '<h2 class="op-panel-title"><i class="fas fa-chart-pie"></i> Perdidas por tipo</h2>' +
      '</div><div class="op-panel-body is-flush" data-op-merma-tipos></div></div>' +
      '<div class="op-panel"><div class="op-panel-head">' +
      '<h2 class="op-panel-title"><i class="fas fa-list"></i> Movimientos</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<select class="op-select" data-op-filtro-tipo style="width:auto">' +
      '<option value="">Todos los tipos</option>' +
      TIPOS_MERMA.map(function (t) {
        var sel = state.filtros.mermaTipo === t[0] ? ' selected' : '';
        return '<option value="' + esc(t[0]) + '"' + sel + '>' + esc(t[1]) + '</option>';
      }).join('') +
      '</select>' +
      // Registrar la merma es la accion principal de esta pestana. Sin este
      // boton el modulo era de solo lectura: se podia ver la perdida, no anotarla.
      '<button class="btn btn-acc" data-op-nueva-merma>' +
      '<i class="fas fa-plus"></i> Registrar merma</button>' +
      '</div></div>' +
      '<div class="op-panel-body is-flush" data-op-mermas></div></div>';

    var cuerpoTipos = host.querySelector('[data-op-merma-tipos]');
    var porTipo = (resumen && resumen.por_tipo) || [];
    if (!porTipo.length) {
      estadoVacio(cuerpoTipos, 'fa-chart-pie', 'Sin perdidas registradas',
        'Cuando registres una merma aparecera aqui el desglose por tipo.');
    } else {
      cuerpoTipos.innerHTML = '<div class="op-table"><thead><tr>' +
        '<th>Tipo</th><th class="num">Eventos</th>' +
        '<th class="num">Unidades</th><th class="num">Costo</th>' +
        '</tr></thead><tbody>' +
        porTipo.map(function (t) {
          return '<tr>' +
            '<td data-label="Tipo"><span class="op-strong">' + esc(t.tipo) + '</span></td>' +
            '<td data-label="Eventos" class="num">' + esc(t.eventos) + '</td>' +
            '<td data-label="Unidades" class="num">' + esc(num(t.unidades)) + '</td>' +
            '<td data-label="Costo" class="num op-danger-text">' + esc(money(t.costo)) + '</td>' +
            '</tr>';
        }).join('') + '</tbody></div>';
    }

    var filtradas = state.filtros.mermaTipo
      ? mermas.filter(function (m) { return m.tipo === state.filtros.mermaTipo; })
      : mermas;
    var cuerpo = host.querySelector('[data-op-mermas]');

    if (!filtradas.length) {
      estadoVacio(cuerpo, 'fa-box-open', 'Sin movimientos',
        mermas.length
          ? 'Ninguna merma coincide con el filtro de tipo seleccionado.'
          : 'Registra la primera merma para descontar stock y dejar asiento en kardex.');
      return;
    }

    cuerpo.innerHTML = '<div class="op-table"><thead><tr>' +
      '<th>Fecha</th><th>Producto</th><th>Tipo</th>' +
      '<th class="num">Cantidad</th><th class="num">Costo</th><th>Motivo</th>' +
      '</tr></thead><tbody>' +
      filtradas.map(function (m) {
        return '<tr>' +
          '<td data-label="Fecha"><span class="op-muted">' + esc(fecha(m.fecha)) + '</span></td>' +
          '<td data-label="Producto"><span class="op-strong">' +
          esc(m.producto_nombre || '—') + '</span></td>' +
          '<td data-label="Tipo">' + badge(m.tipo, 'is-rojo') + '</td>' +
          '<td data-label="Cantidad" class="num">' + esc(num(m.cantidad)) + '</td>' +
          '<td data-label="Costo" class="num">' + esc(money(m.costo_total)) + '</td>' +
          '<td data-label="Motivo"><span class="op-muted">' + esc(m.motivo || '—') + '</span></td>' +
          '</tr>';
      }).join('') + '</tbody></div>';
  }

  function formMerma(productos) {
    if (!productos.length) {
      return '<p class="op-state-text">No hay productos activos en este tenant, ' +
        'por lo que no se pueden registrar mermas.</p>' +
        '<input type="hidden" name="vacio" value="1">';
    }
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field span-2"><label for="mermaProducto">Producto</label>' +
      '<select class="op-select" id="mermaProducto" name="producto_id">' +
      productos.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.nombre) +
          ' (stock ' + esc(num(p.stock_actual)) + ')</option>';
      }).join('') +
      '</select></div>' +
      '<div class="op-field"><label for="mermaCantidad">Cantidad</label>' +
      '<input class="op-input" id="mermaCantidad" name="cantidad" type="number" min="1" step="1" value="1" required></div>' +
      '<div class="op-field"><label for="mermaCosto">Costo unitario</label>' +
      '<input class="op-input" id="mermaCosto" name="costo_unitario" type="number" min="0" step="0.01" placeholder="0.00"></div>' +
      '<div class="op-field span-2"><label for="mermaTipo">Tipo</label>' +
      '<select class="op-select" id="mermaTipo" name="tipo">' +
      TIPOS_MERMA.map(function (t) {
        return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>';
      }).join('') +
      '</select></div>' +
      '<div class="op-field span-2"><label for="mermaMotivo">Motivo</label>' +
      '<textarea class="op-textarea" id="mermaMotivo" name="motivo" required maxlength="300" ' +
      'placeholder="Se exige un motivo para auditar la perdida"></textarea></div>' +
      '</form>';
  }

  function nuevaMerma() {
    request('/api/productos', { soft: true }).then(function (data) {
      var productos = (data && data.productos) || [];
      abrirModal({
        title: 'Registrar merma',
        submitLabel: 'Registrar merma',
        icon: 'fa-triangle-exclamation',
        body: formMerma(productos),
        onSubmit: async function (form) {
          if (form.get('vacio')) throw new Error('No hay productos activos para descontar.');
          var cantidad = parseInt(form.get('cantidad'), 10) || 0;
          if (cantidad <= 0) throw new Error('La cantidad debe ser mayor a 0.');
          var motivo = String(form.get('motivo') || '').trim();
          if (!motivo) throw new Error('El motivo es requerido para auditar la perdida.');

          var cuerpo = {
            producto_id: form.get('producto_id'),
            cantidad: cantidad,
            tipo: form.get('tipo'),
            motivo: motivo
          };
          var costo = form.get('costo_unitario');
          if (costo !== '' && costo !== null) cuerpo.costo_unitario = num(costo);

          await request('/api/mermas', { method: 'POST', body: cuerpo });
          cerrarModal();
          toast('Merma registrada: ' + cantidad + ' unidad(es).', 'ok');
          refrescar();
        }
      });
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  /* ---------------------------------------------------------------- */
  /* Pasillos                                                          */
  /* ---------------------------------------------------------------- */

  async function renderPasillos(host) {
    pintarKpis([{ label: 'Cargando', value: '…' }]);
    var data = await request('/api/pasillos?todos=1');
    var pasillos = (data && data.pasillos) || [];
    var activos = pasillos.filter(function (p) { return p.activo; });

    state.counts.pasillos = activos.length;
    pintarKpis([
      { label: 'Pasillos', value: activos.length },
      { label: 'Inactivos', value: pasillos.length - activos.length },
      { label: 'Productos', value: pasillos.reduce(function (a, p) { return a + num(p.productos_en_pasillo); }, 0) },
      { label: 'Stock en salon', value: pasillos.reduce(function (a, p) { return a + num(p.stock_en_pasillo); }, 0) }
    ]);

    host.innerHTML = '<div class="op-panel"><div class="op-panel-body is-flush" data-op-pasillos></div></div>';
    var cuerpo = host.querySelector('[data-op-pasillos]');

    if (!pasillos.length) {
      estadoVacio(
        cuerpo,
        'fa-grip-lines',
        'Aun no hay pasillos',
        'Crea los pasillos para organizar el salon retail y saber cuantos productos tiene cada uno.',
        '<button class="btn btn-acc" data-op-nuevo-pasillo><i class="fas fa-plus"></i> Crear pasillo</button>'
      );
      return;
    }

    cuerpo.innerHTML = '<div class="op-table"><thead><tr>' +
      '<th>Codigo</th><th>Nombre</th><th>Categoria</th>' +
      '<th class="num">Capacidad</th><th class="num">Productos</th>' +
      '<th class="num">Stock</th><th>Estado</th><th class="actions">Acciones</th>' +
      '</tr></thead><tbody>' +
      pasillos.map(function (p) {
        return '<tr>' +
          '<td data-label="Codigo"><span class="op-muted">' + esc(p.codigo || '—') + '</span></td>' +
          '<td data-label="Nombre"><span class="op-strong">' + esc(p.nombre) + '</span></td>' +
          '<td data-label="Categoria">' + esc(p.categoria || '—') + '</td>' +
          '<td data-label="Capacidad" class="num">' + esc(num(p.capacidad_productos)) + '</td>' +
          '<td data-label="Productos" class="num">' + esc(num(p.productos_en_pasillo)) + '</td>' +
          '<td data-label="Stock" class="num">' + esc(num(p.stock_en_pasillo)) + '</td>' +
          '<td data-label="Estado">' + (p.activo ? badge('Activo', 'is-verde') : badge('Inactivo', 'is-inactivo')) + '</td>' +
          '<td class="actions">' +
          '<button class="btn btn-ghost btn-sm" data-op-edit-pasillo="' + esc(p.id) + '">' +
          '<i class="fas fa-pen"></i></button>' +
          (p.activo
            ? '<button class="btn btn-ghost btn-sm" data-op-del-pasillo="' + esc(p.id) + '"' +
              ' data-op-nombre="' + esc(p.nombre) + '"><i class="fas fa-ban"></i></button>'
            : '') +
          '</td></tr>';
      }).join('') + '</tbody></div>';
  }

  function formPasillo(pasillo) {
    return '<form class="op-form-grid" autocomplete="off">' +
      '<div class="op-field"><label for="pasNombre">Nombre</label>' +
      '<input class="op-input" id="pasNombre" name="nombre" required maxlength="80" ' +
      'value="' + esc(pasillo ? pasillo.nombre : '') + '" placeholder="Ej. Abarrotes"></div>' +
      '<div class="op-field"><label for="pasCodigo">Codigo</label>' +
      '<input class="op-input" id="pasCodigo" name="codigo" maxlength="20" ' +
      'value="' + esc(pasillo ? pasillo.codigo : '') + '" placeholder="Ej. PAS-01"></div>' +
      '<div class="op-field"><label for="pasCategoria">Categoria</label>' +
      '<input class="op-input" id="pasCategoria" name="categoria" maxlength="80" ' +
      'value="' + esc(pasillo ? pasillo.categoria : '') + '"></div>' +
      '<div class="op-field"><label for="pasCapacidad">Capacidad productos</label>' +
      '<input class="op-input" id="pasCapacidad" name="capacidad_productos" type="number" min="0" step="1" ' +
      'value="' + esc(pasillo && pasillo.capacidad_productos ? pasillo.capacidad_productos : '') + '"></div>' +
      '</form>';
  }

  /* ---------------------------------------------------------------- */
  /* Cableado de eventos                                               */
  /* ---------------------------------------------------------------- */

  function recargarActual() {
    return refrescar();
  }

  async function refrescar() {
    pintarTabs();
    var tab = TABS.find(function (t) { return t.id === state.tab; });
    if (!tab) return;
    var host = el.panel;
    estadoCargando(host, 5);
    try {
      await tab.render(host);
    } catch (err) {
      estadoError(host, err.message, tab.id);
    }
  }

  function onClick(evento) {
    var nodo = evento.target;

    var tab = nodo.closest('[data-op-tab]');
    if (tab) {
      state.tab = tab.getAttribute('data-op-tab');
      state.cache = {};
      refrescar();
      return;
    }

    var retry = nodo.closest('[data-op-retry]');
    if (retry) { refrescar(); return; }

    var nuevoProducto = nodo.closest('[data-op-nuevo-producto]');
    if (nuevoProducto) { abrirFormularioProducto(null); return; }

    var editProducto = nodo.closest('[data-op-edit-producto]');
    if (editProducto) {
      var idProd = editProducto.getAttribute('data-op-edit-producto');
      var prod = state.productos.find(function (p) { return String(p.id) === idProd; });
      if (!prod) { toast('El producto ya no esta disponible.', 'error'); refrescar(); return; }
      abrirFormularioProducto(prod);
      return;
    }

    var limpiarProd = nodo.closest('[data-op-prod-limpiar]');
    if (limpiarProd) {
      state.filtros.prodQuery = '';
      state.filtros.prodPasillo = '';
      state.filtros.prodCategoria = '';
      state.filtros.prodInactivos = false;
      refrescar();
      return;
    }

    // El catalogo se administer en su propia pestana; desde productos se lleva
    // al usuarioalli en vez de duplicar los formularios.
    var irCatalogos = nodo.closest('[data-op-ir-catalogos]');
    if (irCatalogos) { state.tab = 'catalogos'; refrescar(); return; }

    var irMesas = nodo.closest('[data-op-ir-mesas]');
    if (irMesas) { state.tab = 'mesas'; refrescar(); return; }

    var nuevaMesa = nodo.closest('[data-op-nueva-mesa]');
    if (nuevaMesa) {
      abrirModal({
        title: 'Crear mesa',
        body: formMesa(null),
        onSubmit: async function (form) {
          await request('/api/mesas', {
            method: 'POST',
            body: {
              nombre: String(form.get('nombre') || '').trim(),
              codigo: String(form.get('codigo') || '').trim(),
              zona: String(form.get('zona') || '').trim(),
              capacidad: parseInt(form.get('capacidad'), 10) || 4,
              precio_consumo: num(form.get('precio_consumo')),
              estado: form.get('estado') || 'libre'
            }
          });
          cerrarModal();
          toast('Mesa creada.', 'ok');
          refrescar();
        }
      });
      return;
    }

    var editMesa = nodo.closest('[data-op-edit-mesa]');
    if (editMesa) {
      var idEdit = editMesa.getAttribute('data-op-edit-mesa');
      var mesaEdit = state.mesas.find(function (m) { return String(m.id) === idEdit; });
      if (!mesaEdit) { toast('La mesa ya no esta disponible.', 'error'); refrescar(); return; }
      abrirModal({
        title: 'Editar ' + mesaEdit.nombre,
        body: formMesa(mesaEdit),
        onSubmit: async function (form) {
          await request('/api/mesas/' + encodeURIComponent(idEdit), {
            method: 'PUT',
            body: {
              nombre: String(form.get('nombre') || '').trim(),
              codigo: String(form.get('codigo') || '').trim(),
              zona: String(form.get('zona') || '').trim(),
              capacidad: parseInt(form.get('capacidad'), 10) || 4,
              precio_consumo: num(form.get('precio_consumo')),
              estado: form.get('estado') || 'libre'
            }
          });
          cerrarModal();
          toast('Mesa actualizada.', 'ok');
          refrescar();
        }
      });
      return;
    }

    var bajaMesa = nodo.closest('[data-op-baja-mesa]');
    if (bajaMesa) {
      var idBaja = bajaMesa.getAttribute('data-op-baja-mesa');
      var mesaBaja = state.mesas.find(function (m) { return String(m.id) === idBaja; });
      if (!mesaBaja) { toast('La mesa ya no esta disponible.', 'error'); refrescar(); return; }
      confirmar(
        'Dar de baja "' + mesaBaja.nombre + '"? La mesa queda fuera de servicio y no podra abrir cuentas. ' +
        'El historial de cuentas y consumos se conserva.',
        async function () {
          await request('/api/mesas/' + encodeURIComponent(idBaja), {
            method: 'PUT',
            body: { estado: 'fuera_servicio' }
          });
          toast('Mesa fuera de servicio.', 'ok');
          refrescar();
        }
      );
      return;
    }

    var mesa = nodo.closest('[data-op-mesa]');
    if (mesa) {
      var encontrada = state.mesas.find(function (m) { return String(m.id) === mesa.getAttribute('data-op-mesa'); });
      if (encontrada && encontrada.tiene_cuenta_abierta) {
        verCuenta(encontrada.cuenta_abierta.id).catch(function (err) { toast(err.message, 'error'); });
        return;
      }
      if (encontrada) {
        abrirModal({
          title: 'Mesa ' + encontrada.nombre,
          submitLabel: 'Abrir cuenta',
          body:
            '<form class="op-form-grid" autocomplete="off">' +
            '<div class="op-summary" style="margin-bottom:16px; grid-column: 1 / -1">' +
            '<div class="op-summary-row"><span>Zona</span><span class="val">' +
            esc(encontrada.zona || '—') + '</span></div>' +
            '<div class="op-summary-row"><span>Capacidad</span><span class="val">' +
            esc(encontrada.capacidad || 0) + '</span></div>' +
            '<div class="op-summary-row"><span>Estado</span><span class="val">' +
            estadoMesaBadge(encontrada.estado) + '</span></div>' +
            '</div>' +
            '<p class="op-state-text" style="grid-column: 1 / -1">' +
            'Abre una cuenta para registrar consumos sobre esta mesa.</p>' +
            '</form>',
          onSubmit: async function () { cerrarModal(); abrirCuenta(encontrada); }
        });
      }
      return;
    }

    var nuevoCatalogo = nodo.closest('[data-op-nuevo-catalogo]');
    if (nuevoCatalogo) {
      var rutaNuevo = nuevoCatalogo.getAttribute('data-op-nuevo-catalogo');
      abrirModal({
        title: rutaNuevo === 'marcas' ? 'Nueva marca' : 'Nueva categoria',
        body: formCatalogo(rutaNuevo, null),
        onSubmit: async function (form) {
          await guardarCatalogo(rutaNuevo, null, {
            nombre: String(form.get('nombre') || '').trim(),
            descripcion: String(form.get('descripcion') || '').trim(),
            color: form.get('color') || null
          });
          cerrarModal();
          toast('Registro creado.', 'ok');
          refrescar();
        }
      });
      return;
    }

    var editCat = nodo.closest('[data-op-edit-cat]');
    if (editCat) {
      var ruta = editCat.getAttribute('data-op-edit-cat');
      var id = editCat.getAttribute('data-op-id');
      request('/api/' + ruta + '?todos=1').then(function (data) {
        var fila = ((data && data.catalogo) || []).find(function (f) { return String(f.id) === id; });
        if (!fila) throw new Error('Registro no encontrado.');
        abrirModal({
          title: 'Editar ' + (ruta === 'marcas' ? 'marca' : 'categoria'),
          body: formCatalogo(ruta, fila),
          onSubmit: async function (form) {
            await guardarCatalogo(ruta, id, {
              nombre: String(form.get('nombre') || '').trim(),
              descripcion: String(form.get('descripcion') || '').trim(),
              color: form.get('color') || null
            });
            cerrarModal();
            toast('Registro actualizado.', 'ok');
            refrescar();
          }
        });
      }).catch(function (err) { toast(err.message, 'error'); });
      return;
    }

    var delCat = nodo.closest('[data-op-del-cat]');
    if (delCat) {
      var rutaDel = delCat.getAttribute('data-op-del-cat');
      var idDel = delCat.getAttribute('data-op-id');
      var nombreDel = delCat.getAttribute('data-op-nombre');
      confirmar(
        'Desactivar "' + nombreDel + '"? Los productos historicos seguiran mostrando ese texto.',
        async function () {
          await request('/api/' + rutaDel + '/' + encodeURIComponent(idDel), { method: 'DELETE' });
          toast('Registro desactivado.', 'ok');
          refrescar();
        }
      );
      return;
    }

    var ver = nodo.closest('[data-op-ver-cuenta]');
    if (ver) {
      verCuenta(ver.getAttribute('data-op-ver-cuenta')).catch(function (err) { toast(err.message, 'error'); });
      return;
    }

    var agregar = nodo.closest('[data-op-agregar-consumo]');
    if (agregar) { agregarConsumo(agregar.getAttribute('data-op-agregar-consumo')); return; }

    var registrarMerma = nodo.closest('[data-op-nueva-merma]');
    if (registrarMerma) { nuevaMerma(); return; }

    var cerrar = nodo.closest('[data-op-cerrar-cuenta]');
    if (cerrar) {
      // Pide forma de pago y descuento: cerrar en efectivo sin preguntar
      // descuadra la caja y el usuario nunca se entera.
      abrirCierre(cerrar.getAttribute('data-op-cerrar-cuenta'));
      return;
    }

    var nuevoAcceso = nodo.closest('[data-op-nuevo-acceso]');
    if (nuevoAcceso) {
      abrirModal({
        title: 'Registrar acceso',
        body: formAcceso(),
        onSubmit: async function (form) {
          if (form.get('vacio')) throw new Error('No hay socios activos para registrar el acceso.');
          await request('/api/socios-accesos', {
            method: 'POST',
            body: {
              socio_id: form.get('socio_id'),
              tipo_acceso: form.get('tipo_acceso'),
              puerta: String(form.get('puerta') || '').trim() || null,
              notas: String(form.get('notas') || '').trim() || null
            }
          });
          cerrarModal();
          toast('Acceso registrado.', 'ok');
          refrescar();
        }
      });
      return;
    }

    var nuevoPasillo = nodo.closest('[data-op-nuevo-pasillo]');
    if (nuevoPasillo) {
      abrirModal({
        title: 'Crear pasillo',
        body: formPasillo(null),
        onSubmit: async function (form) {
          await request('/api/pasillos', {
            method: 'POST',
            body: {
              nombre: String(form.get('nombre') || '').trim(),
              codigo: String(form.get('codigo') || '').trim(),
              categoria: String(form.get('categoria') || '').trim(),
              capacidad_productos: parseInt(form.get('capacidad_productos'), 10) || null
            }
          });
          cerrarModal();
          toast('Pasillo creado.', 'ok');
          refrescar();
        }
      });
      return;
    }

    var editPasillo = nodo.closest('[data-op-edit-pasillo]');
    if (editPasillo) {
      var idPas = editPasillo.getAttribute('data-op-edit-pasillo');
      request('/api/pasillos?todos=1').then(function (data) {
        var fila = ((data && data.pasillos) || []).find(function (f) { return String(f.id) === idPas; });
        if (!fila) throw new Error('Pasillo no encontrado.');
        abrirModal({
          title: 'Editar pasillo',
          body: formPasillo(fila),
          onSubmit: async function (form) {
            await request('/api/pasillos/' + encodeURIComponent(idPas), {
              method: 'PUT',
              body: {
                nombre: String(form.get('nombre') || '').trim(),
                codigo: String(form.get('codigo') || '').trim(),
                categoria: String(form.get('categoria') || '').trim(),
                capacidad_productos: parseInt(form.get('capacidad_productos'), 10) || null
              }
            });
            cerrarModal();
            toast('Pasillo actualizado.', 'ok');
            refrescar();
          }
        });
      }).catch(function (err) { toast(err.message, 'error'); });
      return;
    }

    var delPasillo = nodo.closest('[data-op-del-pasillo]');
    if (delPasillo) {
      var idDelPas = delPasillo.getAttribute('data-op-del-pasillo');
      var nombrePas = delPasillo.getAttribute('data-op-nombre');
      confirmar('Desactivar el pasillo "' + nombrePas + '"?', async function () {
        await request('/api/pasillos/' + encodeURIComponent(idDelPas), { method: 'DELETE' });
        toast('Pasillo desactivado.', 'ok');
        refrescar();
      });
      return;
    }

    if (nodo.closest('[data-op-filtro-tipo]')) {
      state.filtros.mermaTipo = nodo.value;
      refrescar();
      return;
    }
  }

  function onChange(evento) {
    if (evento.target.matches('[data-op-producto], [data-op-cantidad]')) recalcularLineas();
    if (evento.target.matches('[data-op-filtro-tipo]')) {
      state.filtros.mermaTipo = evento.target.value;
      refrescar();
    }
    if (evento.target.matches('[data-op-prod-filtro]')) {
      // El atributo es corto ("pasillo") pero la clave real lleva el prefijo
      // "prod": sin esta correspondencia el filtro se guardaria en una clave
      // que nadie lee y la tabla no se filtraria nunca.
      var clave = evento.target.getAttribute('data-op-prod-filtro') === 'categoria'
        ? 'prodCategoria'
        : 'prodPasillo';
      state.filtros[clave] = evento.target.value;
      refrescar();
    }
    if (evento.target.matches('[data-op-prod-inactivos]')) {
      state.filtros.prodInactivos = evento.target.checked;
      refrescar();
    }
  }

  // El buscador filtra mientras se escribe. SeDebounce para no lanzar una
  // consulta por cada tecla, y el nodo se busca en vivo porque `refrescar()`
  // vuelve a pintar la tabla y deja el foco fuera del input.
  var temporizadorBusqueda = null;
  function onInput(evento) {
    if (!evento.target.matches('[data-op-prod-buscar]')) return;
    var valor = evento.target.value;
    if (temporizadorBusqueda) clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(function () {
      state.filtros.prodQuery = valor;
      refrescar().then(function () {
        var campo = document.querySelector('[data-op-prod-buscar]');
        if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
      });
    }, 320);
  }

  /* ---------------------------------------------------------------- */
  /* Layout: sidebar colapsable, drawer movil y badge de plan           */
  /* ---------------------------------------------------------------- */

  function esMovil() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function montarLayout() {
    var sidebar = document.getElementById('sidebar');
    var dashboard = document.getElementById('dashboard');
    var overlay = document.getElementById('overlay');
    var toggle = document.getElementById('toggleSidebar');

    if (sidebar && dashboard && !esMovil() && localStorage.getItem('sidebarCollapsed') === 'true') {
      sidebar.classList.add('collapsed');
      dashboard.classList.add('sidebar-collapsed');
    }

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (esMovil()) {
          var abierta = sidebar.classList.toggle('active');
          if (overlay) overlay.classList.toggle('active', abierta);
        } else {
          var colapsada = sidebar.classList.toggle('collapsed');
          dashboard.classList.toggle('sidebar-collapsed', colapsada);
          localStorage.setItem('sidebarCollapsed', colapsada ? 'true' : 'false');
        }
      });
    }

    if (overlay) {
      overlay.addEventListener('click', function () {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      });
    }

    var nombre = localStorage.getItem('empresaNombre') || localStorage.getItem('empresaCodigo') || 'Mi empresa';
    var rol = localStorage.getItem('userRole') || '';
    var etiquetaEmpresa = document.getElementById('sidebarName');
    var etiquetaRol = document.getElementById('sidebarRole');
    if (etiquetaEmpresa) etiquetaEmpresa.textContent = nombre;
    if (etiquetaRol) etiquetaRol.textContent = rol ? rol.replace(/[_-]+/g, ' ') : '';

    var plan = localStorage.getItem('empresaPlan') || '';
    var badge = document.getElementById('opPlanBadge');
    if (badge) {
      if (plan) badge.textContent = plan;
      else badge.remove();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Arranque                                                          */
  /* ---------------------------------------------------------------- */

  function cachear() {
    el.tabs = document.getElementById('opTabs');
    el.subtitle = document.getElementById('opSubtitle');
    el.kpis = document.getElementById('opKpis');
    el.panel = document.getElementById('opPanel');
    el.toasts = document.getElementById('opToasts');
    el.modal = document.getElementById('opModal');
    el.modalTitle = document.getElementById('opModalTitle');
    el.modalBody = document.getElementById('opModalBody');
    el.modalFoot = document.getElementById('opModalFoot');
    el.modalAlert = document.getElementById('opModalAlert');

    if (!el.modal) return false;

    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal || e.target.closest('[data-op-modal-close]')) cerrarModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.modal.classList.contains('open')) cerrarModal();
    });

    document.getElementById('opVista').addEventListener('click', onClick);
    document.getElementById('opVista').addEventListener('change', onChange);
    document.getElementById('opVista').addEventListener('input', onInput);

    el.modalBody.addEventListener('click', function (e) {
      if (e.target.closest('[data-op-add-line]')) {
        var lines = el.modalBody.querySelector('[data-op-lines]');
        var ultimo = lines.lastElementChild;
        if (ultimo) lines.appendChild(ultimo.cloneNode(true));
        recalcularLineas();
        return;
      }
      if (e.target.closest('[data-op-quitar-linea]')) {
        var lineas = el.modalBody.querySelectorAll('[data-op-line]');
        if (lineas.length <= 1) {
          toast('La cuenta necesita al menos una linea.', 'error');
          return;
        }
        e.target.closest('[data-op-line]').remove();
        recalcularLineas();
      }
    });

    document.getElementById('opSalir').addEventListener('click', function () {
      window.location.href = 'dashboard.html';
    });

    return true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!cachear()) return;

    montarLayout();

    if (localStorage.getItem('soloLectura') === '1') {
      if (typeof window.injectReadOnlyBanner === 'function') window.injectReadOnlyBanner();
    }

    // Deep-linking: las demas paginas abren esta vista en la pestana que les
    // corresponde (operaciones.html?tab=mermas) en vez de un dashboard generico.
    var pedida = new URLSearchParams(window.location.search).get('tab');
    if (pedida && TABS.some(function (t) { return t.id === pedida; })) {
      state.tab = pedida;
    }

    pintarTabs();
    refrescar();
  });

  window.__opOperativos = {
    refrescar: recargarActual,
    tabs: TABS,
    estado: state
  };
})();
