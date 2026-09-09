/* EMPRESA — SIDEBAR ESTILO PORTAL (colapsar, dark mode, logout sin modal) */
(function () {
  var sidebar = document.getElementById('sidebar');
  var dashboard = document.querySelector('.dashboard');
  var toggleBtn = document.getElementById('toggleSidebar');

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function applySavedState() {
    if (!sidebar || !dashboard) return;
    var collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    var should = collapsed && !isMobile();
    sidebar.classList.toggle('collapsed', should);
    dashboard.classList.toggle('sidebar-collapsed', should);
  }

  if (toggleBtn && sidebar && dashboard) {
    toggleBtn.addEventListener('click', function () {
      if (isMobile()) {
        sidebar.classList.toggle('active');
      } else {
        sidebar.classList.toggle('collapsed');
        dashboard.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
      }
    });
    window.addEventListener('resize', applySavedState);
    applySavedState();
  }

  var darkModeBtn = document.getElementById('darkModeToggle');
  function renderThemeIcon(isLight) {
    if (darkModeBtn) {
      darkModeBtn.innerHTML = isLight
        ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
        : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
    }
  }
  function applyTheme(isLight) {
    document.body.classList.toggle('light-mode', isLight);
    renderThemeIcon(isLight);
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
    logoutBtn.addEventListener('click', function () {
      if (confirm('¿Cerrar sesión?')) {
        localStorage.clear();
        window.location.href = '/login.html';
      }
    });
  }
})();