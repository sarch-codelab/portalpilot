// ── Auditoría — Data & Interaction ─────────────────
const API_BASE = '/api';
let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
const PAGE_SIZE = 20;

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}` }; }

// ── Load Logs ─────────────────
async function loadLogs() {
  const tbody = document.getElementById('auditBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i><br><br>Cargando registros de auditoría...</td></tr>';
  try {
    const res = await fetch(`${API_BASE}/security/audit`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar');
    const data = await res.json();
    allLogs = (data.blocks || []).map(b => ({
      id: b.block,
      date: b.fecha,
      user: b.usuario || 'Sistema',
      action: b.type || b.event,
      description: b.event || '',
      ip: b.ip || '',
      hash: b.currHash || '',
      valid: b.valid
    }));
    filteredLogs = [...allLogs];
    renderLogs();
    // Update stats
    const stats = data.stats || {};
    const totalEl = document.getElementById('totalCount');
    if (totalEl) totalEl.textContent = stats.total || filteredLogs.length;
  } catch (err) {
    console.error('[AUDIT] Error:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar registros de auditoría.</p></td></tr>';
  }
}

// ── Render Table ─────────────────
function renderLogs() {
  const tbody = document.getElementById('auditBody');
  const info = document.querySelector('.pagination-info');
  if (!tbody) return;
  if (filteredLogs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-link"></i><p>No hay registros de auditoría</p></td></tr>';
    if (info) info.innerHTML = `Mostrando <strong>0</strong> de <strong>0</strong> registros`;
    renderPagination();
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredLogs.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = page.map(l => {
    const dateStr = l.date ? new Date(l.date).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const actionClass = getActionClass(l.action);
    const actionLabel = getActionLabel(l.action);
    return `<tr onclick="showLogDetail(${l.id})" style="cursor:pointer;">
      <td><span class="date-cell">${dateStr}</span></td>
      <td><span class="user-cell"><i class="fas fa-user" style="margin-right:6px;color:var(--accent);font-size:11px;"></i>${esc(l.user)}</span></td>
      <td><span class="action-badge ${actionClass}">${actionLabel}</span></td>
      <td><span class="resource-cell">${esc(l.description)}</span></td>
      <td><span class="ip-cell">${esc(l.ip)}</span></td>
      <td><span class="hash-cell" title="${esc(l.hash)}">${esc(l.hash.slice(0, 12))}…</span></td>
    </tr>`;
  }).join('');
  if (info) {
    const end = Math.min(start + PAGE_SIZE, filteredLogs.length);
    info.innerHTML = `Mostrando <strong>${start + 1}-${end}</strong> de <strong>${filteredLogs.length}</strong> registros`;
  }
  renderPagination();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function getActionClass(action) {
  const a = (action || '').toLowerCase();
  if (a.includes('login')) return 'login';
  if (a.includes('logout')) return 'logout';
  if (a.includes('crear') || a.includes('create')) return 'create';
  if (a.includes('editar') || a.includes('edit') || a.includes('update')) return 'edit';
  if (a.includes('eliminar') || a.includes('delete')) return 'delete';
  if (a.includes('denegado') || a.includes('denied')) return 'denied';
  return 'system';
}

function getActionLabel(action) {
  const a = (action || '').toLowerCase();
  if (a.includes('login')) return 'Login';
  if (a.includes('logout')) return 'Logout';
  if (a.includes('crear') || a.includes('create')) return 'Crear';
  if (a.includes('editar') || a.includes('edit') || a.includes('update')) return 'Editar';
  if (a.includes('eliminar') || a.includes('delete')) return 'Eliminar';
  if (a.includes('denegado') || a.includes('denied')) return 'Acceso Denegado';
  return action || 'Sistema';
}

// ── Pagination ─────────────────
function renderPagination() {
  const btns = document.querySelector('.pagination-btns');
  if (!btns) return;
  const total = filteredLogs.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  let html = `<button class="pagination-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 3); i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (pages > 3) html += `<button class="pagination-btn" disabled>...</button><button class="pagination-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="pagination-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
  btns.innerHTML = html;
}

function goPage(p) {
  const pages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderLogs();
}

// ── Filters ─────────────────
function filterLogs() { applyFilters(); }

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const action = document.getElementById('filterAction')?.value || '';
  const user = (document.getElementById('filterUser')?.value || '').toLowerCase();
  const range = document.getElementById('filterRange')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'date';
  const now = new Date();
  filteredLogs = allLogs.filter(l => {
    if (search) {
      const hay = (l.user + l.action + l.description + l.ip).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (action) {
      const a = (l.action || '').toLowerCase();
      if (!a.includes(action)) return false;
    }
    if (user && !(l.user || '').toLowerCase().includes(user)) return false;
    if (range && range !== 'custom') {
      const d = new Date(l.date);
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      if (range === 'today' && diff > 1) return false;
      if (range === '7days' && diff > 7) return false;
      if (range === '30days' && diff > 30) return false;
    }
    return true;
  });
  filteredLogs.sort((a, b) => {
    if (sort === 'date') return new Date(b.date || 0) - new Date(a.date || 0);
    if (sort === 'user') return (a.user || '').localeCompare(b.user || '');
    if (sort === 'action') return (a.action || '').localeCompare(b.action || '');
    return 0;
  });
  currentPage = 1;
  renderLogs();
}

function resetFilters() {
  document.getElementById('globalSearch').value = '';
  document.getElementById('filterAction').value = '';
  document.getElementById('filterUser').value = '';
  document.getElementById('filterRange').value = '7days';
  document.getElementById('filterSort').value = 'date';
  filteredLogs = [...allLogs];
  currentPage = 1;
  renderLogs();
}

function refreshLogs() { loadLogs(); }

// ── Modal ─────────────────
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

// ── Detail Panel ─────────────────
function showLogDetail(id) {
  const log = allLogs.find(l => l.id === id);
  if (!log) return;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');
  if (!panel || !content) return;
  const dateStr = log.date ? new Date(log.date).toLocaleString('es-ES') : '';
  content.innerHTML = `
    <div style="padding:4px 0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(139,92,246,0.15);display:flex;align-items:center;justify-content:center;"><i class="fas fa-link" style="color:var(--accent);font-size:20px;"></i></div>
        <div><div style="font-weight:700;color:var(--white);font-size:16px;">Detalle del Registro</div><div style="font-size:12px;color:var(--gray);">Bloque #${log.id}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div><span class="detail-label">Fecha</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${dateStr}</div></div>
        <div><span class="detail-label">Usuario</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${esc(log.user)}</div></div>
        <div><span class="detail-label">Acción</span><div style="margin-top:4px;"><span class="action-badge ${getActionClass(log.action)}">${getActionLabel(log.action)}</span></div></div>
        <div><span class="detail-label">IP</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${esc(log.ip) || 'N/A'}</div></div>
      </div>
      <div style="margin-bottom:16px;"><span class="detail-label">Descripción</span><p style="color:var(--text);font-size:13px;line-height:1.6;margin-top:4px;">${esc(log.description)}</p></div>
      <div><span class="detail-label">Hash del Bloque</span><div style="color:var(--accent);font-size:11px;font-family:monospace;margin-top:4px;word-break:break-all;">${esc(log.hash)}</div></div>
    </div>`;
  panel.classList.add('active');
}

function closeDetailPanel() {
  const panel = document.getElementById('detailPanel');
  if (panel) panel.classList.remove('active');
}

// ── Export CSV ─────────────────
function exportLogs() {
  if (!filteredLogs.length) { alert('No hay datos para exportar'); return; }
  const headers = ['Fecha', 'Usuario', 'Acción', 'Descripción', 'IP', 'Hash'];
  const rows = filteredLogs.map(l => [l.date, l.user, l.action, l.description, l.ip, l.hash]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ── Init ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadLogs();
});
