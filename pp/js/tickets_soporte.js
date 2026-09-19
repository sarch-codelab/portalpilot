/* ── Tickets de soporte (admin) — pp/tickets_soporte.html ── */
'use strict';

const API_BASE = '/api';
const SLA_HORAS = { critica: 4, urgente: 8, alta: 24, normal: 48, baja: 72 };

let allTickets = [];
let filteredTickets = [];
let currentPage = 1;
const PAGE_SIZE = 20;

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
}
function fmtEdad(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'hace ' + Math.max(1, Math.floor(ms / 60000)) + ' min';
  if (h < 24) return 'hace ' + h + ' h';
  return 'hace ' + Math.floor(h / 24) + ' d';
}
function toast(msg, tipo) {
  let host = document.getElementById('ppToast');
  if (!host) { host = document.createElement('div'); host.id = 'ppToast'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'pp-toast ' + (tipo || '');
  t.innerHTML = '<i class="fas ' + (tipo === 'ok' ? 'fa-check-circle' : tipo === 'err' ? 'fa-exclamation-circle' : 'fa-info-circle') + '"></i><span>' + esc(msg) + '</span>';
  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
function badgeEstado(estado) {
  const e = (estado || 'open').toLowerCase();
  const labels = { open: 'Abierto', in_progress: 'En proceso', waiting_customer: 'Esperando cliente', resolved: 'Resuelto', closed: 'Cerrado' };
  return '<span class="status-badge st-' + esc(e) + '"><span class="action-dot"></span>' + esc(labels[e] || e) + '</span>';
}
function badgePrioridad(p) {
  const v = (p || 'normal').toLowerCase();
  const labels = { critica: 'Crítica', urgente: 'Urgente', alta: 'Alta', normal: 'Normal', media: 'Media', baja: 'Baja' };
  return '<span class="prio-badge ' + esc(v) + '">' + esc(labels[v] || v) + '</span>';
}
function slaInfo(t) {
  const created = t.created_at ? new Date(t.created_at).getTime() : null;
  if (!created) return { text: '—', cls: 'st-neutral' };
  const cerrado = ['resolved', 'closed'].includes((t.estado || '').toLowerCase());
  const fin = cerrado && t.updated_at ? new Date(t.updated_at).getTime() : Date.now();
  const horas = Math.max(0, Math.floor((fin - created) / 3600000));
  const limite = SLA_HORAS[(t.prioridad || 'normal').toLowerCase()] || 48;
  if (cerrado) return { text: 'Cerrado en ' + horas + 'h', cls: horas <= limite ? 'st-ok' : 'st-warning' };
  if (horas >= limite) return { text: 'Vencido (' + horas + 'h/' + limite + 'h)', cls: 'st-error' };
  if (horas >= limite * 0.75) return { text: 'Por vencer (' + horas + 'h/' + limite + 'h)', cls: 'st-warning' };
  return { text: 'OK (' + horas + 'h/' + limite + 'h)', cls: 'st-ok' };
}

async function loadTickets() {
  const tbody = document.getElementById('ticketsBody');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></td></tr>';
  try {
    const res = await fetch(API_BASE + '/admin/tickets', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allTickets = data.tickets || [];
    // Categorías dinámicas
    const cats = [...new Set(allTickets.map(t => t.categoria).filter(Boolean))].sort();
    const sel = document.getElementById('filterCategoria');
    sel.innerHTML = '<option value="">Todas</option>' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[TICKETS]', err);
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar los tickets de soporte.</p></td></tr>';
  }
}

function renderKpis() {
  const abiertos = allTickets.filter(t => !['resolved', 'closed'].includes((t.estado || '').toLowerCase()));
  const vencidos = abiertos.filter(t => slaInfo(t).cls === 'st-error');
  const urgentes = abiertos.filter(t => ['critica', 'urgente'].includes((t.prioridad || '').toLowerCase()));
  document.getElementById('kpiAbiertos').textContent = abiertos.length;
  document.getElementById('kpiSlaBreached').textContent = vencidos.length;
  document.getElementById('kpiUrgentes').textContent = urgentes.length;
  // Respuesta promedio: tiempo hasta primer cambio de estado/updated_at de tickets ya movidos
  const respondidos = allTickets.filter(t => t.updated_at && t.created_at && t.updated_at !== t.created_at && (t.asignado_a || t.estado !== 'open'));
  if (respondidos.length) {
    const prom = respondidos.reduce((s, t) => s + (new Date(t.updated_at) - new Date(t.created_at)) / 3600000, 0) / respondidos.length;
    document.getElementById('kpiRespuesta').textContent = prom < 24 ? prom.toFixed(1) + ' h' : (prom / 24).toFixed(1) + ' d';
  } else {
    document.getElementById('kpiRespuesta').textContent = '—';
  }
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const estado = document.getElementById('filterEstado')?.value || '';
  const prio = document.getElementById('filterPrioridad')?.value || '';
  const emp = (document.getElementById('filterEmpresa')?.value || '').toLowerCase();
  const cat = document.getElementById('filterCategoria')?.value || '';
  filteredTickets = allTickets.filter(t => {
    if (estado && (t.estado || '').toLowerCase() !== estado) return false;
    if (prio && (t.prioridad || '').toLowerCase() !== prio) return false;
    if (cat && (t.categoria || '') !== cat) return false;
    if (emp && !((t.empresa_codigo || '') + ' ' + (t.empresa || '')).toLowerCase().includes(emp)) return false;
    if (search) {
      const hay = ((t.ticket_id || '') + ' ' + (t.nombre || '') + ' ' + (t.email || '') + ' ' + (t.empresa || '') + ' ' + (t.mensaje || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  // Abiertos y vencidos de SLA primero
  filteredTickets.sort((a, b) => {
    const ra = slaInfo(a).cls === 'st-error' ? 0 : 1;
    const rb = slaInfo(b).cls === 'st-error' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('ticketsBody');
  const info = document.getElementById('pageInfo');
  const btns = document.getElementById('pageBtns');
  if (!filteredTickets.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-inbox"></i><p>No hay tickets que coincidan con los filtros.</p></td></tr>';
    if (info) info.innerHTML = 'Mostrando <strong>0</strong> de <strong>0</strong> tickets';
    btns.innerHTML = '';
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredTickets.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = page.map(t => {
    const sla = slaInfo(t);
    return `<tr onclick="openDetail('${esc(t.id)}')" style="cursor:pointer;">
      <td><span style="font-family:monospace;color:var(--accent);font-size:12px;">${esc(t.ticket_id || t.id.slice(0, 8))}</span></td>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((t.empresa_codigo || '?').slice(0, 2))}</span>${esc(t.empresa || t.empresa_codigo || '—')}</span></td>
      <td><div style="color:var(--white);font-weight:600;font-size:13px;">${esc(t.nombre || '—')}</div><div style="font-size:11px;color:var(--gray);">${esc(t.email || '')}</div></td>
      <td>${esc(t.categoria || '—')}</td>
      <td>${badgePrioridad(t.prioridad)}</td>
      <td>${badgeEstado(t.estado)}</td>
      <td><span class="status-badge ${sla.cls}"><span class="action-dot"></span>${esc(sla.text)}</span></td>
      <td>${esc(t.asignado_a || 'Sin asignar')}</td>
      <td><span style="color:var(--white);">${fmtFecha(t.created_at)}</span><br><span style="font-size:11px;color:var(--gray);">${fmtEdad(t.created_at)}</span></td>
    </tr>`;
  }).join('');
  const pages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  if (info) info.innerHTML = `Mostrando <strong>${start + 1}-${Math.min(start + PAGE_SIZE, filteredTickets.length)}</strong> de <strong>${filteredTickets.length}</strong> tickets`;
  let html = `<button class="pagination-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 4); i++) html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  if (pages > 4) html += `<button class="pagination-btn" disabled>…</button><button class="pagination-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="pagination-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
  btns.innerHTML = html;
}

function goPage(p) {
  const pages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
}

function openDetail(id) {
  const t = allTickets.find(x => x.id === id);
  if (!t) return;
  const sla = slaInfo(t);
  const content = document.getElementById('detailContent');
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
      <div style="width:46px;height:46px;border-radius:12px;background:rgba(139,92,246,.15);display:flex;align-items:center;justify-content:center;"><i class="fas fa-life-ring" style="color:var(--accent);font-size:19px;"></i></div>
      <div>
        <div style="font-weight:700;color:var(--white);font-size:15px;">${esc(t.asunto || t.ticket_id || 'Ticket')}</div>
        <div style="font-size:11px;color:var(--gray);font-family:monospace;">${esc(t.ticket_id || t.id)}</div>
      </div>
    </div>
    <div class="detail-stats">
      <div class="detail-stat"><div class="detail-stat-value" style="font-size:14px;">${esc(t.empresa_codigo || '—')}</div><div class="detail-stat-label">Empresa</div></div>
      <div class="detail-stat"><div class="detail-stat-value" style="font-size:14px;">${esc(t.plan || '—')}</div><div class="detail-stat-label">Plan</div></div>
    </div>
    <div class="detail-field"><span class="detail-field-label">Cliente</span><span class="detail-field-value">${esc(t.nombre || '—')}</span></div>
    <div class="detail-field"><span class="detail-field-label">Email</span><span class="detail-field-value mono">${esc(t.email || '—')}</span></div>
    <div class="detail-field"><span class="detail-field-label">Teléfono</span><span class="detail-field-value mono">${esc(t.telefono || '—')}</span></div>
    <div class="detail-field"><span class="detail-field-label">Categoría</span><span class="detail-field-value">${esc(t.categoria || '—')}</span></div>
    <div class="detail-field"><span class="detail-field-label">Prioridad</span>${badgePrioridad(t.prioridad)}</div>
    <div class="detail-field"><span class="detail-field-label">Estado</span>${badgeEstado(t.estado)}</div>
    <div class="detail-field"><span class="detail-field-label">SLA</span><span class="status-badge ${sla.cls}"><span class="action-dot"></span>${esc(sla.text)}</span></div>
    <div class="detail-field"><span class="detail-field-label">Creado</span><span class="detail-field-value">${fmtFecha(t.created_at)}</span></div>
    <div class="detail-field"><span class="detail-field-label">Última actualización</span><span class="detail-field-value">${fmtFecha(t.updated_at)}</span></div>
    <div style="margin:18px 0;">
      <div class="detail-field-label" style="margin-bottom:6px;">Mensaje</div>
      <div style="font-size:13px;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;line-height:1.6;">${esc(t.mensaje || '—')}</div>
    </div>
    <div class="detail-section-title" style="margin-top:24px;"><i class="fas fa-user-check"></i> Gestión</div>
    <div class="form-group">
      <label>Asignar a</label>
      <input type="text" id="dAssign" value="${esc(t.asignado_a || '')}" placeholder="Nombre del agente...">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Cambiar prioridad</label>
        <select id="dPrio">
          ${['critica', 'urgente', 'alta', 'normal', 'baja'].map(p => `<option value="${p}" ${(t.prioridad || 'normal').toLowerCase() === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Cambiar estado</label>
        <select id="dEstado">
          ${[['open', 'Abierto'], ['in_progress', 'En proceso'], ['waiting_customer', 'Esperando cliente'], ['resolved', 'Resuelto'], ['closed', 'Cerrado']]
            .map(([v, l]) => `<option value="${v}" ${(t.estado || 'open').toLowerCase() === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Nota de resolución / respuesta</label>
      <textarea id="dNota" rows="3" placeholder="Qué se hizo o qué se respondió al cliente..."></textarea>
    </div>
    <button class="btn btn-acc" style="width:100%;justify-content:center;" onclick="saveTicket('${esc(t.id)}')"><i class="fas fa-save"></i> Guardar cambios</button>`;
  document.getElementById('detailPanel').classList.add('active');
}

function closeDetailPanel() { document.getElementById('detailPanel').classList.remove('active'); }

async function saveTicket(id) {
  const payload = {
    asignado_a: document.getElementById('dAssign')?.value.trim() || null,
    prioridad: document.getElementById('dPrio')?.value || null,
    estado: document.getElementById('dEstado')?.value || null,
    nota: document.getElementById('dNota')?.value.trim() || ''
  };
  try {
    const res = await fetch(API_BASE + '/admin/tickets/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    toast('Ticket actualizado' + (data.notificado ? ' y cliente notificado' : ''), 'ok');
    closeDetailPanel();
    loadTickets();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function resetFilters() {
  ['filterEstado', 'filterPrioridad', 'filterCategoria'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const fEmp = document.getElementById('filterEmpresa'); if (fEmp) fEmp.value = '';
  const s = document.getElementById('globalSearch'); if (s) s.value = '';
  applyFilters();
}
function refreshTickets() { loadTickets(); }

function exportCsv() {
  if (!filteredTickets.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Ticket', 'Empresa', 'Cliente', 'Email', 'Categoria', 'Prioridad', 'Estado', 'SLA', 'Asignado', 'Creado'];
  const rows = filteredTickets.map(t => [t.ticket_id || t.id, t.empresa || t.empresa_codigo, t.nombre, t.email, t.categoria, t.prioridad, t.estado, slaInfo(t).text, t.asignado_a, t.created_at]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `tickets_soporte_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

document.addEventListener('DOMContentLoaded', loadTickets);
