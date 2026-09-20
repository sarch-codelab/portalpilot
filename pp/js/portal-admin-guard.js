/**
 * pp/js/portal-admin-guard.js
 * Logica de portal-admin-guard: estado, eventos, renderizado y consumo de API.
 * Mantener separadas autenticacion, datos y presentacion. */

(function () {
  const role = (localStorage.getItem('userRole') || '').toString().trim().toLowerCase();
  const empresaCodigo = (localStorage.getItem('empresaCodigo') || '').toString().trim().toUpperCase();
  const token = localStorage.getItem('token');

  const esRolRoot = ['root', 'root pp', 'superadmin'].includes(role);
  const isPortalPilotAdmin = Boolean(token) && esRolRoot;

  if (!isPortalPilotAdmin) {
    const redirectUrl = '../login.html';
    try {
      window.location.replace(redirectUrl);
    } catch (e) {
      window.location.href = redirectUrl;
    }
  }
})();
