// ── Custom Cursor (OPTIMIZADO - sin lag) ─────────────────
const dot = document.getElementById('cursor-dot');
const ring = document.getElementById('cursor-ring');
let mx = 0, my = 0, rx = 0, ry = 0;
let cursorVisible = false;
let rafId = null;

// Usamos transform en vez de left/top (mucho más rápido)
function updateCursor() {
  dot.style.transform = `translate3d(${mx - 3}px, ${my - 3}px, 0)`;
  rx += (mx - rx) * 0.18;
  ry += (my - ry) * 0.18;
  ring.style.transform = `translate3d(${rx - 18}px, ${ry - 18}px, 0)`;
  rafId = requestAnimationFrame(updateCursor);
}

// Throttle del mousemove para reducir carga
let lastMove = 0;
document.addEventListener('mousemove', e => {
  const now = performance.now();
  if (now - lastMove < 8) return; // ~120fps max
  lastMove = now;
  mx = e.clientX;
  my = e.clientY;
  if (!cursorVisible) {
    cursorVisible = true;
    updateCursor();
  }
}, { passive: true });

document.addEventListener('mouseleave', () => {
  cursorVisible = false;
  if (rafId) cancelAnimationFrame(rafId);
});

// Hover effects - delegación de eventos (más eficiente)
document.addEventListener('mouseover', e => {
  const target = e.target.closest('a,button,.sidebar-link,.action-btn,.topbar-btn,.model-item,.cal-day,.heatmap-cell');
  if (target) {
    ring.style.width = '50px';
    ring.style.height = '50px';
    ring.style.borderColor = 'rgba(139, 92, 246, 0.9)';
  }
});
document.addEventListener('mouseout', e => {
  const target = e.target.closest('a,button,.sidebar-link,.action-btn,.topbar-btn,.model-item,.cal-day,.heatmap-cell');
  if (target) {
    ring.style.width = '36px';
    ring.style.height = '36px';
    ring.style.borderColor = 'rgba(139, 92, 246, 0.6)';
  }
});

// ── Scroll Progress ──────────────
window.addEventListener('scroll', () => {
  const p = (window.scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100;
  document.getElementById('progress-fill').style.width = p + '%';
}, { passive: true });

// ── Reveal on Scroll ─────────────
const obs = new IntersectionObserver(entries => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) setTimeout(() => e.target.classList.add('in'), i * 50);
  });
}, { threshold: 0.05 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

// ── Sidebar Toggle ───────────────
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
    dashboard.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  }
}
window.addEventListener('resize', updateLayout);
updateLayout();

toggleBtn.addEventListener('click', () => {
  if (isMobile) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  } else {
    sidebar.classList.toggle('collapsed');
    dashboard.classList.toggle('sidebar-collapsed');
  }
  updateLayout();
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('active');
  overlay.classList.remove('active');
});

// ── Dark Mode Toggle ─────────────
const darkModeBtn = document.getElementById('darkModeToggle');
darkModeBtn.addEventListener('click', () => {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  darkModeBtn.innerHTML = isLight
    ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
    : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
});
if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light-mode');
  darkModeBtn.innerHTML = '<i class="fas fa-sun"></i> <span>Light Mode</span>';
}

// ── Logout Modal ────
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

logoutBtn.addEventListener('click', e => { e.preventDefault(); logoutModal.classList.add('active'); });
modalCancel.addEventListener('click', () => logoutModal.classList.remove('active'));
modalConfirm.addEventListener('click', () => {
  logoutModal.classList.remove('active');
  localStorage.clear();
  showToast('Sesión cerrada', 'Redirigiendo...', 'info');
  setTimeout(() => window.location.href = '/login.html', 1500);
});
logoutModal.addEventListener('click', e => { if (e.target === logoutModal) logoutModal.classList.remove('active'); });

// ── Toast System ────
function showToast(title, message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon ${type}"><i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i></div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('active'), 10);
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Modals Helpers ────
function setupModal(btnId, modalId, closeId) {
  const btn = document.getElementById(btnId);
  const modal = document.getElementById(modalId);
  const close = document.getElementById(closeId);
  if (btn) btn.addEventListener('click', () => modal.classList.add('active'));
  if (close) close.addEventListener('click', () => modal.classList.remove('active'));
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
}
setupModal('notificationsBtn', 'notificationsModal', 'closeNotifications');
setupModal('messagesBtn', 'messagesModal', 'closeMessages');
setupModal('viewHistory', 'activityHistoryModal', 'closeActivityHistory');
setupModal('reportIncidentBtn', 'incidentModal', 'closeIncident');
setupModal('modelSelectBtn', 'modelSelectorModal', 'closeModelSelector');
setupModal(null, 'chartExpandedModal', 'closeChartExpanded');
setupModal(null, 'widgetDetailModal', 'closeWidgetDetail');

document.getElementById('cancelIncident')?.addEventListener('click', () => {
  document.getElementById('incidentModal').classList.remove('active');
});

document.getElementById('incidentForm')?.addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('incidentModal').classList.remove('active');
  e.target.reset();
  showToast('Incidente Reportado', 'Registrado exitosamente.', 'success');
});

document.querySelectorAll('.model-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.model-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const name = item.querySelector('.model-name').textContent;
    const ver = item.querySelector('.model-version').textContent;
    document.getElementById('currentModel').textContent = `- ${name} ${ver}`;
    document.getElementById('modelSelectorModal').classList.remove('active');
    showToast('Modelo Actualizado', `${name} ${ver} seleccionado.`, 'success');
  });
});

// ── Online/Offline Toggle (cada 12s) ────
let isOnline = true;
function toggleUserStatus() {
  isOnline = !isOnline;
  const icon = document.getElementById('usersStatusIcon');
  const text = document.getElementById('onlineUsers');
  const users = parseInt(document.getElementById('kpiUsers').textContent.replace(/,/g, ''));

  if (isOnline) {
    const online = Math.floor(Math.random() * 50) + 120;
    icon.innerHTML = '<i class="fas fa-circle" style="color:var(--green);font-size:6px;"></i>';
    text.textContent = `${online} online ahora`;
    text.style.color = '';
  } else {
    const sleeping = Math.floor(users * (0.6 + Math.random() * 0.2));
    icon.innerHTML = '<i class="fas fa-moon" style="color:var(--accent);font-size:10px;"></i>';
    text.textContent = `${sleeping.toLocaleString()} durmiendo ahora`;
    text.style.color = 'var(--accent)';
  }
}
setInterval(toggleUserStatus, 12000);

// ── Quick Actions ────
document.getElementById('createTenantBtn')?.addEventListener('click', () => window.location.href = 'tenants.html');
document.getElementById('deployBotBtn')?.addEventListener('click', () => {
  showToast('Desplegando Bot', 'Redirigiendo...', 'info');
  setTimeout(() => window.location.href = 'bots.html', 1000);
});
document.getElementById('exportAuditBtn')?.addEventListener('click', () => {
  showToast('Exportando', 'Descargando...', 'success');
});
document.getElementById('managePermissionsBtn')?.addEventListener('click', () => window.location.href = 'usuarios.html');
document.getElementById('newBotBtn')?.addEventListener('click', () => window.location.href = 'bots.html');
document.getElementById('checkServices')?.addEventListener('click', function () {
  this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  this.disabled = true;
  setTimeout(() => {
    this.innerHTML = '<i class="fas fa-sync-alt"></i> Verificar';
    this.disabled = false;
    showToast('Verificación Completa', 'Todos los servicios OK.', 'success');
  }, 2000);
});
document.getElementById('viewAllAlerts')?.addEventListener('click', () => {
  showToast('Alertas', 'Mostrando todas las alertas.', 'info');
});

// ── Global Search ────
const globalSearch = document.getElementById('globalSearch');
const searchResults = document.getElementById('searchResults');
const searchData = [
  { name: 'TechCorp', type: 'Tenant', icon: 'fa-building' },
  { name: 'HealthSys', type: 'Tenant', icon: 'fa-building' },
  { name: 'RetailPlus', type: 'Tenant', icon: 'fa-building' },
  { name: 'admin@techcorp.io', type: 'Usuario', icon: 'fa-user' },
  { name: 'Bot RPA - Análisis Q4', type: 'Bot', icon: 'fa-robot' },
];

globalSearch.addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  if (q.length < 2) { searchResults.classList.remove('active'); return; }
  const filtered = searchData.filter(i => i.name.toLowerCase().includes(q) || i.type.toLowerCase().includes(q));
  if (filtered.length > 0) {
    searchResults.innerHTML = filtered.map(i => `
      <div class="search-result-item">
        <div class="search-result-icon"><i class="fas ${i.icon}"></i></div>
        <div class="search-result-info">
          <div class="search-result-name">${i.name}</div>
          <div class="search-result-type">${i.type}</div>
        </div>
      </div>`).join('');
    searchResults.classList.add('active');
  } else {
    searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-info"><div class="search-result-name">Sin resultados</div></div></div>';
    searchResults.classList.add('active');
  }
});
document.addEventListener('click', e => { if (!e.target.closest('.topbar-search')) searchResults.classList.remove('active'); });
searchResults.addEventListener('click', e => {
  const item = e.target.closest('.search-result-item');
  if (item) {
    showToast('Seleccionado', item.querySelector('.search-result-name').textContent, 'info');
    searchResults.classList.remove('active');
    globalSearch.value = '';
  }
});

// ── Drag & Drop (con localStorage) ────
const settingsBtn = document.getElementById('settingsBtn');
const dashboardGrid = document.getElementById('dashboardGrid');
let isEditing = false;
let draggedWidget = null;

function saveWidgetOrder() {
  const order = Array.from(dashboardGrid.children).map(c => c.dataset.widget);
  localStorage.setItem('widgetOrder', JSON.stringify(order));
}

function loadWidgetOrder() {
  const saved = localStorage.getItem('widgetOrder');
  if (!saved) return;
  try {
    const order = JSON.parse(saved);
    const widgets = {};
    Array.from(dashboardGrid.children).forEach(w => widgets[w.dataset.widget] = w);
    order.forEach(id => {
      if (widgets[id]) dashboardGrid.appendChild(widgets[id]);
    });
  } catch (e) { console.warn('Error loading widget order'); }
}

function enableDragDrop() {
  dashboardGrid.querySelectorAll('[data-widget]').forEach(widget => {
    widget.setAttribute('draggable', 'true');

    widget.addEventListener('dragstart', e => {
      draggedWidget = widget;
      widget.classList.add('widget-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    widget.addEventListener('dragend', () => {
      widget.classList.remove('widget-dragging');
      dashboardGrid.querySelectorAll('.widget-drag-over').forEach(el => el.classList.remove('widget-drag-over'));
      draggedWidget = null;
    });

    widget.addEventListener('dragover', e => {
      e.preventDefault();
      if (widget !== draggedWidget) {
        widget.classList.add('widget-drag-over');
      }
    });

    widget.addEventListener('dragleave', () => {
      widget.classList.remove('widget-drag-over');
    });

    widget.addEventListener('drop', e => {
      e.preventDefault();
      widget.classList.remove('widget-drag-over');
      if (draggedWidget && widget !== draggedWidget) {
        const allWidgets = Array.from(dashboardGrid.children);
        const dragIdx = allWidgets.indexOf(draggedWidget);
        const dropIdx = allWidgets.indexOf(widget);
        if (dragIdx < dropIdx) {
          dashboardGrid.insertBefore(draggedWidget, widget.nextSibling);
        } else {
          dashboardGrid.insertBefore(draggedWidget, widget);
        }
        saveWidgetOrder();
        showToast('Widget movido', 'Orden guardado automáticamente.', 'success');
      }
    });
  });
}

function disableDragDrop() {
  dashboardGrid.querySelectorAll('[data-widget]').forEach(w => w.removeAttribute('draggable'));
}

settingsBtn.addEventListener('click', () => {
  isEditing = !isEditing;
  if (isEditing) {
    dashboardGrid.classList.add('editing');
    settingsBtn.style.background = 'rgba(139, 92, 246, 0.2)';
    settingsBtn.style.color = 'var(--accent)';
    enableDragDrop();
    showToast('Modo Edición', 'Arrastra los widgets para reordenarlos.', 'info');
  } else {
    dashboardGrid.classList.remove('editing');
    settingsBtn.style.background = '';
    settingsBtn.style.color = '';
    disableDragDrop();
    saveWidgetOrder();
    showToast('Modo Vista', 'Orden guardado en tu navegador.', 'success');
  }
});

loadWidgetOrder();

// ── Context Menu (Click Derecho) ────
const contextMenu = document.getElementById('contextMenu');
let currentContextWidget = null;

const widgetContextMenu = {
  'kpi-tenants': [
    { action: 'view-details', label: 'Ver tenants', icon: 'fa-building' },
    { action: 'refresh', label: 'Actualizar lista', icon: 'fa-sync-alt' },
    { action: 'expand', label: 'Ver todos los tenants', icon: 'fa-expand' },
  ],
  'kpi-users': [
    { action: 'view-details', label: 'Ver usuarios', icon: 'fa-users' },
    { action: 'refresh', label: 'Refrescar estado', icon: 'fa-sync-alt' },
    { action: 'export', label: 'Exportar lista', icon: 'fa-download' },
  ],
  'kpi-revenue': [
    { action: 'view-details', label: 'Ver finanzas', icon: 'fa-chart-line' },
    { action: 'export', label: 'Exportar reporte', icon: 'fa-download' },
    { action: 'expand', label: 'Ver proyecciones', icon: 'fa-expand' },
  ],
  'kpi-health': [
    { action: 'view-details', label: 'Ver más detalles BD', icon: 'fa-database' },
    { action: 'refresh', label: 'Verificar conexión', icon: 'fa-sync-alt' },
    { action: 'expand', label: 'Panel de base de datos', icon: 'fa-expand' },
    { action: 'settings', label: 'Configurar BD', icon: 'fa-cog' },
  ],
  'chart-tenants': [
    { action: 'expand', label: 'Análisis completo', icon: 'fa-chart-pie' },
    { action: 'export', label: 'Exportar datos', icon: 'fa-download' },
    { action: 'refresh', label: 'Actualizar gráfico', icon: 'fa-sync-alt' },
  ],
  'chart-tokens': [
    { action: 'expand', label: 'Análisis completo', icon: 'fa-chart-pie' },
    { action: 'export', label: 'Exportar uso', icon: 'fa-download' },
    { action: 'settings', label: 'Configurar modelo', icon: 'fa-cog' },
  ],
  'alerts': [
    { action: 'view-details', label: 'Ver todas las alertas', icon: 'fa-bell' },
    { action: 'refresh', label: 'Actualizar', icon: 'fa-sync-alt' },
    { action: 'settings', label: 'Configurar alertas', icon: 'fa-cog' },
  ],
  'services': [
    { action: 'view-details', label: 'Ver estado detallado', icon: 'fa-heartbeat' },
    { action: 'refresh', label: 'Verificar servicios', icon: 'fa-sync-alt' },
    { action: 'expand', label: 'Panel de servicios', icon: 'fa-expand' },
  ],
  'calendar': [
    { action: 'view-details', label: 'Ver todos los eventos', icon: 'fa-calendar' },
    { action: 'settings', label: 'Añadir evento', icon: 'fa-plus' },
  ],
  'activity': [
    { action: 'view-details', label: 'Ver historial completo', icon: 'fa-history' },
    { action: 'export', label: 'Exportar historial', icon: 'fa-download' },
  ],
  'heatmap': [
    { action: 'view-details', label: 'Ver estadísticas', icon: 'fa-chart-bar' },
    { action: 'refresh', label: 'Actualizar datos', icon: 'fa-sync-alt' },
  ],
  'quick-actions': [
    { action: 'settings', label: 'Personalizar acciones', icon: 'fa-cog' },
  ]
};

document.addEventListener('contextmenu', e => {
  const widget = e.target.closest('[data-widget]');
  if (!widget || !isEditing === false) {
    // Permitir click derecho en widgets siempre
  }
  if (!widget) return;

  e.preventDefault();
  currentContextWidget = widget;
  const widgetType = widget.dataset.widget;
  const items = widgetContextMenu[widgetType] || [
    { action: 'view-details', label: 'Ver detalles', icon: 'fa-eye' },
    { action: 'refresh', label: 'Actualizar', icon: 'fa-sync-alt' },
  ];

  contextMenu.innerHTML = items.map(i => `
    <div class="context-menu-item" data-action="${i.action}">
      <i class="fas ${i.icon}"></i> <span>${i.label}</span>
    </div>`).join('');

  // Posicionar
  const x = Math.min(e.clientX, window.innerWidth - 220);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.classList.add('active');
});

document.addEventListener('click', () => contextMenu.classList.remove('active'));
document.addEventListener('scroll', () => contextMenu.classList.remove('active'), true);

contextMenu.addEventListener('click', e => {
  const item = e.target.closest('.context-menu-item');
  if (!item || !currentContextWidget) return;

  const action = item.dataset.action;
  const widgetType = currentContextWidget.dataset.widget;

  switch (action) {
    case 'view-details':
      showWidgetDetails(widgetType);
      break;
    case 'expand':
      if (widgetType.startsWith('chart-')) {
        showExpandedChart(widgetType);
      } else {
        showWidgetDetails(widgetType);
      }
      break;
    case 'refresh':
      showToast('Actualizando', 'Datos refrescados.', 'info');
      if (widgetType === 'kpi-users') toggleUserStatus();
      if (widgetType === 'services') document.getElementById('checkServices').click();
      break;
    case 'export':
      showToast('Exportando', 'Descarga iniciada.', 'success');
      break;
    case 'settings':
      showToast('Configuración', 'Abriendo ajustes del widget...', 'info');
      break;
  }
  contextMenu.classList.remove('active');
});

// ── Widget Details Modal ────
function showWidgetDetails(widgetType) {
  const modal = document.getElementById('widgetDetailModal');
  const title = document.getElementById('widgetDetailTitle');
  const content = document.getElementById('widgetDetailContent');

  const details = {
    'kpi-tenants': {
      title: 'Detalle de Tenants',
      icon: 'fa-building',
      html: `
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-building"></i></div><div class="detail-label">Total Tenants</div><div class="detail-value">24</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-check-circle"></i></div><div class="detail-label">Activos</div><div class="detail-value">24</div></div>
        <div class="detail-card full"><div class="detail-label">Top Tenants por uso</div>
          <div class="detail-list">
            <div class="detail-list-item"><span>TechCorp</span><span>4,521 req/día</span></div>
            <div class="detail-list-item"><span>HealthSys</span><span>3,847 req/día</span></div>
            <div class="detail-list-item"><span>RetailPlus</span><span>2,956 req/día</span></div>
            <div class="detail-list-item"><span>FinanceLab</span><span>1,823 req/día</span></div>
          </div>
        </div>`
    },
    'kpi-users': {
      title: 'Detalle de Usuarios',
      icon: 'fa-users',
      html: `
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-users"></i></div><div class="detail-label">Total</div><div class="detail-value">1,247</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-circle"></i></div><div class="detail-label">Online</div><div class="detail-value" style="color:var(--green);">142</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-user-plus"></i></div><div class="detail-label">Nuevos hoy</div><div class="detail-value">18</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-user-shield"></i></div><div class="detail-label">Administradores</div><div class="detail-value">12</div></div>`
    },
    'kpi-health': {
      title: 'Panel de Base de Datos',
      icon: 'fa-database',
      html: `
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-database"></i></div><div class="detail-label">Capacidad Total</div><div class="detail-value">98.5%</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-tachometer-alt"></i></div><div class="detail-label">Latencia</div><div class="detail-value">12ms</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-hdd"></i></div><div class="detail-label">Almacenamiento</div><div class="detail-value">847 GB</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-history"></i></div><div class="detail-label">Último Backup</div><div class="detail-value" style="font-size:14px;">Hace 2h</div></div>
        <div class="detail-card full"><div class="detail-label">Estado de componentes</div>
          <div class="detail-list">
            <div class="detail-list-item"><span>NocoDB Primary</span><span style="color:var(--green);">● Operativo</span></div>
            <div class="detail-list-item"><span>NocoDB Replica</span><span style="color:var(--green);">● Operativo</span></div>
            <div class="detail-list-item"><span>Ollama Service</span><span style="color:var(--green);">● Operativo</span></div>
            <div class="detail-list-item"><span>Redis Cache</span><span style="color:var(--yellow);">● Degradado</span></div>
          </div>
        </div>`
    },
    'services': {
      title: 'Estado Detallado de Servicios',
      icon: 'fa-heartbeat',
      html: `
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-plug"></i></div><div class="detail-label">API REST</div><div class="detail-value" style="color:var(--green);font-size:14px;">99.98% uptime</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-database"></i></div><div class="detail-label">NocoDB</div><div class="detail-value" style="color:var(--green);font-size:14px;">99.95% uptime</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-brain"></i></div><div class="detail-label">Gemma 3N</div><div class="detail-value" style="color:var(--green);font-size:14px;">99.90% uptime</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-link"></i></div><div class="detail-label">Blockchain</div><div class="detail-value" style="color:var(--yellow);font-size:14px;">98.20% uptime</div></div>`
    },
    'calendar': {
      title: 'Todos los Eventos',
      icon: 'fa-calendar',
      html: `<div class="detail-card full"><div class="detail-label">Próximos 30 días</div><div class="detail-list" id="allEventsList"></div></div>`
    },
    'heatmap': {
      title: 'Estadísticas de Actividad',
      icon: 'fa-fire',
      html: `
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-fire"></i></div><div class="detail-label">Total peticiones (año)</div><div class="detail-value">284,521</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-calendar-day"></i></div><div class="detail-label">Día más activo</div><div class="detail-value" style="font-size:14px;">15 Mar</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-chart-line"></i></div><div class="detail-label">Promedio diario</div><div class="detail-value">779</div></div>
        <div class="detail-card"><div class="detail-icon"><i class="fas fa-bolt"></i></div><div class="detail-label">Pico máximo</div><div class="detail-value">2,847</div></div>`
    }
  };

  const data = details[widgetType];
  if (!data) return;

  title.innerHTML = `<i class="fas ${data.icon}"></i> ${data.title}`;
  content.innerHTML = data.html;
  modal.classList.add('active');

  if (widgetType === 'calendar') renderAllEvents();
}

function renderAllEvents() {
  const list = document.getElementById('allEventsList');
  if (!list) return;
  list.innerHTML = calendarEvents.slice(0, 10).map(e => `
    <div class="detail-list-item">
      <span>${e.date} — ${e.title}</span>
      <span style="color:${e.priority === 'high' ? 'var(--red)' : e.priority === 'med' ? 'var(--yellow)' : 'var(--blue)'};">${e.priority.toUpperCase()}</span>
    </div>`).join('');
}

// ── Charts ────
function createBarChart(containerId, data, gradient) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const max = Math.max(...data.map(d => d.value));
  data.forEach((d, i) => {
    const height = (d.value / max) * 160;
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.innerHTML = `<div class="chart-bar-fill" style="height:0;background:${gradient};"><span class="chart-bar-value">${d.value}</span></div><span class="chart-bar-label">${d.label}</span>`;
    container.appendChild(bar);
    setTimeout(() => bar.querySelector('.chart-bar-fill').style.height = height + 'px', 100 + i * 80);
  });
}

const chartDataSets = {
  tenants: {
    '7D': [{ label: 'Lun', value: 3 }, { label: 'Mar', value: 5 }, { label: 'Mié', value: 4 }, { label: 'Jue', value: 7 }, { label: 'Vie', value: 6 }, { label: 'Sáb', value: 2 }, { label: 'Dom', value: 1 }],
    '30D': [{ label: 'S1', value: 12 }, { label: 'S2', value: 18 }, { label: 'S3', value: 15 }, { label: 'S4', value: 24 }, { label: 'S5', value: 31 }, { label: 'S6', value: 28 }, { label: 'S7', value: 35 }, { label: 'S8', value: 42 }],
    '90D': [{ label: 'Ene', value: 85 }, { label: 'Feb', value: 92 }, { label: 'Mar', value: 78 }, { label: 'Abr', value: 105 }, { label: 'May', value: 112 }, { label: 'Jun', value: 98 }]
  },
  tokens: {
    'input': [{ label: '1-7', value: 30 }, { label: '8-14', value: 45 }, { label: '15-21', value: 55 }, { label: '22-28', value: 65 }, { label: '29-30', value: 40 }],
    'total': [{ label: '1-7', value: 45 }, { label: '8-14', value: 62 }, { label: '15-21', value: 78 }, { label: '22-28', value: 91 }, { label: '29-30', value: 54 }],
    'output': [{ label: '1-7', value: 15 }, { label: '8-14', value: 17 }, { label: '15-21', value: 23 }, { label: '22-28', value: 26 }, { label: '29-30', value: 14 }]
  }
};

window.addEventListener('load', () => {
  setTimeout(() => {
    createBarChart('chartTenants', chartDataSets.tenants['30D'], 'linear-gradient(180deg,#8b5cf6,#a78bfa)');
    createBarChart('chartTokens', chartDataSets.tokens['total'], 'linear-gradient(180deg,#a78bfa,#7c3aed)');
  }, 300);
});

document.querySelectorAll('.chart-actions').forEach(group => {
  const chartType = group.dataset.chart;
  group.querySelectorAll('button[data-period], button[data-token]').forEach(btn => {
    btn.addEventListener('click', function () {
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      if (chartType === 'tenants') {
        const period = this.dataset.period;
        createBarChart('chartTenants', chartDataSets.tenants[period], 'linear-gradient(180deg,#8b5cf6,#a78bfa)');
        const end = document.getElementById('chartTenantsEnd');
        if (end) end.textContent = period === '7D' ? 'Día 7' : period === '30D' ? 'Semana 4' : 'Mes 6';
      } else if (chartType === 'tokens') {
        const tokenType = this.dataset.token;
        if (tokenType === 'model') return;
        createBarChart('chartTokens', chartDataSets.tokens[tokenType], 'linear-gradient(180deg,#a78bfa,#7c3aed)');
      }
    });
  });
});

// ── Expand Chart Modal ────
document.querySelectorAll('.btn-expand-chart').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const card = btn.closest('[data-widget]');
    showExpandedChart(card.dataset.widget);
  });
});

function showExpandedChart(widgetType) {
  const modal = document.getElementById('chartExpandedModal');
  const title = document.getElementById('chartExpandedTitle');
  const mainView = document.getElementById('chartMainView');
  const statsView = document.getElementById('chartStatsView');

  if (widgetType === 'chart-tenants') {
    title.innerHTML = '<i class="fas fa-chart-pie"></i> Análisis de Tenants';
    renderChartView('bar', 'tenants', mainView, statsView);
  } else if (widgetType === 'chart-tokens') {
    title.innerHTML = '<i class="fas fa-chart-pie"></i> Análisis de Tokens';
    renderChartView('bar', 'tokens', mainView, statsView);
  }
  modal.classList.add('active');
}

function renderChartView(view, dataType, mainView, statsView) {
  const data = dataType === 'tenants' ? chartDataSets.tenants['30D'] : chartDataSets.tokens['total'];
  const total = data.reduce((s, d) => s + d.value, 0);
  const avg = (total / data.length).toFixed(1);
  const max = Math.max(...data.map(d => d.value));
  const min = Math.min(...data.map(d => d.value));

  if (view === 'bar') {
    mainView.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:flex-end;gap:12px;padding:20px;" id="expandedBars"></div>`;
    const container = document.getElementById('expandedBars');
    data.forEach((d, i) => {
      const h = (d.value / max) * 250;
      const bar = document.createElement('div');
      bar.style.cssText = `flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;`;
      bar.innerHTML = `<div style="font-size:12px;color:var(--white);font-weight:600;">${d.value}</div><div style="width:100%;height:${h}px;background:linear-gradient(180deg,var(--accent),var(--cyan));border-radius:6px 6px 0 0;transition:height .5s;"></div><div style="font-size:11px;color:var(--gray);">${d.label}</div>`;
      container.appendChild(bar);
    });
  } else if (view === 'pie') {
    const colors = ['#8b5cf6', '#a78bfa', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#c4b5fd', '#ddd6fe'];
    let cumulative = 0;
    let gradient = 'conic-gradient(';
    data.forEach((d, i) => {
      const pct = (d.value / total) * 100;
      gradient += `${colors[i % colors.length]} ${cumulative}% ${cumulative + pct}%${i < data.length - 1 ? ',' : ''}`;
      cumulative += pct;
    });
    gradient += ')';
    mainView.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:20px;">
        <div class="pie-chart" style="background:${gradient};">
          <div class="pie-chart-center">
            <div class="pie-chart-total">${total}</div>
            <div class="pie-chart-label">Total</div>
          </div>
        </div>
        <div class="pie-legend">
          ${data.map((d, i) => `<div class="pie-legend-item"><div class="pie-legend-dot" style="background:${colors[i % colors.length]};"></div>${d.label}: <strong style="color:var(--white);">${d.value}</strong> (${((d.value / total) * 100).toFixed(1)}%)</div>`).join('')}
        </div>
      </div>`;
  } else if (view === 'line') {
    const w = 600, h = 280, pad = 40;
    const stepX = (w - pad * 2) / (data.length - 1);
    const points = data.map((d, i) => `${pad + i * stepX},${h - pad - (d.value / max) * (h - pad * 2)}`).join(' ');
    mainView.innerHTML = `
      <div class="line-chart">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon points="${pad},${h - pad} ${points} ${w - pad},${h - pad}" fill="url(#lineGrad)"/>
          <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          ${data.map((d, i) => `<circle cx="${pad + i * stepX}" cy="${h - pad - (d.value / max) * (h - pad * 2)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="2"/>`).join('')}
          ${data.map((d, i) => `<text x="${pad + i * stepX}" y="${h - 10}" text-anchor="middle" fill="var(--gray)" font-size="10">${d.label}</text>`).join('')}
        </svg>
      </div>`;
  }

  statsView.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value">${total}</div><div class="stat-trend up"><i class="fas fa-arrow-up"></i> +${(Math.random() * 20 + 5).toFixed(1)}%</div></div>
    <div class="stat-card"><div class="stat-label">Promedio</div><div class="stat-value">${avg}</div></div>
    <div class="stat-card"><div class="stat-label">Máximo</div><div class="stat-value" style="color:var(--green);">${max}</div></div>
    <div class="stat-card"><div class="stat-label">Mínimo</div><div class="stat-value" style="color:var(--yellow);">${min}</div></div>`;
}

document.querySelectorAll('.chart-view-tab').forEach(tab => {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.chart-view-tab').forEach(t => t.classList.remove('active'));
    this.classList.add('active');
    const view = this.dataset.view;
    const title = document.getElementById('chartExpandedTitle').textContent.toLowerCase();
    const dataType = title.includes('tenant') ? 'tenants' : 'tokens';
    renderChartView(view, dataType, document.getElementById('chartMainView'), document.getElementById('chartStatsView'));
  });
});

// ── Calendar ────
const calendarEvents = [
  { date: '2026-06-25', title: 'Renovación SSL TechCorp', priority: 'high', time: '16:00' },
  { date: '2026-06-26', title: 'Backup NocoDB programado', priority: 'med', time: '02:00' },
  { date: '2026-06-27', title: 'Actualización Gemma 3N v1.2.5', priority: 'med', time: '03:00' },
  { date: '2026-06-28', title: 'Auditoría bloque #4829', priority: 'low', time: '10:00' },
  { date: '2026-06-30', title: 'Vencimiento licencia HealthSys', priority: 'high', time: '23:59' },
  { date: '2026-07-02', title: 'Despliegue bot RPA FinanceLab', priority: 'med', time: '14:00' },
  { date: '2026-07-05', title: 'Mantenimiento programado', priority: 'high', time: '01:00' },
  { date: '2026-07-10', title: 'Revisión trimestral RetailPlus', priority: 'low', time: '11:00' },
  { date: '2026-07-15', title: 'Backup completo mensual', priority: 'med', time: '02:00' },
  { date: '2026-07-20', title: 'Auditoría de seguridad', priority: 'high', time: '09:00' },
];

let currentCalDate = new Date(2026, 5, 1); // Junio 2026

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const monthLabel = document.getElementById('calMonth');
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  monthLabel.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date();

  let html = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // Días del mes anterior
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${daysInPrevMonth - i}</div>`;
  }

  // Días del mes actual
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const event = calendarEvents.find(e => e.date === dateStr);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    let classes = 'cal-day';
    if (isToday) classes += ' today';
    if (event) {
      classes += ' has-event';
      if (event.priority === 'high') classes += ' event-high';
      else if (event.priority === 'med') classes += ' event-med';
      else classes += ' event-low';
    }
    html += `<div class="${classes}" data-date="${dateStr}" title="${event ? event.title : ''}">${d}</div>`;
  }

  // Días del mes siguiente
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }

  grid.innerHTML = html;
  renderUpcomingEvents();

  // Click en día
  grid.querySelectorAll('.cal-day.has-event').forEach(day => {
    day.addEventListener('click', () => {
      const date = day.dataset.date;
      const ev = calendarEvents.find(e => e.date === date);
      if (ev) showToast(ev.title, `${ev.date} — ${ev.time}`, 'info');
    });
  });
}

function renderUpcomingEvents() {
  const list = document.getElementById('eventsList');
  const today = new Date();
  const upcoming = calendarEvents
    .filter(e => new Date(e.date) >= new Date(today.getFullYear(), today.getMonth(), today.getDate()))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 4);

  list.innerHTML = upcoming.map(e => {
    const date = new Date(e.date + 'T00:00:00');
    const diff = Math.ceil((date - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / (1000 * 60 * 60 * 24));
    let when = '';
    if (diff === 0) when = '🔴 Hoy ' + e.time;
    else if (diff === 1) when = '🟡 Mañana';
    else if (diff < 7) when = `🔵 En ${diff} días`;
    else when = `📅 ${e.date}`;

    return `<div class="event-item priority-${e.priority}">
      <div class="event-time">${when}</div>
      <div class="event-desc">${e.title}</div>
    </div>`;
  }).join('');
}

document.getElementById('calPrev')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() - 1);
  renderCalendar();
});
document.getElementById('calNext')?.addEventListener('click', () => {
  currentCalDate.setMonth(currentCalDate.getMonth() + 1);
  renderCalendar();
});
renderCalendar();

// ── Heatmap (GitHub style) ────
function renderHeatmap() {
  const container = document.getElementById('heatmapContainer');
  const cells = 364; // 52 semanas x 7 días
  let html = '';
  const today = new Date();

  for (let i = cells - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const level = Math.floor(Math.random() * 6);
    const requests = level === 0 ? 0 : Math.floor(Math.random() * 500 * level) + 50;
    const dateStr = date.toISOString().split('T')[0];
    html += `<div class="heatmap-cell" data-level="${level}" data-tooltip="${dateStr}: ${requests} peticiones"></div>`;
  }
  container.innerHTML = html;
}
renderHeatmap();

// ── Status Pulse ────
document.querySelectorAll('.status-dot').forEach(d => d.style.animationDelay = Math.random() * 2 + 's');

// ── KPI Simulation ────
function updateKPIs() {
  document.getElementById('kpiTenants').textContent = Math.floor(Math.random() * 10) + 20;
  document.getElementById('kpiUsers').textContent = (Math.floor(Math.random() * 200) + 1100).toLocaleString();
  document.getElementById('kpiRevenue').textContent = `$${Math.floor(Math.random() * 30) + 170}K`;
  document.getElementById('kpiHealth').textContent = `${(Math.random() * 5 + 95).toFixed(1)}%`;
}
setInterval(updateKPIs, 30000);

// ── Keyboard Shortcuts ────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey && e.key === 'b') || (e.key === '/' && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault();
    globalSearch.focus();
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    searchResults.classList.remove('active');
    contextMenu.classList.remove('active');
  }
});

console.log('🚀 Dashboard Portal Pilot v2.0 - Inicializado');
console.log('💡 Tips: Ctrl+B buscar | Click derecho en widgets | ⚙️ reorganizar');