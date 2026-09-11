// Carga real de los miembros del tenant desde /api/users (pp/tenant_detail.html)
(function () {
    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function since(v) {
        if (!v) return 'Nunca';
        var d = new Date(v); if (isNaN(d)) return 'Nunca';
        var diff = Date.now() - d.getTime();
        if (diff < 60000) return 'Hace un momento';
        if (diff < 3600000) return 'Hace ' + Math.floor(diff / 60000) + ' min';
        if (diff < 86400000) return 'Hace ' + Math.floor(diff / 3600000) + ' h';
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    }

    window.loadTenantUsers = function () {
        var tbody = document.getElementById('usersTableBody');
        if (!tbody) return;
        var token = localStorage.getItem('token');
        var params = new URLSearchParams(window.location.search);
        var tenantId = params.get('id') || params.get('tenant') || localStorage.getItem('empresaCodigo') || '';
        var myCode = (localStorage.getItem('empresaCodigo') || '').toString().trim().toUpperCase();
        var isRoot = (myCode === 'ROOT' || myCode === 'ROOT PP' || myCode === '');

        fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + (token || '') } })
            .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
            .then(function (all) {
                var list = Array.isArray(all) ? all : [];
                if (isRoot && tenantId) {
                    list = list.filter(function (u) {
                        return String(u.tenant_code || u.empresa_codigo || '').toUpperCase() === String(tenantId).toUpperCase();
                    });
                }
                if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:24px;">Sin miembros registrados</td></tr>'; return; }
                tbody.innerHTML = '';
                list.forEach(function (u) {
                    var email = esc(u.email || '');
                    var full = esc(((u.nombre || email.split('@')[0] || 'Miembro') + ' ' + (u.apellido || '')).trim());
                    var initials = full.split(/\s+/).map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase() || '--';
                    var roleLabel = esc(u.rol || 'Empleado');
                    var roleClass = String(roleLabel).toLowerCase();
                    var last = since(u.lastActivity || u.last_login || u.ultimo_acceso || null);
                    var row = document.createElement('tr');
                    row.dataset.userName = full;
                    row.dataset.userEmail = email;
                    row.dataset.userRole = roleLabel;
                    row.dataset.userStatus = 'Activo';
                    row.innerHTML = '<td><div class="user-info-cell"><div class="user-avatar-sm">' + initials + '</div>' +
                        '<div><div class="user-name-cell">' + full + '</div><div class="user-email-cell">' + email + '</div></div></div></td>' +
                        '<td><span class="role-badge ' + roleClass + '">' + roleLabel + '</span></td>' +
                        '<td><span style="color:var(--green);font-size:12px;"><span class="status-dot" style="background:var(--green);"></span>Activo</span></td>' +
                        '<td>' + last + '</td>' +
                        '<td><button class="btn btn-ghost btn-xs" onclick="editUser(this)"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-xs" onclick="deleteUser(this)"><i class="fas fa-trash"></i></button></td>';
                    tbody.appendChild(row);
                });
            })
            .catch(function () { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray);padding:24px;">No se pudo cargar los miembros</td></tr>'; });
    };

    document.addEventListener('DOMContentLoaded', function () {
        if (window.loadTenantUsers) window.loadTenantUsers();
    });
})();