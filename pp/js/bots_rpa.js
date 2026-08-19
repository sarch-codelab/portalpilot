// ── Bots RPA — Automation Rules Engine ─────────────────
const API_BASE = '/api';
let allRules = [];
let filteredRules = [];
let currentPage = 1;
const PAGE_SIZE = 10;

const TRIGGER_TYPES = {
  usuario_creado: { label: 'Nuevo Usuario', icon: 'fa-user-plus', color: 'var(--accent)' },
  factura_vencida: { label: 'Factura Vencida', icon: 'fa-file-invoice-dollar', color: 'var(--red)' },
  stock_bajo: { label: 'Stock Bajo', icon: 'fa-box-open', color: 'var(--yellow)' },
  factura_creada: { label: 'Factura Creada', icon: 'fa-file-invoice', color: 'var(--green)' },
  tenant_creado: { label: 'Nuevo Tenant', icon: 'fa-building', color: 'var(--cyan)' }
};

const ACTION_TYPES = {
  notificar: { label: 'Notificación', icon: 'fa-bell' },
  email: { label: 'Email', icon: 'fa-envelope' },
  log: { label: 'Log de Auditoría', icon: 'fa-clipboard-list' }
};

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }; }

// ── Load Rules ─────────────────
async function loadRules() {
  const tbody = document.getElementById('botsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i><br><br>Cargando automatizaciones...</td></tr>';
  try {
    const [rulesRes, agentsRes] = await Promise.all([
      fetch(`${API_BASE}/automation/rules`, { headers: authHeaders() }),
      fetch(`${API_BASE}/automation`, { headers: authHeaders() })
    ]);
    if (!rulesRes.ok) throw new Error('Error al cargar reglas');
    const rulesData = await rulesRes.json();
    const agentsData = agentsRes.ok ? await agentsRes.json() : {};
    allRules = (rulesData.rules || []).map(r => ({
      ...r,
      conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : (r.conditions || {}),
      actions: typeof r.actions === 'string' ? JSON.parse(r.actions) : (r.actions || [])
    }));
    filteredRules = [...allRules];
    renderRules();
  } catch (err) {
    console.error('[BOTS] Error:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar automatizaciones.</p></td></tr>';
  }
}

// ── Render Table ─────────────────
function renderRules() {
  const tbody = document.getElementById('botsBody');
  const totalEl = document.getElementById('totalCount');
  if (!tbody) return;
  if (totalEl) totalEl.textContent = filteredRules.length;
  if (filteredRules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-robot"></i><p>No hay automatizaciones configuradas</p><p style="font-size:12px;color:var(--gray);margin-top:4px;">Crea una regla para automatizar procesos</p></td></tr>';
    renderPagination();
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredRules.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = page.map(r => {
    const trigger = TRIGGER_TYPES[r.trigger_type] || { label: r.trigger_type, icon: 'fa-bolt', color: 'var(--gray)' };
    const actionCount = (r.actions || []).length;
    const actionLabels = (r.actions || []).map(a => ACTION_TYPES[a.tipo]?.label || a.tipo).join(', ');
    const lastRun = r.last_executed_at ? new Date(r.last_executed_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Nunca';
    return `<tr>
      <td>
        <div class="bot-name">
          <i class="fas ${trigger.icon}" style="color:${trigger.color};margin-right:8px;"></i>
          ${esc(r.nombre)}
          <div class="bot-desc">${esc(r.descripcion || '')}</div>
        </div>
      </td>
      <td><span class="type-badge" style="border-color:${trigger.color};color:${trigger.color};">${trigger.label}</span></td>
      <td><span style="font-size:12px;color:var(--gray2);">${actionCount} acción(es): ${esc(actionLabels)}</span></td>
      <td><span class="status-badge ${r.enabled ? 'active' : 'paused'}">${r.enabled ? 'Activo' : 'Pausado'}</span></td>
      <td><span class="last-run">${lastRun}</span><br><span style="font-size:10px;color:var(--gray);">${r.execution_count || 0} ejecuciones</span></td>
      <td>
        <div class="actions-cell">
          <button class="action-icon-btn" title="Ver detalle" onclick="showRuleDetail('${r.id}')"><i class="fas fa-eye"></i></button>
          <button class="action-icon-btn ${r.enabled ? 'warning' : 'green'}" title="${r.enabled ? 'Pausar' : 'Activar'}" onclick="toggleRule('${r.id}')"><i class="fas fa-${r.enabled ? 'pause' : 'play'}"></i></button>
          <button class="action-icon-btn" title="Eliminar" style="color:var(--red);" onclick="deleteRule('${r.id}','${esc(r.nombre)}')"><i class="fas fa-trash"></i></button>
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
  const total = filteredRules.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  info.innerHTML = total > 0
    ? `Mostrando <strong>${start}-${end}</strong> de <strong>${total}</strong> reglas`
    : `Mostrando <strong>0</strong> de <strong>0</strong> reglas`;
  let html = `<button class="pagination-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 3); i++) {
    html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  }
  if (pages > 3) html += `<button class="pagination-btn" disabled>...</button><button class="pagination-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="pagination-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
  btns.innerHTML = html;
}

function goPage(p) {
  const pages = Math.max(1, Math.ceil(filteredRules.length / PAGE_SIZE));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderRules();
}

// ── Filters ─────────────────
function filterBots() { applyFilters(); }

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const status = document.getElementById('filterStatus')?.value || '';
  const type = document.getElementById('filterType')?.value || '';
  const sort = document.getElementById('filterSort')?.value || 'name';
  filteredRules = allRules.filter(r => {
    if (search && !r.nombre.toLowerCase().includes(search) && !(r.descripcion || '').toLowerCase().includes(search)) return false;
    if (status === 'active' && !r.enabled) return false;
    if (status === 'paused' && r.enabled) return false;
    if (type && r.trigger_type !== type) return false;
    return true;
  });
  filteredRules.sort((a, b) => {
    if (sort === 'name') return a.nombre.localeCompare(b.nombre);
    if (sort === 'lastRun') return new Date(b.last_executed_at || 0) - new Date(a.last_executed_at || 0);
    if (sort === 'status') return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0);
    return 0;
  });
  currentPage = 1;
  renderRules();
}

function resetFilters() {
  document.getElementById('globalSearch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterType').value = '';
  document.getElementById('filterSort').value = 'name';
  filteredRules = [...allRules];
  currentPage = 1;
  renderRules();
}

function refreshBots() { loadRules(); }

// ── Modal ─────────────────
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('active');
}

// ── Create Rule ─────────────────
async function createBot() {
  const nombre = document.getElementById('b-nombre')?.value.trim();
  const triggerType = document.getElementById('b-tipo')?.value;
  const desc = document.getElementById('b-descripcion')?.value.trim();
  const accion = document.getElementById('b-acciones')?.value.trim();
  if (!nombre) { alert('El nombre es requerido'); return; }
  if (!triggerType) { alert('Selecciona un tipo de trigger'); return; }

  const actions = [];
  if (accion) {
    actions.push({ tipo: 'notificar', titulo: nombre, mensaje: accion });
  } else {
    actions.push({ tipo: 'notificar', titulo: nombre, mensaje: `Automatización "${nombre}" ejecutada` });
  }
  actions.push({ tipo: 'log', accion: `automatizacion_${triggerType}` });

  const conditions = {};
  if (triggerType === 'factura_vencida') conditions.dias_minimas = 3;

  try {
    const res = await fetch(`${API_BASE}/automation/rules`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ nombre, trigger_type: triggerType, descripcion: desc || '', conditions, actions })
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Error'); }
    closeModal('createModal');
    document.getElementById('createBotForm')?.reset();
    if (window.showToast) showToast('Regla creada exitosamente', 'success');
    await loadRules();
  } catch (err) {
    alert('Error al crear regla: ' + err.message);
  }
}

// ── Toggle Rule ─────────────────
async function toggleRule(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  const newEnabled = !rule.enabled;
  try {
    const res = await fetch(`${API_BASE}/automation/rules/${id}`, {
      method: 'PATCH', headers: authHeaders(),
      body: JSON.stringify({ enabled: newEnabled })
    });
    if (!res.ok) throw new Error('Error');
    await loadRules();
    if (window.showToast) showToast(`Regla ${newEnabled ? 'activada' : 'pausada'}`, 'success');
  } catch (err) {
    alert('Error al cambiar estado: ' + err.message);
  }
}

// ── Delete Rule ─────────────────
function deleteRule(id, name) {
  document.getElementById('confirmTitle').textContent = 'Eliminar Regla';
  document.getElementById('confirmMessage').textContent = `¿Estás seguro de eliminar la regla "${name}"? Esta acción no se puede deshacer.`;
  const btn = document.getElementById('confirmActionBtn');
  btn.onclick = async () => {
    try {
      const res = await fetch(`${API_BASE}/automation/rules/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Error');
      closeModal('confirmModal');
      await loadRules();
      if (window.showToast) showToast('Regla eliminada', 'success');
    } catch (err) { alert('Error: ' + err.message); }
  };
  openModal('confirmModal');
}

// ── Execute Polling ─────────────────
async function executeAutomation() {
  try {
    const res = await fetch(`${API_BASE}/automation/execute`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) throw new Error('Error');
    const data = await res.json();
    const count = (data.results || []).reduce((s, r) => s + (r.matched || 0), 0);
    if (window.showToast) showToast(`Polling ejecutado. ${count} regla(s) activadas.`, 'success');
    await loadRules();
  } catch (err) {
    alert('Error al ejecutar: ' + err.message);
  }
}

// ── Detail Panel ─────────────────
function showRuleDetail(id) {
  const rule = allRules.find(r => r.id === id);
  if (!rule) return;
  const panel = document.getElementById('detailPanel');
  const content = document.getElementById('detailContent');
  if (!panel || !content) return;
  const trigger = TRIGGER_TYPES[rule.trigger_type] || { label: rule.trigger_type, icon: 'fa-bolt', color: 'var(--gray)' };
  const lastRun = rule.last_executed_at ? new Date(rule.last_executed_at).toLocaleString('es-ES') : 'Nunca ejecutada';
  content.innerHTML = `
    <div style="padding:4px 0;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(139,92,246,0.15);display:flex;align-items:center;justify-content:center;"><i class="fas ${trigger.icon}" style="color:${trigger.color};font-size:20px;"></i></div>
        <div><div style="font-weight:700;color:var(--white);font-size:16px;">${esc(rule.nombre)}</div><div style="font-size:12px;color:var(--gray);">${trigger.label}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <div><span class="detail-label">Estado</span><div style="margin-top:4px;"><span class="status-badge ${rule.enabled ? 'active' : 'paused'}">${rule.enabled ? 'Activo' : 'Pausado'}</span></div></div>
        <div><span class="detail-label">Ejecuciones</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${rule.execution_count || 0}</div></div>
        <div><span class="detail-label">Última ejecución</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${lastRun}</div></div>
        <div><span class="detail-label">Creada</span><div style="color:var(--text);font-size:13px;margin-top:4px;">${rule.created_at ? new Date(rule.created_at).toLocaleDateString('es-ES') : 'N/A'}</div></div>
      </div>
      ${rule.descripcion ? `<div style="margin-bottom:16px;"><span class="detail-label">Descripción</span><p style="color:var(--text);font-size:13px;line-height:1.6;margin-top:4px;">${esc(rule.descripcion)}</p></div>` : ''}
      <div style="margin-bottom:16px;">
        <span class="detail-label">Condiciones</span>
        <pre style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--cyan);margin-top:6px;overflow-x:auto;">${esc(JSON.stringify(rule.conditions, null, 2))}</pre>
      </div>
      <div>
        <span class="detail-label">Acciones (${(rule.actions || []).length})</span>
        ${(rule.actions || []).map((a, i) => {
          const at = ACTION_TYPES[a.tipo] || { label: a.tipo, icon: 'fa-bolt' };
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--card2);border-radius:8px;margin-top:6px;font-size:12px;">
            <i class="fas ${at.icon}" style="color:var(--accent);"></i>
            <span style="color:var(--white);font-weight:600;">${at.label}</span>
            <span style="color:var(--gray);">— ${esc(a.titulo || a.accion || a.mensaje || '')}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  panel.classList.add('active');
}

function closeDetailPanel() {
  const panel = document.getElementById('detailPanel');
  if (panel) panel.classList.remove('active');
}

// ── Export CSV ─────────────────
function exportBots() {
  if (!filteredRules.length) { alert('No hay datos para exportar'); return; }
  const headers = ['Nombre', 'Trigger', 'Acciones', 'Estado', 'Ejecuciones', 'Última Ejecución'];
  const rows = filteredRules.map(r => {
    const trigger = TRIGGER_TYPES[r.trigger_type]?.label || r.trigger_type;
    const actions = (r.actions || []).map(a => ACTION_TYPES[a.tipo]?.label || a.tipo).join('; ');
    return [r.nombre, trigger, actions, r.enabled ? 'Activo' : 'Pausado', r.execution_count || 0, r.last_executed_at || ''];
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `automatizaciones_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ── Init ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadRules();
});
