/* ── Incidencias de clientes — pp/incidentes_tenant.html ── */
'use strict';

const API_BASE = '/api';
let incidencias = [];
let tenants = [];
let editandoId = null;

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
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

const SEV_CLS = { critica: 'critical', alta: 'warning', media: 'info', baja: 'success' };
const EST_CLS = { abierta: 'st-error', en_progreso: 'st-warning', resuelta: 'st-ok', cerrada: 'st-neutral' };
const EST_LABEL = { abierta: 'Abierta', en_progreso: 'En progreso', resuelta: 'Resuelta', cerrada: 'Cerrada' };

async function init() {
  await cargarTenants();
  await loadIncidencias();
}

async function cargarTenants() {
  try {
    const res = await fetch(API_BASE + '/admin/cobranza', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      tenants = (data.tenants || []).map(t => ({ codigo: t.empresa_codigo, nombre: t.empresa_nombre || t.empresa_codigo }));
    }
  } catch (e) { console.warn('[INCIDENTES] tenants:', e.message); }
  document.getElementById('incTenant').innerHTML = tenants.length
    ? tenants.map(t => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join('')
    : '<option value="">(sin clientes)</option>';
}

async function loadIncidencias() {
  const host = document.getElementById('incidenciasList');
  host.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:22px;"></i></div>';
  try {
    const res = await fetch(API_BASE + '/admin/incidentes', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    incidencias = data.incidencias || [];
    renderKpis();
    applyFilters();
  } catch (err) {
    console.error('[INCIDENTES]', err);
    const es404 = String(err.message).includes('404');
    host.innerHTML = `<div class="empty-state" style="padding:40px;"><i class="fas fa-database"></i><p>${es404
      ? 'La tabla <strong>incidentes</strong> aún no existe. Ejecuta la migración supabase/migracion_incidentes_validacion.sql en Supabase.'
      : 'Error al cargar las incidencias.'}</p></div>`;
  }
}

function renderKpis() {
  const abiertas = incidencias.filter(i => i.estado === 'abierta').length;
  const progreso = incidencias.filter(i => i.estado === 'en_progreso').length;
  const resueltas = incidencias.filter(i => i.resuelta_at && i.created_at);
  const prom = resueltas.length
    ? resueltas.reduce((s, i) => s + (new Date(i.resuelta_at) - new Date(i.created_at)) / 3600000, 0) / resueltas.length
    : null;
  const mes = new Date().toISOString().slice(0, 7);
  document.getElementById('kpiAbiertas').textContent = abiertas;
  document.getElementById('kpiProgreso').textContent = progreso;
  document.getElementById('kpiMttf').textContent = prom != null ? (prom < 24 ? prom.toFixed(1) + ' h' : (prom / 24).toFixed(1) + ' d') : '—';
  document.getElementById('kpiMes').textContent = incidencias.filter(i => (i.created_at || '').slice(0, 7) === mes).length;
}

function applyFilters() {
  const search = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const estado = document.getElementById('filterEstado')?.value || '';
  const sev = document.getElementById('filterSev')?.value || '';
  const lista = incidencias.filter(i => {
    if (estado && i.estado !== estado) return false;
    if (sev && i.severidad !== sev) return false;
    if (search && !((i.titulo || '') + ' ' + (i.empresa_codigo || '') + ' ' + (i.descripcion || '')).toLowerCase().includes(search)) return false;
    return true;
  });
  const ordenEst = { abierta: 0, en_progreso: 1, resuelta: 2, cerrada: 3 };
  const ordenSev = { critica: 0, alta: 1, media: 2, baja: 3 };
  lista.sort((a, b) => (ordenEst[a.estado] - ordenEst[b.estado]) || (ordenSev[a.severidad] - ordenSev[b.severidad]) || (new Date(b.created_at || 0) - new Date(a.created_at || 0)));
  renderList(lista);
}

function renderList(lista) {
  const host = document.getElementById('incidenciasList');
  if (!lista.length) {
    host.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-clipboard-check"></i><p>No hay incidencias registradas. Buen momento para descansar.</p></div>';
    return;
  }
  host.innerHTML = lista.map(i => {
    const sev = esc(i.severidad || 'media');
    const estado = esc(i.estado || 'abierta');
    return `<div class="alert-item ai-${SEV_CLS[sev] || 'info'}">
      <div class="alert-item-icon"><i class="fas fa-triangle-exclamation"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(i.titulo)}</div>
        <div class="alert-item-desc">${esc(i.descripcion || '')}</div>
        <div class="alert-item-meta">
          ${i.empresa_codigo ? `<span class="tenant-chip" style="padding:2px 10px 2px 4px;"><span class="tenant-ava" style="width:18px;height:18px;font-size:9px;">${esc(i.empresa_codigo.slice(0, 2))}</span>${esc(i.empresa_codigo)}</span>` : ''}
          <span><i class="fas fa-user"></i> ${esc(i.responsable || 'Sin asignar')}</span>
          <span><i class="fas fa-clock"></i> ${fmtFecha(i.created_at)} (${hace(i.created_at)})</span>
          ${i.resuelta_at ? `<span style="color:var(--green);"><i class="fas fa-check"></i> Resuelta ${hace(i.resuelta_at)}</span>` : ''}
        </div>
      </div>
      <div class="alert-item-side">
        <span class="prio-badge ${sev}">${sev}</span>
        <span class="status-badge ${EST_CLS[estado] || 'st-neutral'}"><span class="action-dot"></span>${EST_LABEL[estado] || estado}</span>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-xs" onclick="editarIncidente('${esc(i.id)}')" title="Editar"><i class="fas fa-pen"></i></button>
          ${i.estado !== 'resuelta' && i.estado !== 'cerrada' ? `<button class="btn btn-ghost btn-xs" onclick="resolverRapido('${esc(i.id)}')" title="Marcar resuelta"><i class="fas fa-check" style="color:var(--green);"></i></button>` : ''}
          <button class="btn btn-ghost btn-xs" onclick="eliminarIncidente('${esc(i.id)}')" title="Eliminar"><i class="fas fa-trash" style="color:var(--red);"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openNueva() {
  editandoId = null;
  document.getElementById('incModalTitle').textContent = 'Registrar incidencia';
  document.getElementById('incTitulo').value = '';
  document.getElementById('incDesc').value = '';
  document.getElementById('incSev').value = 'alta';
  document.getElementById('incTenant').value = tenants[0]?.codigo || '';
  document.getElementById('incResolucionWrap').style.display = 'none';
  openModal('incidenteModal');
}

function editarIncidente(id) {
  const i = incidencias.find(x => x.id === id);
  if (!i) return;
  editandoId = id;
  document.getElementById('incModalTitle').textContent = 'Editar incidencia';
  document.getElementById('incTitulo').value = i.titulo || '';
  document.getElementById('incDesc').value = i.descripcion || '';
  document.getElementById('incSev').value = i.severidad || 'media';
  document.getElementById('incTenant').value = i.empresa_codigo || '';
  document.getElementById('incResolucionWrap').style.display = 'block';
  document.getElementById('incResolucion').value = i.resolucion || '';
  document.getElementById('incEstado').value = i.estado || 'abierta';
  document.getElementById('incResponsable').value = i.responsable || '';
  openModal('incidenteModal');
}

async function guardarIncidente() {
  const payload = {
    empresa_codigo: document.getElementById('incTenant').value || null,
    titulo: document.getElementById('incTitulo').value.trim(),
    descripcion: document.getElementById('incDesc').value.trim(),
    severidad: document.getElementById('incSev').value
  };
  if (!payload.titulo) { toast('El título es requerido', 'err'); return; }
  if (editandoId) {
    payload.estado = document.getElementById('incEstado').value;
    payload.resolucion = document.getElementById('incResolucion').value.trim();
    payload.responsable = document.getElementById('incResponsable').value.trim();
  }
  const btn = document.getElementById('incSaveBtn');
  btn.disabled = true;
  try {
    const url = editandoId ? API_BASE + '/admin/incidentes/' + encodeURIComponent(editandoId) : API_BASE + '/admin/incidentes';
    const res = await fetch(url, {
      method: editandoId ? 'PATCH' : 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    toast(editandoId ? 'Incidencia actualizada' : 'Incidencia registrada', 'ok');
    closeModal('incidenteModal');
    loadIncidencias();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function resolverRapido(id) {
  try {
    const res = await fetch(API_BASE + '/admin/incidentes/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ estado: 'resuelta' })
    });
    if (!res.ok) throw new Error('Error al marcar como resuelta');
    toast('Incidencia marcada como resuelta', 'ok');
    loadIncidencias();
  } catch (err) { toast(err.message, 'err'); }
}

function eliminarIncidente(id) {
  document.getElementById('confirmMessage').textContent = '¿Eliminar esta incidencia? Esta acción no se puede deshacer.';
  document.getElementById('confirmActionBtn').onclick = async () => {
    try {
      const res = await fetch(API_BASE + '/admin/incidentes/' + encodeURIComponent(id), {
        method: 'DELETE', headers: authHeaders()
      });
      if (!res.ok) throw new Error('Error al eliminar');
      toast('Incidencia eliminada', 'ok');
      closeModal('confirmModal');
      loadIncidencias();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal('confirmModal');
}

function resetFilters() {
  ['filterEstado', 'filterSev'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const s = document.getElementById('globalSearch'); if (s) s.value = '';
  applyFilters();
}

function exportCsv() {
  if (!incidencias.length) { toast('No hay datos para exportar', 'warn'); return; }
  const headers = ['Creada', 'Empresa', 'Titulo', 'Severidad', 'Estado', 'Responsable', 'Resolucion', 'Resuelta'];
  const rows = incidencias.map(i => [i.created_at, i.empresa_codigo, i.titulo, i.severidad, i.estado, i.responsable, i.resolucion, i.resuelta_at]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `incidencias_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', init);
