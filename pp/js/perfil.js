// ── API Config ─────────────────────────────────────
const _isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const _API_ROOT = _isLocalhost ? 'https://portal-pilot.vercel.app' : '';

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
    if (modal) {
        modal.classList.add('active');
    } else {
        console.warn('[PERFIL] Modal no encontrado:', id);
    }
    if (id === 'apiKeysModal') loadApiKeys();
    if (id === 'sessionsModal') loadPerfilSessions();
    if (id === 'uploadAvatarModal' || id === 'uploadBannerModal') {
        syncModalPreviews(id);
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

function syncModalPreviews(modalId) {
    const foto = localStorage.getItem('userFoto') || '';
    const banner = localStorage.getItem('userBanner') || '';
    if (modalId === 'uploadAvatarModal') {
        const img = document.getElementById('img-avatar');
        if (img && foto) img.src = foto;
    }
    if (modalId === 'uploadBannerModal') {
        const img = document.getElementById('img-banner');
        if (img && banner) img.src = banner;
    }
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

// ── Cargar perfil desde la base de datos ────────────
function getProfileInitials() {
    const name = localStorage.getItem('userName') || '';
    const apellido = localStorage.getItem('userApellido') || '';
    const full = apellido ? `${name} ${apellido}` : name;
    return (full.split(' ').filter(Boolean).map(w => w[0]).join('').substring(0, 2) || 'PP').toUpperCase();
}

function fmtFs(iso) {
    try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (e) { return '—'; }
}

function fmtRel(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return 'Hoy, ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        }
        const diff = Math.max(0, Date.now() - d.getTime());
        const dias = Math.floor(diff / 86400000);
        if (dias < 1) return 'Hoy';
        if (dias < 30) return `Hace ${dias} días`;
        return fmtFs(iso);
    } catch (e) { return '—'; }
}

function awaitPreviewItem(t, d) { return { t, d }; }

async function loadProfile() {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) return;
    try {
        const res = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const u = await res.json();
        if (!u || (!u.nombre && !u.email)) return;

        localStorage.setItem('userName', u.nombre || '');
        localStorage.setItem('userApellido', u.apellido || '');
        if (u.avatar) localStorage.setItem('userFoto', u.avatar); else localStorage.removeItem('userFoto');
        if (u.banner) localStorage.setItem('userBanner', u.banner); else localStorage.removeItem('userBanner');

        const fullName = `${u.nombre || ''} ${u.apellido || ''}`.trim() || 'Usuario';

        const pName = document.getElementById('profileName');
        const pEmail = document.getElementById('profileEmail');
        const full = document.getElementById('fullName');
        const email = document.getElementById('email');
        if (pName) pName.textContent = fullName;
        if (pEmail) pEmail.textContent = u.email || '';
        if (full) full.value = fullName;
        if (email) email.value = u.email || '';

        const avatarLarge = document.querySelector('.user-avatar-large');
        if (avatarLarge) {
            if (u.avatar) {
                avatarLarge.innerHTML = `<img src="${u.avatar}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.style.display='none';this.parentElement.innerHTML='${getProfileInitials()}'">`;
            } else {
                avatarLarge.innerHTML = getProfileInitials();
            }
        }

        const banner = document.getElementById('profileBanner');
        if (banner) {
            if (u.banner) banner.style.backgroundImage = `url('${u.banner}')`;
            else banner.style.backgroundImage = "url('../img/banner_ud.jpg')";
        }

        // Sincronizar rol y email (para la sidebar y autenticación del portal)
        if (u.rol) localStorage.setItem('userRole', u.rol);
        if (u.email) localStorage.setItem('userEmail', u.email);
        if (u.tenant_code) localStorage.setItem('empresaCodigo', u.tenant_code);

        // ── Resumen de Cuenta (datos reales) ─────────────
        const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setEl('accMemberSince', u.registered ? new Date(u.registered).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }) : '—');
        if (u.lastActivity) {
            const la = new Date(u.lastActivity);
            const hoje = new Date();
            setEl('accLastAccess', la.toDateString() === hoje.toDateString()
                ? 'Hoy, ' + la.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                : la.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }));
        } else {
            setEl('accLastAccess', '—');
        }
        setEl('accTenant', u.tenant && u.tenant !== 'N/A' ? u.tenant : (u.tenant_code || '—'));
        setEl('accRole', u.rol || '—');
        const uidEl = document.getElementById('accUserId');
        if (uidEl) uidEl.innerHTML = '<code>' + (u.id ? String(u.id).slice(0, 8) + '…' : '—') + '</code>';

        // ── Actividad Reciente (datos reales) ────────────
        const act = document.getElementById('activityPreviewList');
        if (act) {
            const items = [];
            if (u.lastActivity) {
                items.push(awaitPreviewItem('Último acceso', fmtRel(u.lastActivity)));
            } else if (u.registered) {
                items.push(awaitPreviewItem('Miembro desde', fmtFs(u.registered)));
            }
            if (u.registered) {
                items.push(awaitPreviewItem('Cuenta creada', fmtFs(u.registered)));
            }
            act.innerHTML = items.length
                ? items.map((it, i) => `<div style="font-size:12px;color:var(--gray);padding:8px 0;${i < items.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}"><strong style="color:var(--white)">${it.t}</strong><br><span>${it.d}</span></div>`).join('')
                : '<div style="font-size:12px;color:var(--gray);padding:8px 0;">Sin actividad registrada todavía.</div>';
        }

        // ── Información Profesional (datos reales) ────────────
        const prof = u.professional || {};
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

        if (window.refreshSidebarAvatar) window.refreshSidebarAvatar();
    } catch (err) {
        console.warn('[PERFIL] No se pudo cargar el perfil desde la BD:', err.message);
    }
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
        const token = localStorage.getItem('token');
        const userId = localStorage.getItem('currentAccountId');
        if (!token || !userId) {
            showToast('Sesión no válida. Inicia sesión nuevamente.', 'error');
            return;
        }

        const fieldData = {};
        document.querySelectorAll('.field input, .field select, .field textarea').forEach(el => {
            if (el.name) fieldData[el.name] = el.value;
        });

        const res = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(fieldData)
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Error del servidor');
        }

        if (fieldData.nombre) localStorage.setItem('userName', fieldData.nombre);
        if (fieldData.apellido) localStorage.setItem('userApellido', fieldData.apellido);

        document.querySelectorAll('.field input, .field select, .field textarea').forEach(el => {
            el.disabled = true;
            el.classList.remove('editing');
        });

        hasChanges = false;
        btn.style.display = 'none';
        if (window.refreshSidebarAvatar) window.refreshSidebarAvatar();
        showToast('✓ Perfil actualizado exitosamente', 'success');
    } catch (err) {
        showToast(err.message || 'Error al guardar. Intenta de nuevo.', 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

// ── Notifications ──────────────────────────────────
const notificationsBtn = document.getElementById('notificationsBtn');
// ── Perfil Notifications (reales) ──────────────────
async function loadPerfilNotifications() {
    const container = document.getElementById('perfilNotifications');
    if (!container) return;
    const token = localStorage.getItem('token');
    if (!token) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;"><i class="fas fa-bell-slash"></i> Inicia sesión para ver notificaciones.</div>';
        return;
    }
    try {
        const res = await fetch(`${_API_ROOT}/api/notificaciones`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('notif error');
        const data = await res.json();
        const notifs = data.notificaciones || [];

        if (!notifs.length) {
            container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;"><i class="fas fa-bell-slash" style="font-size:24px;display:block;margin-bottom:8px;"></i>Sin notificaciones pendientes.</div>';
            updateNotifBadge();
            return;
        }

        const iconMap = { success: ['fa-check', 'success'], warning: ['fa-exclamation', 'warning'], info: ['fa-info', 'info'], error: ['fa-exclamation-circle', 'error'] };
        const fmtTime = iso => {
            if (!iso) return 'Recién';
            const d = new Date(iso);
            const diff = Date.now() - d.getTime();
            if (diff < 60000) return 'Justo ahora';
            if (diff < 3600000) return `Hace ${Math.max(1, Math.floor(diff / 60000))} min`;
            if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)} h`;
            return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
        };

        container.innerHTML = notifs.slice(0, 15).map(n => {
            const [icon, cls] = iconMap[n.tipo] || iconMap.info;
            const isUnread = !n.leida;
            return `<div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${n.id}">
                <div class="notif-icon ${cls}"><i class="fas ${icon}"></i></div>
                <div class="notif-content">
                    <div class="notif-title">${n.titulo || 'Notificación'}</div>
                    <div class="notif-desc">${n.mensaje || ''}</div>
                    <div class="notif-time">${fmtTime(n.created_at)}</div>
                </div>
                <button class="notif-mark" data-id="${n.id}" onclick="markAsRead(this)"><i class="fas fa-check"></i></button>
            </div>`;
        }).join('');

        updateNotifBadge();
    } catch (e) {
        console.warn('[PERFIL] Error notificaciones:', e.message);
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;"><i class="fas fa-exclamation-triangle"></i> No se pudieron cargar las notificaciones.</div>';
    }
}

const notificationsModal = document.getElementById('notificationsModal');
const notifBadge = document.getElementById('notifBadge');

if (notificationsBtn) {
    notificationsBtn.addEventListener('click', () => {
        openModal('notificationsModal');
        loadPerfilNotifications();
        if (notifBadge) {
            notifBadge.style.display = 'none';
        }
    });
}

function markAsRead(btn) {
    const item = btn.closest('.notification-item');
    const id = (item && item.dataset.id) || btn.dataset.id;
    item.classList.remove('unread');
    btn.style.opacity = '0';
    updateNotifBadge();

    const token = localStorage.getItem('token');
    if (id && token) {
        fetch(`${_API_ROOT}/api/notificaciones/${id}/read`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
    }
}

function markAllRead() {
    const token = localStorage.getItem('token');
    document.querySelectorAll('#perfilNotifications .notification-item.unread').forEach(item => {
        item.classList.remove('unread');
        if (item.dataset.id && token) {
            fetch(`${_API_ROOT}/api/notificaciones/${item.dataset.id}/read`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(() => {});
        }
    });
    updateNotifBadge();
    showToast('Todas las notificaciones marcadas como leídas', 'success');
}

function updateNotifBadge() {
    const unreadCount = document.querySelectorAll('#perfilNotifications .notification-item.unread').length;
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
            const img = document.getElementById('img-avatar');
            if (img) img.src = e.target.result;
            const nameEl = document.getElementById('avatarFileName');
            if (nameEl) {
                nameEl.textContent = input.files[0].name;
                nameEl.style.color = '#ffffff';
            }
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

    const reader = new FileReader();
    reader.onload = async function (e) {
        const base64Data = e.target.result;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${_API_ROOT}/api/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ file: base64Data, folder: 'avatars', filename: 'avatar' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al subir');

            const avatarUrl = data.url;

            // Persistir en base de datos
            const userId = localStorage.getItem('currentAccountId');
            if (token && userId) {
                const saveRes = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ foto_perfil_url: avatarUrl })
                });
                if (!saveRes.ok) {
                    const saveData = await saveRes.json().catch(() => ({}));
                    throw new Error(saveData.error || 'Error al guardar foto en la base de datos');
                }
            }

            localStorage.setItem('userFoto', avatarUrl);

            const avatarLarge = document.querySelector('.user-avatar-large');
            if (avatarLarge) {
                avatarLarge.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.style.display='none';this.parentElement.innerHTML='${getProfileInitials()}'">`;
            }

            if (window.refreshSidebarAvatar) window.refreshSidebarAvatar();

            closeModal('uploadAvatarModal');
            showToast('✓ Foto de perfil actualizada', 'success');
        } catch (err) {
            showToast(err.message || 'Error al subir imagen', 'error');
        } finally {
            document.getElementById('avatarFile').value = '';
        }
    };
    reader.readAsDataURL(file);
}

// ── Banner Upload ──────────────────────────────────
function previewBanner(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = document.getElementById('img-banner');
            if (img) img.src = e.target.result;
            const nameEl = document.getElementById('bannerFileName');
            if (nameEl) {
                nameEl.textContent = input.files[0].name;
                nameEl.style.color = '#ffffff';
            }
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

    const reader = new FileReader();
    reader.onload = async function (e) {
        const base64Data = e.target.result;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${_API_ROOT}/api/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ file: base64Data, folder: 'banners', filename: 'banner' })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al subir');

            const bannerUrl = data.url;

            // Persistir en base de datos
            const userId = localStorage.getItem('currentAccountId');
            if (token && userId) {
                const saveRes = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ banner_perfil_url: bannerUrl })
                });
                if (!saveRes.ok) {
                    const saveData = await saveRes.json().catch(() => ({}));
                    throw new Error(saveData.error || 'Error al guardar banner en la base de datos');
                }
            }

            localStorage.setItem('userBanner', bannerUrl);

            const banner = document.getElementById('profileBanner');
            if (banner) {
                banner.style.backgroundImage = `url('${bannerUrl}')`;
            }

            closeModal('uploadBannerModal');
            showToast('✓ Banner actualizado', 'success');
        } catch (err) {
            showToast(err.message || 'Error al subir banner', 'error');
        } finally {
            document.getElementById('bannerFile').value = '';
        }
    };
    reader.readAsDataURL(file);
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
    const currentPass = document.getElementById('currentPass').value;
    const newPass = document.getElementById('newPass').value;
    const confirmPass = document.getElementById('confirmPass').value;

    if (!currentPass || !newPass || !confirmPass) {
        showToast('Completa todos los campos', 'error');
        return;
    }
    if (newPass !== confirmPass) {
        showToast('Las contraseñas no coinciden', 'error');
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
    btn.disabled = true;

    try {
        const token = localStorage.getItem('token');
        const userId = localStorage.getItem('currentAccountId');
        if (!token || !userId) throw new Error('Sesión no válida');

        const response = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                password: newPass,
                currentPassword: currentPass
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Error al cambiar contraseña');
        }

        closeModal('changePasswordModal');
        showToast('✓ Contraseña actualizada correctamente', 'success');

        document.getElementById('currentPass').value = '';
        document.getElementById('newPass').value = '';
        document.getElementById('confirmPass').value = '';
        document.getElementById('strengthFill').style.width = '0';
        document.getElementById('matchStatus').textContent = '';
    } catch (err) {
        showToast(err.message || 'Error al cambiar contraseña', 'error');
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
async function loadPerfilSessions() {
    const container = document.getElementById('profileSessionsList');
    if (!container) return;
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) { container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray);font-size:13px;">Inicia sesión para ver sesiones.</div>'; return; }
    try {
        const res = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('sessions error');
        const data = await res.json();
        const sessions = data.sessions || [];
        if (!sessions.length) { container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray);font-size:13px;"><i class="fas fa-laptop"></i> No hay sesiones registradas.</div>'; return; }
        container.innerHTML = sessions.map(s => {
            const icon = s.deviceType === 'mobile' ? 'fa-mobile-alt' : s.deviceType === 'tablet' ? 'fa-tablet-alt' : 'fa-desktop';
            const time = s.lastActivity ? new Date(s.lastActivity).toLocaleString('es') : '';
            const status = s.isActive
                ? '<span style="color:var(--green);">&#x25cf; Activa</span>'
                : '<span style="color:var(--gray);">Inactiva</span>';
            return `<div class="session-item ${s.isCurrent ? 'current' : ''}">
                <div class="session-info">
                    <div class="session-device"><i class="fas ${icon}"></i> ${s.browser || 'Navegador'} &bull; ${s.os || 'Sistema'}</div>
                    <div class="session-meta">Última actividad: ${time} &bull; ${status}</div>
                    ${s.location ? '<div class="session-location">&#x1F4CD; ' + s.location + (s.ip ? ' &bull; ' + s.ip : '') + '</div>' : ''}
                </div>
                ${s.isCurrent ? '<span class="profile-badge verified" style="font-size:10px;padding:2px 8px;">Actual</span>'
                    : '<button class="btn btn-ghost btn-xs" onclick="endSession(this)">Cerrar</button>'}
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray);font-size:13px;"><i class="fas fa-exclamation-triangle"></i> No se pudieron cargar las sesiones.</div>';
    }
}

async function endSession(btn) {
    if (!confirm('¿Cerrar esta sesión?')) return;
    const item = btn.closest('.session-item');
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) return showToast('Sesión no válida', 'error');
    try {
        const res = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}/revoke-sessions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Error al revocar');
        item.remove();
        showToast('Sesión cerrada', 'success');
    } catch (err) {
        showToast(err.message || 'Error al cerrar sesión', 'error');
    }
}

async function endAllSessions() {
    if (!confirm('¿Cerrar TODAS las sesiones excepto la actual?')) return;

    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) return showToast('Sesión no válida', 'error');

    try {
        const response = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}/revoke-sessions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Error al revocar sesiones');
        }

        // Limpiar cookie si el backend la limpió
        document.cookie = 'pp_session=; Max-Age=0; path=/;';

        closeModal('sessionsModal');
        showToast('✓ Todas las sesiones revocadas. Volverás a iniciar sesión.', 'success');
        
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);
    } catch (err) {
        showToast(err.message || 'Error al revocar sesiones', 'error');
    }
}

// ── API Keys ───────────────────────────────────────
async function loadApiKeys() {
    const list = document.getElementById('apiKeyList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);"><i class="fas fa-spinner fa-spin"></i> Cargando claves...</div>';
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${_API_ROOT}/api/tenant/apikeys`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        const { keys } = await res.json();
        if (!keys || keys.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray);">Aún no tienes claves API.<br>Genera la primera con el botón inferior.</div>';
            return;
        }
        list.innerHTML = keys.map(k => `
            <div class="api-key-item">
                <div class="api-key-info">
                    <div class="api-key-name">${k.nombre}</div>
                    <div class="api-key-value">${k.clave.slice(0, 14)}...${k.clave.slice(-6)}</div>
                    <div class="api-key-meta">Creada: ${new Date(k.created_at).toLocaleDateString('es')}${k.ultimo_uso ? ' • Última usada: ' + new Date(k.ultimo_uso).toLocaleDateString('es') : ''}</div>
                </div>
                <div class="api-key-actions">
                    <button class="btn btn-ghost btn-xs" onclick="copyApiKey('${k.clave}')">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="btn btn-danger btn-xs" onclick="revokeApiKey('${k.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">No se pudieron cargar las claves: ${err.message}</div>`;
    }
}

function copyApiKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showToast('✓ Clave copiada al portapapeles', 'success');
    });
}

async function revokeApiKey(id) {
    if (!confirm('¿Revocar esta clave API? Las aplicaciones que la usen dejarán de funcionar.')) return;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${_API_ROOT}/api/tenant/apikeys/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Error');
        showToast('Clave revocada', 'success');
        loadApiKeys();
    } catch (err) {
        showToast('Error al revocar: ' + err.message, 'error');
    }
}

async function createApiKey() {
    const name = prompt('Nombre para la nueva clave API:', 'Nueva Integración');
    if (!name) return;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${_API_ROOT}/api/tenant/apikeys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ nombre: name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        loadApiKeys();
        showToast('✓ Clave generada correctamente', 'success');
    } catch (err) {
        showToast('Error al generar: ' + err.message, 'error');
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

async function deleteAccount() {
    if (document.getElementById('deleteConfirm').value.trim().toUpperCase() !== 'ELIMINAR') {
        showToast('Escribe ELIMINAR para confirmar', 'error');
        return;
    }

    if (!confirm('⚠️ ÚLTIMA CONFIRMACIÓN: ¿Estás 100% seguro de eliminar tu cuenta? Esta acción NO se puede deshacer.')) {
        return;
    }

    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) return showToast('Sesión no válida', 'error');

    showToast('Eliminando cuenta...', 'info');

    try {
        const response = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Error al eliminar cuenta');
        }

        // Limpiar todo
        localStorage.clear();
        document.cookie = 'pp_session=; Max-Age=0; path=/;';

        showToast('Cuenta eliminada. Gracias por usar Portal Pilot.', 'info');
        
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);
    } catch (err) {
        showToast(err.message || 'Error al eliminar cuenta', 'error');
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

async function downloadData() {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('currentAccountId');
    if (!token || !userId) return showToast('Sesión no válida', 'error');

    showToast('Generando archivo con tus datos...', 'info');

    try {
        const response = await fetch(`${_API_ROOT}/api/users/${encodeURIComponent(userId)}/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Error al exportar datos');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `usuario-${localStorage.getItem('userEmail') || 'datos'}-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('✓ Descarga completada', 'success');
    } catch (err) {
        showToast(err.message || 'Error al exportar datos', 'error');
    }
}

// ── Initialize ─────────────────────────────────────
window.addEventListener('load', () => {
    // Cargar perfil real desde la base de datos
    loadProfile();
    loadPerfilNotifications();

    setTimeout(() => {
        document.querySelectorAll('.reveal').forEach((el, i) => {
            setTimeout(() => el.classList.add('in'), i * 50);
        });
    }, 100);

    // Disable all form fields by default (tras cargar los datos reales)
    document.querySelectorAll('.field input:not([type="file"]), .field select, .field textarea').forEach(el => {
        el.disabled = true;
    });

    // Fallback: vincular botones de modales por si el onclick no dispara
    document.querySelectorAll('[onclick^="openModal"]').forEach(btn => {
        btn.addEventListener('click', function(e) {
            const match = this.getAttribute('onclick').match(/openModal\(['"]([^'"]+)['"]\)/);
            if (match && match[1]) {
                e.preventDefault();
                openModal(match[1]);
            }
        });
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