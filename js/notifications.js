/* ═══ NOTIFICACIONES COMPARTIDAS — Portal Pilot ═══ */
(function () {
  'use strict';

  var CONTAINER_ID = 'pp-notif-container';
  var COUNTER_ID = 'pp-notif-counter';
  var DURACION = 4500;
  var MAX_NOTIFS = 5;

  var EMOJIS = {
    error:   'Cross%20mark/3D/cross_mark_3d.png',
    success: 'Check%20mark%20button/3D/check_mark_button_3d.png',
    info:    'Information/3D/information_3d.png',
    warning: 'Warning/3D/warning_3d.png'
  };
  var BASE_URL = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/';

  var lista = [];
  var idCounter = 0;
  var animando = false;

  /* ── Crear container si no existe ── */
  function ensureContainer() {
    var c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      document.body.appendChild(c);
    }
    var cnt = document.getElementById(COUNTER_ID);
    if (!cnt) {
      cnt = document.createElement('div');
      cnt.id = COUNTER_ID;
      document.body.appendChild(cnt);
    }
    return c;
  }

  /* ── Crear notificación ── */
  var TIPOS = ['error', 'success', 'info', 'warning'];

  function esTipo(v) {
    return TIPOS.indexOf(v) !== -1;
  }

  function crear(texto, subtitulo, tipo) {
    if (esTipo(subtitulo)) { tipo = subtitulo; subtitulo = null; }
    tipo = tipo || 'info';
    if (TIPOS.indexOf(tipo) === -1) tipo = 'info';

    var container = ensureContainer();

    if (animando) {
      setTimeout(function () { crear(texto, subtitulo, tipo); }, 100);
      return;
    }

    var id = idCounter++;
    var emoji = EMOJIS[tipo] || EMOJIS.info;

    var el = document.createElement('div');
    el.className = 'pp-notif';
    el.dataset.id = id;
    var subHtml = subtitulo ? '<p class="pp-notif-sub">' + subtitulo + '</p>' : '';
    el.innerHTML =
      '<div class="pp-notif-content">' +
        '<div class="pp-notif-icon"><img src="' + BASE_URL + emoji + '" alt="' + tipo + '"></div>' +
        '<div class="pp-notif-body">' +
          '<p class="pp-notif-text">' + texto + '</p>' + subHtml +
        '</div>' +
      '</div>' +
      '<div class="pp-notif-bar ' + tipo + '"></div>';

    container.appendChild(el);

    if (lista.length > 0 && lista[0].estado === 'visible') {
      pausarBarra(lista[0]);
    }

    lista.unshift({ id: id, el: el, timeout: null, estado: 'entrando', progreso: 0, inicio: null });

    if (lista.length > MAX_NOTIFS) {
      var ultima = lista.pop();
      if (ultima.timeout) clearTimeout(ultima.timeout);
      ultima.el.remove();
    }

    animando = true;
    el.classList.add('entering');

    el.addEventListener('animationend', function handler() {
      el.removeEventListener('animationend', handler);
      el.classList.remove('entering');
      el.classList.add('visible', 'pointer-active');
      animando = false;
      actualizarPosiciones();
      iniciarBarra(lista[0]);
      lista[0].estado = 'visible';
    });

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (lista[0] && lista[0].id === id) dismiss(id);
    });

    actualizarContador();
  }

  /* ── Barra de progreso ── */
  function iniciarBarra(d) {
    var barra = d.el.querySelector('.pp-notif-bar');
    var restante = DURACION * (1 - d.progreso);
    barra.style.transform = 'scaleX(' + d.progreso + ')';
    barra.offsetHeight;
    barra.style.transition = 'transform ' + restante + 'ms linear';
    barra.style.transform = 'scaleX(1)';
    d.inicio = Date.now();
    d.timeout = setTimeout(function () { dismiss(d.id); }, restante);
  }

  function pausarBarra(d) {
    var barra = d.el.querySelector('.pp-notif-bar');
    if (d.inicio) {
      var transcurrido = Date.now() - d.inicio;
      d.progreso = Math.min((transcurrido / DURACION) + d.progreso, 1);
    }
    barra.style.transition = 'none';
    barra.style.transform = 'scaleX(' + d.progreso + ')';
    if (d.timeout) { clearTimeout(d.timeout); d.timeout = null; }
    d.inicio = null;
  }

  /* ── Posiciones ── */
  function actualizarPosiciones() {
    lista.forEach(function (n, i) {
      n.el.style.transform = 'translateY(' + (i * 8) + 'px) scale(' + (1 - i * 0.06) + ')';
      n.el.style.opacity = i === 0 ? '1' : Math.max(0.2, 1 - i * 0.18);
      n.el.style.zIndex = 100 - i;
      if (i === 0 && n.estado === 'visible') {
        n.el.classList.add('pointer-active');
      } else {
        n.el.classList.remove('pointer-active');
      }
    });
  }

  /* ── Dismiss ── */
  function dismiss(id) {
    var idx = lista.findIndex(function (n) { return n.id === id; });
    if (idx === -1 || animando) return;
    if (idx !== 0) return;
    var n = lista[idx];
    if (n.timeout) clearTimeout(n.timeout);
    animando = true;
    n.estado = 'saliendo';
    n.el.classList.remove('pointer-active');
    n.el.classList.add('leaving');
    n.el.addEventListener('animationend', function handler() {
      n.el.removeEventListener('animationend', handler);
      n.el.remove();
      lista.splice(0, 1);
      animando = false;
      if (lista.length > 0) {
        var sig = lista[0];
        sig.estado = 'visible';
        sig.el.classList.add('pointer-active');
        actualizarPosiciones();
        iniciarBarra(sig);
      } else {
        actualizarPosiciones();
      }
      actualizarContador();
    });
  }

  /* ── Contador ── */
  function actualizarContador() {
    var cnt = document.getElementById(COUNTER_ID);
    if (!cnt) return;
    if (lista.length > 1) {
      cnt.textContent = lista.length + ' notificaciones';
      cnt.classList.add('visible');
    } else {
      cnt.classList.remove('visible');
    }
  }

  /* ── API pública ── */
  function parsePublico(argv) {
    var a = Array.prototype.slice.call(argv);
    var out = { texto: a.length ? String(a[0]) : '', tipo: null, subtitulo: null };
    if (!out.texto) return out;
    if (a.length === 2) {
      if (esTipo(a[1])) { out.tipo = a[1]; }
      else if (a[1]) { out.subtitulo = a[1]; }
    } else if (a.length >= 3) {
      if (a[1]) out.subtitulo = a[1];
      if (esTipo(a[2])) out.tipo = a[2];
    }
    return out;
  }

  function tipoPp(t) {
    if (t === 'error') return 'err';
    if (t === 'warning') return 'warn';
    if (t === 'info') return 'info';
    return 'ok';
  }

  // Si existe el toast global estilo Sileo (portales.js), delegamos en él
  // para tener UNA sola fuente visual en toda la web. Si no, usamos la pila
  // propia (fallback para páginas /pp/ sin portales.js).
  function delegar(argv, tipoPorDefecto) {
    var p = parsePublico(argv);
    if (window.ppToast) {
      window.ppToast(p.subtitulo ? p.texto + ' · ' + p.subtitulo : p.texto, tipoPp(p.tipo || tipoPorDefecto));
      return null;
    }
    return p;
  }

  function mostrarPublico(tipoPorDefecto, argv) {
    var p = delegar(argv, tipoPorDefecto);
    if (!p) return;
    crear(p.texto, p.subtitulo, p.tipo || tipoPorDefecto);
  }

  window.showMessage = function () {
    mostrarPublico('info', arguments);
  };

  window.showToast = function () {
    mostrarPublico('success', arguments);
  };
})();
