// Carga dinamica de modulos del tenant desde el backend.
//
// FUENTE DE VERDAD: GET /api/tenant/modules, que devuelve
//   { modulos_activos[], modulos_app[], modulos_detalle[] }
// y en `modulos_detalle` cada modulo llega con clave, nombre, categoria,
// icono, precio_mensual_hnl y modulo_app resueltos por el servidor desde
// MODULOS_COTIZADOR_META / modulos_cotizador.
//
// Este archivo NO contiene catalogo de negocio. Solo aporta:
//   - ETIQUETA_CORTA: etiqueta de UI (presentacion) por id de app.
//   - MODULO_URL:     ruta de navegacion por id de app (estructura de la web).
// Si la API no responde se muestra un estado vacio con reintento; NUNCA una
// lista de modulos inventada (antes habia un MODULOS_FALLBACK con 23 nombres
// que se pintaba como si fueran del tenant, incluso sin plan).
(function () {
  'use strict';

  // Presentacion: etiqueta corta por id de app. No es dato de negocio.
  var ETIQUETA_CORTA = {
    pos: 'POS',
    facturacion: 'Facturación SAR',
    inventario: 'Inventario',
    contabilidad: 'Contabilidad',
    rrhh: 'RRHH',
    crm: 'CRM',
    comercial: 'Comercial',
    membresias: 'Membresías',
    canal_tradicional: 'Canal Tradicional',
    canal_moderno: 'Canal Moderno',
    cotizaciones: 'Cotizaciones',
    compras_proveedores: 'Compras & Proveedores',
    analytics: 'Analytics',
    reportes: 'Reportes',
    supply_chain: 'Supply Chain',
    multi_empresa: 'Multi-Empresa',
    chat_ia: 'Chat IA',
    seguridad: 'Seguridad',
    crm_advanced: 'CRM Avanzado',
    fiscal_advanced: 'Fiscal Avanzado',
    sector_retail: 'Sector Retail',
    settings: 'Configuración',
    soporte: 'Soporte'
  };

  // Navegacion: ruta por id de app (estructura de la web, no dato de negocio).
  var MODULO_URL = {
    pos: 'dashboard.html',
    facturacion: 'dashboard.html',
    inventario: 'operaciones.html?tab=productos',
    contabilidad: 'dashboard.html',
    rrhh: 'dashboard.html',
    crm: 'dashboard.html',
    comercial: 'automation.html',
    membresias: 'operaciones.html?tab=mesas',
    canal_tradicional: 'dashboard.html',
    canal_moderno: 'dashboard.html',
    cotizaciones: 'dashboard.html',
    compras_proveedores: 'dashboard.html',
    analytics: 'dashboard.html',
    reportes: 'dashboard.html',
    supply_chain: 'fleet.html',
    multi_empresa: 'tenant_detail.html',
    chat_ia: 'dashboard.html',
    seguridad: 'security.html',
    crm_advanced: 'dashboard.html',
    fiscal_advanced: 'dashboard.html',
    sector_retail: 'operaciones.html?tab=pasillos',
    settings: 'tenant_detail.html',
    soporte: 'support.html'
  };

  var URL_POR_DEFECTO = 'dashboard.html';

  function appDe(detalle) {
    if (!detalle) return '';
    if (Array.isArray(detalle.modulo_app) && detalle.modulo_app.length) return String(detalle.modulo_app[0]);
    return String(detalle.clave || '');
  }

  function etiquetaDe(detalle) {
    var app = appDe(detalle);
    return ETIQUETA_CORTA[app] || (detalle && detalle.nombre) || app || 'Módulo';
  }

  function urlDe(detalle) {
    var app = appDe(detalle);
    return MODULO_URL[app] || URL_POR_DEFECTO;
  }

  function pintar(items) {
    var grid = document.getElementById('modulosGrid');
    if (!grid) return;
    grid.innerHTML = '';
    items.forEach(function (item) {
      var card = document.createElement('a');
      card.className = 'area-card';
      card.href = item.url;
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      card.innerHTML = '<div class="area-icon"><i class="fas ' + item.icono + '"></i></div>' +
        '<h3>' + item.etiqueta + '</h3>' +
        '<div class="btn-ingresar">Acceder <i class="fas fa-arrow-right"></i></div>';
      grid.appendChild(card);
    });
    Array.prototype.forEach.call(grid.querySelectorAll('.area-card'), function (card, i) {
      setTimeout(function () { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; }, 100 + i * 60);
    });
  }

  function pintarEstado(mensaje, conReintento) {
    var grid = document.getElementById('modulosGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="area-card" style="cursor:default;opacity:1;">' +
      '<div class="area-icon"><i class="fas fa-circle-info"></i></div>' +
      '<h3>' + mensaje + '</h3>' +
      (conReintento
        ? '<button class="btn-ingresar" type="button" onclick="cargarModulos()">Reintentar <i class="fas fa-rotate-right"></i></button>'
        : '') +
      '</div>';
  }

  function itemsDesdeDetalle(data) {
    var detalle = Array.isArray(data && data.modulos_detalle) ? data.modulos_detalle : [];
    var vistos = {};
    var items = [];
    detalle.forEach(function (d) {
      var app = appDe(d);
      var key = app || (d && d.clave);
      if (!key || vistos[key]) return;
      vistos[key] = true;
      items.push({ etiqueta: etiquetaDe(d), icono: (d && d.icono) || 'fa-cube', url: urlDe(d) });
    });
    return items;
  }

  // Compatibilidad con respuestas antiguas sin modulos_detalle: los slugs de
  // modulos_activos se resuelven solo si son un id de app conocido.
  function itemsDesdeSlugs(data) {
    var slugs = Array.isArray(data && data.modulos_activos) ? data.modulos_activos : [];
    var items = [];
    slugs.forEach(function (s) {
      var app = String(s || '');
      var etiqueta = ETIQUETA_CORTA[app];
      if (!etiqueta) return;
      items.push({ etiqueta: etiqueta, icono: 'fa-cube', url: MODULO_URL[app] || URL_POR_DEFECTO });
    });
    return items;
  }

  async function cargarModulos() {
    var grid = document.getElementById('modulosGrid');
    if (!grid) return;
    grid.innerHTML = '';
    try {
      var token = localStorage.getItem('token');
      var res = await fetch('/api/tenant/modules', {
        headers: { 'Authorization': 'Bearer ' + (token || '') }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var items = itemsDesdeDetalle(data);
      if (items.length === 0) items = itemsDesdeSlugs(data);
      if (items.length === 0) {
        pintarEstado('Tu plan no tiene módulos activos.', false);
        return;
      }
      pintar(items);
    } catch (e) {
      pintarEstado('No se pudieron cargar tus módulos desde el servidor.', true);
    } finally {
      var sk = document.getElementById('areasSkeleton');
      if (sk) sk.style.display = 'none';
    }
  }

  window.cargarModulos = cargarModulos;
  cargarModulos();
})();
