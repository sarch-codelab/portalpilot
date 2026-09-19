/* ── Integraciones globales — pp/integraciones.html ── */
'use strict';

const API_BASE = '/api';
let catalogo = [];
let conexiones = {};   // { empresa_codigo: { key: {enabled, connected_at, error_reciente} } }
let empresas = [];     // [{empresa_codigo, empresa_nombre}]

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
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
    const res = await fetch(API_BASE + '/admin/integraciones', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    catalogo = data.catalogo || [];
    conexiones = data.conexiones || {};
    empresas = data.empresas || [];
    renderKpis();
    renderMatrix();
  } catch (err) {
    console.error('[INTEGRACIONES]', err);
    document.getElementById('matrixBody').innerHTML = '<tr><td colspan="9" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar las integraciones.</p></td></tr>';
  }
}

function estadoCelda(codigo, key) {
  const est = (conexiones[codigo] || {})[key];
  if (!est || (!est.enabled && !est.connected_at)) return { cls: 'off', icon: 'fa-circle-minus', title: 'No conectada' };
  if (est.error_reciente) return { cls: 'err', icon: 'fa-triangle-exclamation', title: 'Error de sincronización: ' + est.error_reciente };
  if (est.enabled) return { cls: 'on', icon: 'fa-circle-check', title: 'Conectada desde ' + fmtFecha(est.connected_at) };
  return { cls: 'off', icon: 'fa-circle-minus', title: 'Desconectada' };
}

function renderKpis() {
  let conectadas = 0, errores = 0;
  Object.values(conexiones).forEach(m => {
    Object.values(m).forEach(e => {
      if (e.enabled) conectadas++;
      if (e.error_reciente) errores++;
    });
  });
  document.getElementById('kpiConectadas').textContent = conectadas;
  document.getElementById('kpiErrores').textContent = errores;
  document.getElementById('kpiTenants').textContent = Object.keys(conexiones).filter(c => Object.values(conexiones[c]).some(e => e.enabled)).length;
  document.getElementById('kpiCatalogo').textContent = catalogo.length;
}

function renderMatrix() {
  const thead = document.getElementById('matrixHead');
  const tbody = document.getElementById('matrixBody');
  const q = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  if (!catalogo.length) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td class="empty-state"><i class="fas fa-plug"></i><p>Sin catálogo de integraciones disponible.</p></td></tr>';
    return;
  }
  thead.innerHTML = '<tr><th style="min-width:200px;">Cliente</th>' + catalogo.map(i =>
    `<th class="int-cell" title="${esc(i.descripcion || '')}"><i class="${esc(i.icono || 'fa-puzzle-piece')}"></i><br>${esc(i.nombre)}</th>`).join('') + '</tr>';

  const lista = empresas.filter(e => !q || ((e.empresa_nombre || '') + ' ' + e.empresa_codigo).toLowerCase().includes(q));
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="' + (catalogo.length + 1) + '" class="empty-state"><i class="fas fa-building"></i><p>No hay clientes que coincidan.</p></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(e => `<tr>
    <td><span class="tenant-chip"><span class="tenant-ava">${esc((e.empresa_codigo || '?').slice(0, 2))}</span>${esc(e.empresa_nombre || e.empresa_codigo)}</span></td>
    ${catalogo.map(i => {
    const est = estadoCelda(e.empresa_codigo, i.key);
    return `<td class="int-cell" title="${esc(est.title)}"><i class="fas ${est.icon} int-state ${est.cls}"></i></td>`;
  }).join('')}
  </tr>`).join('');
}

function exportCsv() {
  const rows = [['Cliente', 'Codigo', ...catalogo.map(i => i.nombre)]];
  empresas.forEach(e => {
    rows.push([e.empresa_nombre || e.empresa_codigo, e.empresa_codigo,
    ...catalogo.map(i => {
      const est = estadoCelda(e.empresa_codigo, i.key);
      return est.cls === 'on' ? 'Conectada' : est.cls === 'err' ? 'Error' : 'No conectada';
    })]);
  });
  if (rows.length <= 1) { toast('No hay datos para exportar', 'warn'); return; }
  const csv = rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `integraciones_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
