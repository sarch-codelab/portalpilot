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

const savedSidebarState = localStorage.getItem('sidebarCollapsed');
if (savedSidebarState === 'true' && !isMobile) {
    sidebar.classList.add('collapsed');
    dashboard.classList.add('sidebar-collapsed');
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
let tenantRealStats = { usuarios: { total: 0, activos: 0 }, bots: { activos: 0 } };

async function loadTenantRealStats() {
    const token = localStorage.getItem('token');
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    if (!tenantId) return;
    try {
        const res = await fetch(`/api/tenant/${encodeURIComponent(tenantId)}/stats`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('stats error');
        const data = await res.json();
        if (data.stats) {
            tenantRealStats = data.stats;
            updateUsersStatCard();
            updateOverviewStatCards();
        }
    } catch (e) {
        console.warn('[TENANT] No se pudo cargar stats reales:', e.message);
    }
}

// ── Poblar tarjetas de overview con stats reales ────
function updateOverviewStatCards() {
    const s = tenantRealStats || {};

    const botsValue = document.getElementById('botsStatValue');
    if (botsValue && s.bots) {
        botsValue.textContent = s.bots.activos != null ? s.bots.activos : '—';
    }

    const tokensValue = document.getElementById('tokensStatValue');
    if (tokensValue && s.tokens) {
        const t = s.tokens.usados || 0;
        tokensValue.textContent = t >= 1000 ? `${(t / 1000).toFixed(1).replace('.', ',')}K` : t;
    }

    const slaValue = document.getElementById('slaStatValue');
    if (slaValue && s.sla) slaValue.textContent = s.sla;

    const invoiceValue = document.getElementById('invoiceStatValue');
    if (invoiceValue && s.facturas) {
        invoiceValue.textContent = s.facturas.total != null ? String(s.facturas.total) : '—';
    }

    const rpaValue = document.getElementById('rpaExecStatValue');
    if (rpaValue && s.bots) {
        rpaValue.textContent = s.bots.total != null ? s.bots.total : '—';
    }
}

// ── Historial completo (modal) ───────────────────────
async function openFullActivityModal() {
    const container = document.getElementById('fullActivityTimeline');
    if (!container) return;
    const token = localStorage.getItem('token');
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    openModal('activityHistoryModal');
    try {
        const res = await fetch(`/api/dashboard/summary?tenant=${encodeURIComponent(tenantId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('activity error');
        const data = await res.json();
        const eventos = data.actividadReciente || [];
        if (!eventos.length) {
            container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin actividad registrada.</div>';
            return;
        }
        container.innerHTML = eventos.slice(0, 15).map(e => {
            const time = e.fecha ? new Date(e.fecha).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Reciente';
            const type = e.tipo;
            return `
                <div class="timeline-item" data-type="${type}">
                    <div class="timeline-dot"></div>
                    <div class="timeline-time">${time}</div>
                    <div class="timeline-action"><strong>${e.titulo}</strong></div>
                    <div class="timeline-details">${e.detalle || ''}</div>
                </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">No se pudo cargar el historial.</div>';
    }
}

// ── Notificaciones del panel (reales) ───────────────
async function loadTenantNotifications() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    if (!list) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch(`/api/notificaciones`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('notif error');
        const data = await res.json();
        const notifs = data.notificaciones || [];
        const unread = data.unread_count != null ? data.unread_count : notifs.filter(n => !n.leida).length;

        if (badge) {
            if (unread > 0) {
                badge.textContent = unread > 99 ? '99+' : unread;
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        if (!notifs.length) {
            list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--gray);font-size:13px;"><i class="fas fa-bell-slash" style="font-size:24px;display:block;margin-bottom:8px;"></i>Sin notificaciones</div>';
            return;
        }

        const iconMap = { success: ['fa-check-circle', 'var(--green)', 'rgba(52,211,153,0.15)'], error: ['fa-exclamation-circle', 'var(--red)', 'rgba(248,113,113,0.15)'], warning: ['fa-exclamation-triangle', 'var(--yellow)', 'rgba(251,191,36,0.15)'], info: ['fa-info-circle', 'var(--accent)', 'rgba(139,92,246,0.15)'] };
        const fmtTime = iso => {
            if (!iso) return 'Recién';
            const d = new Date(iso);
            const diff = Date.now() - d.getTime();
            if (diff < 60000) return 'Justo ahora';
            if (diff < 3600000) return `Hace ${Math.max(1, Math.floor(diff / 60000))} min`;
            if (diff < 86400000) return `Hace ${Math.floor(diff / 3600000)} h`;
            return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
        };

        list.innerHTML = notifs.slice(0, 10).map(n => {
            const [icon, color, bg] = iconMap[n.tipo] || iconMap.info;
            return `<div class="notif-item ${!n.leida ? 'unread' : ''}" data-id="${n.id}">
                <div class="notif-icon" style="background:${bg};color:${color};"><i class="fas ${icon}"></i></div>
                <div class="notif-content"><div class="notif-text">${n.titulo || 'Notificación'}${n.mensaje ? ' — ' + n.mensaje : ''}</div><div class="notif-time">${fmtTime(n.created_at)}</div></div>
            </div>`;
        }).join('');

        list.querySelectorAll('.notif-item.unread').forEach(item => {
            item.addEventListener('click', async () => {
                item.classList.remove('unread');
                try {
                    await fetch(`/api/notificaciones/${item.dataset.id}/read`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
                    loadTenantNotifications();
                } catch (e) { /* no crítico */ }
            });
        });
    } catch (e) {
        console.warn('[TENANT] Error notificaciones:', e.message);
        list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--gray);font-size:13px;"><i class="fas fa-bell-slash"></i> Sin notificaciones</div>';
    }
}

// ── Actividad reciente (reales) ─────────────────────
async function loadTenantActivity() {
    const container = document.getElementById('recentActivityTimeline');
    if (!container) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    try {
        const res = await fetch(`/api/dashboard/summary?tenant=${encodeURIComponent(tenantId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('activity error');
        const data = await res.json();
        const eventos = data.actividadReciente || [];

        if (!eventos.length) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray);font-size:13px;">Sin actividad registrada.</div>';
            return;
        }

        container.innerHTML = eventos.slice(0, 4).map(e => `
            <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-time">${(e.detalle || 'Reciente').replace(/^.*·\s*/, '')}</div>
                <div class="timeline-action"><strong>${e.titulo}</strong></div>
                <div class="timeline-details">${(e.detalle || '').replace(/\[[^\]]*\]/g, '')}</div>
            </div>`).join('');
    } catch (e) {
        console.warn('[TENANT] Error actividad:', e.message);
        container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--gray);font-size:13px;">No se pudo cargar la actividad.</div>';
    }
}

// ── Logs de auditoría (reales) ─────────────────────
let tenantAuditLogs = [];

async function loadTenantLogs() {
    const container = document.getElementById('logsTimeline');
    if (!container) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    try {
        const res = await fetch(`/api/dashboard/summary?tenant=${encodeURIComponent(tenantId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('logs error');
        const data = await res.json();
        const eventos = data.actividadReciente || [];

        tenantAuditLogs = eventos.map((e, i) => {
            const tipo = e.tipo === 'factura' ? 'rpa' : e.tipo === 'ingreso' || e.tipo === 'gasto' ? 'api' : e.tipo === 'usuario' ? 'access' : 'config';
            const fecha = e.fecha ? new Date(e.fecha) : new Date(Date.now() - i * 3600000);
            const time = fecha.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            return { tipo, time, texto: e.titulo || 'Evento', detalle: e.detalle || '' };
        });

        renderTenantLogs();
    } catch (e) {
        console.warn('[TENANT] Error logs:', e.message);
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">No se pudieron cargar los logs.</div>';
    }
}

function renderTenantLogs() {
    const container = document.getElementById('logsTimeline');
    if (!container) return;
    if (!tenantAuditLogs.length) {
        container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin eventos registrados.</div>';
        return;
    }
    container.innerHTML = tenantAuditLogs.map(l => `
        <div class="timeline-item log-item" data-type="${l.tipo}" style="padding-left:0;border-left:none;">
            <div style="display:grid;grid-template-columns:100px 1fr auto;gap:16px;align-items:start;">
                <span style="font-size:11px;color:var(--gray);">${l.time}</span>
                <div>
                    <div style="color:var(--white);font-weight:500;">${l.texto}</div>
                    <div style="font-size:12px;color:var(--gray);">${l.detalle}</div>
                </div>
                <button class="btn btn-ghost btn-xs" onclick="openModal('logDetailModal')"><i class="fas fa-eye"></i></button>
            </div>
        </div>`).join('');
}

function exportLogs() {
    if (!tenantAuditLogs.length) {
        showToast('No hay logs para exportar', 'warning');
        return;
    }
    const csv = ['Fecha,Tipo,Evento'];
    tenantAuditLogs.forEach(l => csv.push(`${l.time},${l.tipo},"${l.texto}"`));
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Logs exportados', 'success');
}

// ── Logs del Bot (modal) ───────────────────────────
function openBotLogsModal() {
    loadBotLogs();
    openModal('botLogsModal');
}

async function loadBotLogs() {
    const list = document.getElementById('botLogsList');
    if (!list) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    try {
        const res = await fetch(`/api/dashboard/summary?tenant=${encodeURIComponent(tenantId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('bots logs error');
        const data = await res.json();
        const eventos = data.actividadReciente || [];

        if (!eventos.length) {
            list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin ejecuciones registradas.</div>';
            return;
        }

        list.innerHTML = eventos.slice(0, 8).map((e, i) => {
            const ok = e.tipo !== 'gasto';
            const fecha = e.fecha ? new Date(e.fecha) : new Date(Date.now() - i * 3600000);
            const time = fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `
                <div class="bot-log-item ${ok ? 'success' : 'error'}">
                    <div class="bot-log-status"><i class="fas ${ok ? 'fa-check-circle' : 'fa-times-circle'}"></i></div>
                    <div class="bot-log-info">
                        <div class="bot-log-title">${e.titulo}</div>
                        <div class="bot-log-meta">${time} · ${e.detalle || ''}</div>
                    </div>
                    <button class="btn btn-ghost btn-xs" onclick="openModal('logDetailModal')"><i class="fas fa-eye"></i></button>
                </div>`;
        }).join('');
    } catch (e) {
        console.warn('[TENANT] Error bot logs:', e.message);
        list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">No se pudieron cargar los logs del bot.</div>';
    }
}

function updateUsersStatCard() {
    const valueEl = document.getElementById('usersStatValue');
    const labelEl = document.getElementById('usersStatLabel');
    const trendEl = document.getElementById('usersStatTrend');
    const iconEl = document.querySelector('#usersStatCard .stat-card-icon');
    if (!valueEl) return;

    const total = tenantRealStats.usuarios ? tenantRealStats.usuarios.total : 0;
    const activos = tenantRealStats.usuarios ? tenantRealStats.usuarios.activos : 0;
    const inactivos = Math.max(0, total - activos);

    const data = usersStatActive
        ? { value: activos, label: 'Usuarios Activos', icon: 'fa-users', color: 'var(--green)', bg: 'rgba(52, 211, 153, 0.15)', trend: `${total} registrados`, trendClass: 'up', trendIcon: 'fa-arrow-up' }
        : { value: inactivos, label: 'Usuarios Inactivos', icon: 'fa-user-clock', color: 'var(--yellow)', bg: 'rgba(251, 191, 36, 0.15)', trend: `${total} registrados`, trendClass: 'down', trendIcon: 'fa-arrow-down' };

    valueEl.textContent = data.value;
    labelEl.textContent = data.label;
    trendEl.className = `stat-card-trend ${data.trendClass}`;
    trendEl.innerHTML = `<i class="fas ${data.trendIcon}"></i> ${data.trend}`;
    if (iconEl) {
        iconEl.style.background = data.bg;
        iconEl.style.color = data.color;
        iconEl.innerHTML = `<i class="fas ${data.icon}"></i>`;
    }
}

function toggleUsersStat() {
    const valueEl = document.getElementById('usersStatValue');
    const labelEl = document.getElementById('usersStatLabel');
    const trendEl = document.getElementById('usersStatTrend');
    if (!valueEl) return;

    usersStatActive = !usersStatActive;
    valueEl.classList.add('changing');
    valueEl.classList.add('toggled');
    setTimeout(() => {
        updateUsersStatCard();
        valueEl.classList.remove('changing');
        setTimeout(() => valueEl.classList.remove('toggled'), 400);
    }, 250);
}

setInterval(toggleUsersStat, 12000);

// ── Charts (Chart.js OPTIMIZADO) ───────────────────
let tokensChart = null;
let rpaChart = null;
let chartUsageData = [];

async function loadChartsData() {
    const token = localStorage.getItem('token');
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    if (!tenantId) return;
    try {
        const res = await fetch(`/api/dashboard/summary?tenant=${encodeURIComponent(tenantId)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        chartUsageData = data.usage7d || [];
        const stats = tenantRealStats.usuarios ? tenantRealStats : (await (async () => {
            try {
                const r = await fetch(`/api/tenant/${encodeURIComponent(tenantId)}/stats`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (r.ok) return (await r.json()).stats || {};
                return {};
            } catch { return {}; }
        })());
        if (stats.usuarios) tenantRealStats = stats;
        renderCharts();
    } catch (e) {
        console.warn('[TENANT] No se pudieron cargar datos de charts:', e.message);
        renderCharts();
    }
}

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

    // Datos reales: agregar por día de la semana y por periodo
    const usage = chartUsageData.length ? chartUsageData : [];
    const semana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const porDia = [0, 0, 0, 0, 0, 0, 0];
    usage.forEach(d => { if (d.fecha) porDia[new Date(d.fecha).getDay()] += (d.transacciones || 0) + (d.facturas || 0); });
    const totalUso = usage.reduce((s, d) => s + (d.transacciones || 0) + (d.facturas || 0), 0);

    // Período (7D/30D/90D) según selector
    const periodo = document.getElementById('chartPeriodSelect');
    const rawPeriod = periodo ? periodo.value : '30';
    const periodLabel = /7/.test(rawPeriod) ? '7D' : /90/.test(rawPeriod) ? '90D' : '30D';
    const datosTokens = usage.slice(Math.max(0, usage.length - (periodLabel === '7D' ? 7 : periodLabel === '90D' ? 90 : 30)))
        .map(d => (d.transacciones || 0) + (d.facturas || 0));

    // Tokens IA Chart (línea)
    tokensChart = new Chart(tokensCtx, {
        type: 'line',
        data: {
            labels: usage.length ? usage.slice(-datosTokens.length).map(d => d.label || d.fecha.slice(5)) : ['Sin datos'],
            datasets: [{
                label: 'Actividad',
                data: datosTokens.length ? datosTokens : [0],
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: datosTokens.length > 20 ? 0 : 4,
                pointHoverRadius: 6
            }]
        },
        options: commonOptions
    });

    // RPA Chart (barras) con actividad real por día de la semana
    rpaChart = new Chart(rpaCtx, {
        type: 'bar',
        data: {
            labels: semana,
            datasets: [{
                label: 'Ejecuciones',
                data: totalUso > 0 ? porDia : [0],
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
    loadChartsData();
    updateUsersStatCard();
}

// Render charts al cargar (con datos reales)
window.addEventListener('load', () => {
    setTimeout(() => {
        loadTenantRealStats();
        loadChartsData();
    }, 300);
});

// Actualizar charts al cambiar periodo
const chartPeriodSelect = document.getElementById('chartPeriodSelect');
if (chartPeriodSelect) {
    chartPeriodSelect.addEventListener('change', function () {
        showToast(`Periodo: ${this.value}`, 'info');
        loadChartsData();
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
    const item = btn.closest('.api-key-item');
    if (!item) return;
    const id = item.dataset.id;
    const token = localStorage.getItem('token');
    if (!token) { showToast('Sesión no iniciada', 'error'); return; }

    if (!confirm('¿Revocar esta API Key?')) return;

    fetch(`/api/tenant/apikeys/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => {
            if (!res.ok) throw new Error('Error al revocar');
            item.style.transition = 'all 0.3s ease';
            item.style.opacity = '0';
            item.style.transform = 'translateX(-20px)';
            setTimeout(() => item.remove(), 300);
            showToast('API Key revocada', 'success');
        })
        .catch(err => showToast('Error: ' + err.message, 'error'));
}

async function loadApiKeys() {
    const container = document.getElementById('apiKeysContainer');
    if (!container) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const res = await fetch(`/api/tenant/apikeys`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('apikeys error');
        const data = await res.json();
        const keys = data.keys || [];
        if (!keys.length) {
            container.innerHTML = '<div style="padding:16px;color:var(--gray);font-size:13px;">No hay API Keys creadas.</div>';
            return;
        }
        container.innerHTML = keys.map(k => {
            const clave = k.clave || '';
            const masked = clave.length > 15 ? clave.substring(0, 11) + '••••••' + clave.substring(clave.length - 4) : clave;
            const fecha = k.created_at ? new Date(k.created_at).toLocaleDateString('es-HN') : '—';
            const uso = k.ultimo_uso ? new Date(k.ultimo_uso).toLocaleDateString('es-HN') : 'Nunca';
            return `
                <div class="api-key-item" data-id="${k.id}">
                    <div>
                        <div class="api-key-name">${k.nombre}</div>
                        <div class="api-key-value">${masked}${k.activa === false ? ' <span style="color:var(--red);font-size:11px;">· Inactiva</span>' : ''}</div>
                        <div class="api-key-meta">Creada: ${fecha} · Última usada: ${uso}</div>
                    </div>
                    <div class="api-key-actions">
                        <button class="btn btn-ghost btn-xs" onclick="copyApiKey(this, '${clave}')"><i class="fas fa-copy"></i> Copiar</button>
                        <button class="btn btn-outline btn-xs" onclick="editApiKey(this)"><i class="fas fa-edit"></i> Editar</button>
                        <button class="btn btn-danger btn-xs" onclick="deleteApiKey(this)"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
        }).join('');
    } catch (e) {
        console.warn('[TENANT] Error cargando API keys:', e.message);
        container.innerHTML = '<div style="padding:16px;color:var(--gray);font-size:13px;">No se pudieron cargar las API Keys.</div>';
    }
}

function generateApiKey() {
    const name = document.getElementById('keyName').value;
    if (!name) {
        showToast('Ingresa un nombre para la API Key', 'error');
        return;
    }

    const token = localStorage.getItem('token');
    if (!token) { showToast('Sesión no iniciada', 'error'); return; }

    fetch('/api/tenant/apikeys', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: name })
    })
        .then(res => {
            if (!res.ok) return res.json().then(d => Promise.reject(new Error(d.error || 'Error al generar')));
            return res.json();
        })
        .then(data => {
            const clave = data.clave || (data.key && data.key.clave) || '';
            let keysHtml = '';
            if (clave) {
                keysHtml = `<div style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);padding:12px;border-radius:8px;margin-bottom:14px;">
                    <div style="font-size:11px;color:var(--gray);margin-bottom:4px;">⚠️ Guarda esta clave ahora, no se mostrará de nuevo:</div>
                    <div style="font-family:monospace;font-size:12px;color:var(--accent);word-break:break-all;">${clave}</div>
                </div>`;
            }
            closeModal('apiKeyModal');
            document.getElementById('keyName').value = '';
            if (clave) showToast(`API Key "${name}" generada`, 'success');
            loadApiKeys();
        })
        .catch(err => showToast('Error: ' + err.message, 'error'));
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
let currentBillingDocuments = { factura: null, recibo: null, nota: null, tenant: '' };

function openCurrentDocument(template) {
    const key = template.startsWith('factura') ? 'factura' : template.startsWith('recibo') ? 'recibo' : 'nota';
    const document = currentBillingDocuments[key];
    if (!document) {
        showToast('Todavía no hay un documento generado para este tenant.', 'info');
        return;
    }
    const query = new URLSearchParams({ id: document.id, tenant: currentBillingDocuments.tenant });
    window.open(`../${template}?${query}`, '_blank', 'noopener');
}

async function loadBillingDocuments() {
    const params = new URLSearchParams(window.location.search);
    const tenant = params.get('id') || params.get('tenant');
    const token = localStorage.getItem('token');
    if (!tenant || !token) return;
    currentBillingDocuments.tenant = tenant;
    try {
        const headers = { Authorization: `Bearer ${token}` };
        const query = `?tenant=${encodeURIComponent(tenant)}`;
        const [invoiceResponse, receiptResponse, noteResponse] = await Promise.all([
            fetch(`/api/facturas${query}`, { headers }),
            fetch(`/api/recibos${query}`, { headers }),
            fetch(`/api/notas-credito${query}`, { headers })
        ]);
        const invoices = invoiceResponse.ok ? (await invoiceResponse.json()).facturas || [] : [];
        const receipts = receiptResponse.ok ? (await receiptResponse.json()).recibos || [] : [];
        const notes = noteResponse.ok ? (await noteResponse.json()).notas || [] : [];
        currentBillingDocuments.factura = invoices[0] || null;
        currentBillingDocuments.recibo = receipts[0] || null;
        currentBillingDocuments.nota = notes[0] || null;

        const invoice = currentBillingDocuments.factura;
        const money = value => `L ${Number(value || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('currentInvoiceNumber', invoice?.correlativo || 'Sin factura');
        set('currentInvoiceDate', invoice?.created_at ? new Date(invoice.created_at).toLocaleDateString('es-HN') : '—');
        set('currentInvoiceStatus', invoice?.estado || '—');
        set('currentInvoiceTotal', money(invoice?.total));
        set('currentDocumentStatus', `${invoices.length} factura(s) · ${receipts.length} recibo(s) · ${notes.length} nota(s)`);
        const history = document.getElementById('billingHistoryList');
        if (history) {
            history.innerHTML = invoices.length ? invoices.map(invoice => `
                <div class="billing-history-item">
                    <div>
                        <div style="font-weight:600;color:var(--white);">Factura #${invoice.correlativo || invoice.id}</div>
                        <div style="font-size:11px;color:var(--gray);">${invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('es-HN') : 'Sin fecha'} · ${invoice.estado || 'emitida'}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:var(--accent);">${money(invoice.total)}</div>
                        <div style="font-size:11px;color:var(--green);"><i class="fas fa-check"></i> ${invoice.estado || 'Emitida'}</div>
                    </div>
                    <button class="btn btn-ghost btn-xs" onclick="openDocumentById('factura.html', '${invoice.id}')"><i class="fas fa-file-invoice"></i></button>
                </div>`).join('') : '<div style="padding:16px;color:var(--gray);">No hay facturas registradas para este tenant.</div>';
        }
        ['viewInvoiceBtn', 'viewReceiptBtn', 'viewCreditNoteBtn'].forEach((id, index) => {
            const button = document.getElementById(id);
            if (button) button.disabled = ![currentBillingDocuments.factura, currentBillingDocuments.recibo, currentBillingDocuments.nota][index];
        });
    } catch (error) {
        console.error('[TENANT BILLING] Error:', error);
        showToast('No se pudieron cargar los documentos del tenant.', 'warning');
    }
}

function openDocumentById(template, id) {
    const query = new URLSearchParams({ id, tenant: currentBillingDocuments.tenant });
    window.open(`../${template}?${query}`, '_blank', 'noopener');
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

// ── Settings ───────────────────────────────────────
function saveSettings() {
    showToast('Configuración guardada', 'success');
}

function resetSettings() {
    if (confirm('¿Restaurar configuración predeterminada?')) {
        showToast('Configuración restaurada', 'info');
    }
}

async function confirmDelete() {
    if (prompt('Escribe ELIMINAR para confirmar:') !== 'ELIMINAR') {
        showToast('Operación cancelada', 'info');
        return;
    }

    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    if (!tenantId) { showToast('No se encontró el ID del tenant', 'error'); return; }

    const token = localStorage.getItem('token');
    if (!token) { window.location.href = '/login.html'; return; }

    try {
        showToast('Eliminando tenant y todos sus usuarios...', 'info');
        const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Error ${res.status}`);
        }
        showToast('Tenant y usuarios eliminados', 'success');
        setTimeout(() => window.location.href = 'tenants.html', 1000);
    } catch (err) {
        showToast('Error al eliminar: ' + err.message, 'error');
    }
}

function executeSuspend() {
    const params = new URLSearchParams(window.location.search);
    const tenantId = params.get('id') || params.get('tenant');
    const token = localStorage.getItem('token');
    if (!tenantId || !token) { showToast('Falta ID del tenant o sesión', 'error'); return; }
    showToast('Suspendiendo tenant...', 'info');
    fetch(`/api/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'suspendido' })
    })
        .then(res => {
            if (!res.ok) throw new Error('Error al suspender');
            closeModal('suspendModal');
            showToast('Tenant suspendido', 'success');
            const statusEl = document.getElementById('tenant-status');
            if (statusEl) {
                statusEl.textContent = 'Suspendido';
                statusEl.className = 'badge badge-danger';
            }
        })
        .catch(err => {
            showToast('Error al suspender: ' + err.message, 'error');
        });
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
});

// ── Load Tenant Data from API ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadBillingDocuments();
    loadTenantNotifications();
    loadTenantActivity();
    loadTenantLogs();
    loadApiKeys();
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

            const statusEl = document.getElementById('tenant-status');
            if (statusEl) {
                const st = (preview.status || 'active').toLowerCase();
                const statusMap = { active: 'Activo', suspended: 'Suspendido', activo: 'Activo', suspendido: 'Suspendido', pending: 'Pendiente' };
                statusEl.textContent = statusMap[st] || preview.status || 'Activo';
                const isGreen = (st === 'active' || st === 'activo');
                const isRed = (st === 'suspended' || st === 'suspendido');
                statusEl.className = 'badge badge-' + (isGreen ? 'success' : isRed ? 'danger' : 'warning');
            }
            const planEl = document.getElementById('tenant-plan');
            if (planEl) planEl.textContent = preview.plan || 'Sin plan';
            const regEl = document.getElementById('tenant-registered');
            if (regEl && detail.createdAt) {
                regEl.textContent = new Date(detail.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
            }

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

    // Load tenant stats (real data from backend)
    fetch(`/api/tenant/${encodeURIComponent(tenantId)}/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(res => {
            if (!res.ok) throw new Error('Error al cargar stats del tenant');
            return res.json();
        })
        .then(data => {
            const stats = data.stats;
            if (!stats) return;

            // Plan
            const planEl = document.getElementById('tenant-plan');
            if (planEl) planEl.textContent = stats.planNombre || 'Sin plan';

            // Usuarios
            const usersLimitEl = document.getElementById('users-limit');
            const usersUsedEl = document.getElementById('users-used');
            if (usersLimitEl && stats.usuarios) usersLimitEl.textContent = stats.usuarios.limite;
            if (usersUsedEl && stats.usuarios) usersUsedEl.textContent = `${stats.usuarios.total} usados`;

            // Bots
            const botsLimitEl = document.getElementById('bots-limit');
            const botsUsedEl = document.getElementById('bots-used');
            if (botsLimitEl && stats.bots) botsLimitEl.textContent = stats.bots.limite;
            if (botsUsedEl && stats.bots) botsUsedEl.textContent = `${stats.bots.activos} activos`;

            // Tokens
            const tokensLimitEl = document.getElementById('tokens-limit');
            if (tokensLimitEl && stats.tokens) tokensLimitEl.textContent = stats.tokens.limite.toLocaleString('es-ES');

            // Almacenamiento
            const storageLimitEl = document.getElementById('storage-limit');
            const storageUsedEl = document.getElementById('storage-used');
            if (storageLimitEl && stats.almacenamiento) storageLimitEl.textContent = `${stats.almacenamiento.limite} GB`;
            if (storageUsedEl && stats.almacenamiento) storageUsedEl.textContent = `${stats.almacenamiento.gbUsados} GB usados`;

            // Soporte
            const supportEl = document.getElementById('support-level');
            if (supportEl && stats.soporte) supportEl.textContent = stats.soporte;

            // SLA
            const slaEl = document.getElementById('sla-uptime');
            if (slaEl && stats.sla) slaEl.textContent = stats.sla;

            // Facturas
            const invoicesEl = document.getElementById('invoices-total');
            if (invoicesEl && stats.facturas) invoicesEl.textContent = stats.facturas.total;

            // Plan name
            const planNameEl = document.getElementById('plan-name');
            if (planNameEl && stats.planNombre) planNameEl.textContent = stats.planNombre;
        })
        .catch(err => {
            console.error('❌ Error cargando stats:', err.message);
        });
});

// ── Notifications Panel ─────────────────
function toggleNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.classList.toggle('active');
}
function clearNotifications() {
    const list = document.getElementById('notifList');
    if (list) list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--gray);font-size:13px;"><i class="fas fa-bell-slash" style="font-size:24px;display:block;margin-bottom:8px;"></i>Sin notificaciones</div>';
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
}
document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('notifWrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        const panel = document.getElementById('notifPanel');
        if (panel) panel.classList.remove('active');
    }
});