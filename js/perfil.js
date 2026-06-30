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
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card, .notification-item, .session-item, .api-key-item');
        if (target) {
            ring.style.width = '50px';
            ring.style.height = '50px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.9)';
        }
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card, .notification-item, .session-item, .api-key-item');
        if (target) {
            ring.style.width = '36px';
            ring.style.height = '36px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.6)';
        }
    }, { passive: true });
}

// ── Toast Notification System ──────────────────────
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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

// ── Track Changes ──────────────────────────────────
let hasChanges = false;

function trackChanges() {
    hasChanges = true;
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.style.display = 'inline-flex';
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios <span style="background:var(--red);color:#fff;padding:2px 6px;border-radius:10px;font-size:10px;margin-left:4px;">●</span>';
    }
}

function toggleEdit(section) {
    const fields = document.querySelectorAll(`#${section}Fields .field input, #${section}Fields .field select, #${section}Fields .field textarea`);
    fields.forEach(el => {
        el.disabled = false;
        el.classList.add('editing');
    });
    hasChanges = true;
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        saveBtn.style.display = 'inline-flex';
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios <span style="background:var(--red);color:#fff;padding:2px 6px;border-radius:10px;font-size:10px;margin-left:4px;">●</span>';
    }
    showToast('Modo edición activado', 'info');
}

async function saveProfile() {
    if (!hasChanges) {
        showToast('No hay cambios para guardar', 'info');
        return;
    }

    const btn = document.getElementById('saveBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    btn.disabled = true;

    try {
        // Simular API call
        await new Promise(r => setTimeout(r, 1000));

        // Deshabilitar campos
        document.querySelectorAll('.field input, .field select, .field textarea').forEach(el => {
            el.disabled = true;
            el.classList.remove('editing');
        });

        hasChanges = false;
        btn.style.display = 'none';
        showToast('✓ Perfil actualizado exitosamente', 'success');
    } catch (err) {
        showToast('Error al guardar. Intenta de nuevo.', 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Notifications ──────────────────────────────────
const notificationsBtn = document.getElementById('notificationsBtn');
const notificationsModal = document.getElementById('notificationsModal');
const notifBadge = document.getElementById('notifBadge');

if (notificationsBtn) {
    notificationsBtn.addEventListener('click', () => {
        openModal('notificationsModal');
        // Reset badge
        if (notifBadge) {
            notifBadge.style.display = 'none';
        }
    });
}

function markAsRead(btn) {
    const item = btn.closest('.notification-item');
    item.classList.remove('unread');
    btn.style.opacity = '0';
    updateNotifBadge();
}

function markAllRead() {
    document.querySelectorAll('.notification-item.unread').forEach(item => {
        item.classList.remove('unread');
    });
    updateNotifBadge();
    showToast('Todas las notificaciones marcadas como leídas', 'success');
}

function updateNotifBadge() {
    const unreadCount = document.querySelectorAll('.notification-item.unread').length;
    if (notifBadge) {
        if (unreadCount > 0) {
            notifBadge.textContent = unreadCount;
            notifBadge.style.display = 'flex';
        } else {
            notifBadge.style.display = 'none';
        }
    }
}

// ── Avatar Upload ──────────────────────────────────
function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('previewImg').src = e.target.result;
            document.getElementById('avatarPreview').style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function uploadAvatar() {
    const file = document.getElementById('avatarFile').files[0];
    if (!file) {
        showToast('Selecciona una imagen primero', 'error');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('La imagen debe ser menor a 5MB', 'error');
        return;
    }

    // Simular upload
    setTimeout(() => {
        closeModal('uploadAvatarModal');
        showToast('✓ Foto de perfil actualizada', 'success');

        // Update avatar preview
        const reader = new FileReader();
        reader.onload = function (e) {
            const avatarLarge = document.querySelector('.profile-avatar-large');
            if (avatarLarge) {
                avatarLarge.innerHTML = `<img src="${e.target.result}" onerror="this.style.display='none';this.parentElement.innerHTML='AS'">`;
            }

            const sidebarAvatar = document.querySelector('.sidebar .avatar');
            if (sidebarAvatar) sidebarAvatar.src = e.target.result;
        };
        reader.readAsDataURL(file);

        document.getElementById('avatarPreview').style.display = 'none';
        document.getElementById('avatarFile').value = '';
    }, 800);
}

// ── Banner Upload ──────────────────────────────────
function previewBanner(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('bannerPreviewImg').src = e.target.result;
            document.getElementById('bannerPreview').style.display = 'block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

function uploadBanner() {
    const file = document.getElementById('bannerFile').files[0];
    if (!file) {
        showToast('Selecciona una imagen primero', 'error');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast('La imagen debe ser menor a 10MB', 'error');
        return;
    }

    setTimeout(() => {
        closeModal('uploadBannerModal');
        showToast('✓ Banner actualizado', 'success');

        const reader = new FileReader();
        reader.onload = function (e) {
            const banner = document.getElementById('profileBanner');
            if (banner) {
                banner.style.backgroundImage = `url('${e.target.result}')`;
            }
        };
        reader.readAsDataURL(file);

        document.getElementById('bannerPreview').style.display = 'none';
        document.getElementById('bannerFile').value = '';
    }, 800);
}

// ── Password Strength & Match ──────────────────────
function checkStrength(input) {
    const val = input.value;
    const fill = document.getElementById('strengthFill');
    const text = document.getElementById('strengthText');
    const btn = document.getElementById('btnChangePass');

    let score = 0;
    if (val.length >= 8) score += 25;
    if (val.length >= 12) score += 15;
    if (/[A-Z]/.test(val)) score += 15;
    if (/[0-9]/.test(val)) score += 20;
    if (/[^A-Za-z0-9]/.test(val)) score += 25;

    fill.style.width = score + '%';
    if (score < 40) {
        fill.style.background = 'var(--red)';
        text.textContent = 'Débil';
        text.style.color = 'var(--red)';
    } else if (score < 70) {
        fill.style.background = 'var(--yellow)';
        text.textContent = 'Regular';
        text.style.color = 'var(--yellow)';
    } else {
        fill.style.background = 'var(--green)';
        text.textContent = 'Fuerte';
        text.style.color = 'var(--green)';
    }

    checkMatch();
}

function checkMatch() {
    const newPass = document.getElementById('newPass').value;
    const confirmPass = document.getElementById('confirmPass').value;
    const status = document.getElementById('matchStatus');
    const btn = document.getElementById('btnChangePass');

    if (!newPass || !confirmPass) {
        status.textContent = '';
        btn.disabled = true;
        return;
    }

    if (newPass === confirmPass && newPass.length >= 12) {
        status.innerHTML = '<span style="color:var(--green)"><i class="fas fa-check-circle"></i> Coinciden</span>';
        btn.disabled = false;
    } else if (newPass !== confirmPass) {
        status.innerHTML = '<span style="color:var(--red)"><i class="fas fa-times-circle"></i> No coinciden</span>';
        btn.disabled = true;
    } else {
        status.innerHTML = '<span style="color:var(--yellow)">Mínimo 12 caracteres requeridos</span>';
        btn.disabled = true;
    }
}

async function changePassword() {
    const btn = document.getElementById('btnChangePass');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
    btn.disabled = true;

    try {
        await new Promise(r => setTimeout(r, 1200));
        closeModal('changePasswordModal');
        showToast('✓ Contraseña actualizada', 'success');

        document.getElementById('currentPass').value = '';
        document.getElementById('newPass').value = '';
        document.getElementById('confirmPass').value = '';
        document.getElementById('strengthFill').style.width = '0';
        document.getElementById('matchStatus').textContent = '';
    } catch (err) {
        showToast('Error al cambiar contraseña', 'error');
    } finally {
        btn.innerHTML = 'Actualizar Contraseña';
        btn.disabled = false;
    }
}

// ── 2FA Toggle ─────────────────────────────────────
function toggle2FA() {
    const enabled = document.getElementById('toggle2fa').checked;
    showToast(enabled ? '✓ 2FA activado' : '2FA desactivado', enabled ? 'success' : 'info');
}

// ── Sessions ───────────────────────────────────────
function endSession(btn) {
    if (confirm('¿Cerrar esta sesión?')) {
        btn.closest('.session-item').remove();
        showToast('Sesión cerrada', 'success');
    }
}

function endAllSessions() {
    if (confirm('¿Cerrar TODAS las sesiones excepto la actual?')) {
        document.querySelectorAll('.session-item:not(.current)').forEach(el => el.remove());
        closeModal('sessionsModal');
        showToast('✓ Todas las sesiones cerradas', 'success');
    }
}

// ── API Keys ───────────────────────────────────────
function copyApiKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showToast('✓ Clave copiada al portapapeles', 'success');
    });
}

function revokeApiKey(btn) {
    if (confirm('¿Revocar esta clave API? Las aplicaciones que la usen dejarán de funcionar.')) {
        btn.closest('.api-key-item').remove();
        showToast('Clave revocada', 'success');
    }
}

function createApiKey() {
    const name = prompt('Nombre para la nueva clave API:', 'Nueva Integración');
    if (name) {
        showToast('✓ Nueva clave generada: pk_live_' + Math.random().toString(36).substr(2, 12) + '...', 'success');
    }
}

// ── Delete Account ─────────────────────────────────
function checkDeleteConfirm() {
    const input = document.getElementById('deleteConfirm');
    const btn = document.getElementById('btnDeleteAccount');
    if (btn) {
        btn.disabled = input.value.trim().toUpperCase() !== 'ELIMINAR';
    }
}

function deleteAccount() {
    if (document.getElementById('deleteConfirm').value.trim().toUpperCase() === 'ELIMINAR') {
        if (confirm('⚠️ ÚLTIMA CONFIRMACIÓN: ¿Estás 100% seguro de eliminar tu cuenta? Esta acción NO se puede deshacer.')) {
            showToast('Cuenta eliminada. Gracias por usar Portal Pilot.', 'info');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 2000);
        }
    }
}

// ── ID Card ────────────────────────────────────────
function openIdCard() {
    window.open('tarjeta.html', '_blank');
}

// ── Utilities ──────────────────────────────────────
function exportProfile() {
    showToast('Preparando exportación de datos...', 'info');
    setTimeout(() => {
        showToast('✓ Exportación completada', 'success');
    }, 2000);
}

function downloadData() {
    showToast('Generando archivo con tus datos...', 'info');
    setTimeout(() => {
        showToast('✓ Descarga iniciada', 'success');
    }, 1500);
}

// ── Initialize ─────────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(() => {
        document.querySelectorAll('.reveal').forEach((el, i) => {
            setTimeout(() => el.classList.add('in'), i * 50);
        });
    }, 100);

    // Disable all form fields by default
    document.querySelectorAll('.field input, .field select, .field textarea').forEach(el => {
        el.disabled = true;
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (hasChanges) saveProfile();
    }
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        openModal('notificationsModal');
    }
});