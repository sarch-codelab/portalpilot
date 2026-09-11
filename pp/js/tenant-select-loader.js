// Puebla el select de tenants (#u-tenant) con datos reales de /api/tenants
(function () {
    function populate() {
        var sel = document.getElementById('u-tenant');
        if (!sel) return;
        var token = localStorage.getItem('token');
        fetch('/api/tenants', { headers: { 'Authorization': 'Bearer ' + (token || '') } })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (list) {
                if (!Array.isArray(list) || !list.length) return;
                while (sel.options.length > 1) sel.remove(1);
                list.forEach(function (t) {
                    var o = document.createElement('option');
                    o.value = t.codigo || t.id || '';
                    o.textContent = t.name || t.codigo || 'Empresa';
                    sel.appendChild(o);
                });
            })
            .catch(function () { /* sin cambios */ });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', populate);
    } else {
        populate();
    }
})();