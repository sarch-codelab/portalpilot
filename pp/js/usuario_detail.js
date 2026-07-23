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

function saveAllChanges() {
    const changes = {};
    document.querySelectorAll('.info-value[data-field]').forEach(el => {
        const field = el.getAttribute('data-field');
        const value = el.textContent.trim();
        changes[field] = value;
        el.removeAttribute('contenteditable');
        el.parentElement.classList.remove('editing');
    });

    // Simular guardado
    setTimeout(() => {
        toggleEditMode();
        showToast('✓ Cambios guardados exitosamente', 'success');
        console.log('Cambios guardados:', changes);
        // Aquí iría la llamada a API real
    }, 800);
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

function getMockProfile(id) {
    return {
        id: id || 'unknown',
        nombre: 'Usuario',
        apellido: 'Desconocido',
        email: 'N/A',
        rol: 'user',
        tenant: 'N/A',
        registered: new Date().toISOString(),
        lastActivity: null,
        status: 'active',
        plan: null,
        verified: false,
        twoFactor: false,
        securityScore: 0,
        department: '',
        position: '',
        location: '',
        timezone: '',
        phone: '',
        extension: '',
        responsibilities: '',
        source: profileSource
    };
}

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
        console.warn('Perfil cargado en modo mock:', err);
        return getMockProfile(id);
    }
}

function renderProfile(user) {
    currentUserData = user;
    const nombre = user.nombre || '?';
    const apellido = user.apellido || '?';
    const initials = `${nombre[0]}${apellido[0]}`.toUpperCase();
    const avatar = document.getElementById('profileAvatar');

    if (avatar) {
        if (user.avatar) {
            avatar.innerHTML = `<img src="${user.avatar}" alt="${nombre}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.parentElement.innerHTML='${initials}'">`;
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
        nameEl.innerHTML = `${nombre} ${apellido}${verifiedIcon}`;
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
        const roleLabel = user.rol === 'Owner' ? 'Owner' : user.rol === 'Administrador' ? 'Admin de Tenant' : user.rol === 'Operador' ? 'Operador' : 'Usuario';
        badges.push(`<span class="user-badge role"><i class="fas fa-id-badge"></i> ${roleLabel}</span>`);
        if (user.source) badges.push(`<span class="user-badge verified"><i class="fas fa-database"></i> ${user.source === 'nocodb' ? 'NocoDB' : 'Supabase'}</span>`);
        badgesEl.innerHTML = badges.join('');
    }

    // Modals
    const resetUserNameEl = document.getElementById('resetUserName');
    if (resetUserNameEl) resetUserNameEl.textContent = `${nombre} ${apellido}`;

    const suspendUserNameEl = document.getElementById('suspendUserName');
    if (suspendUserNameEl) suspendUserNameEl.textContent = `${nombre} ${apellido}`;
}

async function initProfilePage() {
    const user = profileUserId ? await fetchUserProfile(profileUserId) : getMockProfile();
    renderProfile(user);
}

initProfilePage();

// ── Admin Actions ──────────────────────────────────
function impersonateUser() {
    const name = currentUserData ? `${currentUserData.nombre} ${currentUserData.apellido}` : 'el usuario';
    if (confirm(`¿Suplantar a ${name}? Tendrás todos sus permisos temporalmente.`)) {
        showToast('✓ Suplantación iniciada. Redirigiendo...', 'success');
        setTimeout(() => {
            alert('✅ Modo suplantación activado (mock)');
        }, 1000);
    }
}

function executeReset() {
    const method = document.getElementById('resetMethod').value;
    const force = document.getElementById('forceChange').checked;

    setTimeout(() => {
        closeModal('resetPasswordModal');
        const email = currentUserData?.email || 'correo@dominio.com';
        showToast(`✓ Contraseña reseteada. Email enviado a ${email}`, 'success');
        document.getElementById('resetMethod').selectedIndex = 0;
        document.getElementById('forceChange').checked = true;
    }, 1200);
}

// Suspend modal validation
const suspendReason = document.getElementById('suspendReason');
if (suspendReason) {
    suspendReason.addEventListener('change', function () {
        const btnSuspend = document.getElementById('btnSuspend');
        if (btnSuspend) btnSuspend.disabled = !this.value;
    });
}

function executeSuspend() {
    const reason = document.getElementById('suspendReason').value;
    const notes = document.getElementById('suspendNotes').value;

    if (!reason) { showToast('Selecciona un motivo de suspensión', 'error'); return; }

    setTimeout(() => {
        closeModal('suspendModal');
        showToast('✓ Cuenta suspendida exitosamente', 'success');
        const statusBadge = document.querySelector('.user-avatar-container .status-badge');
        if (statusBadge) {
            statusBadge.className = 'status-badge offline';
            statusBadge.textContent = '● Suspendido';
        }
        const badgesEl = document.getElementById('profileBadges');
        if (badgesEl && !badgesEl.querySelector('.suspended')) {
            badgesEl.innerHTML += '<span class="user-badge suspended"><i class="fas fa-ban"></i> Suspendido</span>';
        }
    }, 1000);
}

function generateApiKey() {
    const name = document.getElementById('apiKeyName').value.trim();
    if (!name) { showToast('Ingresa un nombre para la clave', 'error'); return; }

    const newKey = 'pk_live_' + Math.random().toString(36).substr(2, 20);
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
}

function saveNote() {
    const type = document.getElementById('noteType').value;
    const content = document.getElementById('noteContent').value.trim();
    const internal = document.getElementById('noteInternal').checked;

    if (!content) { showToast('Escribe el contenido de la nota', 'error'); return; }

    setTimeout(() => {
        closeModal('notesModal');
        showToast('✓ Nota de administrador guardada', 'success');
        document.getElementById('noteContent').value = '';
        document.getElementById('noteType').selectedIndex = 0;
    }, 800);
}

function endSession(sessionId) {
    if (confirm('¿Cerrar esta sesión?')) {
        setTimeout(() => {
            showToast('Sesión cerrada', 'success');
            event.target.closest('.device-item')?.remove();
        }, 500);
    }
}

function endAllSessions() {
    if (confirm('¿Cerrar TODAS las sesiones activas excepto la actual?')) {
        setTimeout(() => {
            document.querySelectorAll('.device-item:not(.current)').forEach(el => el.remove());
            showToast('✓ Todas las sesiones cerradas', 'success');
        }, 800);
    }
}

function copyApiKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showToast('✓ Clave copiada al portapapeles', 'success');
    });
}

function revokeApiKey(keyId) {
    if (confirm('¿Revocar esta clave API?')) {
        setTimeout(() => {
            event.target.closest('.api-key-item')?.remove();
            showToast('✓ Clave API revocada', 'success');
        }, 600);
    }
}

function exportUserData() {
    showToast('Generando archivo con datos del usuario (GDPR compliant)...', 'info');
    setTimeout(() => {
        showToast('✓ Exportación completada. Descarga iniciada.', 'success');
    }, 2000);
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