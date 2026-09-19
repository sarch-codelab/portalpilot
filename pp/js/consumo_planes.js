/* ── Consumo vs límites de plan — pp/consumo_planes.html ── */
'use strict';

const API_BASE = '/api';
let rows = [];           // [{empresa_codigo, empresa_nombre, plan, recurso, cantidad, maximo}]
let filtered = [];
let periodoSel = '';

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function toast(msg, tipo) {
  let host = document.getElementById('ppToast');
  if (!host) { host = document.createElement('div'); host.id = 'ppToast'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'pp-toast ' + (tipo || '');
  t.innerHTML = '<i class="fas ' + (tipo === 'ok' ? 'fa-check-circle' : 'fa-exclamation-circle') + '"></i><span>' + esc(msg) + '</span>';
  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function fmtNum(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

const RECURSO_LABEL = {
  ai_tokens: 'Tokens de IA', api_requests: 'Llamadas API', storage: 'Almacenamiento',
  users: 'Usuarios', documents: 'Documentos', automations: 'Automatizaciones'
};

async function loadData() {
  const host = document.getElementById('consumoList');
  host.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:22px;"></i></div>';
  try {
    periodoSel = document.getElementById('filterPeriodo')?.value || new Date().toISOString().slice(0, 7);
    const res = await fetch(API_BASE + '/admin/consumo_planes?periodo=' + encodeURIComponent(periodoSel), { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    rows = data.filas || [];
    // recursos dinámicos
    const recursos = [...new Set(rows.map(r => r.recurso))].sort();
    const sel = document.getElementById('filterRecurso');
    const prev = sel.value;
    sel.innerHTML = '<option value="">Todos</option>' + recursos.map(r => `<option value="${esc(r)}">${esc(RECURSO_LABEL[r] || r)}</option>`).join('');
    if (recursos.includes(prev)) sel.value = prev;
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[CONSUMO_PLANES]', err);
    host.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar el consumo por plan.</p></div>';
  }
}

function pct(r) {
  if (!r.maximo || r.maximo <= 0) return null; // sin límite
  return (Number(r.cantidad) || 0) / Number(r.maximo) * 100;
}

function fillClass(p) {
  if (p == null) return '';
  if (p >= 100) return 'over';
  if (p >= 80) return 'danger';
  if (p >= 60) return 'warn';
  return '';
}

function renderKpis() {
  const conLimite = rows.map(r => ({ r, p: pct(r) })).filter(x => x.p != null);
  document.getElementById('kpiExcedidos').textContent = conLimite.filter(x => x.p >= 100).length;
  document.getElementById('kpiCerca').textContent = conLimite.filter(x => x.p >= 80 && x.p < 100).length;
  document.getElementById('kpiTenants').textContent = new Set(rows.map(r => r.empresa_codigo)).size;
  document.getElementById('kpiRecursos').textContent = new Set(rows.map(r => r.recurso)).size;
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const recurso = document.getElementById('filterRecurso')?.value || '';
  filtered = rows.filter(r => {
    if (recurso && r.recurso !== recurso) return false;
    if (search && !((r.empresa_nombre || '') + ' ' + (r.empresa_codigo || '')).toLowerCase().includes(search)) return false;
    return true;
  });
  renderList();
}

function renderList() {
  const host = document.getElementById('consumoList');
  document.getElementById('resumenCount').textContent = filtered.length + ' combinaciones cliente/recurso · periodo ' + periodoSel;
  if (!filtered.length) {
    host.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-chart-simple"></i><p>Sin consumo registrado para este periodo.</p></div>';
    return;
  }
  // Agrupar por tenant
  const porTenant = {};
  filtered.forEach(r => { (porTenant[r.empresa_codigo] = porTenant[r.empresa_codigo] || []).push(r); });
  const orden = Object.entries(porTenant).sort((a, b) => {
    const maxA = Math.max(...a[1].map(r => pct(r) ?? 0));
    const maxB = Math.max(...b[1].map(r => pct(r) ?? 0));
    return maxB - maxA;
  });
  host.innerHTML = orden.map(([codigo, lista]) => {
    const nombre = lista[0].empresa_nombre || codigo;
    const plan = lista[0].plan || '—';
    return `<div class="pp-card" style="margin-bottom:16px;">
      <div class="pp-card-title" style="justify-content:space-between;">
        <span><i class="fas fa-building"></i> ${esc(nombre)} <span style="color:var(--gray);font-weight:400;">(${esc(codigo)})</span></span>
        <span class="status-badge st-info" style="text-transform:capitalize;">${esc(plan)}</span>
      </div>
      ${lista.map(r => {
        const p = pct(r);
        const pTxt = p == null ? 'sin límite definido' : Math.round(p) + '% del límite';
        return `<div class="usage-row">
          <div class="usage-row-head">
            <span class="u-name">${esc(RECURSO_LABEL[r.recurso] || r.recurso)}</span>
            <span class="u-vals">${fmtNum(r.cantidad)}${r.maximo ? ' / ' + fmtNum(r.maximo) : ''} · ${pTxt}</span>
          </div>
          <div class="usage-bar"><div class="usage-fill ${fillClass(p)}" style="width:${p == null ? '4' : Math.min(100, p)}%;"></div></div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function exportCsv() {
  if (!filtered.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Periodo', 'Empresa', 'Codigo', 'Plan', 'Recurso', 'Uso', 'Limite', 'Porcentaje'];
  const rowsCsv = filtered.map(r => [periodoSel, r.empresa_nombre || '', r.empresa_codigo, r.plan, r.recurso, r.cantidad, r.maximo, pct(r) == null ? '' : Math.round(pct(r))]);
  const csv = [headers, ...rowsCsv].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `consumo_planes_${periodoSel}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('filterPeriodo');
  if (inp) inp.value = new Date().toISOString().slice(0, 7);
  loadData();
});
