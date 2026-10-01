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
      const role = String(user.rol || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
      // La pertenencia al panel /pp la decide el servidor mediante
      // empresa_codigo === 'ROOT'. La lista de roles globales queda solo como
      // refuerzo para cuentas historicas: un Owner de tenant cuyo rol diga
      // "owner"/"admin" NUNCA debe entrar en /pp, y un admin ROOT guardado con
      // rol "admin" SÍ debe poder entrar.
      const empresa = String(user.empresa_codigo || user.tenant_code || '').trim().toUpperCase();
      const isPortalPilotAdmin = empresa === 'ROOT'
        || ['root', 'root pp', 'superadmin', 'super admin'].includes(role);
      if (!isPortalPilotAdmin) return redirectToLogin();
      if (data.token) localStorage.setItem('token', data.token);
      if (user.id) localStorage.setItem('currentAccountId', String(user.id));
      localStorage.setItem('userRole', role);
      if (empresa) localStorage.setItem('empresaCodigo', empresa);
    } catch (e) {
      return redirectToLogin();
    }
  }

  validatePortalAdmin();
})();
