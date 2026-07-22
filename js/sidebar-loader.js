// ═══ SIDEBAR LOADER COMPARTIDO ═══
// Incluir este script en todas las páginas con barra lateral.
// Requiere que existan IDs: sidebarName, sidebarRole, sidebarAvatar

(function() {
  const name = localStorage.getItem('userName') || 'Admin';
  const apellido = localStorage.getItem('userApellido') || '';
  const role = localStorage.getItem('userRole') || 'Administrador';
  const email = localStorage.getItem('userEmail') || '';
  const foto = localStorage.getItem('userFoto') || '';
  const fullName = apellido ? `${name} ${apellido}` : name;
  const initials = fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  const sn = document.getElementById('sidebarName');
  const sr = document.getElementById('sidebarRole');
  const sa = document.getElementById('sidebarAvatar');

  if (sn) sn.textContent = fullName;
  if (sr) sr.textContent = role;

  if (sa) {
    if (foto) {
      // Si hay foto, mostrar imagen
      sa.textContent = '';
      sa.style.backgroundImage = `url(${foto})`;
      sa.style.backgroundSize = 'cover';
      sa.style.backgroundPosition = 'center';
      sa.style.color = 'transparent';
    } else {
      // Si no hay foto, mostrar iniciales
      sa.textContent = initials;
    }
  }

  // Hacer clic en el perfil → ir a perfil.html
  const sidebarUser = document.querySelector('.sidebar-user') || (sa && sa.parentElement);
  if (sidebarUser) {
    sidebarUser.style.cursor = 'pointer';
    sidebarUser.addEventListener('click', function() {
      window.location.href = 'perfil.html';
    });
  }
})();
