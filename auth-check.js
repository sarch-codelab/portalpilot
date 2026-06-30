// ─── AUTHENTICATION CHECK & PROFILE POPULATION ───

(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const queryToken = urlParams.get('token');
  if (queryToken) {
    // Remove any token passed via URL to avoid leakage in referers or logs.
    if (window.history && window.history.replaceState) {
      urlParams.delete('token');
      const cleanUrl = `${window.location.origin}${window.location.pathname}${urlParams.toString() ? '?' + urlParams.toString() : ''}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
    // Do NOT persist tokens coming from URL. Require secure auth flow to set localStorage token.
  }
  const token = localStorage.getItem('token');
  // Si tenemos token pero faltan datos de sesión importantes, intentar decodificar el JWT
  if (token) {
    try {
      const base64Url = token.split('.')[1] || '';
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const payload = JSON.parse(jsonPayload || '{}');
      // Poblar valores útiles si no están definidos
      if (!localStorage.getItem('currentAccountId') && payload.sub) {
        localStorage.setItem('currentAccountId', payload.sub.toString());
      }
      if (!localStorage.getItem('userRole') && payload.rol) {
        localStorage.setItem('userRole', payload.rol.toString());
      }
      if (!localStorage.getItem('empresaCodigo') && payload.empresa_codigo) {
        localStorage.setItem('empresaCodigo', payload.empresa_codigo.toString());
      }
      if (!localStorage.getItem('empresaNombre') && payload.empresa_nombre) {
        localStorage.setItem('empresaNombre', payload.empresa_nombre.toString());
      }
    } catch (e) {
      // No bloquear si el token no es decodificable
    }
  }
  const userRole = localStorage.getItem('userRole');
  const userName = localStorage.getItem('userName');
  const userEmail = localStorage.getItem('userEmail');
  const empresaCodigo = localStorage.getItem('empresaCodigo');
  const empresaNombre = localStorage.getItem('empresaNombre') || empresaCodigo || 'Enterprise';

  // Determinar ruta de login relativa a la ubicación actual
  const isSubDir = window.location.pathname.includes('/enterprise/') || window.location.pathname.includes('\\enterprise\\');
  const loginPath = isSubDir ? '../login.html' : 'login.html';
  const apiRefreshPath = isSubDir ? '../api/refresh' : '/api/refresh';
  const apiAlertaPath = isSubDir ? '../api/alerta-no-autorizado' : '/api/alerta-no-autorizado';
  const isEnterprisePage = isSubDir;
  const isRootUser = !empresaCodigo || empresaCodigo.toUpperCase() === 'ROOT' || (userRole && userRole.toLowerCase().includes('root'));
  const isEnterpriseUser = empresaCodigo && empresaCodigo.toUpperCase() !== 'ROOT' && empresaCodigo.trim() !== '';
  const linkedAccounts = (() => {
    try {
      return JSON.parse(localStorage.getItem('linkedAccounts') || '[]');
    } catch {
      return [];
    }
  })();

  function getCurrentAccountId() {
    return localStorage.getItem('currentAccountId');
  }

  function getAuthHeaders() {
    const t = localStorage.getItem('token');
    return t ? { 'Authorization': `Bearer ${t}` } : {};
  }

  async function fetchWithAuth(input, init = {}) {
    const headers = Object.assign({}, init.headers || {}, getAuthHeaders());
    return fetch(input, Object.assign({}, init, { headers }));
  }

  // Expose helpers globally for other scripts to use
  window.getAuthHeaders = getAuthHeaders;
  window.fetchWithAuth = fetchWithAuth;

  function getAccountDisplayName(account) {
    const isRoot = !account.empresa_codigo || account.empresa_codigo.toString().trim().toUpperCase() === 'ROOT';
    const name = isRoot ? 'Portal Pilot' : account.empresa_nombre || account.empresa_codigo || 'Tenant';
    const email = account.email ? ` - ${account.email}` : '';
    return `${name}${email}`;
  }

  function getSwitchTarget(account) {
    if (account.empresa_codigo && account.empresa_codigo.toString().trim().toUpperCase() !== 'ROOT') {
      return isSubDir ? 'dashboard-amy.html' : 'enterprise/dashboard-amy.html';
    }
    return isSubDir ? '../inicio.html' : 'inicio.html';
  }

  function openAccountSwitcher() {
    const accounts = linkedAccounts;
    if (!accounts || accounts.length < 2) return;
    const existing = document.getElementById('account-switch-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.id = 'account-switch-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);z-index:10000000;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#0e0e1c;border:1px solid rgba(139,92,246,0.3);border-radius:18px;width:100%;max-width:520px;overflow:hidden;box-shadow:0 18px 45px rgba(0,0,0,0.55);">
        <div style="padding:22px 24px 16px 24px;background:rgba(15,15,35,0.95);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#fff;">Cambiar Cuenta</div>
            <div style="font-size:13px;color:#9ca3af;margin-top:6px;">Selecciona la cuenta con la que deseas continuar.</div>
          </div>
          <button id="closeAccountSwitch" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;">&times;</button>
        </div>
        <div style="padding:18px 24px;max-height:320px;overflow-y:auto;">
          ${accounts.map(account => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div>
                <div style="font-size:14px;color:#fff;font-weight:600;">${getAccountDisplayName(account)}</div>
                <div style="font-size:12px;color:#9ca3af;">Rol: ${account.rol || 'Usuario'} • Estado: ${account.status || 'activo'}</div>
              </div>
              <button data-account-id="${account.id}" class="account-switch-btn" style="border:1px solid rgba(139,92,246,0.4);background:transparent;color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;">Seleccionar</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#closeAccountSwitch').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('.account-switch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const accountId = e.currentTarget.getAttribute('data-account-id');
        switchToAccount(accountId);
      });
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function switchToAccount(accountId) {
    const account = linkedAccounts.find(acc => acc.id === accountId);
    if (!account) return;
    localStorage.setItem('token', account.token);
    localStorage.setItem('userRole', account.rol);
    localStorage.setItem('userName', account.nombre || account.email);
    localStorage.setItem('userEmail', account.email);
    localStorage.setItem('empresaCodigo', account.empresa_codigo || 'ROOT');
    localStorage.setItem('empresaNombre', account.empresa_nombre || (account.empresa_codigo === 'ROOT' ? 'Portal Pilot' : account.empresa_codigo));
    localStorage.setItem('currentAccountId', account.id);
    const target = getSwitchTarget(account);
    window.location.href = target;
  }

  function renderAccountSwitcher() {
    if (!linkedAccounts || linkedAccounts.length < 2) return;
    const footer = document.querySelector('.sidebar-footer');
    if (!footer) return;
    if (document.getElementById('accountSwitchBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'accountSwitchBtn';
    btn.className = 'footer-btn';
    btn.style.marginBottom = '10px';
    btn.innerHTML = '<i class="fas fa-exchange-alt"></i> Cambiar cuenta';
    btn.addEventListener('click', openAccountSwitcher);
    footer.insertBefore(btn, footer.firstChild);
  }

  if (!isEnterprisePage && isEnterpriseUser && !isRootUser) {
    alert('Acceso restringido: este panel es solo para administradores raíz.');
    localStorage.clear();
    window.location.href = loginPath;
    return;
  }

  // Permitir que ROOT acceda a cualquier lado (root pages y enterprise pages)
  // Solo bloquear usuarios enterprise que intenten acceder a enterprise pages sin ser enterprise user
  if (isEnterprisePage && !isEnterpriseUser && !isRootUser) {
    alert('Acceso restringido: esta área es solo para administradores de tenant.');
    localStorage.clear();
    window.location.href = '../inicio.html';
    return;
  }
  
  // Log de acceso para debugging
  if (isRootUser) {
    console.log('[AUTH] Usuario ROOT detectado, acceso total permitido');
  } else if (isEnterpriseUser) {
    console.log('[AUTH] Usuario Enterprise detectado, acceso limitado a tenant:', empresaCodigo);
  }

  function getTokenRemainingTime(token) {
    if (!token) return 0;
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const payload = JSON.parse(jsonPayload);
      if (payload.exp) {
        return Math.max(0, Math.floor((payload.exp * 1000 - Date.now()) / 1000));
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // Si no hay token en absoluto (Acceso no autorizado directo)
  if (!token) {
    // Alerta de acceso no autorizado al servidor (asíncrono, no bloqueante)
    fetch(apiAlertaPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: window.location.href,
        referrer: document.referrer
      })
    }).catch(() => {});

    // Redirigir de inmediato al login - agregar pequeño delay para asegurar que otros scripts no se ejecuten
    console.warn('[AUTH-CHECK] No hay token de sesión. Redirigiendo a login...');
    window.location.replace(loginPath);
    return;
  }

  // Marca global para indicar que la sesión fue validada
  window._SESSION_VALIDATED = true;

  // Si el token está expirado desde el inicio
  const initialRemaining = getTokenRemainingTime(token);
  if (initialRemaining <= 0) {
    triggerExpirationFlow();
    return;
  }

  // ─── MONITOREO DE EXPIRACIÓN EN TIEMPO REAL ───
  let warningToast = null;
  let isExpiredFlowActive = false;

  function checkSession() {
    if (isExpiredFlowActive) return;

    const currentToken = localStorage.getItem('token');
    const remaining = getTokenRemainingTime(currentToken);

    if (remaining <= 0) {
      triggerExpirationFlow();
      return;
    }

    if (remaining <= 60) {
      // Quedan menos de 60 segundos, advertir al usuario
      showPreExpirationWarning(remaining);
    } else {
      removePreExpirationWarning();
    }
  }

  // Comprobación periódica cada 3 segundos
  const checkInterval = setInterval(checkSession, 3000);

  function showPreExpirationWarning(seconds) {
    if (warningToast) {
      const timerEl = document.getElementById('pre-exp-timer');
      if (timerEl) timerEl.textContent = `Tu sesión expirará en ${seconds} segundos.`;
      return;
    }

    warningToast = document.createElement('div');
    warningToast.id = 'pre-exp-toast';
    warningToast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(14, 14, 28, 0.95);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 12px;
      padding: 16px 20px;
      z-index: 9999999;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6), 0 0 20px rgba(139, 92, 246, 0.2);
      display: flex;
      align-items: center;
      gap: 15px;
      color: #fff;
      font-family: 'DM Sans', sans-serif;
      animation: slideInPreExp 0.3s ease-out;
    `;

    // Animación inyectada
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
      @keyframes slideInPreExp {
        from { transform: translateX(120%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styleEl);

    warningToast.innerHTML = `
      <div style="color: #fbbf24; font-size: 20px;"><i class="fas fa-exclamation-triangle"></i></div>
      <div style="flex: 1;">
        <div style="font-weight: 700; font-size: 13px; letter-spacing: 0.3px; color: #fff;">SESIÓN POR EXPIRAR</div>
        <div id="pre-exp-timer" style="font-size: 12px; color: #9ca3af; margin-top: 2px;">Tu sesión expirará en ${seconds} segundos.</div>
      </div>
      <button id="extend-session-btn" style="
        background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        border: none;
        border-radius: 8px;
        color: #fff;
        padding: 8px 14px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
      ">Renovar</button>
    `;

    document.body.appendChild(warningToast);

    document.getElementById('extend-session-btn').addEventListener('click', async () => {
      const btn = document.getElementById('extend-session-btn');
      const originalText = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;

      try {
        const res = await fetch(apiRefreshPath, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('token', data.token);
          removePreExpirationWarning();
          // Pequeño toast de éxito
          showSuccessToast();
        } else {
          alert('No se pudo renovar la sesión. Por favor inicia sesión nuevamente.');
          triggerExpirationFlow();
        }
      } catch (err) {
        console.error('Error al renovar sesión:', err);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
  }

  function removePreExpirationWarning() {
    if (warningToast) {
      warningToast.remove();
      warningToast = null;
    }
  }

  function showSuccessToast() {
    const successToast = document.createElement('div');
    successToast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(6, 78, 59, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(52, 211, 153, 0.4);
      border-radius: 12px;
      padding: 14px 20px;
      z-index: 9999999;
      color: #fff;
      font-family: 'DM Sans', sans-serif;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    `;
    successToast.innerHTML = '<i class="fas fa-check-circle" style="color:#34d399; margin-right:8px;"></i> Sesión extendida por 2 horas más.';
    document.body.appendChild(successToast);
    setTimeout(() => successToast.remove(), 3000);
  }

  function triggerExpirationFlow() {
    if (isExpiredFlowActive) return;
    isExpiredFlowActive = true;
    clearInterval(checkInterval);
    removePreExpirationWarning();

    // Bloquear interacción con overlay premium
    const lockOverlay = document.createElement('div');
    lockOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,4,10,0.85);backdrop-filter:blur(10px);z-index:9999999;display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;';
    
    const contentBox = document.createElement('div');
    contentBox.style.cssText = 'text-align:center;padding:30px;background:#0e0e1c;border:1px solid rgba(139, 92, 246, 0.2);border-radius:18px;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    
    contentBox.innerHTML = `
      <div style="font-size:40px;color:#f87171;margin-bottom:15px;"><i class="fas fa-history"></i></div>
      <h3 style="margin:0 0 10px 0;font-size:18px;font-weight:700;">Tu sesión ha expirado</h3>
      <p style="margin:0 0 20px 0;font-size:13px;color:#9ca3af;line-height:1.5;">Por motivos de seguridad, debes volver a iniciar sesión.</p>
      <div style="font-size:14px;color:#8b5cf6;font-weight:600;" id="countdown-text">Redirigiendo al login en 10 segundos...</div>
    `;
    lockOverlay.appendChild(contentBox);
    document.body.appendChild(lockOverlay);

    let count = 10;
    const interval = setInterval(() => {
      count--;
      const textEl = document.getElementById('countdown-text');
      if (textEl) textEl.textContent = `Redirigiendo al login en ${count} segundos...`;
      if (count <= 0) {
        clearInterval(interval);
        localStorage.clear();
        window.location.href = loginPath;
      }
    }, 1000);
  }

  // ─── POBLAMIENTO DINÁMICO DE DATOS ───
  document.addEventListener('DOMContentLoaded', () => {
    // 1. Nombre de usuario y iniciales
    const initials = userName ? userName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'U';
    
    // Selectores comunes de nombre de usuario en sidebar y headers
    document.querySelectorAll('.sidebar-username, .name, .profile-info .name, .profile-username').forEach(el => {
      el.textContent = userName;
    });

    // Selectores comunes de rol
    document.querySelectorAll('.sidebar-role, .role, .profile-info .role, .profile-role').forEach(el => {
      el.textContent = userRole || 'Usuario';
    });

    // Avatar/Iniciales
    document.querySelectorAll('.sidebar-avatar, .avatar, .profile-avatar, .user-avatar, .profile-circle-large').forEach(el => {
      if (el.tagName !== 'IMG') {
        el.textContent = initials;
      }
    });

    // Código/Nombre de empresa
    document.querySelectorAll('.company-name, .tenant-name, .brand-right .company-name').forEach(el => {
      if (el.id !== 'tenant-name') { // Evitar pisar el detalle específico
        el.textContent = empresaNombre;
      }
    });

    renderAccountSwitcher();

    // Saludo de bienvenida personalizado en inicio.html
    const greetingEl = document.getElementById('greeting');
    if (greetingEl) {
      const hour = new Date().getHours();
      let timeGreeting = 'Buenas noches';
      if (hour >= 5 && hour < 12) timeGreeting = 'Buenos días';
      else if (hour >= 12 && hour < 19) timeGreeting = 'Buenas tardes';
      greetingEl.innerHTML = `${timeGreeting}, <span>${userName}</span><br><span style="opacity:.5;font-weight:400;font-size:0.65em;display:block;margin-top:6px">ROL: ${userRole}</span>`;
    }

    // 2. Gestionar Cierre de Sesión
    document.querySelectorAll('#logoutBtn, .logout, .sidebar-footer a[href*="sign-out"], a[href*="logout"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        
        const confirmLogout = confirm('¿Deseas cerrar tu sesión en Portal Pilot?');
        if (confirmLogout) {
          localStorage.clear();
          window.location.href = loginPath;
        }
      });
    });
  });
})();
