/* ── Centro de alertas — pp/alertas.html ── */
'use strict';

const API_BASE = '/api';
let alertas = [];
let filtered = [];

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
}
function hace(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '';
  if (ms < 60000) return 'justo ahora';
  if (ms < 3600000) return 'hace ' + Math.floor(ms / 60000) + ' min';
  if (ms < 86400000) return 'hace ' + Math.floor(ms / 3600000) + ' h';
  return 'hace ' + Math.floor(ms / 86400000) + ' d';
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

const ICONOS = { seguridad: 'fa-shield-halved', limite: 'fa-gauge-high', bot: 'fa-robot' };
const TITULOS = { seguridad: 'Alerta de seguridad', limite: 'Límite de uso superado', bot: 'Fallo de automatización' };

function sevClass(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'critical' || s === 'error') return 'critical';
  if (s === 'warning') return 'warning';
  if (s === 'success') return 'success';
  return 'info';
}

async function loadAlertas() {
  const host = document.getElementById('alertasList');
  host.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:22px;"></i></div>';
  try {
    const res = await fetch(API_BASE + '/admin/alertas', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    alertas = (data.alertas || []).map(a => Object.assign(a, { _sev: sevClass(a.severidad) }));
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[ALERTAS]', err);
    host.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar las alertas.</p></div>';
  }
}

function renderKpis() {
  const seg = alertas.filter(a => a.tipo === 'seguridad' && ['critical', 'warning'].includes(a._sev)).length;
  const lim = alertas.filter(a => a.tipo === 'limite').length;
  const bots = alertas.filter(a => a.tipo === 'bot').length;
  document.getElementById('kpiSeguridad').textContent = seg;
  document.getElementById('kpiLimites').textContent = lim;
  document.getElementById('kpiBots').textContent = bots;
  document.getElementById('kpiTotal').textContent = alertas.length;
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const sev = document.getElementById('filterSev')?.value || '';
  const tipo = document.getElementById('filterTipo')?.value || '';
  const emp = (document.getElementById('filterEmpresa')?.value || '').toLowerCase();
  filtered = alertas.filter(a => {
    if (sev && a._sev !== sev) return false;
    if (tipo && a.tipo !== tipo) return false;
    if (emp && !(a.empresa_codigo || '').toLowerCase().includes(emp)) return false;
    if (search && !((a.titulo || '') + ' ' + (a.descripcion || '')).toLowerCase().includes(search)) return false;
    return true;
  });
  const ordenSev = { critical: 0, warning: 1, info: 2, success: 3 };
  filtered.sort((a, b) => (ordenSev[a._sev] - ordenSev[b._sev]) || (new Date(b.fecha || 0) - new Date(a.fecha || 0)));
  renderFeed();
}

function renderFeed() {
  const host = document.getElementById('alertasList');
  document.getElementById('feedCount').textContent = filtered.length + ' alerta(s)';
  if (!filtered.length) {
    host.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-bell-slash"></i><p>No hay alertas con estos filtros. Todo en orden.</p></div>';
    return;
  }
  host.innerHTML = filtered.slice(0, 120).map(a => `
    <div class="alert-item ai-${a._sev}">
      <div class="alert-item-icon"><i class="fas ${ICONOS[a.tipo] || 'fa-bell'}"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(a.titulo || TITULOS[a.tipo] || 'Alerta')}</div>
        <div class="alert-item-desc">${esc(a.descripcion || '')}</div>
        <div class="alert-item-meta">
          ${a.empresa_codigo ? `<span class="tenant-chip" style="padding:2px 10px 2px 4px;"><span class="tenant-ava" style="width:18px;height:18px;font-size:9px;">${esc((a.empresa_codigo || '?').slice(0, 2))}</span>${esc(a.empresa_codigo)}</span>` : ''}
          <span><i class="fas fa-clock"></i> ${fmtFecha(a.fecha)} (${hace(a.fecha)})</span>
        </div>
      </div>
      <div class="alert-item-side">
        <span class="status-badge st-${a._sev === 'critical' ? 'error' : a._sev === 'warning' ? 'warning' : 'info'}"><span class="action-dot"></span>${esc(a._sev)}</span>
      </div>
    </div>`).join('');
}

function resetFilters() {
  ['filterSev', 'filterTipo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const fE = document.getElementById('filterEmpresa'); if (fE) fE.value = '';
  const s = document.getElementById('globalSearch'); if (s) s.value = '';
  applyFilters();
}

function exportCsv() {
  if (!filtered.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Fecha', 'Tipo', 'Severidad', 'Empresa', 'Titulo', 'Descripcion'];
  const rows = filtered.map(a => [a.fecha, a.tipo, a._sev, a.empresa_codigo, a.titulo, a.descripcion]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `alertas_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadAlertas);
