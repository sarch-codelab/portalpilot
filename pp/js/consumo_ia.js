/* ── Consumo de IA — pp/consumo_ia.html ── */
'use strict';

const API_BASE = '/api';
let iaData = { porTenant: [], porFuncion: {} };
let chartTokens = null;
let chartFunciones = null;

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
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}
function fmtDinero(n) {
  const v = Number(n) || 0;
  if (v > 0 && v < 0.01) return 'L ' + v.toFixed(4);
  return 'L ' + v.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadData() {
  const mes = document.getElementById('filterMes')?.value || new Date().toISOString().slice(0, 7);
  const tbody = document.getElementById('iaBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></td></tr>';
  try {
    const res = await fetch(API_BASE + '/admin/consumo_ia?mes=' + encodeURIComponent(mes), { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    iaData = await res.json();
    renderKpis();
    renderCharts();
    renderTable();
  } catch (err) {
    console.error('[CONSUMO_IA]', err);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar el consumo de IA.</p></td></tr>';
  }
}

function renderKpis() {
  const p = iaData.porTenant || [];
  document.getElementById('kpiTokens').textContent = fmtNum(p.reduce((s, t) => s + (t.tokens || 0), 0));
  document.getElementById('kpiLlamadas').textContent = fmtNum(p.reduce((s, t) => s + (t.llamadas || 0), 0));
  document.getElementById('kpiCosto').textContent = fmtDinero(p.reduce((s, t) => s + (t.costo || 0), 0));
  document.getElementById('kpiTopes').textContent = p.filter(t => t.tope && t.tokens >= t.tope).length;
}

function baseChartOpts() {
  const isLight = document.body.classList.contains('light-mode');
  return {
    chart: { background: 'transparent', fontFamily: 'DM Sans, sans-serif', animations: { enabled: true } },
    theme: { mode: isLight ? 'light' : 'dark' },
    grid: { borderColor: isLight ? 'rgba(15,23,42,.1)' : 'rgba(139,92,246,.12)' },
    dataLabels: { enabled: false },
    tooltip: { theme: isLight ? 'light' : 'dark' }
  };
}

function renderCharts() {
  const p = [...(iaData.porTenant || [])].sort((a, b) => (b.tokens || 0) - (a.tokens || 0)).slice(0, 10);
  const el1 = document.getElementById('chartTokens');
  if (el1) {
    const opts = Object.assign({}, baseChartOpts(), {
      chart: Object.assign({}, baseChartOpts().chart, { type: 'bar', height: 320, toolbar: { show: false } }),
      colors: ['#8b5cf6'],
      plotOptions: { bar: { borderRadius: 6, horizontal: true } },
      series: [{ name: 'Tokens', data: p.map(t => t.tokens || 0) }],
      xaxis: { categories: p.map(t => t.empresa_nombre || t.empresa_codigo || '—') }
    });
    if (chartTokens) chartTokens.destroy();
    chartTokens = new ApexCharts(el1, opts);
    chartTokens.render();
  }
  const el2 = document.getElementById('chartFunciones');
  if (el2) {
    const funcs = Object.entries(iaData.porFuncion || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const opts = Object.assign({}, baseChartOpts(), {
      chart: Object.assign({}, baseChartOpts().chart, { type: 'donut', height: 320 }),
      labels: funcs.length ? funcs.map(([k]) => k) : ['Sin datos'],
      series: funcs.length ? funcs.map(([, v]) => v) : [1],
      colors: ['#8b5cf6', '#a78bfa', '#7c3aed', '#34d399', '#fbbf24', '#f87171', '#0a84ff', '#5d5d7a'],
      legend: { position: 'bottom' },
      stroke: { width: 0 }
    });
    if (chartFunciones) chartFunciones.destroy();
    chartFunciones = new ApexCharts(el2, opts);
    chartFunciones.render();
  }
}

function renderTable() {
  const tbody = document.getElementById('iaBody');
  const p = iaData.porTenant || [];
  if (!p.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-brain"></i><p>Sin uso de IA registrado en este mes.</p></td></tr>';
    return;
  }
  tbody.innerHTML = [...p].sort((a, b) => (b.tokens || 0) - (a.tokens || 0)).map(t => {
    const pct = t.tope && t.tope > 0 ? Math.round((t.tokens / t.tope) * 100) : null;
    let pctHtml = '<span style="color:var(--gray);">sin tope</span>';
    if (pct != null) {
      const cls = pct >= 100 ? 'st-error' : pct >= 80 ? 'st-warning' : 'st-ok';
      pctHtml = `<span class="status-badge ${cls}"><span class="action-dot"></span>${pct}%</span>`;
    }
    return `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((t.empresa_codigo || '?').slice(0, 2))}</span>${esc(t.empresa_nombre || t.empresa_codigo)}</span></td>
      <td style="color:var(--white);">${t.llamadas || 0}</td>
      <td style="color:var(--green);">${t.exitosas || 0}</td>
      <td style="color:${(t.fallidas || 0) > 0 ? 'var(--red)' : 'var(--gray)'};">${t.fallidas || 0}</td>
      <td style="font-family:monospace;color:var(--white);">${fmtNum(t.tokens || 0)}</td>
      <td>${t.tope ? fmtNum(t.tope) : '<span style="color:var(--gray);">—</span>'}</td>
      <td>${pctHtml}</td>
      <td style="color:var(--yellow);font-weight:600;">${fmtDinero(t.costo || 0)}</td>
    </tr>`;
  }).join('');
}

function exportCsv() {
  const p = iaData.porTenant || [];
  if (!p.length) { toast('No hay datos para exportar', 'warn'); return; }
  const mes = document.getElementById('filterMes')?.value || '';
  const headers = ['Mes', 'Cliente', 'Codigo', 'Llamadas', 'Exitosas', 'Fallidas', 'Tokens', 'Tope_plan', 'Costo_imputado'];
  const rows = p.map(t => [mes, t.empresa_nombre || '', t.empresa_codigo, t.llamadas, t.exitosas, t.fallidas, t.tokens, t.tope || '', t.costo]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `consumo_ia_${mes}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('filterMes');
  if (inp) inp.value = new Date().toISOString().slice(0, 7);
  loadData();
});
