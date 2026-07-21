(function () {
  const role = (localStorage.getItem('userRole') || '').toString().trim().toLowerCase();
  const empresaCodigo = (localStorage.getItem('empresaCodigo') || '').toString().trim().toUpperCase();
  const token = localStorage.getItem('token');

  const isPortalPilotAdmin = Boolean(token) && (
    !empresaCodigo ||
    empresaCodigo === 'ROOT' ||
    ['root', 'root pp', 'superadmin', 'admin', 'administrador'].includes(role)
  );

  if (!isPortalPilotAdmin) {
    const redirectUrl = '../login.html';
    try {
      window.location.replace(redirectUrl);
    } catch (e) {
      window.location.href = redirectUrl;
    }
  }
})();
