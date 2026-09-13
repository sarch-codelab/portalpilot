// ── Panel de notificaciones (campana) ─────────────────────────────
// Busca todos los botones de campana (.topbar-btn con .fa-bell), les
// coloca el contador real de no leídas y despliega el panel de
// notificaciones usando el CSS ya definido en css/notifications.css.
(function () {
  'use strict';
  if (window.ppNotifPanel) return;
  window.ppNotifPanel = true;

  var TOKEN_KEY = 'token';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function apiFetch(url, options) {
    var token = getToken();
    var headers = Object.assign({}, (options && options.headers) || {}, token ? { 'Authorization': 'Bearer ' + token } : {});
    return fetch(url, Object.assign({}, options, { headers: headers }));
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      var now = new Date();
      if (isNaN(d.getTime())) return '';
      var seg = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
      if (seg < 60) return 'Ahora';
      if (seg < 3600) return 'Hace ' + Math.floor(seg / 60) + ' min';
      if (seg < 86400) return 'Hace ' + Math.floor(seg / 3600) + ' h';
      if (seg < 172800) return 'Ayer';
      if (seg < 604800) return 'Hace ' + Math.floor(seg / 86400) + ' días';
      return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return ''; }
  }

  function iconFor(tipo, prioridad) {
    var icons = {
      'sistema': 'fa-cog',
      'alert': 'fa-exclamation-triangle',
      'advertencia': 'fa-exclamation-triangle',
      'security': 'fa-shield-halved',
      'seguridad': 'fa-shield-halved',
      'factura': 'fa-file-invoice-dollar',
      'billing': 'fa-credit-card',
      'usuario': 'fa-users',
      'bot': 'fa-robot',
      'automation': 'fa-robot',
      'info': 'fa-info-circle',
      'success': 'fa-check-circle',
      'error': 'fa-times-circle'
    };
    var c = icons[tipo] || (prioridad === 'alta' ? 'fa-exclamation-triangle' : 'fa-info-circle');
    var color = prioridad === 'alta' ? '#ff453a' : (prioridad === 'media' ? '#ffd60a' : '#8b5cf6');
    return '<span class="ppnp-ic" style="color:' + color + ';"><i class="fas ' + c + '"></i></span>';
  }

  var state = { notifs: [], unread: 0 };

  function buildPanel() {
    if (document.getElementById('pp-notif-panel-overlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'pp-notif-panel-overlay';
    overlay.innerHTML = '' +
      '<div class="ppnp-panel">' +
      '  <div class="ppnp-head"><span><i class="fas fa-bell"></i>Notificaciones</span>' +
      '    <button class="ppnp-close" aria-label="Cerrar"><i class="fas fa-times"></i></button></div>' +
      '  <div class="ppnp-list"></div>' +
      '  <div class="ppnp-foot"><button class="ppnp-markall"><i class="fas fa-check-double"></i> Marcar todas como leídas</button></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePanel();
    });
    overlay.querySelector('.ppnp-close').addEventListener('click', closePanel);
    overlay.querySelector('.ppnp-markall').addEventListener('click', markAllRead);
  }

  var overlayEl = null;
  function panel() { buildPanel(); return document.getElementById('pp-notif-panel-overlay'); }
  function listEl() { return panel().querySelector('.ppnp-list'); }

  function openPanel() {
    var p = panel();
    p.classList.add('active');
    render();
  }
  function closePanel() {
    var p = document.getElementById('pp-notif-panel-overlay');
    if (p) p.classList.remove('active');
  }

  function updateBadges() {
    document.querySelectorAll('.topbar-btn .fa-bell').forEach(function (bell) {
      var btn = bell.closest('.topbar-btn');
      if (!btn) return;
      var badge = btn.querySelector('.badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        btn.appendChild(badge);
      }
      if (state.unread > 0) {
        badge.textContent = state.unread > 99 ? '99+' : state.unread;
        badge.style.display = '';
      } else {
        badge.textContent = '0';
        badge.style.display = 'none';
      }
    });
  }

  function bindBells() {
    document.querySelectorAll('.topbar-btn').forEach(function (btn) {
      if (!btn.querySelector('.fa-bell')) return;
      if (btn.dataset.ppnpBound) return;
      btn.dataset.ppnpBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (panel().classList.contains('active')) closePanel();
        else openPanel();
      });
    });
  }

  function render() {
    var list = listEl();
    var markBtn = panel().querySelector('.ppnp-markall');
    if (markBtn) markBtn.style.display = state.notifs.length ? '' : 'none';
    list.innerHTML = '';

    if (!getToken()) {
      list.innerHTML = '<div class="ppnp-empty"><i class="fas fa-lock"></i>Inicia sesión para ver tus notificaciones.</div>';
      return;
    }
    if (!state.notifs.length) {
      list.innerHTML = '<div class="ppnp-empty"><i class="fas fa-bell-slash"></i>No tienes notificaciones.</div>';
      return;
    }

    state.notifs.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'ppnp-item' + (n.leida ? '' : ' unread');
      item.dataset.pid = String(n.id);
      item.innerHTML = iconFor(n.tipo, n.prioridad) +
        '<div class="ppnp-body">' +
        '  <div class="ppnp-title">' + (n.titulo || 'Notificación') + '</div>' +
        '  <div class="ppnp-msg">' + (n.mensaje || '') + '</div>' +
        '  <div class="ppnp-time">' + fmtTime(n.created_at) + '</div>' +
        '</div>' +
        (n.leida ? '' : '<button class="ppnp-read" title="Marcar como leída"><i class="fas fa-check"></i></button>');

      var readBtn = item.querySelector('.ppnp-read');
      if (readBtn) {
        readBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          markRead(n.id);
        });
      }
      item.addEventListener('click', function () {
        if (!n.leida) markRead(n.id);
        closePanel();
      });
      item.addEventListener('mouseenter', function () { item.style.cursor = 'pointer'; });
      list.appendChild(item);
    });
  }

  async function markRead(id) {
    try {
      var res = await apiFetch('/api/notificaciones/' + encodeURIComponent(id) + '/read', { method: 'PUT' });
      if (!res.ok) { var e = await res.json(); throw new Error(e.error || 'Error'); }
      state.notifs.forEach(function (n) {
        if (String(n.id) === String(id)) { n.leida = true; if (state.unread > 0) state.unread--; }
      });
      updateBadges();
      render();
    } catch (err) {
      if (window.showToast) showToast('Error: ' + err.message, 'error');
    }
  }

  async function markAllRead() {
    var unread = state.notifs.filter(function (n) { return !n.leida; });
    if (!unread.length) return;
    try {
      await Promise.all(unread.map(function (n) {
        return apiFetch('/api/notificaciones/' + encodeURIComponent(n.id) + '/read', { method: 'PUT' });
      }));
      state.notifs.forEach(function (n) { n.leida = true; });
      state.unread = 0;
      updateBadges();
      render();
      if (window.showToast) showToast('Todas las notificaciones marcadas como leídas', 'success');
    } catch (err) {
      if (window.showToast) showToast('Error: ' + err.message, 'error');
    }
  }

  async function load() {
    if (!getToken()) { updateBadges(); return; }
    try {
      var res = await apiFetch('/api/notificaciones');
      if (!res.ok) throw new Error((await res.json()).error || 'Error');
      var data = await res.json();
      state.notifs = data.notificaciones || [];
      state.unread = (typeof data.unread_count === 'number' ? data.unread_count : state.notifs.filter(function (n) { return !n.leida; }).length);
      updateBadges();
      if (panel().classList.contains('active')) render();
    } catch (err) {
      console.warn('[notif-panel]', err.message);
    }
  }

  function init() {
    bindBells();
    updateBadges();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Re-escanea por si el sidebar/HTML cargó campanas de forma dinámica
  window.addEventListener('load', function () { bindBells(); });
})();