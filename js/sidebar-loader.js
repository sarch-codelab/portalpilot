// ═══ SIDEBAR LOADER COMPARTIDO ═══
// Incluir este script en todas las páginas con barra lateral.
// Funciona con avatar <img> o <div>, con o sin IDs; si no hay foto
// de perfil muestra las iniciales del nombre y apellido (nada de imágenes aleatorias).

(function() {
  function readUser() {
    const name = localStorage.getItem('userName') || 'Admin';
    const apellido = localStorage.getItem('userApellido') || '';
    const role = localStorage.getItem('userRole') || 'Administrador';
    const foto = localStorage.getItem('userFoto') || '';
    const fullName = apellido ? `${name} ${apellido}` : name;
    const initials = fullName.split(' ').filter(Boolean).map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'PP';
    return { name, apellido, role, foto, fullName, initials };
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
        el.textContent = '';
        el.style.backgroundImage = `url(${u.foto})`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.style.color = 'transparent';
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

  function renderSidebar() {
    const u = readUser();

    // Nombre y rol (con o sin IDs)
    document.querySelectorAll('#sidebarName, .profile-info .name, .sidebar-user .name').forEach(el => { el.textContent = u.fullName; });
    document.querySelectorAll('#sidebarRole, .profile-info .role, .sidebar-user .role').forEach(el => { el.textContent = u.role; });

    // Avatar (con o sin IDs; <img> o <div>)
    const avatars = document.querySelectorAll('#sidebarAvatar, .sidebar-avatar, .sidebar .avatar, .profile-section .avatar, .sidebar-user .avatar');
    avatars.forEach(el => renderAvatar(el, u));
  }

  window.renderSidebar = renderSidebar;
  window.refreshSidebarAvatar = renderSidebar;

  renderSidebar();

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