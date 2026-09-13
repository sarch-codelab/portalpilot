/* ── Badge + panel de notificaciones compartido ── */
(function () {
  var badge = document.querySelector('[data-notif-badge]');
  if (!badge) return;

  var token = localStorage.getItem('token');
  if (!token) { badge.style.display = 'none'; return; }

  var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API_ROOT = isLocalhost ? 'https://portal-pilot.vercel.app' : '';

  var notifs = [];
  var panel = null;
  var bell = badge.closest('button, [data-notif-trigger]') || badge.parentElement;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTime(iso) {
    if (!iso) return 'Recién';
    var d = new Date(iso);
    if (isNaN(d)) return 'Recién';
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Justo ahora';
    if (diff < 3600000) return 'Hace ' + Math.max(1, Math.floor(diff / 60000)) + ' min';
    if (diff < 86400000) return 'Hace ' + Math.floor(diff / 3600000) + ' h';
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
  }

  function actualizarBadge() {
    var unread = notifs.filter(function (n) { return !n.leida; }).length;
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  }

  function marcarLeida(id) {
    return fetch(API_ROOT + '/api/notificaciones/' + encodeURIComponent(id) + '/read', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function (r) { return r.ok; });
  }

  function render() {
    if (!panel) return;
    var list = document.getElementById('pp-notif-panel-list');
    if (!list) return;

    if (!notifs.length) {
      list.innerHTML = '<div class="ppnp-empty"><i class="fas fa-check-circle"></i><p>Sin notificaciones.<br>Todo al día.</p></div>';
      return;
    }

    var icono = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    var color = { success: '#30d158', error: '#ff453a', warning: '#ff9f0a', info: '#0a84ff' };

    list.innerHTML = notifs.slice(0, 20).map(function (n) {
      var ic = icono[n.tipo] || icono.info;
      var c = color[n.tipo] || color.info;
      return '<div class="ppnp-item' + (n.leida ? '' : ' unread') + '">' +
        '<div class="ppnp-ic" style="color:' + c + ';"><i class="fas ' + ic + '"></i></div>' +
        '<div class="ppnp-body">' +
          '<div class="ppnp-title">' + esc(n.titulo || 'Notificación') + '</div>' +
          (n.mensaje ? '<div class="ppnp-msg">' + esc(n.mensaje) + '</div>' : '') +
          '<div class="ppnp-time">' + fmtTime(n.created_at) + '</div>' +
        '</div>' +
        (n.leida ? '' : '<button class="ppnp-read" data-id="' + esc(n.id) + '" title="Marcar como leída"><i class="fas fa-check"></i></button>') +
      '</div>';
    }).join('') || '<div class="ppnp-empty"><i class="fas fa-check-circle"></i><p>Sin notificaciones.</p></div>';

    list.querySelectorAll('.ppnp-read').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.id;
        marcarLeida(id).then(function (ok) {
          if (!ok) return;
          notifs.forEach(function (n) { if (String(n.id) === String(id)) n.leida = true; });
          actualizarBadge();
          render();
        });
      });
    });
  }

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'pp-notif-panel-overlay';
    panel.innerHTML =
      '<div class="ppnp-panel">' +
        '<div class="ppnp-head">' +
          '<span><i class="fas fa-bell"></i> Notificaciones</span>' +
          '<button class="ppnp-close" title="Cerrar"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="ppnp-list" id="pp-notif-panel-list"></div>' +
        '<div class="ppnp-foot">' +
          '<button class="ppnp-markall">Marcar todas como leídas</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
    panel.querySelector('.ppnp-close').addEventListener('click', close);

    var markAll = panel.querySelector('.ppnp-markall');
    if (markAll) {
      markAll.addEventListener('click', function () {
        var pendientes = notifs.filter(function (n) { return !n.leida; });
        Promise.all(pendientes.map(function (n) {
          return marcarLeida(n.id).then(function (ok) {
            if (ok) n.leida = true;
          });
        })).then(function () {
          actualizarBadge();
          render();
        });
      });
    }
  }

  function open() {
    if (!panel) buildPanel();
    render();
    panel.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (bell) bell.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (panel && panel.classList.contains('active')) { close(); return; }
    open();
  });

  /* ══════ Cargar notificaciones ══════ */
  fetch(API_ROOT + '/api/notificaciones', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function (res) {
      if (!res.ok) throw new Error('notif error');
      return res.json();
    })
    .then(function (data) {
      notifs = data.notificaciones || [];
      actualizarBadge();
    })
    .catch(function () {
      badge.style.display = 'none';
    });
})();