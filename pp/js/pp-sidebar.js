/**
 * Sidebar compartido del portal administrativo.
 *
 * Responsabilidades:
 * - Inyectar el estilo canónico de la sidebar en páginas PP antiguas y nuevas.
 * - Renderizar grupos, enlaces y estado activo desde una sola definición.
 * - Colapso global con #toggleSidebar persistido en localStorage.sidebarCollapsed.
 * - Grupos colapsables con chevron, persistidos en localStorage.ppSidebarGroups.
 * - Dark mode centralizado y persistido (theme / darkMode).
 * - Logout: abre #logoutModal si existe; si no, cierra sesión directamente.
 *
 * Contrato HTML: necesita #sidebarNav (o .sidebar-nav) dentro de #sidebar y
 * #dashboard. Cada pieza es opcional y se guarda con null-checks.
 * Se salta el binding del toggle en páginas que ya definen window.toggleSidebar
 * (billing_plans.html, global_settings.html) para no duplicar eventos.
 */
(function () {
  const SIDEBAR_STYLE_ID = 'pp-sidebar-shared-style';
  if (!document.getElementById(SIDEBAR_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = SIDEBAR_STYLE_ID;
    style.textContent = `
      .dashboard {
        grid-template-columns: 260px minmax(0, 1fr) !important;
      }
      .dashboard.sidebar-collapsed {
        grid-template-columns: 72px minmax(0, 1fr) !important;
      }
      .sidebar {
        width: 260px !important;
        min-width: 260px !important;
        padding: 20px 16px !important;
        left: -260px !important;
        right: auto !important;
      }
      .sidebar.collapsed {
        width: 72px !important;
        min-width: 72px !important;
        padding: 20px 8px !important;
      }
      .sidebar.active,
      .sidebar.open {
        left: 0 !important;
        right: auto !important;
      }
      .sidebar-header {
        min-height: 24px;
        margin-bottom: 16px !important;
      }
      .sidebar-nav {
        gap: 6px !important;
        overflow-y: auto;
      }
      .pp-nav-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .pp-nav-group + .pp-nav-group {
        margin-top: 12px;
      }
      .pp-nav-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 0 10px 4px;
        color: var(--gray2, #9ca3af);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        transition: opacity 0.2s;
      }
      .pp-nav-title:hover {
        opacity: 1;
      }
      .pp-nav-title .pp-nav-chevron {
        font-size: 10px;
        opacity: 0.55;
        transition: transform 0.25s ease;
      }
      .pp-nav-group.collapsed .pp-nav-title .pp-nav-chevron {
        transform: rotate(-90deg);
      }
      .pp-nav-group.collapsed .sidebar-link {
        display: none;
      }
      .sidebar-link {
        min-height: 40px;
        padding: 11px 14px !important;
      }
      .sidebar-link.active {
        padding-left: 12px !important;
      }
      .sidebar.collapsed .logo,
      .sidebar.collapsed .profile-info,
      .sidebar.collapsed .sidebar-link span,
      .sidebar.collapsed .footer-btn span,
      .sidebar.collapsed .pp-nav-title {
        display: none !important;
      }
      .sidebar.collapsed .sidebar-link {
        justify-content: center;
        padding: 11px !important;
      }
      .sidebar.collapsed .sidebar-link.active {
        padding-left: 11px !important;
        border-left: 0;
        border-bottom: 2px solid var(--accent, #8b5cf6);
      }
      .sidebar.collapsed .pp-nav-group + .pp-nav-group {
        margin-top: 8px;
      }
      .sidebar.collapsed .footer-btn {
        justify-content: center;
        padding: 11px !important;
      }
      @media (max-width: 900px) {
        .dashboard {
          grid-template-columns: 1fr !important;
        }
        .sidebar,
        .sidebar.collapsed {
          position: fixed;
          top: 0;
          width: 260px !important;
          min-width: 260px !important;
          height: 100vh;
          padding: 20px 16px !important;
          z-index: 1000;
          transition: left 0.3s ease;
        }
        .toggle-btn {
          right: -40px !important;
        }
        .sidebar.collapsed .logo,
        .sidebar.collapsed .profile-info,
        .sidebar.collapsed .sidebar-link span,
        .sidebar.collapsed .footer-btn span,
        .sidebar.collapsed .pp-nav-title {
          display: block !important;
        }
        .sidebar.collapsed .sidebar-link {
          justify-content: flex-start;
          padding: 11px 14px !important;
        }
        .sidebar.collapsed .sidebar-link.active {
          padding-left: 12px !important;
          border-left: 2px solid var(--accent, #8b5cf6);
          border-bottom: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const GRUPOS = [
    {
      titulo: 'Supervisión', items: [
        { href: 'dashboard.html', icon: 'fa-gauge', label: 'Dashboard' },
        { href: 'tenants.html', icon: 'fa-building', label: 'Tenants' },
        { href: 'tenant_detail.html', icon: 'fa-magnifying-glass-chart', label: 'Detalle tenant', oculto: true },
        { href: 'bot_detail.html', icon: 'fa-robot', label: 'Detalle bot', oculto: true },
        { href: 'alertas.html', icon: 'fa-bell', label: 'Alertas' },
        { href: 'logs_realtime.html', icon: 'fa-tower-broadcast', label: 'Logs en vivo' },
        { href: 'incidentes_tenant.html', icon: 'fa-triangle-exclamation', label: 'Incidencias' }
      ]
    },
    {
      titulo: 'Operación', items: [
        { href: 'tickets_soporte.html', icon: 'fa-life-ring', label: 'Soporte' },
        { href: 'bots_rpa.html', icon: 'fa-gears', label: 'Bots RPA' },
        { href: 'integraciones.html', icon: 'fa-plug', label: 'Integraciones' },
        { href: 'provisionar_tenant.html', icon: 'fa-user-plus', label: 'Provisionar' },
        { href: 'validacion_tenant.html', icon: 'fa-file-shield', label: 'Validación KYC' }
      ]
    },
    {
      titulo: 'Finanzas', items: [
        { href: 'finanzas.html', icon: 'fa-chart-line', label: 'Finanzas' },
        { href: 'billing_plans.html', icon: 'fa-credit-card', label: 'Billing & Planes' },
        { href: 'renovaciones.html', icon: 'fa-calendar-check', label: 'Renovaciones' },
        { href: 'facturas_cliente.html', icon: 'fa-file-invoice-dollar', label: 'Cuenta corriente' },
        { href: 'consumo_ia.html', icon: 'fa-brain', label: 'Consumo IA' },
        { href: 'consumo_planes.html', icon: 'fa-arrows-up-to-line', label: 'Uso vs. Plan' },
        { href: 'reportes.html', icon: 'fa-file-export', label: 'Reportes' }
      ]
    },
    {
      titulo: 'Seguridad', items: [
        { href: 'seguridad_accesos.html', icon: 'fa-shield-halved', label: 'Sesiones y accesos' },
        { href: 'respaldos_y_rotacion.html', icon: 'fa-arrows-rotate', label: 'Respaldos y rotación' },
        { href: 'reglas_alertas.html', icon: 'fa-sliders', label: 'Reglas de alertas' }
      ]
    },
    {
      titulo: 'Sistema', items: [
        { href: 'auditoria.html', icon: 'fa-link', label: 'Auditoría' },
        { href: 'analytics.html', icon: 'fa-chart-simple', label: 'Analytics' },
        { href: 'comunicados.html', icon: 'fa-bullhorn', label: 'Comunicados' },
        { href: 'system_health.html', icon: 'fa-heartbeat', label: 'System Health' },
        { href: 'usuarios.html', icon: 'fa-users', label: 'Usuarios' },
        { href: 'global_settings.html', icon: 'fa-cog', label: 'Configuración Global' },
        { href: 'perfil.html', icon: 'fa-user', label: 'Mi perfil', oculto: true }
      ]
    }
  ];

  function paginaActual() {
    const f = (window.location.pathname.split('/').pop() || 'dashboard.html').replace(/\.html$/i, '');
    return f.toLowerCase();
  }

  function readCollapsedGroups() {
    try {
      const v = JSON.parse(localStorage.getItem('ppSidebarGroups') || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function saveCollapsedGroups(list) {
    try {
      localStorage.setItem('ppSidebarGroups', JSON.stringify(list));
    } catch (e) { /* noop */ }
  }

  function toggleGroupCollapsible(group) {
    const title = group.querySelector('.pp-nav-title');
    const titulo = title ? title.getAttribute('data-titulo') : group.getAttribute('data-titulo');
    if (!titulo) return;
    group.classList.toggle('collapsed');
    const list = readCollapsedGroups();
    const idx = list.indexOf(titulo);
    if (group.classList.contains('collapsed')) {
      if (idx < 0) list.push(titulo);
    } else if (idx >= 0) {
      list.splice(idx, 1);
    }
    saveCollapsedGroups(list);
  }

  function render() {
    const nav = document.getElementById('sidebarNav') || document.querySelector('.sidebar-nav');
    if (!nav) return;
    const actual = paginaActual();
    const collapsedList = readCollapsedGroups();
    nav.innerHTML = GRUPOS.map(g => {
      const items = g.items.filter(i => !i.oculto || i.href.replace('.html', '') === actual);
      if (!items.length) return '';
      const hasActive = items.some(i => i.href.replace('.html', '') === actual);
      const isCollapsed = collapsedList.indexOf(g.titulo) >= 0 && !hasActive;
      return `<div class="pp-nav-group${isCollapsed ? ' collapsed' : ''}" data-titulo="${g.titulo}">
        <div class="pp-nav-title" data-titulo="${g.titulo}" title="Cerrar sección">
          <span>${g.titulo}</span><i class="fas fa-chevron-down pp-nav-chevron"></i>
        </div>
        ${items.map(i => `<a href="${i.href}" class="sidebar-link ${i.href.replace('.html', '') === actual ? 'active' : ''}"><i class="fas ${i.icon}"></i> <span>${i.label}</span></a>`).join('')}
      </div>`;
    }).join('');

    nav.addEventListener('click', (e) => {
      const title = e.target.closest('.pp-nav-title');
      if (title) {
        const group = title.closest('.pp-nav-group');
        if (group) toggleGroupCollapsible(group);
        return;
      }
      if (innerWidth <= 900) {
        if (e.target.closest('.sidebar-link')) closeDrawer();
      }
    });
  }

  // ── Colapso global + móvil ──────────────────────────────
  function isMobile() {
    return window.innerWidth <= 900;
  }

  // ── Drawer móvil: un único mecanismo canónico (clase .active) ──
  // También se limpia .open (usado por código inline antiguo / hamburguesa).
  function drawerOpen() {
    const sb = document.getElementById('sidebar');
    return !!(sb && (sb.classList.contains('active') || sb.classList.contains('open')));
  }

  function setDrawer(open) {
    const sb = document.getElementById('sidebar');
    if (!sb) return;
    sb.classList.toggle('active', open);
    sb.classList.remove('open');
    const ov = document.getElementById('overlay');
    if (ov) ov.classList.toggle('active', open);
    const ov2 = document.querySelector('.sidebar-overlay');
    if (ov2) ov2.classList.toggle('active', open);
    const hb = document.getElementById('hamburgerBtn') || document.querySelector('.hamburger-toggle');
    if (hb) hb.classList.toggle('active', open);
    // Posición inline garantizada en móvil: vence a cualquier regla de
    // página (y al retraso del recálculo de estilo con el hilo principal
    // ocupado) de forma determinista. En escritorio se libera en applyLayout.
    if (isMobile()) sb.style.left = open ? '0px' : '-260px';
  }

  function closeDrawer() { setDrawer(false); }

  function toggleDrawer() { setDrawer(!drawerOpen()); }

  function toggleDesktopCollapse() {
    const sb = document.getElementById('sidebar');
    const dash = document.getElementById('dashboard');
    if (!sb || !dash) return;
    const collapsed = !sb.classList.contains('collapsed');
    sb.classList.toggle('collapsed', collapsed);
    dash.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false'); } catch (e) { /* noop */ }
  }

  // Un único manejador en fase de captura: corre ANTES que cualquier
  // onclick inline o binding de página, evitando el doble binding de
  // #toggleSidebar (usuarios, fleet, security, perfil) y la coexistencia
  // de dos mecanismos (.open del hamburguesa + .active del chevron).
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const trig = t.closest('#toggleSidebar, #sidebarToggle, .sidebar-toggle, #hamburgerBtn, .hamburger-toggle');
    if (!trig) return;
    const isSidebarControl = trig.closest('#sidebar, .sidebar')
      || trig.id === 'hamburgerBtn'
      || trig.id === 'sidebarToggle'
      || trig.classList.contains('sidebar-toggle')
      || trig.classList.contains('hamburger-toggle');
    if (!isSidebarControl) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isMobile()) toggleDrawer();
    else toggleDesktopCollapse();
  }, true);

  // Cerrar el drawer móvil al hacer clic fuera
  document.addEventListener('click', function (e) {
    if (!isMobile() || !drawerOpen()) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#sidebar, .sidebar, #toggleSidebar, #sidebarToggle, .sidebar-toggle, #hamburgerBtn, .hamburger-toggle')) return;
    closeDrawer();
  });

  // API pública para páginas que llaman toggleSidebarMobile()/toggleSidebar()
  window.ppCloseSidebar = function () { closeDrawer(); };
  window.ppOpenSidebar = function () { setDrawer(true); };
  window.ppToggleSidebar = function () { toggleDrawer(); };

  function setupCollapse() {
    const sidebar = document.getElementById('sidebar');
    const dashboard = document.getElementById('dashboard');
    const overlay = document.getElementById('overlay');
    if (!sidebar || !dashboard) return;

    function applyLayout() {
      if (isMobile()) {
        sidebar.classList.remove('collapsed');
        dashboard.classList.remove('sidebar-collapsed');
      } else {
        sidebar.style.left = ''; // libera la posición inline del drawer móvil
        closeDrawer(); // limpia active/open + overlay + hamburguesa
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        sidebar.classList.toggle('collapsed', collapsed);
        dashboard.classList.toggle('sidebar-collapsed', collapsed);
      }
    }

    if (overlay) overlay.addEventListener('click', closeDrawer);

    window.addEventListener('resize', applyLayout);
    applyLayout();
  }

  // ── Dark mode ───────────────────────────────────────────
  function setupTheme() {
    const darkModeBtn = document.getElementById('darkModeToggle');
    function renderIcon(isLight) {
      if (!darkModeBtn) return;
      darkModeBtn.innerHTML = isLight
        ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
        : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
    }
    function applyTheme(isLight) {
      document.body.classList.toggle('light-mode', isLight);
      renderIcon(isLight);
    }
    const saved = localStorage.getItem('theme')
      || (localStorage.getItem('darkMode') === 'light' ? 'light' : 'dark');
    applyTheme(saved === 'light');
    if (darkModeBtn) {
      darkModeBtn.addEventListener('click', () => {
        const isLight = !document.body.classList.contains('light-mode');
        applyTheme(isLight);
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        localStorage.setItem('darkMode', isLight ? 'light' : 'dark');
      });
    }
  }

  // ── Logout ──────────────────────────────────────────────
  function setupLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    const logoutModal = document.getElementById('logoutModal');
    if (!logoutBtn) return;

    function doLogout() {
      try { localStorage.clear(); } catch (e) { /* noop */ }
      try { sessionStorage.clear(); } catch (e) { /* noop */ }
      window.location.href = '/login.html';
    }

    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (logoutModal) logoutModal.classList.add('active');
      else doLogout();
    });

    if (logoutModal) {
      const modalCancel = document.getElementById('modalCancel');
      const modalConfirm = document.getElementById('modalConfirm');
      if (modalCancel) modalCancel.addEventListener('click', () => logoutModal.classList.remove('active'));
      if (modalConfirm) modalConfirm.addEventListener('click', doLogout);
      logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) logoutModal.classList.remove('active');
      });
    }
  }

  render();
  // Páginas que ya definen window.toggleSidebar (billing_plans, global_settings)
  // gestionan su propia sidebar (móvil). No duplicamos eventos.
  if (typeof window.toggleSidebar !== 'function') setupCollapse();
  setupTheme();
  setupLogout();
})();