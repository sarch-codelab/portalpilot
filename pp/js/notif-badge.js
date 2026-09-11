/* ── Badge de notificaciones compartido ── */
(async function () {
  var badge = document.querySelector('[data-notif-badge]');
  if (!badge) return;
  var token = localStorage.getItem('token');
  if (!token) { badge.style.display = 'none'; return; }
  var isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API_ROOT = isLocalhost ? 'https://portal-pilot.vercel.app' : '';
  try {
    var res = await fetch(API_ROOT + '/api/notificaciones', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('notif error');
    var data = await res.json();
    var notifs = data.notificaciones || [];
    var unread = data.unread_count != null ? data.unread_count : notifs.filter(function (n) { return !n.leida; }).length;
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  } catch (e) {
    badge.style.display = 'none';
  }
})();