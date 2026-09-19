/* ── Radar de renovaciones — pp/renovaciones.html ── */
'use strict';

const API_BASE = '/api';
let subRows = [];
let renovHist = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 20;

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDinero(n) {
  const v = Number(n) || 0;
  return 'L ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function toast(msg, tipo) {
  let host = document.getElementById('ppToast');
  if (!host) { host = document.createElement('div'); host.id = 'ppToast'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'pp-toast ' + (tipo || '');
  t.innerHTML = '<i class="fas ' + (tipo === 'ok' ? 'fa-check-circle' : 'fa-exclamation-circle') + '"></i><span>' + esc(msg) + '</span>';
  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function fechaFin(sub) {
  // Prioridad: current_period_end, luego trial_ends_at; vacío si no hay
  const raw = sub.current_period_end || sub.periodo_fin || sub.fecha_fin || sub.trial_ends_at;
  return raw ? new Date(raw) : null;
}

async function loadData() {
  const tbody = document.getElementById('renovBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></td></tr>';
  try {
    const res = await fetch(API_BASE + '/admin/renovaciones', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    subRows = data.suscripciones || [];
    renovHist = data.renovaciones || [];
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[RENOVACIONES]', err);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar las renovaciones.</p></td></tr>';
  }
}

function renderKpis() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const en30 = new Date(hoy.getTime() + 30 * 86400000);
  let proximas = 0, vencidas = 0, riesgo = 0;
  for (const s of subRows) {
    const fin = fechaFin(s);
    const estado = (s.estado || '').toLowerCase();
    if (['cancelled'].includes(estado)) continue;
    if (!fin) continue;
    const monto = Number(s.monto_mensual || 0);
    if (fin < hoy) { vencidas++; riesgo += monto; }
    else if (fin <= en30) { proximas++; riesgo += monto; }
  }
  const mesActual = new Date().toISOString().slice(0, 7);
  const renovadasMes = renovHist.filter(r => (r.created_at || '').slice(0, 7) === mesActual).length;
  document.getElementById('kpiProximas').textContent = proximas;
  document.getElementById('kpiVencidas').textContent = vencidas;
  document.getElementById('kpiMrrRiesgo').textContent = fmtDinero(riesgo);
  document.getElementById('kpiRenovadas').textContent = renovadasMes;
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const ventana = document.getElementById('filterVentana')?.value ?? '30';
  const estado = document.getElementById('filterEstado')?.value || '';
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const limite = ventana ? (ventana === 'vencidos' ? hoy : new Date(hoy.getTime() + parseInt(ventana, 10) * 86400000)) : null;

  filtered = subRows.filter(s => {
    if (estado && (s.estado || '').toLowerCase() !== estado) return false;
    if (search && !((s.empresa_nombre || '') + ' ' + (s.empresa_codigo || '')).toLowerCase().includes(search)) return false;
    if (limite) {
      const fin = fechaFin(s);
      if (!fin) return false;
      if (ventana === 'vencidos') { if (fin >= hoy) return false; }
      else if (fin < hoy || fin > limite) return false;
    }
    return true;
  });
  // Más urgentes primero: vencidos primero, luego por fecha
  filtered.sort((a, b) => {
    const fa = fechaFin(a), fb = fechaFin(b);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fa - fb;
  });
  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('renovBody');
  const info = document.getElementById('pageInfo');
  const btns = document.getElementById('pageBtns');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-calendar-check"></i><p>No hay renovaciones en esta ventana.</p></td></tr>';
    if (info) info.innerHTML = 'Mostrando <strong>0</strong> de <strong>0</strong> clientes';
    btns.innerHTML = '';
    return;
  }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = page.map(s => {
    const fin = fechaFin(s);
    let diasTxt = '—', diasCls = 'st-neutral';
    if (fin) {
      const dias = Math.round((fin - hoy) / 86400000);
      if (dias < 0) { diasTxt = 'Vencido hace ' + Math.abs(dias) + ' d'; diasCls = 'st-error'; }
      else if (dias <= 7) { diasTxt = dias + ' días'; diasCls = 'st-warning'; }
      else if (dias <= 30) { diasTxt = dias + ' días'; diasCls = 'st-info'; }
      else { diasTxt = dias + ' días'; diasCls = 'st-ok'; }
    }
    return `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((s.empresa_codigo || '?').slice(0, 2))}</span>${esc(s.empresa_nombre || s.empresa_codigo)}</span></td>
      <td style="text-transform:capitalize;color:var(--white);font-weight:600;">${esc(s.plan || '—')}</td>
      <td><span class="status-badge st-${esc((s.estado || '').toLowerCase())}"><span class="action-dot"></span>${esc(s.estado || '—')}</span></td>
      <td style="color:var(--white);">${fin ? fmtFecha(fin) : '—'}</td>
      <td><span class="status-badge ${diasCls}"><span class="action-dot"></span>${diasTxt}</span></td>
      <td style="color:var(--white);font-weight:600;">${s.monto_mensual != null ? fmtDinero(s.monto_mensual) : '—'}</td>
      <td>${esc(s.proveedor_pago || 'manual')}</td>
      <td>${s.ultima_renovacion ? fmtFecha(s.ultima_renovacion) : '<span style="color:var(--gray);">—</span>'}</td>
    </tr>`;
  }).join('');
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (info) info.innerHTML = `Mostrando <strong>${start + 1}-${Math.min(start + PAGE_SIZE, filtered.length)}</strong> de <strong>${filtered.length}</strong> clientes`;
  let html = `<button class="pagination-btn" onclick="goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
  for (let i = 1; i <= Math.min(pages, 4); i++) html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
  if (pages > 4) html += `<button class="pagination-btn" disabled>…</button><button class="pagination-btn" onclick="goPage(${pages})">${pages}</button>`;
  html += `<button class="pagination-btn" onclick="goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
  btns.innerHTML = html;
}

function goPage(p) {
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
}

function resetFilters() {
  const v = document.getElementById('filterVentana'); if (v) v.value = '30';
  const e = document.getElementById('filterEstado'); if (e) e.value = '';
  const s = document.getElementById('globalSearch'); if (s) s.value = '';
  applyFilters();
}

function exportCsv() {
  if (!filtered.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Cliente', 'Codigo', 'Plan', 'Estado', 'Vence', 'Monto_mensual_HNL', 'Proveedor_pago', 'Ultima_renovacion'];
  const rows = filtered.map(s => [s.empresa_nombre || s.empresa_codigo, s.empresa_codigo, s.plan, s.estado, fechaFin(s) ? fechaFin(s).toISOString() : '', s.monto_mensual, s.proveedor_pago, s.ultima_renovacion]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `renovaciones_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
