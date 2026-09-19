/* ── Cuenta corriente por tenant — pp/facturas_cliente.html ── */
'use strict';

const API_BASE = '/api';
let cobranza = { tenants: [], documentos: [] };
let tenantSel = '';
let filteredDocs = [];

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

async function loadData() {
  const tbody = document.getElementById('resumenBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></td></tr>';
  try {
    const res = await fetch(API_BASE + '/admin/cobranza', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    cobranza = await res.json();
    renderSelector();
    renderResumen();
    renderKpis();
    onTenantChange(true);
  } catch (err) {
    console.error('[COBRANZA]', err);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar la cobranza.</p></td></tr>';
  }
}

function renderSelector() {
  const sel = document.getElementById('filterTenant');
  const urlTenant = new URLSearchParams(window.location.search).get('tenant') || '';
  sel.innerHTML = '<option value="">— Resumen global —</option>' +
    cobranza.tenants.map(t => `<option value="${esc(t.empresa_codigo)}" ${t.empresa_codigo === urlTenant ? 'selected' : ''}>${esc(t.empresa_nombre || t.empresa_codigo)}</option>`).join('');
  tenantSel = sel.value;
}

function docsDelTenant(codigo) {
  return (cobranza.documentos || []).filter(d => !codigo || d.empresa_codigo === codigo);
}

function onTenantChange(keep) {
  tenantSel = document.getElementById('filterTenant')?.value || '';
  const t = cobranza.tenants.find(x => x.empresa_codigo === tenantSel);
  document.getElementById('docsTitle').innerHTML = 'Documentos — ' + esc(t ? (t.empresa_nombre || t.empresa_codigo) : 'todos los clientes');
  applyDocFilters();
}

function renderResumen() {
  const tbody = document.getElementById('resumenBody');
  if (!cobranza.tenants.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-folder-open"></i><p>Aún no hay documentos comerciales registrados.</p></td></tr>';
    return;
  }
  const orden = [...cobranza.tenants].sort((a, b) => (b.saldo || 0) - (a.saldo || 0));
  tbody.innerHTML = orden.map(t => `
    <tr style="cursor:pointer;" onclick="seleccionarTenant('${esc(t.empresa_codigo)}')">
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((t.empresa_codigo || '?').slice(0, 2))}</span>${esc(t.empresa_nombre || t.empresa_codigo)}</span></td>
      <td>${t.total_facturas || 0}</td>
      <td style="color:var(--white);">${fmtDinero(t.total_facturado)}</td>
      <td style="color:var(--green);">${fmtDinero(t.total_cobrado)}</td>
      <td style="color:var(--cyan);">${fmtDinero(t.total_notas_credito)}</td>
      <td style="color:${(t.saldo || 0) > 0 ? 'var(--yellow)' : 'var(--gray)'};font-weight:700;">${fmtDinero(t.saldo)}</td>
      <td>${(t.facturas_vencidas || 0) > 0
        ? `<span class="status-badge st-error"><span class="action-dot"></span>${t.facturas_vencidas} vencida(s)</span>`
        : '<span class="status-badge st-ok"><span class="action-dot"></span>Al día</span>'}</td>
    </tr>`).join('');
}

function seleccionarTenant(codigo) {
  const sel = document.getElementById('filterTenant');
  sel.value = codigo;
  onTenantChange();
  document.getElementById('docsTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderKpis() {
  const docs = docsDelTenant(tenantSel);
  const facturas = docs.filter(d => d.tipo === 'factura' && d.estado !== 'anulada');
  const totalFacturado = facturas.reduce((s, d) => s + (Number(d.total) || 0), 0);
  const totalCobrado = docs.filter(d => d.tipo === 'recibo').reduce((s, d) => s + (Number(d.total) || 0), 0);
  const totalNC = docs.filter(d => d.tipo === 'nota_credito').reduce((s, d) => s + (Number(d.total) || 0), 0);
  const saldo = Math.max(0, totalFacturado - totalCobrado - totalNC);
  const hoy = Date.now();
  const vencidas = facturas.filter(d => {
    if (d.estado === 'pagada') return false;
    const f = new Date(d.created_at || 0).getTime();
    return hoy - f > 30 * 86400000;
  }).length;
  document.getElementById('kpiFacturado').textContent = fmtDinero(totalFacturado);
  document.getElementById('kpiCobrado').textContent = fmtDinero(totalCobrado);
  document.getElementById('kpiSaldo').textContent = fmtDinero(saldo);
  document.getElementById('kpiMoroso').textContent = vencidas;
}

function applyDocFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const estado = document.getElementById('filterEstadoDoc')?.value || '';
  filteredDocs = docsDelTenant(tenantSel).filter(d => {
    if (estado && (d.estado || '') !== estado) return false;
    if (search && !((d.correlativo || '') + ' ' + (d.cliente_nombre || '') + ' ' + (d.empresa_codigo || '')).toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  renderDocs();
  renderKpis();
}

function renderDocs() {
  const tbody = document.getElementById('docsBody');
  if (!filteredDocs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-file-invoice"></i><p>No hay documentos con estos filtros.</p></td></tr>';
    return;
  }
  const iconos = { factura: 'fa-file-invoice', recibo: 'fa-receipt', nota_credito: 'fa-file-circle-minus' };
  tbody.innerHTML = filteredDocs.slice(0, 100).map(d => `
    <tr>
      <td style="color:var(--white);">${fmtFecha(d.created_at)}</td>
      <td><i class="fas ${iconos[d.tipo] || 'fa-file'}" style="color:var(--accent);margin-right:6px;"></i>${esc(d.tipo.replace('_', ' '))}</td>
      <td style="font-family:monospace;color:var(--cyan);font-size:12px;">${esc(d.correlativo || d.id.slice(0, 8))}</td>
      <td>${esc(d.cliente_nombre || '—')}</td>
      <td style="color:var(--white);font-weight:600;text-align:right;">${fmtDinero(d.total)}</td>
      <td><span class="status-badge st-${esc((d.estado || '').toLowerCase())}"><span class="action-dot"></span>${esc(d.estado || '—')}</span></td>
      <td>${d.tipo === 'factura' ? `<a href="../factura.html?id=${encodeURIComponent(d.id)}&tenant=${encodeURIComponent(d.empresa_codigo)}" target="_blank" class="btn btn-ghost btn-xs" title="Ver documento"><i class="fas fa-eye"></i></a>` : d.tipo === 'recibo' ? `<a href="../recibo.html?id=${encodeURIComponent(d.id)}&tenant=${encodeURIComponent(d.empresa_codigo)}" target="_blank" class="btn btn-ghost btn-xs" title="Ver recibo"><i class="fas fa-eye"></i></a>` : ''}</td>
    </tr>`).join('');
}

function exportCsv() {
  const docs = filteredDocs.length ? filteredDocs : docsDelTenant(tenantSel);
  if (!docs.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Fecha', 'Empresa', 'Tipo', 'Correlativo', 'Cliente', 'Total_HNL', 'Estado'];
  const rows = docs.map(d => [d.created_at, d.empresa_codigo, d.tipo, d.correlativo, d.cliente_nombre, d.total, d.estado]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `cuenta_corriente_${tenantSel || 'global'}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
