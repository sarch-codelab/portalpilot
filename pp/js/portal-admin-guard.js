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

  function tokenSubject(value) {
    try {
      const part = String(value || '').split('.')[1];
      if (!part) return '';
      return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).sub || '';
    } catch (e) {
      return '';
    }
  }

  async function validatePortalAdmin() {
    if (!token) return redirectToLogin();
    const id = localStorage.getItem('currentAccountId') || tokenSubject(token);
    if (!id) return redirectToLogin();
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return redirectToLogin();
      const user = await response.json();
      const role = String(user.rol || '').trim().toLowerCase();
      const isPortalPilotAdmin = ['root', 'root pp', 'superadmin'].includes(role);
      if (!isPortalPilotAdmin) return redirectToLogin();
      localStorage.setItem('currentAccountId', String(user.id || id));
      localStorage.setItem('userRole', role);
      if (user.tenant_code) localStorage.setItem('empresaCodigo', user.tenant_code);
    } catch (e) {
      return redirectToLogin();
    }
  }

  validatePortalAdmin();
})();
