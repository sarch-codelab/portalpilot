// ── Bots RPA — Data & Interaction ─────────────────
const API_BASE = '/api';
let allBots = [];
let filteredBots = [];
let currentPage = 1;
const PAGE_SIZE = 10;

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }; }

// ── Load Bots ─────────────────
async function loadBots() {
  const tbody = document.getElementById('botsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i><br><br>Cargando bots...</td></tr>';
  try {
    const res = await fetch(`${API_BASE}/automation`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar');
    const data = await res.json();
    allBots = (data.agents || []).map(a => ({
      id: a.id,
      name: a.nombre || 'Sin nombre',
      type: a.trigger_flow || 'automatic',
      description: a.descripcion || '',
      tenant: a.empresa_codigo || '',
      status: a.estado || 'inactivo',
      lastRun: a.updated_at || a.created_at,
      tasks: a.tareas || 0,
      success: a.exito || 100,
      icon: a.icono || 'fa-bolt',
      trigger_flow: a.trigger_flow || '',
      accion: a.accion || '',
      created_at: a.created_at
    }));
    filteredBots = [...allBots];
    renderBots();
  } catch (err) {
    console.error('[BOTS] Error:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar bots. Verifica la conexión.</p></td></tr>';
  }
}

// ── Render Table ─────────────────
function renderBots() {
  const tbody = document.getElementById('botsBody');
  const totalEl = document.getElementById('totalCount');
  if (!tbody) return;
  if (totalEl) totalEl.textContent = filteredBots.length;
  if (filteredBots.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-robot"></i><p>No hay bots configurados</p></td></tr>';
    renderPagination();
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredBots.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = page.map(b => {
    const statusClass = b.status === 'activo' ? 'active' : b.status === 'inactivo' ? 'paused' : 'error';
    const statusLabel = b.status === 'activo' ? 'Activo' : b.status === 'inactivo' ? 'Pausado' : 'Error';
    const typeLabels = { assistant: 'Asistente', automatic: 'Automático', hybrid: 'Híbrido' };
    const typeLabel = typeLabels[b.type] || b.type || 'Automático';
    const lastRunStr = b.lastRun ? new Date(b.lastRun).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Nunca';
    return `<tr>
      <td><div class="bot-name"><i class="fas ${b.icon}" style="color:var(--accent);margin-right:8px;"></i>${esc(b.name)}<div class="bot-desc">${esc(b.description)}</div></div></td>
      <td><span class="type-badge">${typeLabel}</span></td>
      <td><span class="tenant-tag">${esc(b.tenant)}</span></td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td><span class="last-run">${lastRunStr}</span></td>
      <td>
        <div class="actions-cell">
          <button class="action-icon-btn" title="Ver detalle" onclick="showBotDetail('${b.id}')"><i class="fas fa-eye"></i></button>
          <button class="action-icon-btn ${b.status === 'activo' ? 'warning' : 'green'}" title="${b.status === 'activo' ? 'Pausar' : 'Activar'}" onclick="toggleBotStatus('${b.id}')"><i class="fas fa-${b.status === 'activo' ? 'pause' : 'play'}"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
  renderPagination();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Pagination ─────────────────
function renderPagination() {
  const info = document.querySelector('.pagination-info');
  const btns = document.querySelector('.pagination-btns');
  if (!info || !btns) return;
  const total = filteredBots.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  info.innerHTML = total > 0
    ? `Mostrando <strong>${start}-${end}</strong> de <strong>${total}</strong> bots`
    : `Mostrando <strong>0</strong> de <strong>0</strong> bots`;
  let html = `<button class="pagination-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 3); i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (pages > 3) html += `<button class="pagination-btn" disabled>...</button><button class="pagination-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="pagination-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
  btns.innerHTML = html;
}

function goPage(p) {
  const pages = Math.max(1, Math.ceil(filteredBots.length / PAGE_SIZE));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderBots();
}

// ── Filters ─────────────────
function filterBots() {
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const status = document.getElementById('filterStatus')?.value || '';
  const type = document.getElementById('filterType')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'name';
  filteredBots = allBots.filter(b => {
    if (search && !b.name.toLowerCase().includes(search) && !b.tenant.toLowerCase().includes(search) && !b.description.toLowerCase().includes(search)) return false;
    if (status && b.status !== status) return false;
    if (type && b.type !== type) return false;
    return true;
  });
  filteredBots.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'lastRun') return new Date(b.lastRun || 0) - new Date(a.lastRun || 0);
    if (sort === 'status') return a.status.localeCompare(b.status);
    return 0;
  });
  currentPage = 1;
  renderBots();
}

function resetFilters() {
  document.getElementById('globalSearch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterType').value = '';
  document.getElementById('filterSort').value = 'name';
  filteredBots = [...allBots];
  currentPage = 1;
  renderBots();
}

function refreshBots() { loadBots(); }

// ── Modal ─────────────────
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

// ── Create Bot ─────────────────
async function createBot() {
  const nombre = document.getElementById('b-nombre')?.value.trim();
  const tipo = document.getElementById('b-tipo')?.value;
  const desc = document.getElementById('b-descripcion')?.value.trim();
  const accion = document.getElementById('b-acciones')?.value.trim();
  if (!nombre) { alert('El nombre es requerido'); return; }
  try {
    const res = await fetch(`${API_BASE}/automation`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ nombre, trigger_flow: tipo || 'automatic', descripcion: desc, accion })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Error'); }
    closeModal('createModal');
    document.getElementById('createBotForm')?.reset();
    if (window.showToast) showToast('Bot creado exitosamente', 'success');
    await loadBots();
  } catch (err) {
    alert('Error al crear bot: ' + err.message);
  }
}

// ── Toggle Status ─────────────────
async function toggleBotStatus(id) {
  const bot = allBots.find(b => b.id === id);
  if (!bot) return;
  const newStatus = bot.status === 'activo' ? 'inactivo' : 'activo';
  try {
    const res = await fetch(`${API_BASE}/automation/${id}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ estado: newStatus })
    });
    if (!res.ok) throw new Error('Error');
    await loadBots();
    if (window.showToast) showToast(`Bot ${newStatus === 'activo' ? 'activado' : 'pausado'}`, 'success');
  } catch (err) {
    alert('Error al cambiar estado: ' + err.message);
  }
}

// ── Detail Panel ─────────────────
function showBotDetail(id) {
  const bot = allBots.find(b => b.id === id);
  if (!bot) return;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');
  if (!panel || !content) return;
  const statusLabel = bot.status === 'activo' ? 'Activo' : bot.status === 'inactivo' ? 'Pausado' : 'Error';
  content.innerHTML = `
    <div style="padding:4px 0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(139,92,246,0.15);display:flex;align-items:center;justify-content:center;"><i class="fas ${bot.icon}" style="color:var(--accent);font-size:20px;"></i></div>
        <div><div style="font-weight:700;color:var(--white);font-size:16px;">${esc(bot.name)}</div><div style="font-size:12px;color:var(--gray);">${esc(bot.tenant)}</div></div>
      </div>
      <div class="detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div class="detail-item"><span class="detail-label">Estado</span><span class="status-badge ${bot.status === 'activo' ? 'active' : 'paused'}">${statusLabel}</span></div>
        <div class="detail-item"><span class="detail-label">Tipo</span><span style="color:var(--text);font-size:13px;">${esc(bot.type)}</span></div>
        <div class="detail-item"><span class="detail-label">Tareas ejecutadas</span><span style="color:var(--text);font-size:13px;">${bot.tasks}</span></div>
        <div class="detail-item"><span class="detail-label">Tasa de éxito</span><span style="color:var(--green);font-size:13px;">${bot.success}%</span></div>
        <div class="detail-item"><span class="detail-label">Creado</span><span style="color:var(--text);font-size:13px;">${bot.created_at ? new Date(bot.created_at).toLocaleDateString('es-ES') : 'N/A'}</span></div>
        <div class="detail-item"><span class="detail-label">Última ejecución</span><span style="color:var(--text);font-size:13px;">${bot.lastRun ? new Date(bot.lastRun).toLocaleDateString('es-ES') : 'Nunca'}</span></div>
      </div>
      ${bot.description ? `<div style="margin-bottom:16px;"><span class="detail-label">Descripción</span><p style="color:var(--text);font-size:13px;line-height:1.6;margin-top:4px;">${esc(bot.description)}</p></div>` : ''}
      ${bot.accion ? `<div><span class="detail-label">Acciones</span><p style="color:var(--text);font-size:13px;line-height:1.6;margin-top:4px;white-space:pre-wrap;">${esc(bot.accion)}</p></div>` : ''}
    </div>`;
  panel.classList.add('active');
}

function closeDetailPanel() {
  const panel = document.getElementById('detailPanel');
  if (panel) panel.classList.remove('active');
}

// ── Export CSV ─────────────────
function exportBots() {
  if (!filteredBots.length) { alert('No hay datos para exportar'); return; }
  const headers = ['Nombre', 'Tipo', 'Tenant', 'Estado', 'Tareas', 'Éxito', 'Última Ejecución'];
  const rows = filteredBots.map(b => [b.name, b.type, b.tenant, b.status, b.tasks, b.success + '%', b.lastRun || '']);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bots_rpa_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ── Init ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadBots();
});
