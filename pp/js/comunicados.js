/* ── Comunicados masivos — pp/comunicados.html ── */
'use strict';

const API_BASE = '/api';
let comunicados = [];
let tenants = [];

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

const TIPO_CLS = { info: 'st-info', warning: 'st-warning', success: 'st-ok', error: 'st-error' };

async function init() {
  try {
    const res = await fetch(API_BASE + '/admin/cobranza', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      tenants = (data.tenants || []).map(t => ({ codigo: t.empresa_codigo, nombre: t.empresa_nombre || t.empresa_codigo }));
    }
  } catch (e) { console.warn('[COMUNICADOS] tenants:', e.message); }
  const sel = document.getElementById('cDestino');
  sel.innerHTML = '<option value="ALL">📢 Todos los clientes (broadcast)</option>' +
    tenants.map(t => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join('');
  await loadData();
}

async function loadData() {
  const host = document.getElementById('historialList');
  host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray);"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const res = await fetch(API_BASE + '/admin/comunicados', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    comunicados = data.comunicados || [];
    renderHistorial();
  } catch (err) {
    console.error('[COMUNICADOS]', err);
    host.innerHTML = '<div class="empty-state" style="padding:30px;"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar el historial.</p></div>';
  }
}

function renderHistorial() {
  const host = document.getElementById('historialList');
  if (!comunicados.length) {
    host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray);font-size:13px;"><i class="fas fa-bullhorn" style="font-size:26px;display:block;margin-bottom:8px;opacity:.5;"></i>Aún no se han enviado comunicados.</div>';
    return;
  }
  host.innerHTML = comunicados.slice(0, 50).map(c => `
    <div class="alert-item ai-${c.tipo === 'error' ? 'critical' : c.tipo === 'warning' ? 'warning' : c.tipo === 'success' ? 'success' : 'info'}">
      <div class="alert-item-icon"><i class="fas ${c.tipo === 'error' ? 'fa-triangle-exclamation' : c.tipo === 'warning' ? 'fa-circle-exclamation' : c.tipo === 'success' ? 'fa-circle-check' : 'fa-circle-info'}"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(c.titulo)}</div>
        <div class="alert-item-desc">${esc(c.mensaje)}</div>
        <div class="alert-item-meta">
          <span class="tenant-chip" style="padding:2px 10px 2px 4px;"><span class="tenant-ava" style="width:18px;height:18px;font-size:9px;">${c.empresa_codigo === 'ALL' ? '📢' : esc(String(c.empresa_codigo || '?').slice(0, 2))}</span>${c.empresa_codigo === 'ALL' ? 'Todos los clientes' : esc(c.empresa_codigo)}</span>
          <span><i class="fas fa-clock"></i> ${fmtFecha(c.created_at)}</span>
          <span><i class="fas fa-inbox"></i> ${c.destinatarios != null ? c.destinatarios + ' usuarios notificados' : ''}</span>
        </div>
      </div>
      <div class="alert-item-side">
        <span class="status-badge ${TIPO_CLS[c.tipo] || 'st-info'}"><span class="action-dot"></span>${esc(c.tipo)}</span>
        ${c.prioridad ? `<span class="prio-badge ${esc(c.prioridad)}">${esc(c.prioridad)}</span>` : ''}
      </div>
    </div>`).join('');
}

async function enviarComunicado() {
  const payload = {
    destino: document.getElementById('cDestino').value,
    tipo: document.getElementById('cTipo').value,
    prioridad: document.getElementById('cPrioridad').value,
    titulo: document.getElementById('cTitulo').value.trim(),
    mensaje: document.getElementById('cMensaje').value.trim(),
    link: document.getElementById('cLink').value.trim()
  };
  if (!payload.titulo || !payload.mensaje) { toast('Título y mensaje son requeridos', 'err'); return; }
  const btn = document.getElementById('cSendBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando…';
  try {
    const res = await fetch(API_BASE + '/admin/comunicados', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al enviar el comunicado');
    toast((data.destinatarios || 0) + ' usuarios notificados', 'ok');
    ['cTitulo', 'cMensaje', 'cLink'].forEach(id => { document.getElementById(id).value = ''; });
    loadData();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar comunicado';
  }
}

document.addEventListener('DOMContentLoaded', init);
