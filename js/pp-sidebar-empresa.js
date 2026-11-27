/**
 * Sidebar compartido del portal de empresa (tenant).
 *
 * Mantiene el comportamiento de colapso, drawer móvil, modo claro/oscuro y
 * cierre de sesión sin inyectar enlaces administrativos de /pp/.
 */
(function () {
  var sidebar = document.getElementById('sidebar');
  var dashboard = document.querySelector('.dashboard');

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function drawerOpen() {
    return !!(sidebar && (sidebar.classList.contains('active') || sidebar.classList.contains('open')));
  }

  function setDrawer(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('active', open);
    sidebar.classList.remove('open');
    var ov = document.getElementById('overlay') || document.querySelector('.sidebar-overlay');
    if (ov) ov.classList.toggle('active', open);
    var hb = document.getElementById('hamburgerBtn') || document.querySelector('.hamburger-toggle');
    if (hb) hb.classList.toggle('active', open);
  }

  function toggleDesktopCollapse() {
    if (!sidebar || !dashboard) return;
    var collapsed = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', collapsed);
    dashboard.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false'); } catch (e) { /* noop */ }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var trig = t.closest('#toggleSidebar, #sidebarToggle, .sidebar-toggle, #hamburgerBtn, .hamburger-toggle');
    if (!trig) return;
    var isSidebarControl = trig.closest('#sidebar, .sidebar')
      || trig.id === 'hamburgerBtn'
      || trig.id === 'sidebarToggle'
      || trig.classList.contains('sidebar-toggle')
      || trig.classList.contains('hamburger-toggle');
    if (!isSidebarControl) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (isMobile()) setDrawer(!drawerOpen());
    else toggleDesktopCollapse();
  }, true);

  document.addEventListener('click', function (e) {
    if (!isMobile() || !drawerOpen()) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#sidebar, .sidebar, #toggleSidebar, #sidebarToggle, .sidebar-toggle, #hamburgerBtn, .hamburger-toggle')) return;
    setDrawer(false);
  });

  function applySavedState() {
    if (!sidebar || !dashboard) return;
    if (isMobile()) {
      setDrawer(false);
      sidebar.classList.remove('collapsed');
      dashboard.classList.remove('sidebar-collapsed');
    } else {
      setDrawer(false);
      var collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
      sidebar.classList.toggle('collapsed', collapsed);
      dashboard.classList.toggle('sidebar-collapsed', collapsed);
    }
  }

  window.addEventListener('resize', applySavedState);
  applySavedState();

  var darkModeBtn = document.getElementById('darkModeToggle');
  function applyTheme(isLight) {
    document.body.classList.toggle('light-mode', isLight);
    if (darkModeBtn) {
      darkModeBtn.innerHTML = isLight
        ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
        : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
    }
  }
  if (darkModeBtn) {
    darkModeBtn.addEventListener('click', function () {
      var light = !document.body.classList.contains('light-mode');
      localStorage.setItem('theme', light ? 'light' : 'dark');
      applyTheme(light);
    });
    applyTheme(localStorage.getItem('theme') === 'light');
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (confirm('¿Cerrar sesión?')) {
        if (window.PP && window.PP.logout) window.PP.logout('/login.html');
        else if (window.ppLogout) window.ppLogout('/login.html');
        else {
          localStorage.clear();
          window.location.href = '/login.html';
        }
      }
    });
  }
})();
