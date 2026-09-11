// ── Custom Cursor (OPTIMIZADO) ─────────────────────
const dot = document.getElementById('cursor-dot');
const ring = document.getElementById('cursor-ring');
let mouseX = 0, mouseY = 0;
let ringX = 0, ringY = 0;
let isTouchDevice = 'ontouchstart' in window;

if (!isTouchDevice) {
    let lastMoveTime = 0;
    document.addEventListener('mousemove', (e) => {
        const now = performance.now();
        if (now - lastMoveTime < 16) return;
        lastMoveTime = now;

        mouseX = e.clientX;
        mouseY = e.clientY;
        dot.style.transform = `translate3d(${mouseX - 3}px, ${mouseY - 3}px, 0)`;
    }, { passive: true });

    function animateRing() {
        ringX += (mouseX - ringX) * 0.15;
        ringY += (mouseY - ringY) * 0.15;
        ring.style.transform = `translate3d(${ringX - 18}px, ${ringY - 18}px, 0)`;
        requestAnimationFrame(animateRing);
    }
    animateRing();

    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card');
        if (target) {
            ring.style.width = '50px';
            ring.style.height = '50px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.9)';
        }
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card');
        if (target) {
            ring.style.width = '36px';
            ring.style.height = '36px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.6)';
        }
    }, { passive: true });
}

// ── Scroll Progress ────────────────────────────────
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
    const now = performance.now();
    if (now - lastScrollTime < 16) return;
    lastScrollTime = now;
    const p = (window.scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = Math.min(100, Math.max(0, p)) + '%';
}, { passive: true });

// ── Reveal on Scroll ───────────────────────────────
const obs = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
        if (e.isIntersecting) {
            setTimeout(() => e.target.classList.add('in'), i * 30);
            obs.unobserve(e.target);
        }
    });
}, { threshold: 0.05 });

document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

// ── Sidebar Toggle ─────────────────────────────────
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggleSidebar');
const overlay = document.getElementById('overlay');
const dashboard = document.getElementById('dashboard');
let isMobile = window.innerWidth <= 900;

// Cargar estado guardado
const savedSidebarState = localStorage.getItem('sidebarCollapsed');
const savedDarkMode = localStorage.getItem('darkMode');

if (savedSidebarState === 'true' && !isMobile) {
    sidebar.classList.add('collapsed');
    dashboard.classList.add('sidebar-collapsed');
}

if (savedDarkMode === 'light') {
    document.body.classList.add('light-mode');
    const darkModeBtn = document.getElementById('darkModeToggle');
    if (darkModeBtn) darkModeBtn.innerHTML = '<i class="fas fa-sun"></i> <span>Light Mode</span>';
}

function updateLayout() {
    isMobile = window.innerWidth <= 900;
    if (isMobile) {
        sidebar.style.position = 'fixed';
        sidebar.style.left = sidebar.classList.contains('active') ? '0' : '-260px';
        dashboard.classList.remove('sidebar-collapsed');
    } else {
        sidebar.style.position = 'sticky';
        sidebar.style.left = 'auto';
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
        if (sidebar.classList.contains('collapsed')) {
            dashboard.classList.add('sidebar-collapsed');
        } else {
            dashboard.classList.remove('sidebar-collapsed');
        }
    }
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateLayout, 100);
});
updateLayout();

toggleBtn.addEventListener('click', () => {
    if (isMobile) {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    } else {
        sidebar.classList.toggle('collapsed');
        dashboard.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    }
});

overlay.addEventListener('click', () => {
    sidebar.classList.remove('active');
    overlay.classList.remove('active');
});

// ── Dark Mode Toggle ───────────────────────────────
const darkModeBtn = document.getElementById('darkModeToggle');
if (darkModeBtn) {
    darkModeBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        darkModeBtn.innerHTML = isLight
            ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
            : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
        localStorage.setItem('darkMode', isLight ? 'light' : 'dark');
    });
}

// ── Logout Modal ───────────────────────────────────
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
if (logoutBtn && logoutModal) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.classList.add('active');
    });
}

// ── Modal Functions ────────────────────────────────
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

document.querySelectorAll('.modal-overlay').forEach(overlayModal => {
    overlayModal.addEventListener('click', e => {
        if (e.target === overlayModal) overlayModal.classList.remove('active');
    });
});

// ── EDIT MODE ──────────────────────────────────────
let editMode = false;
let currentUserData = null;

function toggleEditMode() {
    editMode = !editMode;
    const btn = document.getElementById('editToggleBtn');
    const adminBar = document.getElementById('adminBar');
    const body = document.body;

    if (editMode) {
        // Activar modo edición
        btn.classList.add('editing');
        btn.innerHTML = '<i class="fas fa-check"></i> <span>Modo Edición</span>';
        adminBar.style.display = 'flex';
        body.classList.add('edit-mode');

        // Hacer editables los campos
        document.querySelectorAll('.info-value[data-field]').forEach(el => {
            el.setAttribute('contenteditable', 'true');
            el.parentElement.classList.add('editing');
        });

        showToast('Modo edición activado. Haz clic en cualquier campo para editar.', 'info');
    } else {
        // Desactivar modo edición
        btn.classList.remove('editing');
        btn.innerHTML = '<i class="fas fa-edit"></i> <span>Editar Perfil</span>';
        adminBar.style.display = 'none';
        body.classList.remove('edit-mode');

        // Quitar editable
        document.querySelectorAll('.info-value[data-field]').forEach(el => {
            el.removeAttribute('contenteditable');
            el.parentElement.classList.remove('editing');
        });
    }
}

function cancelEdit() {
    toggleEditMode();
    showToast('Cambios cancelados', 'info');
}

async function saveAllChanges() {
    const changes = {};
    document.querySelectorAll('.info-value[data-field]').forEach(el => {
        const field = el.getAttribute('data-field');
        const value = el.textContent.trim();
        changes[field] = value;
        el.removeAttribute('contenteditable');
        el.parentElement.classList.remove('editing');
    });

    const token = localStorage.getItem('token');
    const userId = new URLSearchParams(window.location.search).get('id');
    if (!token || !userId) {
        toggleEditMode();
        showToast('Falta token o ID de usuario', 'error');
        return;
    }

    // Mapear campos al schema de PUT /api/users/:id
    const apiFields = {};
    const extendedFields = {};

    // Map direct fields
    if (changes.firstName !== undefined) apiFields.nombre = changes.firstName;
    if (changes.lastName !== undefined) apiFields.apellido = changes.lastName;
    if (changes.email !== undefined) apiFields.email = changes.email;
    if (changes.role !== undefined) apiFields.rol = changes.role;
    if (changes.status !== undefined) apiFields.status = changes.status;
    if (changes.notas !== undefined) apiFields.notas = changes.notas;

    // Extended profile fields → store in notas as JSON
    ['department', 'position', 'location', 'timezone', 'phone', 'extension', 'responsibilities'].forEach(key => {
        if (changes[key] !== undefined) extendedFields[key] = changes[key];
    });

    if (Object.keys(extendedFields).length > 0) {
        // Merge with existing notas if present
        let existingNotas = '';
        try { existingNotas = currentUserData?.notas || ''; } catch { existingNotas = ''; }
        let notasData = {};
        try {
            const parsed = JSON.parse(existingNotas);
            if (typeof parsed === 'object') notasData = parsed;
        } catch { notasData = { raw: existingNotas }; }
        Object.assign(notasData, extendedFields);
        apiFields.notas = JSON.stringify(notasData);
    }

    if (Object.keys(apiFields).length === 0) {
        toggleEditMode();
        showToast('No hay cambios para guardar', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(apiFields)
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Error ${res.status}`);
        }
        toggleEditMode();
        showToast('Cambios guardados exitosamente', 'success');
        // Reload profile
        const profile = await fetchUserProfile(userId);
        if (profile) renderProfile(profile);
    } catch (err) {
        showToast('Error al guardar: ' + err.message, 'error');
    }
}

function toggleSectionEdit(section) {
    const sectionEl = document.getElementById(section + 'Info');
    if (sectionEl) {
        sectionEl.querySelectorAll('.info-value[data-field]').forEach(el => {
            const isEditable = el.getAttribute('contenteditable') === 'true';
            if (isEditable) {
                el.removeAttribute('contenteditable');
                el.parentElement.classList.remove('editing');
            } else {
                el.setAttribute('contenteditable', 'true');
                el.parentElement.classList.add('editing');
            }
        });
    }
}

// ── User Profile Data ──────────────────────────────
const profileUserId = new URLSearchParams(window.location.search).get('id');
const profileSource = new URLSearchParams(window.location.search).get('source') || 'supabase';

async function fetchUserProfile(id) {
    try {
        const token = localStorage.getItem('token');
        let url = `/api/users/${encodeURIComponent(id)}`;
        if (profileSource === 'nocodb') url += '?source=nocodb';
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) return await response.json();
        throw new Error('No se pudo obtener usuario');
    } catch (err) {
        console.error('No se pudo cargar el perfil:', err);
        showToast('No se pudo cargar el usuario desde el servidor.', 'error');
        return null;
    }
}

function renderProfile(user) {
    currentUserData = user;
    const full = user.nombre_completo || [user.nombre, user.apellido].filter(Boolean).join(' ') || '?';
    const words = full.split(/\s+/).filter(Boolean);
    const initials = `${(words[0] || '?')[0]}${words.length > 1 ? (words[words.length - 1][0] || '') : (words[0] ? words[0][1] || '' : '')}`.toUpperCase();
    const avatar = document.getElementById('profileAvatar');

    if (avatar) {
        if (user.avatar) {
            avatar.innerHTML = `<img src="${user.avatar}" alt="${full}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.parentElement.innerHTML='${initials}'">`;
        } else {
            avatar.innerHTML = initials;
        }
        // Add status badge
        const statusBadge = document.createElement('span');
        statusBadge.className = `status-badge ${user.status === 'active' ? 'online' : user.status === 'pending' ? 'warning' : 'offline'}`;
        statusBadge.id = 'profileStatusBadge';
        statusBadge.textContent = `● ${user.status === 'active' ? 'Online' : user.status === 'pending' ? 'Pendiente' : 'Suspendido'}`;
        avatar.appendChild(statusBadge);
    }

    const nameEl = document.getElementById('profileName');
    if (nameEl) {
        const verifiedIcon = user.verified ? ' <i class="fas fa-check-circle verified" title="Verificado"></i>' : '';
        nameEl.innerHTML = `${full}${verifiedIcon}`;
    }

    const emailEl = document.getElementById('profileEmail');
    if (emailEl) emailEl.textContent = user.email || 'N/A';

    const idEl = document.getElementById('profileId');
    if (idEl) idEl.textContent = user.displayId || user.id || 'N/A';

    const tenantEl = document.getElementById('profileTenant');
    if (tenantEl) tenantEl.textContent = user.tenant || user.tenant_code || 'N/A';

    const memberSinceEl = document.getElementById('profileMemberSince');
    if (memberSinceEl && user.registered) {
        memberSinceEl.textContent = `Miembro desde: ${new Date(user.registered).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }

    const lastAccessEl = document.getElementById('profileLastAccess');
    if (lastAccessEl && user.lastActivity) {
        lastAccessEl.textContent = `Último acceso: ${new Date(user.lastActivity).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${new Date(user.lastActivity).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (lastAccessEl) {
        lastAccessEl.textContent = 'Último acceso: Sin actividad registrada';
    }

    // Badges
    const badgesEl = document.getElementById('profileBadges');
    if (badgesEl) {
        const badges = [];
        const roleMap = { owner: 'Owner', administrador: 'Admin de Tenant', admin: 'Admin de Tenant', operador: 'Operador', operator: 'Operador', user: 'Usuario' };
        const roleLabel = roleMap[String(user.rol || '').toLowerCase()] || user.rol || 'Usuario';
        badges.push(`<span class="user-badge role"><i class="fas fa-id-badge"></i> ${roleLabel}</span>`);
        if (user.source) badges.push(`<span class="user-badge verified"><i class="fas fa-database"></i> ${user.source === 'nocodb' ? 'NocoDB' : 'Supabase'}</span>`);
        if (user.verified) badges.push(`<span class="user-badge secure"><i class="fas fa-shield-alt"></i> 2FA Activo</span>`);
        badgesEl.innerHTML = badges.join('');
    }

    // Stats reales
    const stats = user.stats || {};
    const setStat = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = value;
    };
    setStat('statSesiones', typeof stats.sesiones === 'number' ? stats.sesiones.toLocaleString('es-ES') : '—');
    setStat('statBots', typeof stats.bots === 'number' ? stats.bots.toLocaleString('es-ES') : '—');
    let tokensText = '—';
    if (typeof stats.tokens === 'number') {
        tokensText = stats.tokens >= 1000000 ? `${(stats.tokens / 1000000).toFixed(2)}M` : stats.tokens >= 1000 ? `${(stats.tokens / 1000).toFixed(1)}K` : String(stats.tokens);
    }
    setStat('statTokens', tokensText);
    setStat('statScore', typeof stats.score === 'number' ? `${stats.score}%` : '—');

    // Professional Information (solo datos reales; si no existen, se queda en '—')
    const prof = user.professional || {};
    const profMap = {
        department: prof.departamento,
        position: prof.cargo,
        location: prof.ubicacion,
        timezone: prof.zonaHoraria,
        phone: prof.telCorporativo,
        extension: prof.extension,
        responsibilities: prof.responsabilidades
    };
    document.querySelectorAll('#professionalInfo .info-value[data-field]').forEach(el => {
        const field = el.getAttribute('data-field');
        if (field in profMap && profMap[field] != null && String(profMap[field]).trim() !== '') {
            el.textContent = profMap[field];
        }
    });

    // Tenant asignado (real)
    const tenantListEl = document.getElementById('tenantAssignList');
    if (tenantListEl) {
        const tenantName = (user.tenant && user.tenant !== 'N/A') ? user.tenant : ((user.tenant_code && user.tenant_code !== 'ROOT') ? user.tenant_code : null);
        tenantListEl.innerHTML = tenantName
            ? `<div class="tenant-item">
                    <div class="tenant-info">
                        <div class="tenant-icon"><i class="fas fa-building"></i></div>
                        <div><div class="tenant-name">${tenantName}</div><div class="tenant-role">Tenant Principal</div></div>
                    </div>
                    <span class="tenant-access full"><i class="fas fa-check-circle"></i> Acceso Completo</span>
                </div>`
            : `<div class="tenant-item"><div class="tenant-info"><div><div class="tenant-name">Sin tenant asignado</div><div class="tenant-role">—</div></div></div></div>`;
    }

    // Security panel
    setStat('security2fa', user.verified
        ? '<i class="fas fa-check-circle"></i> Activo'
        : '<i class="fas fa-times-circle"></i> Inactivo');
    setStat('securityFails', typeof stats.fallidos === 'number' ? String(stats.fallidos) : '—');

    // Modals
    const resetUserNameEl = document.getElementById('resetUserName');
    if (resetUserNameEl) resetUserNameEl.textContent = full;

    const suspendUserNameEl = document.getElementById('suspendUserName');
    if (suspendUserNameEl) suspendUserNameEl.textContent = full;
}

async function loadUserSessions(userId) {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/sessions`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.sessions || [];
    }
  } catch (e) {
    console.warn('No se pudieron cargar sesiones:', e);
  }
  return [];
}

async function loadUserActivity(userId) {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/activity?limit=10`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.activity || [];
    }
  } catch (e) {
    console.warn('No se pudo cargar actividad:', e);
  }
  return [];
}

function renderSessions(sessions) {
  const container = document.querySelector('.device-list');
  if (!container) return;
  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin sesiones registradas</div>';
    return;
  }
  container.innerHTML = sessions.map(s => `
    <div class="device-item ${s.isCurrent ? 'current' : ''}">
      <div class="device-info">
        <div class="device-name"><i class="fas fa-${s.deviceType === 'mobile' ? 'mobile-alt' : 'desktop'}"></i> ${s.deviceName}</div>
        <div class="device-meta">Última actividad: ${s.lastActivity ? new Date(s.lastActivity).toLocaleString('es-ES') : 'Desconocida'} ${s.isActive ? '• <span style="color:var(--green)">● Activa</span>' : ''}</div>
        <div class="device-location"><i class="fas fa-map-marker-alt"></i> ${s.location || 'Desconocida'} • ${s.ip || 'Desconocida'}</div>
      </div>
      ${s.isCurrent ? '<span class="user-badge verified" style="font-size:10px;padding:2px 8px;">Actual</span>' : `<button class="btn btn-ghost btn-xs" onclick="endSession('${s.id}')">Cerrar</button>`}
    </div>
  `).join('');
}

function renderActivity(activity) {
  const container = document.querySelector('.timeline');
  if (!container) return;
  if (!activity || activity.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin actividad registrada</div>';
    return;
  }
  container.innerHTML = activity.map(a => {
    const iconClass = a.result === 'failed' ? 'warning' : a.result === 'warning' ? 'warning' : 'success';
    return `
      <div class="timeline-item ${iconClass}">
        <div class="timeline-time"><i class="fas fa-clock"></i> ${a.timestamp ? new Date(a.timestamp).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Desconocida'}</div>
        <div class="timeline-action">${a.action}</div>
        <div class="timeline-details">${a.details || ''}${a.ip ? ` • IP: <code>${a.ip}</code>` : ''}${a.module ? ` • Módulo: ${a.module}` : ''}</div>
        <div class="timeline-meta">${a.result !== 'success' ? `<span><i class="fas fa-exclamation-triangle"></i> ${a.result}</span>` : ''}${a.hash ? `<span><i class="fas fa-link"></i> Hash: ${a.hash}</span>` : ''}</div>
      </div>
    `;
  }).join('');
}

async function loadUserActivity(userId) {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/activity?limit=10`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.activity || [];
    }
  } catch (e) {
    console.warn('No se pudo cargar actividad:', e);
  }
  return [];
}

async function loadUserSessions(userId) {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/users/${encodeURIComponent(userId)}/sessions`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (response.ok) {
      const data = await response.json();
      return data.sessions || [];
    }
  } catch (e) {
    console.warn('No se pudieron cargar sesiones:', e);
  }
  return [];
}

function renderSessions(sessions) {
  const container = document.querySelector('.device-list');
  if (!container) return;
  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="empty-state">Sin sesiones registradas</div>';
    return;
  }
  container.innerHTML = sessions.map(s => `
    <div class="device-item ${s.isCurrent ? 'current' : ''}">
      <div class="device-info">
        <div class="device-name"><i class="fas fa-${s.deviceType === 'mobile' ? 'mobile-alt' : 'desktop'}"></i> ${s.deviceName}</div>
        <div class="device-meta">Última actividad: ${s.lastActivity ? new Date(s.lastActivity).toLocaleString('es-ES') : 'Desconocida'} ${s.isActive ? '• <span style="color:var(--green)">● Activa</span>' : ''}</div>
        <div class="device-location"><i class="fas fa-map-marker-alt"></i> ${s.location || 'Desconocida'} • ${s.ip || 'Desconocida'}</div>
      </div>
      ${s.isCurrent ? '<span class="user-badge verified" style="font-size:10px;padding:2px 8px;">Actual</span>' : `<button class="btn btn-ghost btn-xs" onclick="endSession('${s.id}')">Cerrar</button>`}
    </div>
  `).join('');
}

async function initProfilePage() {
    if (!profileUserId) {
        showToast('Falta el identificador del usuario.', 'error');
        return;
    }
    const user = await fetchUserProfile(profileUserId);
    if (user) {
      renderProfile(user);
      const [sessions, activity] = await Promise.all([
        loadUserSessions(profileUserId),
        loadUserActivity(profileUserId)
      ]);
      renderSessions(sessions);
      renderActivity(activity);
      loadUserApiKeys();
    }
}

initProfilePage();

// ── Admin Actions ──────────────────────────────────
async function impersonateUser() {
    if (!profileUserId) {
        showToast('No se identificó al usuario.', 'error');
        return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
        showToast('Sesión no válida. Vuelve a iniciar sesión.', 'warning');
        return;
    }
    try {
        const response = await fetch(`/api/users/${encodeURIComponent(profileUserId)}/impersonate`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (!response.ok || !data.token) {
            showToast(data.error || 'No se pudo suplantar al usuario.', 'error');
            return;
        }
        localStorage.setItem('token', data.token);
        localStorage.setItem('currentAccountId', data.user.id);
        localStorage.setItem('userRole', data.user.rol || 'admin');
        localStorage.setItem('empresaCodigo', data.user.empresa_codigo || 'ROOT');
        localStorage.setItem('empresaNombre', data.user.empresa_nombre || ((data.user.empresa_codigo && data.user.empresa_codigo !== 'ROOT') ? data.user.empresa_codigo : 'Portal Pilot'));
        localStorage.setItem('userName', data.user.nombre || '');
        localStorage.setItem('userEmail', data.user.email || '');
        localStorage.setItem('userApellido', '');
        localStorage.setItem('userFoto', data.user.foto_perfil_url || '');
        localStorage.setItem('userBanner', data.user.banner_perfil_url || '');
        localStorage.setItem('empresaPlan', 'enterprise');
        localStorage.setItem('trialExpired', 'false');
        localStorage.removeItem('linkedAccounts');

        // Sincronizar la cookie httpOnly con la nueva sesión para que /empresa/* se sirva de inmediato
        try {
            await fetch('/api/session/sync', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${data.token}` }
            });
        } catch (e) { /* no crítico */ }

        showToast(`Sesión iniciada como ${data.user.nombre || data.user.email}`, 'success');
        setTimeout(() => {
            if (data.user.empresa_codigo && data.user.empresa_codigo !== 'ROOT') {
                window.location.href = '/empresa/dashboard.html';
            } else {
                window.location.href = '/pp/welcome.html';
            }
        }, 1000);
    } catch (err) {
        console.error('[IMPRESIONAR] Error:', err);
        showToast('Error al intentar suplantar al usuario.', 'error');
    }
}

async function executeReset() {
    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    const method = document.getElementById('resetMethod')?.value || '';
    if (!userId || !token) { showToast('Falta ID de usuario o sesión', 'error'); return; }

    const tempPwd = 'Tmp' + Math.random().toString(36).slice(2, 8) + '!A' + Date.now().toString().slice(-4);

    showToast('Reseteando contraseña...', 'info');
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: tempPwd })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Error ${res.status}`);
        }
        closeModal('resetPasswordModal');

        if (method.includes('mostrar aquí')) {
            alert(`Contraseña temporal generada: ${tempPwd}\n\nCompártela de forma segura con el usuario.`);
        } else {
            showToast('Contraseña temporal enviada al usuario', 'success');
        }
    } catch (err) {
        showToast('Error al resetear: ' + err.message, 'error');
    }
}

// Suspend modal validation
const suspendReason = document.getElementById('suspendReason');
if (suspendReason) {
    suspendReason.addEventListener('change', function () {
        const btnSuspend = document.getElementById('btnSuspend');
        if (btnSuspend) btnSuspend.disabled = !this.value;
    });
}

async function executeSuspend() {
    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    const reasonEl = document.getElementById('suspendReason');
    const reason = reasonEl ? reasonEl.value : '';

    if (!userId || !token) { showToast('Falta ID de usuario o sesión', 'error'); return; }

    showToast('Suspendiendo cuenta...', 'info');
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'suspended', reason, notas: reason ? JSON.stringify({ suspend_reason: reason }) : undefined })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Error ${res.status}`);
        }
        const modal = document.getElementById('suspendModal');
        if (modal) modal.classList.remove('active');
        showToast('Cuenta suspendida', 'success');
        const profile = await fetchUserProfile(userId);
        if (profile) renderProfile(profile);
    } catch (err) {
        showToast('Error al suspender: ' + err.message, 'error');
    }
}

async function loadUserApiKeys() {
    const container = document.getElementById('userApiKeysList');
    if (!container) return;
    const token = localStorage.getItem('token');
    if (!token) { container.innerHTML = '<div style="padding:12px;color:var(--gray);font-size:13px;">Inicia sesión para ver claves API.</div>'; return; }
    try {
        const res = await fetch('/api/tenant/apikeys', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('apikeys error');
        const data = await res.json();
        const keys = data.keys || [];
        if (!keys.length) { container.innerHTML = '<div style="padding:12px;color:var(--gray);font-size:13px;">No hay claves API generadas.</div>'; return; }
        container.innerHTML = keys.map(k => {
            const full = k.clave || '';
            const short = full.length > 24 ? full.slice(0, 17) + '...' + full.slice(-8) : full;
            const used = k.ultimo_uso ? 'Último uso: ' + new Date(k.ultimo_uso).toLocaleString('es') : 'Sin uso registrado';
            const created = k.created_at ? 'Creada: ' + new Date(k.created_at).toLocaleDateString('es') : '';
            return `<div class="api-key-item">
                <div class="api-key-info">
                    <div class="api-key-name">${k.nombre || 'Clave API'}</div>
                    <div class="api-key-value">${short}</div>
                    <div class="api-key-meta"><span>${created}</span><span>•</span><span>${used}</span></div>
                </div>
                <div class="api-key-actions">
                    <button class="btn btn-ghost btn-xs" onclick="copyApiKey('${full}')"><i class="fas fa-copy"></i></button>
                    <button class="btn btn-danger btn-xs" onclick="revokeApiKey('${k.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div style="padding:12px;color:var(--gray);font-size:13px;">No se pudieron cargar las claves API.</div>';
    }
}

async function generateApiKey() {
    const name = document.getElementById('apiKeyName').value.trim();
    if (!name) { showToast('Ingresa un nombre para la clave', 'error'); return; }

    const token = localStorage.getItem('token');
    if (!token) { showToast('Sesión no válida. Inicia sesión nuevamente.', 'error'); return; }

    try {
        const response = await fetch('/api/tenant/apikeys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nombre: name })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudo crear la clave API');
        const newKey = data.clave || data.key?.clave;
        if (!newKey) throw new Error('El servidor no devolvió la clave API');

    closeModal('createApiKeyModal');

    const keyModal = document.createElement('div');
    keyModal.className = 'modal-overlay active';
    keyModal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title"><i class="fas fa-key" style="color:var(--green);margin-right:8px;"></i>Clave Generada</div>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body" style="text-align:center;">
                <p style="font-size:13px;color:var(--gray);margin-bottom:16px;">Guarda esta clave en un lugar seguro. <strong>No se volverá a mostrar.</strong></p>
                <div style="background:var(--card2);padding:12px;border-radius:8px;font-family:monospace;font-size:12px;color:var(--cyan);margin-bottom:16px;word-break:break-all;">${newKey}</div>
                <button class="btn btn-acc btn-sm" onclick="navigator.clipboard.writeText('${newKey}');showToast('✓ Clave copiada','success');this.closest('.modal-overlay').remove();"><i class="fas fa-copy"></i> Copiar y Cerrar</button>
            </div>
        </div>
    `;
    document.body.appendChild(keyModal);
    keyModal.addEventListener('click', e => { if (e.target === keyModal) keyModal.remove(); });

    showToast('✓ Nueva clave API generada', 'success');
    document.getElementById('apiKeyName').value = '';
    document.getElementById('apiKeyPerms').selectedIndex = 2;
    document.getElementById('apiKeyExpiry').value = '';
    loadUserApiKeys();
    } catch (error) {
        showToast(error.message || 'No se pudo crear la clave API.', 'error');
    }
}

async function saveNote() {
    const type = document.getElementById('noteType').value;
    const content = document.getElementById('noteContent').value.trim();
    const internal = document.getElementById('noteInternal').checked;

    if (!content) { showToast('Escribe el contenido de la nota', 'error'); return; }

    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    if (!userId || !token) { showToast('Falta ID de usuario o sesión', 'error'); return; }

    const nota = { tipo: type, contenido: content, interna: internal, fecha: new Date().toISOString() };

    let notas = [];
    try {
        const base = currentUserData?.notas || '';
        const parsed = JSON.parse(base);
        if (Array.isArray(parsed)) notas = parsed;
        else if (typeof parsed === 'object') notas = Object.values(parsed).filter(v => typeof v === 'object');
    } catch { notas = []; }
    notas.push(nota);

    showToast('Guardando nota...', 'info');
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notas: JSON.stringify(notas) })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Error ${res.status}`);
        }
        closeModal('notesModal');
        showToast('Nota de administrador guardada', 'success');
        document.getElementById('noteContent').value = '';
        document.getElementById('noteType').selectedIndex = 0;
    } catch (err) {
        showToast('Error al guardar nota: ' + err.message, 'error');
    }
}

async function endSession(sessionId) {
    if (!confirm('¿Cerrar esta sesión?')) return;
    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    if (!userId || !token) return;
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/revoke-sessions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al cerrar sesión');
        showToast('Sesión cerrada', 'success');
        const sessions = await loadUserSessions(userId);
        renderSessions(sessions);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function endAllSessions() {
    if (!confirm('¿Cerrar TODAS las sesiones activas excepto la actual?')) return;
    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    if (!userId || !token) return;
    showToast('Revocando sesiones...', 'info');
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/revoke-sessions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al revocar');
        showToast('Todas las sesiones cerradas', 'success');
        const sessions = await loadUserSessions(userId);
        renderSessions(sessions);
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function copyApiKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showToast('Clave copiada al portapapeles', 'success');
    });
}

async function revokeApiKey(keyId) {
    if (!confirm('¿Revocar esta clave API?')) return;
    const token = localStorage.getItem('token');
    if (!token) { showToast('Sesión no iniciada', 'error'); return; }
    try {
        const res = await fetch(`/api/tenant/apikeys/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al revocar');
        event.target.closest('.api-key-item')?.remove();
        showToast('Clave API revocada', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function exportUserData() {
    const userId = new URLSearchParams(window.location.search).get('id');
    const token = localStorage.getItem('token');
    if (!userId || !token) { showToast('Falta ID de usuario o sesión', 'error'); return; }

    showToast('Generando archivo con datos del usuario (GDPR compliant)...', 'info');
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al exportar');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `usuario-${userId}-export-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Exportación completada. Descarga iniciada.', 'success');
    } catch (err) {
        showToast('Error al exportar: ' + err.message, 'error');
    }
}

function printProfile() {
    window.print();
}

// ── Initialize ─────────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(() => {
        document.querySelectorAll('.reveal').forEach((el, i) => {
            setTimeout(() => el.classList.add('in'), i * 50);
        });
    }, 100);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'e') { e.preventDefault(); toggleEditMode(); }
    if (e.ctrlKey && e.key === 's' && editMode) { e.preventDefault(); saveAllChanges(); }
    if (e.ctrlKey && e.key === 'i') { e.preventDefault(); impersonateUser(); }
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); openModal('resetPasswordModal'); }
});