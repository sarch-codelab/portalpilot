/* ── Seguridad y accesos — pp/seguridad_accesos.html ── */
'use strict';

const API_BASE = '/api';
let data = { sesiones: [], fallidos: [], ips_sospechosas: [], api_keys: [], dos_factores: [] };

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
}
function hace(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  if (ms < 3600000) return 'hace ' + Math.max(1, Math.floor(ms / 60000)) + ' min';
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

async function loadData() {
  const tbody = document.getElementById('tablaBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:20px;"></i></td></tr>';
  try {
    const res = await fetch(API_BASE + '/admin/seguridad', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[SEGURIDAD]', err);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar los datos de seguridad.</p></td></tr>';
  }
}

function renderKpis() {
  document.getElementById('kpiSesiones').textContent = (data.sesiones || []).filter(s => !s.revocada).length;
  document.getElementById('kpiFallidos').textContent = (data.fallidos || []).length;
  document.getElementById('kpiIps').textContent = (data.ips_sospechosas || []).length;
  document.getElementById('kpiKeys').textContent = (data.api_keys || []).filter(k => k.activa).length;
}

function filtroTenant() {
  return (document.getElementById('filterTenant')?.value || '').toLowerCase();
}
function filtroSearch() {
  return (document.getElementById('globalSearch')?.value || '').toLowerCase();
}
function pasaFiltros(...campos) {
  const t = filtroTenant();
  const s = filtroSearch();
  const hay = campos.map(c => String(c || '').toLowerCase()).join(' ');
  if (t && !hay.includes(t)) return false;
  if (s && !hay.includes(s)) return false;
  return true;
}

const VISTAS = {
  sesiones: {
    head: ['Empresa', 'Usuario', 'IP', 'Dispositivo', 'Ubicación', 'Última actividad', 'Estado'],
    rows: () => (data.sesiones || []).filter(x => pasaFiltros(x.empresa_codigo, x.usuario, x.email, x.ip)).map(x => `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((x.empresa_codigo || '?').slice(0, 2))}</span>${esc(x.empresa_codigo)}</span></td>
      <td><div style="color:var(--white);font-weight:600;font-size:13px;">${esc(x.usuario)}</div><div style="font-size:11px;color:var(--gray);">${esc(x.email || '')}</div></td>
      <td style="font-family:monospace;">${esc(x.ip || '—')}</td>
      <td>${esc(x.dispositivo || '—')}</td>
      <td>${esc(x.ubicacion || '—')}</td>
      <td><span style="color:var(--white);">${fmtFecha(x.ultimo_actividad)}</span><br><span style="font-size:11px;color:var(--gray);">${hace(x.ultimo_actividad)}</span></td>
      <td>${x.revocada ? '<span class="status-badge st-revoked"><span class="action-dot"></span>Revocada</span>' : '<span class="status-badge st-ok"><span class="action-dot"></span>Activa</span>'}</td>
    </tr>`)
  },
  fallidos: {
    head: ['Empresa', 'Usuario / email', 'Evento', 'IP', 'Dispositivo', 'Fecha', 'Severidad'],
    rows: () => (data.fallidos || []).filter(x => pasaFiltros(x.empresa_codigo, x.usuario_email, x.evento, x.ip)).map(x => `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((x.empresa_codigo || '?').slice(0, 2))}</span>${esc(x.empresa_codigo)}</span></td>
      <td>${esc(x.usuario_email || '—')}</td>
      <td>${esc(x.evento)}</td>
      <td style="font-family:monospace;">${esc(x.ip || '—')}</td>
      <td>${esc(x.dispositivo || '—')}</td>
      <td><span style="color:var(--white);">${fmtFecha(x.created_at)}</span><br><span style="font-size:11px;color:var(--gray);">${hace(x.created_at)}</span></td>
      <td><span class="status-badge ${x.severidad === 'critical' ? 'st-error' : 'st-warning'}"><span class="action-dot"></span>${esc(x.severidad || 'warning')}</span></td>
    </tr>`)
  },
  ips: {
    head: ['IP', 'Empresa(s)', 'Eventos', 'Últimos usuarios', 'Último evento'],
    rows: () => (data.ips_sospechosas || []).filter(x => pasaFiltros(x.ip, x.empresas, x.usuarios)).map(x => `<tr>
      <td style="font-family:monospace;color:var(--yellow);font-weight:700;">${esc(x.ip)}</td>
      <td>${esc(x.empresas)}</td>
      <td><span class="status-badge st-warning"><span class="action-dot"></span>${x.total_eventos} eventos</span></td>
      <td>${esc(x.usuarios)}</td>
      <td>${fmtFecha(x.ultimo_evento)} (${hace(x.ultimo_evento)})</td>
    </tr>`)
  },
  keys: {
    head: ['Empresa', 'Nombre', 'Prefijo', 'Estado', 'Creada', 'Último uso'],
    rows: () => (data.api_keys || []).filter(x => pasaFiltros(x.empresa_codigo, x.nombre, x.clave_prefix)).map(x => `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((x.empresa_codigo || '?').slice(0, 2))}</span>${esc(x.empresa_codigo)}</span></td>
      <td style="color:var(--white);font-weight:600;">${esc(x.nombre)}</td>
      <td style="font-family:monospace;color:var(--cyan);">${esc(x.clave_prefix || '—')}</td>
      <td>${x.activa ? '<span class="status-badge st-ok"><span class="action-dot"></span>Activa</span>' : '<span class="status-badge st-revoked"><span class="action-dot"></span>Revocada</span>'}</td>
      <td>${fmtFecha(x.created_at)}</td>
      <td>${x.ultimo_uso ? hace(x.ultimo_uso) : 'Nunca usada'}</td>
    </tr>`)
  }
};

function applyFilters() {
  const vista = document.getElementById('filterVista')?.value || 'sesiones';
  const conf = VISTAS[vista];
  const thead = document.getElementById('tablaHead');
  const tbody = document.getElementById('tablaBody');
  thead.innerHTML = '<tr>' + conf.head.map(h => `<th>${h}</th>`).join('') + '</tr>';
  const rows = conf.rows();
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="${conf.head.length}" class="empty-state"><i class="fas fa-shield-halved"></i><p>No hay registros para esta vista.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.join('');
}

function resetFilters() {
  const t = document.getElementById('filterTenant'); if (t) t.value = '';
  const s = document.getElementById('globalSearch'); if (s) s.value = '';
  applyFilters();
}

function exportCsv() {
  const vista = document.getElementById('filterVista')?.value || 'sesiones';
  const conf = VISTAS[vista];
  // extraer texto plano de las filas renderizadas
  const trs = [...document.querySelectorAll('#tablaBody tr')];
  const rows = trs.filter(tr => tr.querySelector('td')).map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g, ' ').trim()));
  if (!rows.length) { toast('No hay datos para exportar', 'warn'); return; }
  const csv = [conf.head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `seguridad_${vista}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
