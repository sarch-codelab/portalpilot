/**
 * pp/js/portal-admin-guard.js
 * Logica de portal-admin-guard: estado, eventos, renderizado y consumo de API.
 * Mantener separadas autenticacion, datos y presentacion. */

(function () {
  const token = localStorage.getItem('token');
  const redirectUrl = '../login.html';

  function redirectToLogin() {
    try {
      window.location.replace(redirectUrl);
    } catch (e) {
      window.location.href = redirectUrl;
    }
  }

  async function validatePortalAdmin() {
    if (!token) return redirectToLogin();
    try {
      // Este endpoint rehidrata el rol desde usuarios. /api/users/:id aplica
      // aislamiento de tenant y puede rechazar una cookie antigua antes de
      // que podamos reconocer a un administrador global.
      const response = await fetch('/api/session/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return redirectToLogin();
      const data = await response.json();
      const user = data.user || {};
      const role = String(user.rol || '').trim().toLowerCase();
      const isPortalPilotAdmin = ['root', 'root pp', 'superadmin'].includes(role);
      if (!isPortalPilotAdmin) return redirectToLogin();
      if (data.token) localStorage.setItem('token', data.token);
      if (user.id) localStorage.setItem('currentAccountId', String(user.id));
      localStorage.setItem('userRole', role);
      if (user.tenant_code) localStorage.setItem('empresaCodigo', user.tenant_code);
    } catch (e) {
      return redirectToLogin();
    }
  }

  validatePortalAdmin();
})();
