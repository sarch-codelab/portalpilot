/* ── Respaldos y rotación — pp/respaldos_y_rotacion.html ── */
'use strict';

const API_BASE = '/api';
let ops = { api_keys: [], sesiones_purga: [], health: null, generado: null };

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
}
function hace(iso) {
  if (!iso) return 'Nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  if (ms < 3600000) return 'hace ' + Math.max(1, Math.floor(ms / 60000)) + ' min';
  if (ms < 86400000) return 'hace ' + Math.floor(ms / 3600000) + ' h';
  return 'hace ' + Math.floor(ms / 86400000) + ' d';
}
function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
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
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

async function loadData() {
  try {
    const res = await fetch(API_BASE + '/admin/respaldos', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    ops = await res.json();
    renderKpis();
    renderKeys();
    renderSesiones();
    renderHealth();
  } catch (err) {
    console.error('[RESPALDOS]', err);
    toast('Error al cargar los datos operativos', 'err');
  }
}

function renderKpis() {
  const porRotar = (ops.api_keys || []).filter(k => k.activa && k.edad_dias != null && k.edad_dias > 90).length;
  document.getElementById('kpiRotar').textContent = porRotar;
  document.getElementById('kpiSesionesViejas').textContent = (ops.sesiones_purga || []).length;
  document.getElementById('kpiKeysActivas').textContent = (ops.api_keys || []).filter(k => k.activa).length;
  const h = ops.health;
  const ok = h && (h.ok === true || (typeof h === 'object' && h.supabase !== 'down'));
  document.getElementById('kpiHealth').textContent = ok ? 'OK' : 'Sin datos';
  document.getElementById('healthTime').textContent = ops.generado ? 'Generado ' + fmtFecha(ops.generado) : '';
}

function renderKeys() {
  const tbody = document.getElementById('keysBody');
  const keys = [...(ops.api_keys || [])].sort((a, b) => (b.edad_dias || 0) - (a.edad_dias || 0));
  if (!keys.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-key"></i><p>No hay API keys registradas.</p></td></tr>';
    return;
  }
  tbody.innerHTML = keys.map(k => {
    const edad = k.edad_dias != null ? k.edad_dias + ' días' : '—';
    const porRotar = k.activa && k.edad_dias != null && k.edad_dias > 90;
    return `<tr>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((k.empresa_codigo || '?').slice(0, 2))}</span>${esc(k.empresa_codigo)}</span></td>
      <td style="color:var(--white);font-weight:600;">${esc(k.nombre)}</td>
      <td style="font-family:monospace;color:var(--cyan);font-size:11px;">${esc(k.clave_prefix || '—')}</td>
      <td>${edad}</td>
      <td>${k.activa
        ? (porRotar ? '<span class="status-badge st-error"><span class="action-dot"></span>Rotar ya</span>' : '<span class="status-badge st-ok"><span class="action-dot"></span>Vigente</span>')
        : '<span class="status-badge st-revoked"><span class="action-dot"></span>Revocada</span>'}</td>
      <td>${hace(k.ultimo_uso)}${k.activa ? ` <button class="btn btn-ghost btn-xs" style="margin-left:6px;" onclick="revocarKey('${esc(k.id)}')" title="Revocar"><i class="fas fa-ban" style="color:var(--red);"></i></button>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderSesiones() {
  const tbody = document.getElementById('sesionesBody');
  const sesiones = ops.sesiones_purga || [];
  if (!sesiones.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><i class="fas fa-shield-halved"></i><p>No hay sesiones para purgar. Todo limpio.</p></td></tr>';
    return;
  }
  tbody.innerHTML = sesiones.map(s => `<tr>
    <td><span class="tenant-chip"><span class="tenant-ava">${esc((s.empresa_codigo || '?').slice(0, 2))}</span>${esc(s.empresa_codigo)}</span></td>
    <td>${esc(s.usuario || '—')}</td>
    <td><span style="font-family:monospace;">${esc(s.ip || '—')}</span> · ${esc(s.dispositivo || '—')}</td>
    <td>${hace(s.ultimo_actividad)}</td>
    <td><button class="btn btn-ghost btn-xs" onclick="purgarSesion('${esc(s.id)}')" title="Revocar sesión"><i class="fas fa-broom" style="color:var(--yellow);"></i></button></td>
  </tr>`).join('');
}

function renderHealth() {
  const host = document.getElementById('healthList');
  const h = ops.health;
  if (!h) {
    host.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin datos de system_health disponibles.</div>';
    return;
  }
  const checks = Array.isArray(h.checks) ? h.checks :
    Object.entries(h).filter(([k]) => !['ok'].includes(k)).map(([k, v]) => ({ nombre: k, estado: typeof v === 'string' ? v : (v ? 'ok' : 'error'), detalle: '' }));
  if (!checks.length) {
    host.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin chequeos registrados.</div>';
    return;
  }
  host.innerHTML = checks.map(c => {
    const ok = ['ok', 'up', 'healthy', 'activo', true].includes(c.estado);
    const cls = ok ? 'ok' : 'err';
    return `<div class="pp-tl-item">
      <div class="pp-tl-dot ${cls}"><i class="fas ${ok ? 'fa-check' : 'fa-xmark'}"></i></div>
      <div class="pp-tl-title">${esc(c.nombre || 'Check')}</div>
      ${c.detalle ? '<div class="pp-tl-desc">' + esc(c.detalle) + '</div>' : ''}
      <div class="pp-tl-time">Estado: ${esc(String(c.estado))}</div>
    </div>`;
  }).join('');
}

function revocarKey(id) {
  const k = (ops.api_keys || []).find(x => x.id === id);
  document.getElementById('confirmMessage').textContent = `¿Revocar la API key "${k ? k.nombre : id}" de ${k ? k.empresa_codigo : ''}? Las integraciones que la usen dejarán de funcionar.`;
  document.getElementById('confirmActionBtn').onclick = async () => {
    try {
      const res = await fetch(API_BASE + '/admin/respaldos/keys/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al revocar');
      toast('API key revocada', 'ok');
      closeModal('confirmModal');
      loadData();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal('confirmModal');
}

function purgarSesion(id) {
  document.getElementById('confirmMessage').textContent = '¿Revocar esta sesión? El usuario tendrá que iniciar sesión de nuevo en ese dispositivo.';
  document.getElementById('confirmActionBtn').onclick = async () => {
    try {
      const res = await fetch(API_BASE + '/admin/respaldos/sesiones/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Error al revocar la sesión');
      toast('Sesión revocada', 'ok');
      closeModal('confirmModal');
      loadData();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal('confirmModal');
}

function exportarEstado() {
  const payload = {
    generado: new Date().toISOString(),
    api_keys: ops.api_keys,
    sesiones_para_purga: ops.sesiones_purga,
    system_health: ops.health
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `estado_operativo_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
