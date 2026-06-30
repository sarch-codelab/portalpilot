// ── Custom Cursor ─────────────────
const dot = document.getElementById('cursor-dot');
const ring = document.getElementById('cursor-ring');
const glow = document.getElementById('cursor-glow');
let mx = 0, my = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  mx = e.clientX;
  my = e.clientY;
  dot.style.left = mx + 'px';
  dot.style.top = my + 'px';
  glow.style.left = mx + 'px';
  glow.style.top = my + 'px';
});

function animRing() {
  rx += (mx - rx) * 0.12;
  ry += (my - ry) * 0.12;
  ring.style.left = rx + 'px';
  ring.style.top = ry + 'px';
  requestAnimationFrame(animRing);
}
animRing();

document.querySelectorAll('a,button,.sidebar-link,.action-icon-btn,.filter-select,.pagination-btn').forEach(el => {
  el.addEventListener('mouseenter', () => {
    ring.style.width = '50px';
    ring.style.height = '50px';
    ring.style.opacity = '.5';
  });
  el.addEventListener('mouseleave', () => {
    ring.style.width = '36px';
    ring.style.height = '36px';
    ring.style.opacity = '1';
  });
});

// ── Scroll Progress ──────────────
window.addEventListener('scroll', () => {
  const p = (window.scrollY / (document.documentElement.scrollHeight - innerHeight)) * 100;
  document.getElementById('progress-fill').style.width = Math.min(100, Math.max(0, p)) + '%';
});

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
    if (sidebar.classList.contains('collapsed')) {
      dashboard.classList.add('sidebar-collapsed');
    } else {
      dashboard.classList.remove('sidebar-collapsed');
    }
  }
}

window.addEventListener('resize', () => {
  updateLayout();
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 300);
});
updateLayout();

// Restaurar estado guardado del sidebar
const savedSidebarState = localStorage.getItem('sidebarCollapsed');
if (savedSidebarState === 'true') {
  sidebar.classList.add('collapsed');
  dashboard.classList.add('sidebar-collapsed');
}

toggleBtn.addEventListener('click', () => {
  if (isMobile) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  } else {
    sidebar.classList.toggle('collapsed');
    dashboard.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
  }
  updateLayout();
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('active');
  overlay.classList.remove('active');
});

// ── Dark Mode ────────────────────
const darkModeBtn = document.getElementById('darkModeToggle');
if (darkModeBtn) {
  darkModeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    darkModeBtn.innerHTML = isLight
      ? '<i class="fas fa-sun"></i> <span>Light Mode</span>'
      : '<i class="fas fa-moon"></i> <span>Dark Mode</span>';
    localStorage.setItem('darkMode', isLight);
  });

  // Restaurar modo guardado
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('light-mode');
    darkModeBtn.innerHTML = '<i class="fas fa-sun"></i> <span>Light Mode</span>';
  }
}

// ── Logout Modal ─────────────────
const logoutBtn = document.getElementById('logoutBtn');
const logoutModal = document.getElementById('logoutModal');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

logoutBtn.addEventListener('click', (e) => {
  e.preventDefault();
  logoutModal.classList.add('active');
});

modalCancel.addEventListener('click', () => {
  logoutModal.classList.remove('active');
});

modalConfirm.addEventListener('click', () => {
  logoutModal.classList.remove('active');
  localStorage.clear();
  sessionStorage.clear();
  alert('Sesión cerrada. Redirigiendo...');
  window.location.href = '/login.html';
});

logoutModal.addEventListener('click', (e) => {
  if (e.target === logoutModal) {
    logoutModal.classList.remove('active');
  }
});

// ── Utilities ────────────────────
function showMessage(text, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;top:80px;right:24px;padding:12px 18px;border-radius:10px;background:${type === 'error' ? 'rgba(248,113,113,0.18)' : type === 'warning' ? 'rgba(251,191,36,0.18)' : 'rgba(52,211,153,0.18)'};border:1px solid ${type === 'error' ? 'rgba(248,113,113,0.35)' : type === 'warning' ? 'rgba(251,191,36,0.35)' : 'rgba(52,211,153,0.35)'};color:${type === 'error' ? '#f87171' : type === 'warning' ? '#fbbf24' : '#34d399'};font-size:13px;backdrop-filter: blur(8px);box-shadow:0 18px 60px rgba(0,0,0,0.18);z-index:9999;transition:opacity .3s ease,transform .3s ease;`;
  toast.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'check-circle'}"></i> ${text}`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-12px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Debug: Mostrar información del usuario ROOT
function debugUserInfo() {
  const token = localStorage.getItem('token');
  const userRole = localStorage.getItem('userRole');
  const userName = localStorage.getItem('userName');
  const empresaCodigo = localStorage.getItem('empresaCodigo');
  console.log('[TENANTS DEBUG]', {
    hasToken: !!token,
    userRole,
    userName,
    empresaCodigo,
    isRootUser: !empresaCodigo || empresaCodigo.toUpperCase() === 'ROOT'
  });
}

// ── Tenant Functions ─────────────
let tenants = [];
let filteredTenants = [];
let currentPage = 1;
let itemsPerPage = 10;
let isLoadingTenants = false;
let tenantsLoadError = false;

// Función auxiliar para validar sesión
function validateSession() {
  const token = localStorage.getItem('token');
  if (!token) {
    console.error('[TENANTS] No se encontró token de sesión válido');
    localStorage.clear();
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function fetchTenants() {
  if (!validateSession()) return;

  isLoadingTenants = true;
  tenantsLoadError = false;
  showTenantsSkeleton();

  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/tenants', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Validar respuesta de autenticación
    if (response.status === 401 || response.status === 403) {
      console.error('[TENANTS] Error de autenticación:', response.status);
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);

    const data = await response.json();
    tenants = Array.isArray(data) ? data : (data.list || []);
    filteredTenants = [...tenants];
    tenantsLoadError = false;
    isLoadingTenants = false;
    renderTenants();
  } catch (error) {
    console.error('[TENANTS] Error al cargar:', error);
    tenants = [];
    filteredTenants = [];
    tenantsLoadError = true;
    isLoadingTenants = false;
    renderTenants();
    showMessage('No se pudieron cargar los tenants. Verifica la conexión al servidor.', 'warning');
  }
}

function showTenantsSkeleton(rows = 6) {
  const tbody = document.getElementById('tenantsBody');
  tbody.innerHTML = '';
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('tr');
    row.className = 'loading-row';
    row.innerHTML = `
      <td><div class="skeleton" style="width:18px;height:18px;border-radius:6px"></div></td>
      <td><div style="display:flex;align-items:center;gap:12px"><div class="skeleton" style="width:42px;height:42px;border-radius:50%"></div><div style="min-width:100px;flex:1"><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-subtext"></div></div></div></td>
      <td><div class="skeleton skeleton-badge"></div></td>
      <td><div class="skeleton skeleton-badge short"></div></td>
      <td><div class="skeleton skeleton-text short"></div></td>
      <td><div class="skeleton skeleton-action"></div></td>
    `;
    tbody.appendChild(row);
  }
}

async function fetchTenantDebug(id) {
  try {
    const token = localStorage.getItem('token');
    if (!token) return { error: 'No se encontró token de sesión.' };
    const res = await fetch(`/api/debug/tenants/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    return { error: err.message };
  }
}

async function deleteTenant(id, name) {
  try {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('No se encontró token de sesión. Por favor inicia sesión de nuevo.');
      window.location.href = '/login.html';
      return;
    }

    const res = await fetch(`/api/tenants/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Validar autenticación
    if (res.status === 401 || res.status === 403) {
      console.error('[DELETE] Error de autenticación:', res.status);
      alert('Tu sesión ha expirado. Por favor inicia sesión de nuevo.');
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login.html';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showMessage(`✓ Tenant ${name} eliminado junto a sus usuarios asociados.`, 'success');
      await fetchTenants();
      return;
    }

    const debugResult = await fetchTenantDebug(id);
    if (debugResult.data) {
      console.group(`DEBUG eliminación tenant ${id}`);
      console.log(debugResult.data);
      console.groupEnd();
    } else if (debugResult.error) {
      console.warn('No se pudo obtener debug del tenant:', debugResult.error);
    }

    showMessage('Error al eliminar tenant: ' + (data.error || 'No se pudo eliminar el tenant'), 'error');
  } catch (err) {
    console.error('Error:', err);
    showMessage('Error de conexión al intentar eliminar el tenant', 'error');
  }
}

function renderTenants(data = filteredTenants) {
  const tbody = document.getElementById('tenantsBody');
  tbody.innerHTML = '';

  if (tenantsLoadError) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>No se pudieron cargar los tenants.</p><p>Verifica que el servidor y NocoDB estén disponibles.</p><button class="btn btn-acc btn-sm" onclick="refreshTenants()">Reintentar</button></td></tr>`;
    return;
  }

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-inbox"></i><p>No se encontraron tenants</p><button class="btn btn-acc btn-sm" onclick="openModal(\'createModal\')">Crear primero</button></td></tr>';
    return;
  }

  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageData = data.slice(start, end);

  pageData.forEach(t => {
    const row = document.createElement('tr');
    row.onclick = (e) => {
      if (!e.target.closest('.tenant-actions')) openDetailPanel(t);
    };
    row.innerHTML = `
      <td>
        <div class="tenant-info">
          <div class="tenant-avatar">${t.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
          <div>
            <div class="tenant-name">${t.name}</div>
            <div class="tenant-id">${t.domain}</div>
          </div>
        </div>
      </td>
      <td><span class="plan-badge ${t.plan}">${t.plan.charAt(0).toUpperCase() + t.plan.slice(1)}</span></td>
      <td><span class="status-badge ${t.status}"><span class="status-dot"></span>${t.status.charAt(0).toUpperCase() + t.status.slice(1)}</span></td>
      <td>${t.users}</td>
      <td>${new Date(t.registered).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
      <td>
        <div class="tenant-actions">
          <button class="action-icon-btn" title="Ver detalle" onclick="event.stopPropagation();window.location.href='tenant_detail.html?id=' + encodeURIComponent('${t.id}')"><i class="fas fa-eye"></i></button>
          <button class="action-icon-btn" title="Cambiar plan" onclick="event.stopPropagation();showChangePlan('${t.id}')"><i class="fas fa-exchange-alt"></i></button>
          <button class="action-icon-btn" title="Gestionar acceso" onclick="event.stopPropagation();manageAccess('${t.id}')"><i class="fas fa-user-cog"></i></button>
          <button class="action-icon-btn danger" title="Eliminar Tenant" onclick="event.stopPropagation();confirmAction('Eliminar Tenant','¿Eliminar ${t.name} y todos los usuarios relacionados? Esta acción no se puede deshacer.',()=>deleteTenant('${t.id}','${t.name}'))"><i class="fas fa-trash-alt"></i></button>
          <button class="action-icon-btn" title="Ver Detalle Completo" onclick="event.stopPropagation();window.location.href='tenant_detail.html?id=' + encodeURIComponent('${t.id}')"><i class="fas fa-external-link-alt"></i></button>
        </div>
      </td>`;
    tbody.appendChild(row);
  });
}

// ── Sorting ──────────────────────
let currentSort = { key: 'date', asc: false };

function applySorting() {
  filteredTenants.sort((a, b) => {
    let valA = a[currentSort.key];
    let valB = b[currentSort.key];
    if (currentSort.key === 'date') {
      valA = new Date(a.registered);
      valB = new Date(b.registered);
    }
    if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = valB.toLowerCase();
    }
    return currentSort.asc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
  });
}

document.querySelectorAll('.tenants-table th.sortable').forEach(th => {
  th.addEventListener('click', function () {
    const key = this.dataset.sort;
    document.querySelectorAll('.tenants-table th.sortable').forEach(h => h.classList.remove('asc', 'desc'));
    currentSort = { key, asc: !currentSort.asc || (currentSort.key !== key) };
    this.classList.add(currentSort.asc ? 'asc' : 'desc');
    applySorting();
    renderTenants();
  });
});

// ── Filtering ────────────────────
function filterTenants() {
  const query = document.getElementById('globalSearch').value.toLowerCase();
  const plan = document.getElementById('filterPlan').value;
  const status = document.getElementById('filterStatus').value;

  filteredTenants = tenants.filter(t => {
    const matchSearch = t.name.toLowerCase().includes(query) ||
      t.domain.toLowerCase().includes(query) ||
      t.id.toLowerCase().includes(query);
    return matchSearch && (!plan || t.plan === plan) && (!status || t.status === status);
  });

  currentPage = 1;
  applySorting();
  renderTenants();
  updatePagination();
}

function applyFilters() {
  filterTenants();
}

function resetFilters() {
  document.getElementById('globalSearch').value = '';
  document.getElementById('filterPlan').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterSort').value = 'date';
  filteredTenants = [...tenants];
  currentPage = 1;
  applySorting();
  renderTenants();
  updatePagination();
}

// ── Pagination ───────────────────
function updatePagination() {
  const total = filteredTenants.length;
  const totalPages = Math.ceil(total / itemsPerPage);

  document.getElementById('totalCount').textContent = total;
  document.getElementById('prevBtn').disabled = currentPage <= 1;
  document.getElementById('nextBtn').disabled = currentPage >= totalPages;

  document.querySelectorAll('.pagination-btns .pagination-btn:not(#prevBtn):not(#nextBtn)').forEach(btn => btn.classList.remove('active'));

  const activeBtn = document.getElementById('page' + currentPage) || document.querySelector('.pagination-btns .pagination-btn:nth-child(2)');
  if (activeBtn) activeBtn.classList.add('active');

  document.getElementById('lastPage').textContent = totalPages > 1 ? totalPages : 1;
}

document.getElementById('prevBtn').onclick = () => {
  if (currentPage > 1) {
    currentPage--;
    renderTenants();
    updatePagination();
  }
};

document.getElementById('nextBtn').onclick = () => {
  const totalPages = Math.ceil(filteredTenants.length / itemsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderTenants();
    updatePagination();
  }
};

// ── Modal Functions ──────────────
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

async function createTenant() {
  const form = document.getElementById('createTenantForm');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const payload = {
    nombre: document.getElementById('t-nombre').value.trim(),
    dominio: document.getElementById('t-dominio').value.trim(),
    plan: document.getElementById('t-plan').value,
    emailAdmin: document.getElementById('t-emailAdmin').value.trim(),
    pais: document.getElementById('t-pais').value,
    zonaHoraria: document.getElementById('t-zona').value,
    notas: document.getElementById('t-notas').value.trim()
  };

  const btn = form.closest('.modal').querySelector('.btn-acc');
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...';
  btn.disabled = true;

  try {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('No se encontró token de sesión. Por favor inicia sesión de nuevo.');
      btn.innerHTML = orig;
      btn.disabled = false;
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      alert(`✓ Tenant creado exitosamente. Admin ${payload.emailAdmin} creado en estado pendiente. Se envió correo de activación.`);
      closeModal('createModal');
      form.reset();
      await fetchTenants();
    } else {
      alert('Error: ' + (data.error || 'No se pudo crear el tenant'));
    }
  } catch (err) {
    console.error('Error:', err);
    alert('Error de conexión. Usando modo desarrollo.');
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

// ── Confirm Action ───────────────
let pendingAction = null;

function confirmAction(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  pendingAction = callback;
  document.getElementById('confirmActionBtn').onclick = () => {
    if (pendingAction) pendingAction();
    closeModal('confirmModal');
    pendingAction = null;
  };
  openModal('confirmModal');
}

// ── Tenant Actions ───────────────
function toggleStatus(id, currentStatus) {
  const t = tenants.find(x => x.id === id);
  if (!t) return;
  t.status = currentStatus === 'active' ? 'suspended' : 'active';
  alert(`✓ ${t.name} ${t.status === 'active' ? 'desbloqueado' : 'bloqueado'} exitosamente`);
  filterTenants();
}

function manageAccess(id) {
  alert(`🔐 Gestionar acceso para tenant: ${id}\n\nFuncionalidad completa en: tenants.html?id=${id}`);
}

function showChangePlan(id) {
  const t = tenants.find(x => x.id === id);
  if (!t) return;
  const newPlan = prompt(`Cambiar plan para ${t.name}:\n(starter/business/enterprise)`, t.plan);
  if (newPlan && ['starter', 'business', 'enterprise'].includes(newPlan)) {
    t.plan = newPlan;
    alert(`✓ Plan actualizado a ${newPlan}`);
    filterTenants();
  }
}

// ── Detail Panel ─────────────────
async function openDetailPanel(tenant) {
  if (typeof tenant === 'string') tenant = tenants.find(t => t.id === tenant);
  if (!tenant) return;

  let tenantUsers = [];
  try {
    const token = localStorage.getItem('token');
    if (token) {
      const response = await fetch(`/api/users?empresa=${encodeURIComponent(tenant.id)}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (response.ok) {
        tenantUsers = await response.json();
      } else {
        console.warn(`[TENANTS] No se pudo cargar usuarios del tenant ${tenant.id}: ${response.status}`);
      }
    }
  } catch (err) {
    console.warn('[TENANTS] Error cargando usuarios del tenant:', err);
  }

  const shownUsers = tenantUsers.slice(0, 5);
  const userItems = shownUsers.length > 0 ? shownUsers.map(u => {
    const initials = `${(u.nombre || 'U')[0]}${(u.apellido || 'X')[0]}`.toUpperCase();
    return `
      <div class="user-item">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${u.nombre} ${u.apellido}</div>
          <div class="user-email">${u.email}</div>
        </div>
        <span class="user-role">${(u.rol || 'viewer').charAt(0).toUpperCase() + (u.rol || 'viewer').slice(1)}</span>
      </div>`;
  }).join('') : '<div class="empty-state"><p>No se encontraron usuarios registrados para este tenant.</p></div>';

  const extraUsers = tenantUsers.length > shownUsers.length ? `<div class="user-more">+${tenantUsers.length - shownUsers.length} usuario(s) más</div>` : '';

  const content = document.getElementById('detailContent');
  content.innerHTML = `
    <div class="tenant-detail-header">
      <div class="tenant-detail-avatar">${tenant.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
      <div class="tenant-detail-info">
        <div class="name">${tenant.name}</div>
        <div class="id">${tenant.id} · ${tenant.domain}</div>
        <span class="plan-badge ${tenant.plan}">${tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)}</span>
        <span class="status-badge ${tenant.status}" style="margin-left:8px;"><span class="status-dot"></span>${tenant.status.charAt(0).toUpperCase() + tenant.status.slice(1)}</span>
      </div>
    </div>
    <div class="detail-stats">
      <div class="detail-stat"><div class="detail-stat-value">${tenantUsers.length}</div><div class="detail-stat-label">Usuarios Activos</div></div>
      <div class="detail-stat"><div class="detail-stat-value">${Math.floor(Math.random() * 500) + 50}K</div><div class="detail-stat-label">Tokens IA este mes</div></div>
      <div class="detail-stat"><div class="detail-stat-value">${Math.floor(Math.random() * 20) + 5}</div><div class="detail-stat-label">Bots RPA Activos</div></div>
      <div class="detail-stat"><div class="detail-stat-value">99.9%</div><div class="detail-stat-label">Uptime SLA</div></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title"><i class="fas fa-users"></i> Usuarios del Tenant</div>
      <div class="users-list">${userItems}${extraUsers}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title"><i class="fas fa-history"></i> Logs Recientes</div>
      <div class="logs-list">
        <div class="log-item"><span class="log-action">Bot RPA ejecutado: "Cotización proveedores"</span><span class="log-time">Hace 12 min</span></div>
        <div class="log-item"><span class="log-action">Nuevo usuario registrado</span><span class="log-time">Hace 1 h</span></div>
        <div class="log-item"><span class="log-action">Hash blockchain generado: 0x8f2a...</span><span class="log-time">Hace 3 h</span></div>
        <div class="log-item"><span class="log-action">Plan actualizado: Business → Enterprise</span><span class="log-time">Hace 1 d</span></div>
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-top:24px;">
      <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center;" onclick="alert('Reporte generado')"><i class="fas fa-file-export"></i> Exportar Logs</button>
      <button class="btn btn-outline btn-sm" style="flex:1;justify-content:center;" onclick="alert('Soporte notificado')"><i class="fas fa-headset"></i> Contactar Soporte</button>
      <button class="btn btn-acc btn-sm" style="flex:1;justify-content:center;" onclick="window.location.href='tenant_detail.html?id=${tenant.id}&token=' + encodeURIComponent(localStorage.getItem('token') || '')"><i class="fas fa-arrow-right"></i> Ver Detalle Completo</button>
    </div>`;

  document.getElementById('detailPanel').classList.add('active');
}

function closeDetailPanel() {
  document.getElementById('detailPanel').classList.remove('active');
}

document.getElementById('detailPanel').addEventListener('click', e => {
  if (e.target.id === 'detailPanel') closeDetailPanel();
});

// ── Refresh & Export ─────────────
async function refreshTenants() {
  const btn = document.querySelector('.page-actions .btn-ghost');
  const icon = btn?.querySelector('i');
  if (icon) icon.classList.add('fa-spin');
  await fetchTenants();
  if (icon) icon.classList.remove('fa-spin');
}

function exportTenants() {
  const csv = ['ID,Nombre,Dominio,Plan,Estado,Usuarios,Registro'];
  filteredTenants.forEach(t => csv.push(`${t.id},"${t.name}",${t.domain},${t.plan},${t.status},${t.users},${t.registered}`));
  const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tenants_export_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  alert('✓ CSV exportado exitosamente');
}

// ── Initialize on DOM Loaded ─────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[TENANTS] DOMContentLoaded iniciado');
  debugUserInfo();
  if (!validateSession()) {
    console.warn('[TENANTS] Sesión no válida');
    return;
  }
  await fetchTenants();
  setTimeout(() => document.querySelectorAll('.reveal').forEach((el, i) => setTimeout(() => el.classList.add('in'), i * 50)), 100);
});

// ── Global Event Listeners ───────
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    closeDetailPanel();
  }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    document.getElementById('globalSearch').focus();
  }
  if (e.key === 'n' && e.ctrlKey) {
    e.preventDefault();
    openModal('createModal');
  }
});