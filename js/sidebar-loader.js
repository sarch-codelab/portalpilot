/**
 * Hidratador de identidad para sidebars.
 *
 * Lee nombre, rol y foto desde localStorage y actualiza cualquier variante
 * histórica del markup de perfil. En rutas /pp/ también carga el renderer de
 * navegación compartido cuando una página antigua no lo declaró explícitamente.
 *
 * Este archivo no decide permisos ni genera enlaces: la autorización pertenece
 * a auth-check.js/backend y la navegación a pp/js/pp-sidebar.js.
 */

(function() {
  const BANNER_STYLE_ID = 'pp-sidebar-banner-style';
  if (!document.getElementById(BANNER_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = BANNER_STYLE_ID;
    style.textContent = `
      .profile-section.has-banner {
        position: relative;
        min-height: 92px;
        overflow: hidden;
        background-size: cover;
        background-position: center;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .profile-section.has-banner::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        background: linear-gradient(180deg, rgba(4,4,10,0.25), rgba(4,4,10,0.0) 45%, rgba(4,4,10,0.0) 55%, rgba(4,4,10,0.85));
      }
      .profile-section.has-banner > * {
        position: relative;
        z-index: 1;
      }
      .sidebar.collapsed .profile-section.has-banner {
        min-height: 64px;
      }
      @media (max-width: 900px) {
        .sidebar.collapsed .profile-section.has-banner {
          min-height: 92px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function readUser() {
    const name = localStorage.getItem('userName') || 'Admin';
    const apellido = localStorage.getItem('userApellido') || '';
    const role = localStorage.getItem('userRole') || 'Administrador';
    const foto = localStorage.getItem('userFoto') || '';
    const banner = localStorage.getItem('userBanner') || '';
    const fullName = apellido ? `${name} ${apellido}` : name;
    const initials = fullName.split(' ').filter(Boolean).map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'PP';
    return { name, apellido, role, foto, banner, fullName, initials };
  }

  function initialsDataUri(initials) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="#7c3aed"/><text x="50" y="53" text-anchor="middle" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#ffffff">${initials}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function renderAvatar(el, u) {
    if (!el) return;
    if (u.foto) {
      if (el.tagName === 'IMG') {
        el.onerror = function() { this.onerror = null; this.src = initialsDataUri(u.initials); };
        el.src = u.foto;
        el.alt = u.fullName;
      } else {
        var setFoto = function () {
          el.textContent = '';
          el.style.backgroundImage = 'url("' + u.foto + '")';
          el.style.backgroundSize = 'cover';
          el.style.backgroundPosition = 'center';
          el.style.color = 'transparent';
        };
        var setFallback = function () {
          el.style.backgroundImage = 'none';
          el.style.color = '';
          el.textContent = u.initials;
        };
        var probe = new Image();
        probe.onload = setFoto;
        probe.onerror = setFallback;
        probe.src = u.foto;
        setFoto();
      }
    } else {
      if (el.tagName === 'IMG') {
        el.onerror = null;
        el.src = initialsDataUri(u.initials);
        el.alt = u.fullName;
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = u.initials;
      }
    }
  }

  function renderProfileBanner(el, u) {
    if (!el) return;
    if (u.banner) {
      const setBanner = function () {
        el.classList.add('has-banner');
        el.style.backgroundImage = 'url("' + u.banner + '")';
      };
      const probe = new Image();
      probe.onload = setBanner;
      probe.onerror = function () {
        el.classList.remove('has-banner');
        el.style.backgroundImage = 'none';
      };
      probe.src = u.banner;
    } else {
      el.classList.remove('has-banner');
      el.style.backgroundImage = 'none';
    }
  }

  function renderSidebar() {
    const u = readUser();

    // Nombre y rol (con o sin IDs)
    document.querySelectorAll('#sidebarName, .profile-info .name, .sidebar-user .name').forEach(el => { el.textContent = u.fullName; });
    document.querySelectorAll('#sidebarRole, .profile-info .role, .sidebar-user .role').forEach(el => { el.textContent = u.role; });

    // Avatar (con o sin IDs; <img> o <div>)
    const avatars = document.querySelectorAll('#sidebarAvatar, .sidebar-avatar, .sidebar .avatar, .profile-section .avatar, .sidebar-user .avatar');
    avatars.forEach(el => renderAvatar(el, u));

    // Banner como fondo de la sección de perfil (detrás de la foto)
    document.querySelectorAll('.profile-section, .sidebar-user').forEach(el => renderProfileBanner(el, u));
  }

  window.renderSidebar = renderSidebar;
  window.refreshSidebarAvatar = renderSidebar;

  renderSidebar();

  // Older PP pages do not declare the shared sidebar script yet.
  if (window.location.pathname.startsWith('/pp/') && !document.querySelector('script[src*="pp-sidebar.js"]')) {
    const sharedSidebar = document.createElement('script');
    sharedSidebar.src = '/pp/js/pp-sidebar.js';
    document.head.appendChild(sharedSidebar);
  }

  // Hacer clic en el perfil → ir a perfil.html
  const clickTarget = document.querySelector('.profile-section, .sidebar-user') || null;
  if (clickTarget) {
    clickTarget.style.cursor = 'pointer';
    clickTarget.addEventListener('click', function(e) {
      const link = clickTarget.closest('a');
      if (link) return; // ya es un enlace
      e.preventDefault();
      window.location.href = 'perfil.html';
    });
  }
})();