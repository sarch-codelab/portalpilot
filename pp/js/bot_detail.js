/* ── Detalle de automatización — pp/bot_detail.html ── */
'use strict';

const API_BASE = '/api';
let bots = [];
let botActual = null;
let runs = [];
let reglas = [];
let tenantSel = '';

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

function botIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

async function loadBots() {
  try {
    const res = await fetch(API_BASE + '/admin/bots' + (tenantSel ? '?tenant=' + encodeURIComponent(tenantSel) : ''), { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    bots = data.bots || [];
    renderSelector();
    const id = botIdFromUrl();
    if (id) {
      const b = bots.find(x => String(x.id) === id);
      if (b) return selectBot(id);
      toast('Bot no encontrado en la lista; cargando directo…', 'warn');
      botActual = { id, nombre: 'Bot ' + id.slice(0, 8) };
      return loadBotData();
    }
  } catch (err) {
    console.error('[BOT_DETAIL]', err);
    document.getElementById('botsBody').innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar las automatizaciones.</p></td></tr>';
  }
}

function renderSelector() {
  const tbody = document.getElementById('botsBody');
  if (!bots.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-robot"></i><p>No hay automatizaciones registradas todavía.</p></td></tr>';
    return;
  }
  tbody.innerHTML = bots.map(b => `
    <tr>
      <td><span style="color:var(--white);font-weight:600;"><i class="fas ${esc(b.icono || 'fa-robot')}" style="color:var(--accent);margin-right:8px;"></i>${esc(b.nombre)}</span></td>
      <td><span class="tenant-chip"><span class="tenant-ava">${esc((b.empresa_codigo || '?').slice(0, 2))}</span>${esc(b.empresa_codigo)}</span></td>
      <td><span class="status-badge st-${esc((b.estado || 'inactivo').toLowerCase())}"><span class="action-dot"></span>${esc(b.estado || 'inactivo')}</span></td>
      <td>${esc(b.tareas || 0)}</td>
      <td>${esc(b.exito != null ? b.exito + '%' : '—')}</td>
      <td>${fmtFecha(b.created_at)}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="selectBot('${esc(b.id)}')">Ver detalle <i class="fas fa-arrow-right"></i></button></td>
    </tr>`).join('');
}

async function selectBot(id) {
  botActual = bots.find(b => String(b.id) === String(id)) || { id };
  try {
    const res = await fetch(API_BASE + '/admin/bots/' + encodeURIComponent(id) + '/detail', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    botActual = Object.assign({}, botActual, data.bot || {});
    runs = data.runs || [];
    reglas = data.rules || [];
    renderDetail();
    document.getElementById('selectorSection').style.display = 'none';
    document.getElementById('detailSection').style.display = 'block';
  } catch (err) {
    console.error('[BOT_DETAIL]', err);
    toast('No se pudo cargar el detalle del bot', 'err');
  }
}

async function loadBotData() {
  if (botActual && botActual.id) await selectBot(botActual.id);
}

function renderDetail() {
  const b = botActual || {};
  document.getElementById('pageTitle').innerHTML = 'Bot <span>' + esc(b.nombre || '—') + '</span>';
  document.getElementById('pageSubtitle').innerHTML =
    'Empresa <strong style="color:var(--text);">' + esc(b.empresa_codigo || '—') + '</strong> · estado ' + esc(b.estado || '—') +
    (b.trigger_flow ? ' · disparo: ' + esc(b.trigger_flow) : '') + (b.accion ? ' → ' + esc(b.accion) : '');
  document.getElementById('pageActions').innerHTML =
    '<span class="status-badge st-' + esc((b.estado || 'inactivo').toLowerCase()) + '" style="padding:8px 18px;"><span class="action-dot"></span>' + esc(b.estado || 'inactivo') + '</span>';

  const total = runs.length;
  const ok = runs.filter(r => (r.nivel || '').toLowerCase() === 'success' || r.success === true).length;
  const errores = runs.filter(r => (r.nivel || '').toLowerCase() === 'error' || r.success === false).length;
  document.getElementById('kpiEjecuciones').textContent = total || b.tareas || 0;
  document.getElementById('kpiExito').textContent = total ? Math.round((ok / total) * 100) + '%' : (b.exito != null ? b.exito + '%' : '—');
  document.getElementById('kpiErrores').textContent = errores;

  // Duración promedio si el run trae duracion_ms / duration_ms / created_at→finished_at
  const durs = runs.map(r => Number(r.duracion_ms || r.duration_ms)).filter(n => Number.isFinite(n) && n >= 0);
  document.getElementById('kpiDuracion').textContent = durs.length
    ? (durs.reduce((s, d) => s + d, 0) / durs.length < 1000
      ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) + ' ms'
      : ((durs.reduce((s, d) => s + d, 0) / durs.length) / 1000).toFixed(1) + ' s')
    : '—';

  renderRuns();
  renderRules();
}

function filterRuns() { renderRuns(); }

function renderRuns() {
  const host = document.getElementById('runsTimeline');
  const q = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const list = runs.filter(r => !q || ((r.mensaje || '') + ' ' + (r.agente || '')).toLowerCase().includes(q));
  if (!list.length) {
    host.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;"><i class="fas fa-inbox" style="font-size:26px;display:block;margin-bottom:8px;opacity:.5;"></i>Sin ejecuciones registradas.</div>';
    return;
  }
  host.innerHTML = list.slice(0, 60).map(r => {
    const nivel = (r.nivel || (r.success === false ? 'error' : 'info')).toLowerCase();
    const cls = nivel === 'success' ? 'ok' : nivel === 'error' ? 'err' : nivel === 'warning' ? 'warn' : '';
    const dur = Number(r.duracion_ms || r.duration_ms);
    return `<div class="pp-tl-item">
      <div class="pp-tl-dot ${cls}"><i class="fas ${nivel === 'error' ? 'fa-xmark' : nivel === 'success' ? 'fa-check' : 'fa-circle'}"></i></div>
      <div class="pp-tl-title">${esc(r.mensaje || r.agente || 'Ejecución')}</div>
      ${r.detalle ? '<div class="pp-tl-desc">' + esc(r.detalle) + '</div>' : ''}
      <div class="pp-tl-time">${fmtFecha(r.created_at)}${Number.isFinite(dur) && dur > 0 ? ' · ' + (dur < 1000 ? dur + ' ms' : (dur / 1000).toFixed(1) + ' s') : ''}${r.empresa_codigo ? ' · ' + esc(r.empresa_codigo) : ''}</div>
    </div>`;
  }).join('');
}

function renderRules() {
  const host = document.getElementById('rulesList');
  if (!reglas.length) {
    host.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;"><i class="fas fa-diagram-project" style="font-size:26px;display:block;margin-bottom:8px;opacity:.5;"></i>Este bot no tiene reglas configuradas.</div>';
    return;
  }
  host.innerHTML = reglas.map(r => `
    <div class="alert-item ai-info">
      <div class="alert-item-icon"><i class="fas fa-gears"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(r.nombre || r.tipo || 'Regla')}</div>
        <div class="alert-item-desc">${esc(r.descripcion || '')}</div>
        <div class="alert-item-meta">
          ${r.event_type ? '<span><i class="fas fa-bolt"></i> ' + esc(r.event_type) + '</span>' : ''}
          ${r.activo !== undefined ? '<span>' + (r.activo ? '<i class="fas fa-toggle-on" style="color:var(--green);"></i> Activa' : '<i class="fas fa-toggle-off"></i> Inactiva') + '</span>' : ''}
          <span><i class="fas fa-calendar"></i> ${fmtFecha(r.created_at)}</span>
        </div>
      </div>
    </div>`).join('');
}

function refresh() { botActual && botActual.id ? selectBot(botActual.id) : loadBots(); }

document.addEventListener('DOMContentLoaded', loadBots);
