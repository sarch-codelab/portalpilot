// Datos dinamicos de tenant_detail: usuarios, bots y extras del header.
(function () {
  function byId(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function initialsFrom(name) {
    var t = String(name || '').trim();
    return t.length ? t.split(/\s+/).map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase() : '—';
  }
  function lastLoginLabel(v) {
    if (!v) return 'Nunca';
    var d = new Date(v); if (isNaN(d)) return 'Nunca';
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return 'Hace un momento';
    if (diff < 3600000) return 'Hace ' + Math.floor(diff / 60000) + ' min';
    if (diff < 86400000) return 'Hace ' + Math.floor(diff / 3600000) + ' h';
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  var params = new URLSearchParams(window.location.search);
  var tenantId = params.get('id') || params.get('tenant') || localStorage.getItem('empresaCodigo') || '';
  var token = localStorage.getItem('token') || '';
  var headers = { 'Authorization': 'Bearer ' + token };
  var myCode = (localStorage.getItem('empresaCodigo') || '').toString().trim().toUpperCase();
  var isRoot = (myCode === 'ROOT' || myCode === 'ROOT PP' || myCode === '');

  // ── Usuarios del tenant ──
  function renderUsers(list) {
    var body = byId('tenantUsersBody');
    if (!body) return;
    var stat = byId('statUsers'); if (stat) stat.textContent = list.length;
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:24px;">Sin miembros registrados en este tenant</td></tr>'; return; }
    body.innerHTML = list.map(function (u) {
      var name = esc(((u.nombre || '') + ' ' + (u.apellido || '')).trim());
      var email = esc(u.email || '');
      var ini = initialsFrom(u.nombre || u.email || '');
      var rol = esc(u.rol || 'Empleado');
      var last = lastLoginLabel(u.lastActivity || u.last_login || u.ultimo_acceso || null);
      return '<tr>' +
        '<td><div class="user-info-cell"><div class="user-avatar-sm">' + ini + '</div><div><div class="user-name-cell">' + name + '</div><div class="user-email-cell">' + email + '</div></div></div></td>' +
        '<td><span class="role-badge ' + String(rol).toLowerCase() + '">' + rol + '</span></td>' +
        '<td><span style="color:var(--green);font-size:12px;"><i class="fas fa-circle" style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block;margin-right:4px;"></i>Activo</span></td>' +
        '<td>' + last + '</td>' +
        '<td><button class="btn btn-ghost btn-xs"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-xs"><i class="fas fa-trash"></i></button></td>' +
        '</tr>';
    }).join('');
  }
  function loadUsers() {
    var body = byId('tenantUsersBody');
    if (!body) return;
    fetch('/api/users', { headers: headers })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (all) {
        var list = Array.isArray(all) ? all : [];
        if (isRoot && tenantId) {
          list = list.filter(function (u) {
            return String(u.tenant_code || u.empresa_codigo || '').toUpperCase() === String(tenantId).toUpperCase();
          });
        }
        renderUsers(list);
      })
      .catch(function () { if (body) body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:24px;">No se pudo cargar los miembros</td></tr>'; });
  }

  // ── Bots de automatizacion (tenant actual) ──
  function loadBots() {
    var grid = byId('tenantBotsGrid');
    if (!grid) return;
    fetch('/api/automation', { headers: headers })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (data) {
        var bots = [];
        if (data && Array.isArray(data.bots)) bots = data.bots;
        else if (data && Array.isArray(data.rules)) bots = data.rules;
        var stat = byId('statBots'); if (stat) stat.textContent = bots.length;
        if (!bots.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--gray);padding:24px;">Sin automatizaciones registradas</div>'; return; }
        grid.innerHTML = bots.map(function (b) {
          var name = esc(b.nombre || b.name || 'Bot sin nombre');
          var desc = esc(b.descripcion || b.description || '');
          return '<div class="bot-card"><div class="bot-card-header"><div class="bot-icon"><i class="fas fa-robot"></i></div><span class="bot-status running"><i class="fas fa-play"></i> Activo</span></div><div class="bot-name">' + name + '</div><div class="bot-desc">' + desc + '</div></div>';
        }).join('');
      })
      .catch(function () { if (grid) grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--gray);padding:24px;">No hay datos de automatizacion disponibles</div>'; });
  }

  function refreshHeaderExtras() {
    var logo = byId('tenantLogo');
    var name = (byId('tenant-name') || {}).textContent || '';
    if (logo) logo.textContent = initialsFrom(name);
    var co = byId('settingsCompanyName');
    var dm = byId('settingsDomain');
    var tn = (byId('tenantNameDisplay') || {}).textContent || '';
    var td = (byId('tenant-domain') || {}).textContent || '';
    if (co && tn && tn !== 'Cargando...') co.value = tn;
    if (dm && td && td !== '...') dm.value = td;
  }

  document.addEventListener('DOMContentLoaded', function () {
    refreshHeaderExtras();
    loadUsers();
    loadBots();
  });
  window.addEventListener('load', refreshHeaderExtras);
})();