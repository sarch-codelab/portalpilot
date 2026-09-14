// ─── PLAN GATE: Checks company plan and locks sidebar items ───
// Add data-min-plan="starter|business|enterprise" to sidebar links
//starter=free, business=pro, enterprise=enterprise

(function () {
  const PLAN_LEVELS = { starter: 0, free: 0, startup: 0, business: 1, pro: 1, enterprise: 2, corporativo: 2 };

  function getPlanLevel(plan) {
    return PLAN_LEVELS[(plan || '').toLowerCase()] ?? 0;
  }

  async function fetchPlan() {
    const token = localStorage.getItem('token');
    const empresaCodigo = localStorage.getItem('empresaCodigo');
    const userRole = (localStorage.getItem('userRole') || '').toLowerCase();
    // Owner/Root always gets everything
    if (!token) return 'starter';
    if (!empresaCodigo || empresaCodigo === 'ROOT' || userRole.includes('root') || userRole === 'owner') {
      return 'enterprise';
    }
    try {
      const res = await fetch('../api/tenants', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) return localStorage.getItem('empresaPlan') || 'starter';
      const tenants = await res.json();
      const mine = Array.isArray(tenants) ? tenants.find(t =>
        (t.codigo || '').toUpperCase() === empresaCodigo.toUpperCase()
      ) : null;
      const plan = (mine && mine.plan) || localStorage.getItem('empresaPlan') || 'starter';
      localStorage.setItem('empresaPlan', plan);
      return plan;
    } catch {
      return localStorage.getItem('empresaPlan') || 'starter';
    }
  }

  function lockSidebar(currentPlan) {
    // Todos los módulos quedan habilitados: se eliminan los candados de plan.
    document.querySelectorAll('[data-min-plan].plan-locked').forEach(el => {
      el.classList.remove('plan-locked');
      el.removeAttribute('title');
    });
  }

  function showPlanBadge(plan) {
    const name = { starter: 'Starter', free: 'Starter', business: 'Business', pro: 'Business', enterprise: 'Enterprise' }[plan] || 'Starter';
    const color = { starter: '#9ca3af', business: '#8b5cf6', enterprise: '#f59e0b' }[plan.toLowerCase()] || '#9ca3af';
    const badges = document.querySelectorAll('.plan-badge');
    badges.forEach(b => {
      b.textContent = name;
      b.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '44;margin-left:6px';
    });
  }

  function showUpgradeModal(feature, customMessage) {
    const message = customMessage || '"' + feature + '" requiere un plan superior. Actualiza tu plan para desbloquear esta función.';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:10000';
    overlay.innerHTML = '<div style="background:#0e0e1c;border:1px solid rgba(139,92,246,0.3);border-radius:18px;width:100%;max-width:400px;padding:32px;text-align:center">' +
      '<div style="width:64px;height:64px;border-radius:50%;background:rgba(139,92,246,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:28px;color:#8b5cf6"><i class="fas fa-lock"></i></div>' +
      '<h3 style="color:#fff;font-size:18px;font-weight:700;margin:0 0 8px">Función bloqueada</h3>' +
      '<p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 24px">' + message + '</p>' +
      '<div style="display:flex;gap:12px;justify-content:center">' +
      '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="padding:10px 20px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(139,92,246,0.2);color:#fff;font-size:13px;cursor:pointer">Cerrar</button>' +
      '<a href="../pay_plan.html" style="padding:10px 20px;border-radius:10px;background:#8b5cf6;color:#fff;font-size:13px;font-weight:600;text-decoration:none">Ver Planes</a>' +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  window.marcarSoloLectura = function (activo) {
    localStorage.setItem('soloLectura', activo ? '1' : '0');
    if (activo) injectReadOnlyBanner();
    else {
      const b = document.getElementById('ppReadOnlyBanner');
      if (b) { b.remove(); if (document.body.style.paddingTop === '42px') document.body.style.paddingTop = ''; }
    }
  };

  window.injectReadOnlyBanner = function () {
    if (document.getElementById('ppReadOnlyBanner')) return;
    const existing = ['.pp-read-only-banner', '#ppReadOnlyBanner'];
    // Siempre lo más alto posible
    const banner = document.createElement('div');
    banner.id = 'ppReadOnlyBanner';
    banner.className = 'pp-read-only-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:20000;background:linear-gradient(90deg,#dc2626,#ef4444);color:#fff;padding:10px 16px;text-align:center;font-weight:600;font-size:13px;line-height:1.5;font-family:"DM Sans",system-ui,sans-serif;box-shadow:0 4px 14px rgba(220,38,38,.35);display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap';
    banner.innerHTML = '<i class="fas fa-lock" style="font-size:13px"></i><span>Prueba vencida · Modo solo lectura: solo puedes consultar y exportar tus datos.</span>' +
      '<a href="../pay_plan.html" style="color:#fff;text-decoration:underline;font-weight:800">Renovar plan</a>';
    document.body.appendChild(banner);
    if (parseInt(document.body.style.paddingTop || '0', 10) < 42) document.body.style.paddingTop = '42px';
  };

  window.injectReadOnlyBannerHide = function () { window.marcarSoloLectura(false); };

  // Observador global de respuestas: si el backend devuelve 403 TRIAL_EXPIRED,
  // marcamos el modo solo lectura para toda la sesión web.
  (function installReadOnlyFetchWatcher() {
    if (window.__ppReadOnlyWatcherInstalled) return;
    window.__ppReadOnlyWatcherInstalled = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const res = await origFetch(input, init);
      if (res && res.status === 403 && res.headers) {
        try {
          const ct = (res.headers.get('content-type') || '');
          if (ct.includes('json')) {
            const clone = res.clone();
            const body = await clone.json();
            if (body && body.code === 'TRIAL_EXPIRED') {
              window.marcarSoloLectura(true);
            } else if (res.url && !res.ok && String(res.url).includes('/login')) {
              // mantener
            }
          }
        } catch (e) { /* no-op */ }
      }
      return res;
    };
  })();

// Skeleton helpers
  window.renderSkeletonRows = function (container, count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="skeleton-row"><div class="skeleton skeleton-avatar"></div><div class="skeleton-col"><div class="skeleton skeleton-text" style="width:' + (50 + Math.random() * 30) + '%"></div><div class="skeleton skeleton-text xs"></div></div><div class="skeleton skeleton-badge" style="margin-left:auto"></div></div>';
    }
    container.innerHTML = html;
  };

  window.renderSkeletonStats = function (container, count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div class="skeleton-stat"><div class="skeleton skeleton-stat-icon"></div><div class="skeleton-stat-info"><div class="skeleton skeleton-stat-value"></div><div class="skeleton skeleton-stat-label"></div></div></div>';
    }
    container.innerHTML = html;
  };

  window.renderSkeletonCards = function (container, count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px"><div class="skeleton" style="height:20px;width:40%;margin-bottom:12px"></div><div class="skeleton" style="height:14px;width:80%;margin-bottom:8px"></div><div class="skeleton" style="height:14px;width:60%"></div></div>';
    }
    container.innerHTML = html;
  };

  window.hideSkeletons = function () {
    document.querySelectorAll('.skeleton,.skeleton-row,.skeleton-stat,.skeleton-avatar,.skeleton-badge,.skeleton-text,.skeleton-col,.skeleton-stat-icon,.skeleton-stat-info,.skeleton-stat-value,.skeleton-stat-label').forEach(el => {
      const p = el.closest('[data-skeleton]');
      if (p) p.style.display = '';
    });
  };

  // Init
  window.addEventListener('DOMContentLoaded', async () => {
    const plan = await fetchPlan();
    window._currentPlan = plan;
    lockSidebar(plan);
    showPlanBadge(plan);
    const owner = (localStorage.getItem('empresaCodigo') || '').toUpperCase() === 'ROOT';
    const role = (localStorage.getItem('userRole') || '').toLowerCase();
    const readonly = localStorage.getItem('soloLectura') === '1';
    if (readonly && !owner && !(role.includes('root') || role === 'owner')) {
      injectReadOnlyBanner();
    }
  });
})();
