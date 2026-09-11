// Accesos recientes (empresa/security.html) desde la auditoria real
(function () {
    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function since(v) {
        if (!v) return 'Hace un momento';
        var d = new Date(v); if (isNaN(d)) return '';
        var diff = Date.now() - d.getTime();
        if (diff < 60000) return 'Hace un momento';
        if (diff < 3600000) return 'Hace ' + Math.floor(diff / 60000) + ' min';
        if (diff < 86400000) return 'Hace ' + Math.floor(diff / 3600000) + ' h';
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
    }
    function isBlocked(b) {
        var txt = ((b.type || '') + ' ' + (b.event || '')).toLowerCase();
        return /deneg|bloque|fallid|fail|prohibid|expir/.test(txt);
    }
    function render(list) {
        var wrap = document.getElementById('recentAccesses');
        if (!wrap) return;
        if (!list.length) { wrap.innerHTML = '<div class="access-item" style="grid-column:1/-1;"><div class="access-location">Sin eventos de acceso registrados</div></div>'; return; }
        wrap.innerHTML = list.map(function (b) {
            var ip = esc(b.ip || '');
            var blocked = isBlocked(b);
            var cls = blocked ? 'blocked' : 'allowed';
            var ic = blocked ? 'fa-ban' : 'fa-check-circle';
            var ipHtml = ip
                ? '<span class="access-ip ' + cls + '"><i class="fas ' + ic + '"></i> ' + ip + '</span>'
                : '<span class="access-ip remote"><i class="fas fa-laptop"></i> Acceso Remoto</span>';
            var location = blocked ? '<b>&#9888;&#65039; Evento: ' + esc(b.event || 'Acceso') + '</b>' : esc(b.event || 'Acceso registrado');
            var user = esc(b.usuario || 'Usuario del tenant');
            return '<div class="access-item">' + ipHtml +
                '<div class="access-location">' + location + '</div>' +
                '<div class="access-user">' + user + '</div>' +
                '<div class="access-time"><i class="fas fa-clock"></i> ' + since(b.fecha) + '</div></div>';
        }).join('');
    }
    function load() {
        var token = localStorage.getItem('token');
        fetch('/api/security/audit?limit=10', { headers: { 'Authorization': 'Bearer ' + (token || '') } })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (data) { render((data && Array.isArray(data.blocks)) ? data.blocks.slice(0, 5) : []); })
            .catch(function () {
                var wrap = document.getElementById('recentAccesses');
                if (wrap) wrap.innerHTML = '<div class="access-item" style="grid-column:1/-1;"><div class="access-location">No se pudo cargar la auditor&iacute;a</div></div>';
            });
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', load); } else { load(); }
})();