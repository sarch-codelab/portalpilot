/* ═══════════════════════════════════════════════════════════
   PORTAL PILOT — PORTAL JS COMPARTIDO (empresa/ + pp/)
   Autenticación, fetch API con errores consistentes, toasts,
   helpers de formato. Una sola fuente de verdad para portales.
   ═══════════════════════════════════════════════════════════ */
(function () {
  // Las páginas viven en /empresa/ o /pp/ → el backend está en ../api
  const API_ROOT = (typeof window.API_ROOT !== 'undefined' && window.API_ROOT) ? window.API_ROOT : '..';

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function authHeaders(extra) {
    return Object.assign({ 'Authorization': 'Bearer ' + getToken() }, extra || {});
  }

  // Fetch con errores consistentes: { status, data } en excepción tipada.
  async function apiFetch(url, options) {
    const opts = Object.assign({}, options || {});
    opts.headers = Object.assign(authHeaders(), (options && options.headers) || {});
    if (opts.body && !opts.headers['Content-Type'] && typeof opts.body === 'string') {
      opts.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(API_ROOT + url, opts);
    } catch (e) {
      const err = new Error('No hay conexión con el servidor.');
      err.status = 0;
      throw err;
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) { try { data = await res.json(); } catch (e) { data = null; } }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Error HTTP ' + res.status));
      err.status = res.status;
      err.code = data && data.code;
      err.data = data;
      // Trial vencido: banner global de solo lectura (plan-gate.js)
      if (err.code === 'TRIAL_EXPIRED' && window.marcarSoloLectura) window.marcarSoloLectura(true);
      throw err;
    }
    return data;
  }

  // ── Toast global ──
  window.ppToast = function (message, type) {
    const t = document.createElement('div');
    t.className = 'pp-toast ' + (type === 'err' ? 'err' : 'ok');
    t.innerHTML = '<i class="fas ' + (type === 'err' ? 'fa-exclamation-circle' : 'fa-check-circle') + '"></i><span></span>';
    t.querySelector('span').textContent = message;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3600);
  };

  // ── Formatters ──
  const fmtDate = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
  };
  const fmtMoney = function (n) {
    return 'L ' + (Number(n) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtNum = function (n) { return (Number(n) || 0).toLocaleString('es-HN'); };
  const escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  // Estado de consumo: normal / próximo / alcanzado / ilimitado (Bloque H)
  const usageState = function (usado, limite) {
    if (!limite || limite <= 0) return { cls: 'gray', label: 'Ilimitado', pct: null };
    const p = Math.min(100, Math.round((usado / limite) * 100));
    if (p >= 100) return { cls: 'red', label: 'Límite alcanzado', pct: 100 };
    if (p >= 80) return { cls: 'yellow', label: 'Próximo al límite', pct: p };
    return { cls: 'green', label: 'Normal', pct: p };
  };

  // ── Bootstrap: exige sesión; redirige al login si no hay token ──
  // (La protección real vive en el middleware del backend; esto solo evita
  //  renderizar páginas vacías sin datos.)
  function requireSession() {
    if (!getToken()) { window.location.replace('/login.html'); return false; }
    return true;
  }

  // ── Guardia de navegación: oculta links según rol del token ──
  // SOLO es cosmético: el backend revalida cada endpoint.
  function applyNavGuards() {
    let rol = '';
    try {
      const payload = JSON.parse(decodeURIComponent(atob(getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('') || '{}'));
      rol = String(payload.rol || '').toLowerCase();
    } catch (e) { /* noop */ }
    const esOwnerOrRoot = ['owner', 'root', 'root pp', 'superadmin', 'ceo'].includes(rol);
    document.querySelectorAll('[data-need-owner]').forEach(el => { if (!esOwnerOrRoot) el.style.display = 'none'; });
  }

  window.PP = {
    API_ROOT, getToken, authHeaders, apiFetch, requireSession,
    fmtDate, fmtDateTime, fmtMoney, fmtNum, escapeHtml, usageState, applyNavGuards
  };
  window.addEventListener('DOMContentLoaded', () => { requireSession(); applyNavGuards(); });
})();
