/* ── Métricas de negocio — pp/finanzas.html ── */
'use strict';

const API_BASE = '/api';
let fin = {};
let chartIngresos = null;
let chartPlanes = null;

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
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
  try {
    const res = await fetch(API_BASE + '/admin/finanzas', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fin = await res.json();
    renderKpis();
    renderCharts();
    renderTop();
    renderChurn();
  } catch (err) {
    console.error('[FINANZAS]', err);
    toast('Error al cargar las métricas financieras', 'err');
  }
}

function renderKpis() {
  document.getElementById('kpiMrr').textContent = fmtDinero(fin.mrr || 0);
  document.getElementById('kpiArpu').textContent = fin.arpu != null ? fmtDinero(fin.arpu) : '—';
  document.getElementById('kpiChurn').textContent = fin.churn_pct != null ? fin.churn_pct.toFixed(1) + '%' : '—';
  document.getElementById('kpiCobranza').textContent = fmtDinero(fin.cobranza_proyectada_30d || 0);
}

function baseChartOpts() {
  const isLight = document.body.classList.contains('light-mode');
  return {
    chart: { background: 'transparent', fontFamily: 'DM Sans, sans-serif' },
    theme: { mode: isLight ? 'light' : 'dark' },
    grid: { borderColor: isLight ? 'rgba(15,23,42,.1)' : 'rgba(139,92,246,.12)' },
    dataLabels: { enabled: false },
    tooltip: { theme: isLight ? 'light' : 'dark' }
  };
}

function renderCharts() {
  const serie = fin.ingresos_mensuales || [];
  const el1 = document.getElementById('chartIngresos');
  if (el1) {
    const opts = Object.assign({}, baseChartOpts(), {
      chart: Object.assign({}, baseChartOpts().chart, { type: 'area', height: 300, toolbar: { show: false } }),
      colors: ['#34d399'],
      series: [{ name: 'Cobrado (HNL)', data: serie.map(m => Number(m.total) || 0) }],
      xaxis: { categories: serie.map(m => m.mes) },
      stroke: { curve: 'smooth', width: 2 },
      fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } }
    });
    if (chartIngresos) chartIngresos.destroy();
    chartIngresos = new ApexCharts(el1, opts);
    chartIngresos.render();
  }
  const el2 = document.getElementById('chartPlanes');
  if (el2) {
    const porPlan = fin.mrr_por_plan || [];
    const opts = Object.assign({}, baseChartOpts(), {
      chart: Object.assign({}, baseChartOpts().chart, { type: 'donut', height: 300 }),
      labels: porPlan.length ? porPlan.map(p => p.plan || '—') : ['Sin suscripciones'],
      series: porPlan.length ? porPlan.map(p => Number(p.mrr) || 0) : [1],
      colors: ['#8b5cf6', '#34d399', '#fbbf24', '#f87171', '#0a84ff', '#a78bfa'],
      legend: { position: 'bottom' },
      stroke: { width: 0 }
    });
    if (chartPlanes) chartPlanes.destroy();
    chartPlanes = new ApexCharts(el2, opts);
    chartPlanes.render();
  }
}

function renderTop() {
  const tbody = document.getElementById('topBody');
  const lista = fin.top_clientes || [];
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><i class="fas fa-coins"></i><p>Sin pagos registrados todavía.</p></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(c => `<tr>
    <td><span class="tenant-chip"><span class="tenant-ava">${esc((c.empresa_codigo || '?').slice(0, 2))}</span>${esc(c.empresa_nombre || c.empresa_codigo)}</span></td>
    <td style="text-transform:capitalize;">${esc(c.plan || '—')}</td>
    <td style="color:var(--white);font-weight:600;">${fmtDinero(c.pagado_12m)}</td>
    <td><span class="status-badge st-${esc((c.estado || '').toLowerCase())}"><span class="action-dot"></span>${esc(c.estado || '—')}</span></td>
  </tr>`).join('');
}

function renderChurn() {
  const tbody = document.getElementById('churnBody');
  const lista = fin.senales_churn || [];
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state"><i class="fas fa-shield-heart"></i><p>Sin señales de churn detectadas.</p></td></tr>';
    return;
  }
  const sev = { vencido: 'st-error', moroso: 'st-warning', cancelado: 'st-error', suspendido: 'st-warning', sin_pagos: 'st-warning' };
  const label = { vencido: 'Suscripción vencida', moroso: 'Facturas vencidas', cancelado: 'Cancelado', suspendido: 'Suspendido', sin_pagos: 'Sin pagos en 3 meses' };
  tbody.innerHTML = lista.map(c => `<tr>
    <td><span class="tenant-chip"><span class="tenant-ava">${esc((c.empresa_codigo || '?').slice(0, 2))}</span>${esc(c.empresa_nombre || c.empresa_codigo)}</span></td>
    <td><span class="status-badge ${sev[c.tipo] || 'st-warning'}"><span class="action-dot"></span>${esc(label[c.tipo] || c.tipo)}</span></td>
    <td style="color:var(--text);font-size:12px;">${esc(c.detalle || '')}</td>
  </tr>`).join('');
}

function exportCsv() {
  const filas = [['Metrica', 'Valor'], ['MRR', fin.mrr || 0], ['ARPU', fin.arpu || 0], ['Churn %', fin.churn_pct || 0], ['Cobranza proyectada 30d', fin.cobranza_proyectada_30d || 0], [], ['Mes', 'Cobrado']];
  (fin.ingresos_mensuales || []).forEach(m => filas.push([m.mes, m.total]));
  filas.push([], ['Cliente', 'Plan', 'Pagado 12m', 'Estado']);
  (fin.top_clientes || []).forEach(c => filas.push([c.empresa_nombre || c.empresa_codigo, c.plan, c.pagado_12m, c.estado]));
  const csv = filas.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `finanzas_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
