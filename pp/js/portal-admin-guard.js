(function () {
  const role = (localStorage.getItem('userRole') || '').toString().trim().toLowerCase();
  const empresaCodigo = (localStorage.getItem('empresaCodigo') || '').toString().trim().toUpperCase();
  const token = localStorage.getItem('token');

  const esRoot = ['ROOT', 'ROOT PP'].includes(empresaCodigo);
  const esRolRoot = ['root', 'root pp', 'superadmin'].includes(role);
  const isPortalPilotAdmin = Boolean(token) && (!empresaCodigo || esRoot || esRolRoot);

  if (!isPortalPilotAdmin) {
    const redirectUrl = '../login.html';
    try {
      window.location.replace(redirectUrl);
    } catch (e) {
      window.location.href = redirectUrl;
    }
  }
})();
