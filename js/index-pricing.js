/* ─────────────────────────────────────────────────────────────────────────────
   index-pricing.js — Precios y catálogo de la landing (index.html)
   ---------------------------------------------------------------------------
   FUENTE ÚNICA DE VERDAD: GET /api/plans (endpoint público, sin autenticación).
   Devuelve { moneda, plans[], cotizador { base_mensual_hnl, descuentos[], modulos[] } }.

   Este archivo NO inventa datos de negocio. Si la petición falla, aplica
   FALLBACK (una COPIA de los últimos valores conocidos del servidor, no la
   fuente) y lo deja marcado en <html data-price-source="fallback"> para que
   nunca se confunda con datos vivos.
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var API_PLANS = '/api/plans';

  /* FALLBACK offline. Copia de /api/plans (2026-10). Solo se usa si fetch falla.
     NO es fuente de verdad: el marcado data-price-source lo distingue. */
  var FALLBACK = {
    moneda: 'HNL',
    planes: {
      pulperia: {
        clave: 'pulperia',
        nombre: 'Pulpería / Mercadito',
        precio_mensual_hnl: 299,
        precio_anual_hnl: 2990,
        max_users: 3,
        descripcion_corta: 'L. 10 al día. Se paga solo recuperando 1 fiado al mes.'
      },
      tienda: {
        clave: 'tienda',
        nombre: 'Tienda / Supermercado',
        precio_mensual_hnl: 799,
        precio_anual_hnl: 7990,
        max_users: 15,
        descripcion_corta: 'L. 26.60 al día — menos del 0.8% de tus ventas.'
      },
      club: {
        clave: 'club',
        nombre: 'Club / Membresía',
        precio_mensual_hnl: 1399,
        precio_anual_hnl: 13990,
        max_users: 35,
        descripcion_corta: 'Se cubre con la entrada de 2 socios al mes.'
      },
      personalizado: {
        clave: 'personalizado',
        nombre: 'Personalizado (Cotizador)',
        precio_mensual_hnl: 150,
        precio_anual_hnl: 1500,
        max_users: 15,
        descripcion_corta: 'Arma tu plan módulo por módulo.'
      },
      starter: {
        clave: 'starter',
        nombre: 'Prueba',
        precio_mensual_hnl: 0,
        precio_anual_hnl: 0,
        max_users: 5,
        trial_dias: 15,
        descripcion_corta: '15 días gratis, sin tarjeta.'
      }
    },
    cotizador: { base_mensual_hnl: 150, descuento_max: 0.25, modulos_total: 23 }
  };

  /* Estado en memoria, siempre poblado desde la API cuando está disponible. */
  var STATE = {
    planByKey: {},
    cotizador: null,
    source: 'pending'
  };

  function fmtNum(n) {
    var v = Number(n);
    if (!isFinite(v)) return '0';
    return v.toLocaleString('es-HN');
  }

  function fmtPct(fraction) {
    var v = Number(fraction);
    if (!isFinite(v)) return '0%';
    return Math.round(v * 100) + '%';
  }

  function setText(selector, value, scope) {
    var root = scope || document;
    var els = root.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) els[i].textContent = value;
  }

  /* El subtítulo se arma SOLO con copy del servidor (descripcion_corta).
     No se calculan cifras nuevas: si el texto del servidor ya empieza por el
     importe diario, se antepone "Por mes · "; si no, se muestra en su renglón. */
  function subtituloDe(plan) {
    var txt = String((plan && plan.descripcion_corta) || '').trim();
    if (!txt) return 'Por mes';
    if (/^L\.?\s*[\d.,]+\s*al\s*d[ií]a/i.test(txt)) return 'Por mes · ' + txt;
    return 'Por mes<br>' + txt;
  }

  function setSource(source) {
    STATE.source = source;
    try { document.documentElement.setAttribute('data-price-source', source); } catch (e) {}
  }

  function renderTarjetas() {
    var cards = document.querySelectorAll('[data-plan-card]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var key = card.getAttribute('data-plan-card');
      var plan = STATE.planByKey[key];
      if (!plan) continue;

      var precio = Number(plan.precio_mensual_hnl);
      var elPrecio = card.querySelector('[data-plan-price]');
      if (elPrecio) elPrecio.textContent = fmtNum(precio);

      var elSub = card.querySelector('[data-plan-daily]');
      if (elSub) elSub.innerHTML = subtituloDe(plan);

      var elUsers = card.querySelector('[data-plan-users]');
      if (elUsers && plan.max_users !== undefined && plan.max_users !== null) {
        elUsers.textContent = fmtNum(plan.max_users);
      }

      // Nombre real del plan para el CTA (registrov2.html) y para el título accesible.
      card.setAttribute('data-plan-nombre', String(plan.nombre || ''));
      var btn = card.querySelector('[data-plan-cta]');
      if (btn && plan.nombre) {
        var label = btn.querySelector('[data-plan-cta-label]');
        if (label) label.textContent = 'Elegir ' + String(plan.nombre).split('/')[0].trim();
      }
    }
  }

  function renderCotizador() {
    var c = STATE.cotizador;
    if (!c) return;
    if (c.modulos_total !== undefined && c.modulos_total !== null) {
      setText('[data-cotizador-modulos]', fmtNum(c.modulos_total));
    }
    if (c.base_mensual_hnl !== undefined && c.base_mensual_hnl !== null) {
      setText('[data-cotizador-base]', fmtNum(c.base_mensual_hnl));
    }
    if (c.descuento_max !== undefined && c.descuento_max !== null) {
      setText('[data-cotizador-descuento]', fmtPct(c.descuento_max));
    }
  }

  function renderTrial() {
    var starter = STATE.planByKey.starter;
    if (!starter) return;
    var dias = starter.trial_dias;
    if (dias !== undefined && dias !== null && Number(dias) > 0) {
      setText('[data-trial-dias]', fmtNum(dias));
    }
  }

  function normalizarPlans(plans) {
    var map = {};
    (plans || []).forEach(function (p) {
      if (p && p.clave) map[String(p.clave)] = p;
    });
    return map;
  }

  function desdeApi(data) {
    if (!data || !Array.isArray(data.plans)) return null;
    STATE.planByKey = normalizarPlans(data.plans);
    var c = data.cotizador || {};
    var maxDesc = 0;
    (c.descuentos || []).forEach(function (d) {
      var v = Number(d && d.descuento);
      if (isFinite(v) && v > maxDesc) maxDesc = v;
    });
    STATE.cotizador = {
      base_mensual_hnl: c.base_mensual_hnl,
      descuento_max: maxDesc,
      modulos_total: Array.isArray(c.modulos) ? c.modulos.length : null
    };
    return STATE;
  }

  function desdeFallback() {
    STATE.planByKey = normalizarPlans(Object.keys(FALLBACK.planes).map(function (k) {
      return FALLBACK.planes[k];
    }));
    STATE.cotizador = {
      base_mensual_hnl: FALLBACK.cotizador.base_mensual_hnl,
      descuento_max: FALLBACK.cotizador.descuento_max,
      modulos_total: FALLBACK.cotizador.modulos_total
    };
    return STATE;
  }

  function aplicar() {
    renderTarjetas();
    renderCotizador();
    renderTrial();
  }

  /* ── CTA: plan seleccionado → registrov2.html ─────────────────────────────
     Usa el nombre real del plan (campo `nombre` de la API) como business_type. */
  window.selectPlan = function (name, target) {
    var plan = STATE.planByKey[name] || FALLBACK.planes[name] || null;
    // `target` puede ser el propio botón (onclick="selectPlan('x', this)").
    var btn = target && target.currentTarget ? target.currentTarget : (target || null);
    // Solo se sustituye el texto de la etiqueta, para conservar el icono del diseño.
    var label = btn && btn.querySelector ? btn.querySelector('[data-plan-cta-label]') : null;
    var el = label || btn;
    var orig = el ? el.textContent : '';
    if (btn) {
      btn.style.background = '#34d399';
      btn.style.borderColor = '#34d399';
      btn.style.color = '#000';
    }
    if (el) el.textContent = '✓ Seleccionado!';
    var url = 'registrov2.html?plan=' + encodeURIComponent(name);
    if (plan && plan.nombre) url += '&business_type=' + encodeURIComponent(plan.nombre);
    setTimeout(function () {
      if (btn) {
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      }
      if (el) el.textContent = orig;
      window.location.href = url;
    }, 500);
  };

  /* ── Toggle mensual/anual ─────────────────────────────────────────────────
     Los importes salen del servidor (precio_mensual_hnl / precio_anual_hnl). */
  window.setPricingToggle = function (btn, mode) {
    try {
      var btns = document.querySelectorAll('.pt-btn');
      for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
      var target = btn || document.querySelector('.pt-btn');
      if (target) target.classList.add('active');

      var field = mode === 'yearly' ? 'precio_anual_hnl' : 'precio_mensual_hnl';
      var cards = document.querySelectorAll('[data-plan-card]');
      for (var j = 0; j < cards.length; j++) {
        var card = cards[j];
        var plan = STATE.planByKey[card.getAttribute('data-plan-card')];
        if (!plan) continue;
        var el = card.querySelector('[data-plan-price]');
        var v = plan[field];
        if (el && v !== undefined && v !== null) {
          el.textContent = fmtNum(v);
          el.style.display = 'none';
          void el.offsetHeight;
          el.style.display = '';
        }
      }
    } catch (e) {
      console.error('[index-pricing] toggle:', e);
    }
  };

  /* Expuesto para pruebas/debug (no se usa en producción como fuente). */
  window.IndexPricing = {
    state: STATE,
    fallback: FALLBACK,
    render: aplicar,
    apiUrl: API_PLANS
  };

  function cargar() {
    if (typeof fetch !== 'function') { desdeFallback(); setSource('fallback'); aplicar(); return; }
    fetch(API_PLANS, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!desdeApi(data)) throw new Error('respuesta sin plans[]');
        setSource('api');
        aplicar();
      })
      .catch(function (err) {
        console.warn('[index-pricing] /api/plans no disponible, se usa FALLBACK marcado:', err && err.message);
        desdeFallback();
        setSource('fallback');
        aplicar();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargar);
  } else {
    cargar();
  }
})();
