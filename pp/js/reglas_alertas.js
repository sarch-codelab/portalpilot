/* ── Reglas de alertas — pp/reglas_alertas.html ── */
'use strict';

const API_BASE = '/api';
let reglas = [];

const TIPOS = {
  uso_plan: { nombre: 'Uso del plan', unidad: '% del límite', help: 'Porcentaje del límite del plan.', ej: 'uso > 80% del plan → notificar', icono: 'fa-gauge-high' },
  ticket_sla: { nombre: 'Ticket sin respuesta', unidad: 'horas', help: 'Horas sin que nadie cambie el estado del ticket.', ej: 'ticket abierto > 8h → escalar', icono: 'fa-life-ring' },
  renovacion_proxima: { nombre: 'Renovación próxima', unidad: 'días', help: 'Días que faltan para el vencimiento.', ej: 'renovación < 15 días → avisar', icono: 'fa-calendar-check' },
  fallos_bot: { nombre: 'Fallos de bot', unidad: 'fallos/24h', help: 'Fallos acumulados del bot en 24 horas.', ej: '≥ 3 fallos en 24h → notificar', icono: 'fa-robot' },
  logins_fallidos: { nombre: 'Logins fallidos', unidad: 'intentos/1h', help: 'Intentos fallidos por tenant en la última hora.', ej: '≥ 5 intentos/h → alerta de seguridad', icono: 'fa-user-lock' }
};

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
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
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

async function loadReglas() {
  const host = document.getElementById('reglasList');
  host.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);"><i class="fas fa-spinner fa-spin" style="font-size:22px;"></i></div>';
  try {
    const res = await fetch(API_BASE + '/admin/reglas', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    reglas = data.reglas || [];
    renderReglas();
  } catch (err) {
    console.error('[REGLAS]', err);
    const es404 = String(err.message).includes('404');
    host.innerHTML = `<div class="empty-state" style="padding:40px;"><i class="fas fa-database"></i><p>${es404
      ? 'La tabla <strong>reglas_alertas</strong> aún no existe. Ejecuta supabase/migracion_incidentes_validacion.sql en Supabase.'
      : 'Error al cargar las reglas.'}</p></div>`;
  }
}

function renderReglas() {
  const host = document.getElementById('reglasList');
  if (!reglas.length) {
    host.innerHTML = `<div class="empty-state" style="padding:40px;"><i class="fas fa-sliders"></i><p>No hay reglas configuradas todavía.<br><span style="font-size:12px;">Ejemplos: uso &gt; 80% del plan, ticket sin respuesta &gt; 8h, renovación en &lt; 15 días.</span></p>
      <button class="btn btn-acc btn-sm" onclick="openNueva()"><i class="fas fa-plus"></i> Crear la primera regla</button></div>`;
    return;
  }
  host.innerHTML = reglas.map(r => {
    const t = TIPOS[r.tipo] || { icono: 'fa-bell', nombre: r.tipo, unidad: '' };
    return `<div class="alert-item ${r.activo ? 'ai-info' : ''}" style="${r.activo ? '' : 'opacity:.55;'}">
      <div class="alert-item-icon" style="background:rgba(139,92,246,.15);color:var(--accent);"><i class="fas ${t.icono}"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(r.nombre || t.nombre)}</div>
        <div class="alert-item-desc">${esc(t.ej)} <span style="color:var(--gray);">· cuando se cumpla, alerta a los admins ROOT</span></div>
        <div class="alert-item-meta">
          <span><i class="fas fa-bullseye"></i> Umbral: <strong style="color:var(--white);">${esc(r.umbral)} ${esc(t.unidad)}</strong></span>
          <span><i class="fas fa-flag"></i> Severidad: ${esc(r.severidad)}</span>
          ${r.ultima_evaluacion ? `<span><i class="fas fa-clock-rotate-left"></i> Última evaluación: ${fmtFecha(r.ultima_evaluacion)}</span>` : ''}
          ${r.ultima_coincidencia ? `<span style="color:var(--yellow);"><i class="fas fa-bell"></i> Última vez que se cumplió: ${fmtFecha(r.ultima_coincidencia)}</span>` : ''}
        </div>
      </div>
      <div class="alert-item-side">
        <button class="stream-chip ${r.activo ? 'on' : ''}" onclick="toggleRegla('${esc(r.id)}', ${!r.activo})" title="Activar/desactivar">
          <span class="live-dot"></span> ${r.activo ? 'Activa' : 'Pausada'}
        </button>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-xs" onclick="editarRegla('${esc(r.id)}')"><i class="fas fa-pen"></i></button>
          <button class="btn btn-ghost btn-xs" onclick="eliminarRegla('${esc(r.id)}')"><i class="fas fa-trash" style="color:var(--red);"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function actualizarHelp() {
  const tipo = document.getElementById('reglaTipo').value;
  const t = TIPOS[tipo] || {};
  document.getElementById('reglaUmbralHelp').textContent = t.help || '';
  const umbral = document.getElementById('reglaUmbral');
  if (tipo === 'uso_plan') umbral.value = 80;
  if (tipo === 'ticket_sla') umbral.value = 8;
  if (tipo === 'renovacion_proxima') umbral.value = 15;
  if (tipo === 'fallos_bot') umbral.value = 3;
  if (tipo === 'logins_fallidos') umbral.value = 5;
}

function openNueva() {
  const sel = document.getElementById('reglaTipo');
  sel.value = 'uso_plan';
  sel.onchange = actualizarHelp;
  actualizarHelp();
  document.getElementById('reglaNombre').value = '';
  document.getElementById('reglaSev').value = 'critical';
  document.getElementById('reglaActiva').checked = true;
  document.getElementById('reglaSaveBtn').dataset.id = '';
  document.getElementById('reglaModalTitle').textContent = 'Nueva regla';
  openModal('reglaModal');
}

function editarRegla(id) {
  const r = reglas.find(x => x.id === id);
  if (!r) return;
  const sel = document.getElementById('reglaTipo');
  sel.value = r.tipo;
  sel.onchange = actualizarHelp;
  document.getElementById('reglaUmbral').value = r.umbral;
  document.getElementById('reglaNombre').value = r.nombre || '';
  document.getElementById('reglaSev').value = r.severidad || 'critical';
  document.getElementById('reglaActiva').checked = r.activo !== false;
  document.getElementById('reglaSaveBtn').dataset.id = r.id;
  document.getElementById('reglaModalTitle').textContent = 'Editar regla';
  openModal('reglaModal');
}

async function guardarRegla() {
  const id = document.getElementById('reglaSaveBtn').dataset.id || '';
  const payload = {
    tipo: document.getElementById('reglaTipo').value,
    umbral: Number(document.getElementById('reglaUmbral').value) || 1,
    nombre: document.getElementById('reglaNombre').value.trim(),
    severidad: document.getElementById('reglaSev').value,
    activo: document.getElementById('reglaActiva').checked
  };
  const btn = document.getElementById('reglaSaveBtn');
  btn.disabled = true;
  try {
    const res = await fetch(id ? API_BASE + '/admin/reglas/' + encodeURIComponent(id) : API_BASE + '/admin/reglas', {
      method: id ? 'PATCH' : 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al guardar la regla');
    toast('Regla guardada', 'ok');
    closeModal('reglaModal');
    loadReglas();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; }
}

async function toggleRegla(id, activo) {
  try {
    const res = await fetch(API_BASE + '/admin/reglas/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ activo })
    });
    if (!res.ok) throw new Error('Error al actualizar');
    loadReglas();
  } catch (err) { toast(err.message, 'err'); }
}

function eliminarRegla(id) {
  document.getElementById('confirmMessage').textContent = '¿Eliminar esta regla? Dejará de evaluarse.';
  document.getElementById('confirmActionBtn').onclick = async () => {
    try {
      const res = await fetch(API_BASE + '/admin/reglas/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Error al eliminar');
      toast('Regla eliminada', 'ok');
      closeModal('confirmModal');
      loadReglas();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal('confirmModal');
}

async function evaluarAhora() {
  toast('Evaluando reglas…');
  try {
    const res = await fetch(API_BASE + '/admin/reglas/evaluar', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders())
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al evaluar');
    toast(data.resultado || 'Evaluación completada: ' + (data.notificaciones || 0) + ' notificación(es) generada(s)', 'ok');
    loadReglas();
  } catch (err) { toast(err.message, 'err'); }
}

document.addEventListener('DOMContentLoaded', loadReglas);
