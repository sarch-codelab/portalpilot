// ── Custom Cursor (OPTIMIZADO) ─────────────────────
const dot = document.getElementById('cursor-dot');
const ring = document.getElementById('cursor-ring');
let mouseX = 0, mouseY = 0;
let ringX = 0, ringY = 0;
let isTouchDevice = 'ontouchstart' in window;

// Solo activar cursor personalizado en desktop
if (!isTouchDevice) {
    // Throttled mousemove (máximo 60fps)
    let lastMoveTime = 0;
    document.addEventListener('mousemove', (e) => {
        const now = performance.now();
        if (now - lastMoveTime < 16) return; // ~60fps
        lastMoveTime = now;

        mouseX = e.clientX;
        mouseY = e.clientY;

        // Dot sigue al mouse instantáneamente con transform (más rápido que left/top)
        dot.style.transform = `translate3d(${mouseX - 3}px, ${mouseY - 3}px, 0)`;
    }, { passive: true });

    // Ring con interpolación suave usando requestAnimationFrame
    function animateRing() {
        ringX += (mouseX - ringX) * 0.15;
        ringY += (mouseY - ringY) * 0.15;
        ring.style.transform = `translate3d(${ringX - 18}px, ${ringY - 18}px, 0)`;
        requestAnimationFrame(animateRing);
    }
    animateRing();

    // Hover effects
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card, .integration-card');
        if (target) {
            ring.style.width = '50px';
            ring.style.height = '50px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.9)';
        }
    }, { passive: true });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('a, button, .sidebar-link, .btn, .tab-btn, .bot-card, .stat-card, .integration-card');
        if (target) {
            ring.style.width = '36px';
            ring.style.height = '36px';
            ring.style.borderColor = 'rgba(139, 92, 246, 0.6)';
        }
    }, { passive: true });
}

// ── Toast Notification System ──────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ── Scroll Progress (OPTIMIZADO con throttle) ──────
let lastScrollTime = 0;
window.addEventListener('scroll', () => {
    const now = performance.now();
    if (now - lastScrollTime < 16) return;
    lastScrollTime = now;

    const p = (window.scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100;
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = p + '%';
}, { passive: true });

// ── Reveal on Scroll ───────────────────────────────
const obs = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
        if (e.isIntersecting) {
            setTimeout(() => e.target.classList.add('in'), i * 30);
            obs.unobserve(e.target); // Dejar de observar una vez revelado
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
        // Re-render charts con el nuevo tema
        if (typeof renderCharts === 'function') renderCharts();
    });
}

// ── Logout Confirmation Modal ──────────────────────
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutModal.classList.add('active');
    });
}

if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        logoutModal.classList.remove('active');
    });
}

if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
        logoutModal.classList.remove('active');
        localStorage.removeItem('token');
        showToast('Sesión cerrada. Redirigiendo...', 'info');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1000);
    });
}

if (logoutModal) {
    logoutModal.addEventListener('click', (e) => {
        if (e.target === logoutModal) {
            logoutModal.classList.remove('active');
        }
    });
}

// ── Tabs Navigation ────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        const tabId = btn.dataset.tab;
        document.getElementById(tabId).classList.add('active');

        // Reveal animations en el nuevo tab
        setTimeout(() => {
            document.querySelectorAll('#' + tabId + ' .reveal').forEach((el, i) => {
                setTimeout(() => el.classList.add('in'), i * 30);
            });
        }, 50);

        // Re-render charts si es overview
        if (tabId === 'overview' && typeof renderCharts === 'function') {
            setTimeout(renderCharts, 100);
        }
    });
});

// ── Modal Functions ────────────────────────────────
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlayModal => {
    overlayModal.addEventListener('click', e => {
        if (e.target === overlayModal && overlayModal.id !== 'logoutModal') {
            overlayModal.classList.remove('active');
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => {
            if (m.id !== 'logoutModal') m.classList.remove('active');
        });
    }

    // Ctrl+B para buscar usuarios
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        const usersTab = document.querySelector('[data-tab="users"]');
        if (usersTab) {
            usersTab.click();
            setTimeout(() => {
                const searchInput = document.getElementById('userSearchInput');
                if (searchInput) searchInput.focus();
            }, 200);
        }
    }
});

// ── User Stats Toggle (cada 12 segundos) ───────────
let usersStatActive = true;
const usersStatData = {
    activos: { value: 24, trend: '+12% este mes', trendClass: 'up', icon: 'fa-arrow-up' },
    inactivos: { value: 8, trend: '-5% este mes', trendClass: 'down', icon: 'fa-arrow-down' }
};

function toggleUsersStat() {
    const valueEl = document.getElementById('usersStatValue');
    const labelEl = document.getElementById('usersStatLabel');
    const trendEl = document.getElementById('usersStatTrend');
    const iconEl = document.querySelector('#usersStatCard .stat-card-icon');

    if (!valueEl) return;

    usersStatActive = !usersStatActive;
    const data = usersStatActive ? usersStatData.activos : usersStatData.inactivos;

    valueEl.classList.add('changing');

    setTimeout(() => {
        valueEl.textContent = data.value;
        labelEl.textContent = usersStatActive ? 'Usuarios Activos' : 'Usuarios Inactivos';
        trendEl.className = `stat-card-trend ${data.trendClass}`;
        trendEl.innerHTML = `<i class="fas ${data.icon}"></i> ${data.trend}`;

        if (iconEl) {
            if (usersStatActive) {
                iconEl.style.background = 'rgba(52, 211, 153, 0.15)';
                iconEl.style.color = 'var(--green)';
                iconEl.innerHTML = '<i class="fas fa-users"></i>';
            } else {
                iconEl.style.background = 'rgba(251, 191, 36, 0.15)';
                iconEl.style.color = 'var(--yellow)';
                iconEl.innerHTML = '<i class="fas fa-user-clock"></i>';
            }
        }

        valueEl.classList.remove('changing');
    }, 250);
}

setInterval(toggleUsersStat, 12000);

// ── Charts (Chart.js OPTIMIZADO) ───────────────────
let tokensChart = null;
let rpaChart = null;

function renderCharts() {
    const tokensCtx = document.getElementById('tokensChart');
    const rpaCtx = document.getElementById('rpaChart');

    if (!tokensCtx || !rpaCtx) return;

    // Destruir charts anteriores
    if (tokensChart) {
        tokensChart.destroy();
        tokensChart = null;
    }
    if (rpaChart) {
        rpaChart.destroy();
        rpaChart = null;
    }

    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#475569' : '#9ca3af';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.1)' : 'rgba(139, 92, 246, 0.1)';

    // Configuración común optimizada
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 600, // Animación rápida pero suave
            easing: 'easeOutQuart'
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                enabled: true,
                backgroundColor: isLight ? '#fff' : '#0e0e1c',
                titleColor: isLight ? '#0f172a' : '#fff',
                bodyColor: isLight ? '#334155' : '#c4c4d4',
                borderColor: isLight ? 'rgba(15, 23, 42, 0.2)' : 'rgba(139, 92, 246, 0.22)',
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8,
                displayColors: false,
                animation: { duration: 150 }
            }
        },
        scales: {
            x: {
                grid: { color: gridColor, drawBorder: false },
                ticks: { color: textColor, font: { size: 10 } }
            },
            y: {
                grid: { color: gridColor, drawBorder: false },
                ticks: { color: textColor, font: { size: 10 } }
            }
        },
        interaction: {
            intersect: false,
            mode: 'index'
        }
    };

    // Tokens IA Chart (línea)
    tokensChart = new Chart(tokensCtx, {
        type: 'line',
        data: {
            labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
            datasets: [{
                label: 'Tokens IA',
                data: [320000, 480000, 650000, 820000],
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: commonOptions
    });

    // RPA Chart (barras)
    rpaChart = new Chart(rpaCtx, {
        type: 'bar',
        data: {
            labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
            datasets: [{
                label: 'Ejecuciones',
                data: [1240, 1580, 1890, 1420, 2100, 980, 760],
                backgroundColor: 'rgba(167, 139, 250, 0.7)',
                borderColor: '#a78bfa',
                borderWidth: 1,
                borderRadius: 6,
                hoverBackgroundColor: '#a78bfa'
            }]
        },
        options: {
            ...commonOptions,
            plugins: {
                ...commonOptions.plugins,
                tooltip: {
                    ...commonOptions.plugins.tooltip,
                    callbacks: {
                        label: function (context) {
                            return `${context.parsed.y.toLocaleString()} ejecuciones`;
                        }
                    }
                }
            }
        }
    });
}

function refreshCharts() {
    showToast('Gráficos actualizados', 'info');
    renderCharts();
}

// Render charts al cargar
window.addEventListener('load', () => {
    setTimeout(renderCharts, 300);
});

// Actualizar charts al cambiar periodo
const chartPeriodSelect = document.getElementById('chartPeriodSelect');
if (chartPeriodSelect) {
    chartPeriodSelect.addEventListener('change', function () {
        showToast(`Periodo: ${this.value}`, 'info');
        renderCharts();
    });
}

// ── User Search ────────────────────────────────────
const userSearchInput = document.getElementById('userSearchInput');
if (userSearchInput) {
    userSearchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        const rows = document.querySelectorAll('#usersTableBody tr');

        rows.forEach(row => {
            const name = row.dataset.userName?.toLowerCase() || '';
            const email = row.dataset.userEmail?.toLowerCase() || '';
            const role = row.dataset.userRole?.toLowerCase() || '';

            const match = name.includes(searchTerm) || email.includes(searchTerm) || role.includes(searchTerm);
            row.style.display = match ? '' : 'none';
        });
    });
}

// ── Edit User ──────────────────────────────────────
let currentEditRow = null;

function editUser(btn) {
    const row = btn.closest('tr');
    currentEditRow = row;

    const name = row.dataset.userName;
    const email = row.dataset.userEmail;
    const role = row.dataset.userRole;
    const status = row.dataset.userStatus;

    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    document.getElementById('editUserAvatar').textContent = initials;
    document.getElementById('editUserName').textContent = name;
    document.getElementById('editUserEmail').textContent = email;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserStatus').value = status;

    openModal('editUserModal');
}

function saveUserEdit() {
    if (!currentEditRow) return;

    const newRole = document.getElementById('editUserRole').value;
    const newStatus = document.getElementById('editUserStatus').value;

    currentEditRow.dataset.userRole = newRole;
    currentEditRow.dataset.userStatus = newStatus;

    // Actualizar badge de rol
    const roleBadge = currentEditRow.querySelector('.role-badge');
    if (roleBadge) {
        roleBadge.className = 'role-badge';
        if (newRole === 'Administrador') {
            roleBadge.classList.add('admin');
            roleBadge.textContent = 'Admin';
        } else if (newRole === 'Operador') {
            roleBadge.classList.add('operator');
            roleBadge.textContent = 'Operador';
        } else {
            roleBadge.classList.add('viewer');
            roleBadge.textContent = 'Viewer';
        }
    }

    // Actualizar estado
    const statusCell = currentEditRow.querySelectorAll('td')[2];
    if (statusCell) {
        if (newStatus === 'Activo') {
            statusCell.innerHTML = `<span style="color:var(--green);font-size:12px;"><span class="status-dot" style="background:var(--green);"></span>Activo</span>`;
        } else if (newStatus === 'Inactivo') {
            statusCell.innerHTML = `<span style="color:var(--yellow);font-size:12px;"><span class="status-dot" style="background:var(--yellow);"></span>Inactivo</span>`;
        } else {
            statusCell.innerHTML = `<span style="color:var(--red);font-size:12px;"><span class="status-dot" style="background:var(--red);"></span>Suspendido</span>`;
        }
    }

    closeModal('editUserModal');
    showToast('Usuario actualizado correctamente', 'success');
}

// ── Delete User ────────────────────────────────────
let currentDeleteRow = null;

function deleteUser(btn) {
    const row = btn.closest('tr');
    currentDeleteRow = row;

    const name = row.dataset.userName;
    document.getElementById('deleteUserName').textContent = name;

    openModal('deleteUserModal');
}

function confirmDeleteUser() {
    if (!currentDeleteRow) return;

    const name = currentDeleteRow.dataset.userName;

    currentDeleteRow.style.transition = 'all 0.3s ease';
    currentDeleteRow.style.opacity = '0';
    currentDeleteRow.style.transform = 'translateX(-20px)';

    setTimeout(() => {
        currentDeleteRow.remove();
        currentDeleteRow = null;
        showToast(`Usuario ${name} eliminado`, 'success');
    }, 300);

    closeModal('deleteUserModal');
}

// ── Invite User ────────────────────────────────────
async function inviteUser(event) {
    const form = document.getElementById('addUserForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const email = document.getElementById('inviteEmail').value.trim();
    const rol = document.getElementById('inviteRole').value;

    if (!email || !rol) {
        showToast('Completa los campos obligatorios', 'error');
        return;
    }

    const btn = event.target;
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
    btn.disabled = true;

    setTimeout(() => {
        const tbody = document.getElementById('usersTableBody');
        const initials = email.split('@')[0].substring(0, 2).toUpperCase();
        const roleClass = rol === 'Administrador' ? 'admin' : (rol === 'Operador' ? 'operator' : 'viewer');
        const roleLabel = rol === 'Administrador' ? 'Admin' : (rol === 'Operador' ? 'Operador' : 'Viewer');
        const displayName = email.split('@')[0];

        const newRow = document.createElement('tr');
        newRow.dataset.userName = displayName;
        newRow.dataset.userEmail = email;
        newRow.dataset.userRole = roleLabel;
        newRow.dataset.userStatus = 'Activo';

        newRow.innerHTML = `
            <td>
                <div class="user-info-cell">
                    <div class="user-avatar-sm">${initials}</div>
                    <div>
                        <div class="user-name-cell">${displayName}</div>
                        <div class="user-email-cell">${email}</div>
                    </div>
                </div>
            </td>
            <td><span class="role-badge ${roleClass}">${roleLabel}</span></td>
            <td><span style="color:var(--yellow);font-size:12px;"><span class="status-dot" style="background:var(--yellow);"></span>Pendiente</span></td>
            <td>Justo ahora</td>
            <td>
                <button class="btn btn-ghost btn-xs" onclick="editUser(this)"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-xs" onclick="deleteUser(this)"><i class="fas fa-trash"></i></button>
            </td>
        `;

        tbody.insertBefore(newRow, tbody.firstChild);

        form.reset();
        btn.innerHTML = origText;
        btn.disabled = false;

        closeModal('addUserModal');
        showToast(`Invitación enviada a ${email}`, 'success');
    }, 800);
}

// ── Bot Configuration ──────────────────────────────
function saveBotConfig() {
    const name = document.getElementById('botConfigName').value;
    closeModal('botConfigModal');
    showToast(`Bot "${name}" configurado`, 'success');
}

function createNewBot() {
    closeModal('newBotModal');
    showToast('Nuevo bot creado exitosamente', 'success');
}

// ── API Keys ───────────────────────────────────────
function copyApiKey(btn, fullKey) {
    navigator.clipboard.writeText(fullKey).then(() => {
        showToast('API Key copiada', 'success');
    }).catch(() => {
        showToast('Error al copiar', 'error');
    });
}

function editApiKey(btn) {
    const item = btn.closest('.api-key-item');
    const name = item.querySelector('.api-key-name').textContent;
    showToast(`Editando: ${name}`, 'info');
}

function deleteApiKey(btn) {
    if (!confirm('¿Eliminar esta API Key?')) return;

    const item = btn.closest('.api-key-item');
    item.style.transition = 'all 0.3s ease';
    item.style.opacity = '0';
    item.style.transform = 'translateX(-20px)';
    setTimeout(() => {
        item.remove();
        showToast('API Key eliminada', 'success');
    }, 300);
}

function generateApiKey() {
    const name = document.getElementById('keyName').value;
    if (!name) {
        showToast('Ingresa un nombre para la API Key', 'error');
        return;
    }

    const newKey = `pk_live_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 6)}`;
    const maskedKey = newKey.substring(0, 11) + '••••••' + newKey.substring(newKey.length - 4);

    const container = document.getElementById('apiKeysContainer');
    const newItem = document.createElement('div');
    newItem.className = 'api-key-item';
    newItem.innerHTML = `
        <div>
            <div class="api-key-name">${name}</div>
            <div class="api-key-value">${maskedKey}</div>
            <div class="api-key-meta">Creada: Hoy · Última usada: Nunca</div>
        </div>
        <div class="api-key-actions">
            <button class="btn btn-ghost btn-xs" onclick="copyApiKey(this, '${newKey}')"><i class="fas fa-copy"></i> Copiar</button>
            <button class="btn btn-outline btn-xs" onclick="editApiKey(this)"><i class="fas fa-edit"></i> Editar</button>
            <button class="btn btn-danger btn-xs" onclick="deleteApiKey(this)"><i class="fas fa-trash"></i></button>
        </div>
    `;

    container.insertBefore(newItem, container.firstChild);

    closeModal('apiKeyModal');
    document.getElementById('keyName').value = '';
    showToast(`API Key "${name}" generada`, 'success');
}

// ── Integrations ───────────────────────────────────
function disconnectIntegration(name) {
    if (confirm(`¿Desconectar ${name}?`)) {
        showToast(`${name} desconectado`, 'info');
    }
}

function connectNewIntegration() {
    showToast('Abriendo catálogo de integraciones...', 'info');
}

// ── Billing ────────────────────────────────────────
function downloadInvoice() {
    showToast('Descargando factura...', 'info');
    setTimeout(() => showToast('Factura descargada', 'success'), 1000);
}

function updatePayment() {
    openModal('addPaymentModal');
}

function editPaymentMethod() {
    showToast('Editando método de pago...', 'info');
}

function addPaymentMethod() {
    closeModal('addPaymentModal');
    showToast('Método de pago agregado', 'success');
}

function viewPlans() {
    showToast('Abriendo catálogo de planes...', 'info');
}

// ── Logs ───────────────────────────────────────────
function filterLogs() {
    const filter = document.getElementById('logsFilter').value;
    const items = document.querySelectorAll('#logsTimeline .log-item');

    items.forEach(item => {
        item.style.display = (filter === 'all' || item.dataset.type === filter) ? '' : 'none';
    });
}

function exportLogs() {
    showToast('Exportando logs...', 'info');
    setTimeout(() => showToast('Logs exportados', 'success'), 1000);
}

// ── Settings ───────────────────────────────────────
function saveSettings() {
    showToast('Configuración guardada', 'success');
}

function resetSettings() {
    if (confirm('¿Restaurar configuración predeterminada?')) {
        showToast('Configuración restaurada', 'info');
    }
}

function confirmDelete() {
    if (prompt('Escribe ELIMINAR para confirmar:') !== 'ELIMINAR') {
        showToast('Operación cancelada', 'info');
        return;
    }
    showToast('Tenant eliminado', 'error');
    setTimeout(() => window.location.href = 'tenants.html', 1000);
}

function executeSuspend() {
    closeModal('suspendModal');
    showToast('Tenant suspendido', 'success');
}

// ── Open Tenant Portal ─────────────────────────────
function openTenantPortal() {
    const domain = document.getElementById('tenant-domain')?.textContent ||
        document.getElementById('openPortalBtn')?.dataset.domain || '';
    if (!domain) {
        showToast('Dominio no disponible', 'error');
        return;
    }
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    window.open(url, '_blank');
}

// ── Initialize ─────────────────────────────────────
window.addEventListener('load', () => {
    setTimeout(() => {
        document.querySelectorAll('.reveal').forEach((el, i) => {
            setTimeout(() => el.classList.add('in'), i * 30);
        });
    }, 100);

    const backBtn = document.getElementById('backBtn');
    if (backBtn && document.referrer.includes('tenants.html')) {
        backBtn.style.display = 'flex';
    }
});

// ── Load Tenant Data from API ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        console.warn('⚠️ No se encontró token.');
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');

    if (!tenantId) {
        console.error('❌ Falta ?id= en la URL');
        return;
    }

    fetch(`/api/tenant/${encodeURIComponent(tenantId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => {
            if (!res.ok) throw new Error('Error al cargar tenant');
            return res.json();
        })
        .then(data => {
            const preview = data.preview || {};
            const detail = data.detail || {};

            document.getElementById('tenant-name').textContent = preview.name || 'Sin nombre';
            document.getElementById('tenantNameDisplay').textContent = preview.name || 'Sin nombre';
            document.getElementById('tenant-domain').textContent = preview.domain || 'sin dominio';
            document.getElementById('tenant-id').textContent = preview.id || tenantId;
            document.getElementById('tenant-country').textContent = preview.country || 'N/A';
            document.getElementById('tenant-timezone').textContent = detail.timezone || 'N/A';

            if (preview.logo) {
                const logoEl = document.querySelector('.tenant-logo');
                if (logoEl) {
                    logoEl.innerHTML = `<img src="${preview.logo}" alt="Logo">`;
                }
            }
        })
        .catch(err => {
            console.error('❌ Error:', err.message);
        });
});