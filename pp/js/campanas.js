/* ── Campañas de email — pp/campanas.html ── */
'use strict';

const API_BASE = '/api';

const ESTADO_CLS = {
  borrador: 'st-neutral',
  programada: 'st-pending',
  enviando: 'st-in_progress',
  enviada: 'st-ok',
  cancelada: 'st-cancelled',
  error: 'st-error'
};
const ESTADO_ICO = {
  borrador: 'fa-file-pen',
  programada: 'fa-clock',
  enviando: 'fa-paper-plane',
  enviada: 'fa-circle-check',
  cancelada: 'fa-ban',
  error: 'fa-triangle-exclamation'
};

let currentId = null;         // id de la campaña en edición (null = nueva)
let campanas = [];
let sendLoop = false;         // control del bucle de envío

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit' });
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

function setEstadoBtn(id, disabled, html) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = disabled;
  if (html !== undefined) b.innerHTML = html;
}

async function api(path, opts) {
  const res = await fetch(API_BASE + path, Object.assign({
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders())
  }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ── Tabs ─────────────────────────────────────────── */
function cambiarTab(vista) {
  document.querySelectorAll('.camp-tab').forEach(t => t.classList.toggle('active', t.dataset.view === vista));
  document.querySelectorAll('.camp-view').forEach(v => v.classList.toggle('active', v.id === 'view-' + vista));
}
document.addEventListener('click', e => {
  const tab = e.target.closest('.camp-tab');
  if (tab) cambiarTab(tab.dataset.view);
}, true);

/* ── Formulario ───────────────────────────────────── */
function leerForm() {
  return {
    nombre: document.getElementById('cNombre').value.trim(),
    asunto: document.getElementById('cAsunto').value.trim(),
    html: document.getElementById('cHtml').value,
    texto: document.getElementById('cTexto').value.trim() || null,
    remitente: document.getElementById('cRemitente').value.trim(),
    destino_tipo: document.getElementById('cDestinoTipo').value,
    destino_valor: document.getElementById('cDestinoValor').value.trim()
  };
}

function validarForm(f) {
  if (!f.nombre) { toast('El nombre de la campaña es requerido', 'err'); return false; }
  if (!f.asunto) { toast('El asunto es requerido', 'err'); return false; }
  if (!f.html || !f.html.trim()) { toast('La plantilla HTML es requerida', 'err'); return false; }
  if (f.destino_tipo === 'tenant' && !f.destino_valor) { toast('Indica el código del tenant', 'err'); return false; }
  if (f.destino_tipo === 'emails' && !f.destino_valor) { toast('Pega la lista de correos separada por comas', 'err'); return false; }
  return true;
}

function nuevaCampana() {
  currentId = null;
  document.getElementById('campIdTag').textContent = '';
  ['cNombre', 'cAsunto', 'cTexto', 'cDestinoValor'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('cHtml').value = '<!DOCTYPE html>\n<html>\n<body style="font-family:Arial,sans-serif;margin:0;padding:24px;">\n  <h2>Hola {{nombre}},</h2>\n  <p>Estas son las novedades para {{empresa}}.</p>\n  <a href="https://portalpilot.hn">Ver más</a>\n</body>\n</html>';
  document.getElementById('cRemitente').value = '';
  document.getElementById('cDestinoTipo').value = 'all';
  onDestinoTipoChange();
  document.getElementById('cDestResumen').style.display = 'none';
  document.getElementById('sendBar').classList.remove('active');
  setEstadoBtn('btnPreparar', false);
  setEstadoBtn('btnEnviar', false);
  setEstadoBtn('btnProgramar', false);
  setEstadoBtn('btnCancelar', false, '<i class="fas fa-ban"></i> Cancelar envío');
  setEstadoBtn('btnCancelar', false); // habilitar (si estuvo deshabilitado)
  document.getElementById('btnCancelar').style.display = 'none';
  setFormEditable(true);
  refreshPreview();
  cambiarTab('editor');
}

function onDestinoTipoChange() {
  const tipo = document.getElementById('cDestinoTipo').value;
  const lbl = document.getElementById('cDestinoValorLabel');
  const inp = document.getElementById('cDestinoValor');
  document.getElementById('grupoValor').style.display = tipo === 'all' ? 'none' : '';
  if (tipo === 'tenant') {
    lbl.textContent = 'Empresa';
    inp.placeholder = 'codigo_tenant (ej: tenant_demo)';
    inp.setAttribute('list', 'cTenantList');
  } else if (tipo === 'emails') {
    lbl.textContent = 'Correos (separados por coma)';
    inp.placeholder = 'cliente1@gmail.com, cliente2@gmail.com';
    inp.removeAttribute('list');
  }
}

function insertarVar(v) {
  const t = document.getElementById('cHtml');
  const start = t.selectionStart != null ? t.selectionStart : t.value.length;
  t.value = t.value.slice(0, start) + v + t.value.slice(t.selectionEnd != null ? t.selectionEnd : start);
  t.focus();
  t.setSelectionRange(start + v.length, start + v.length);
}

function renderPreview(html) {
  const frame = document.getElementById('cPreview');
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html || '');
  doc.close();
}

function refreshPreview() {
  const f = leerForm();
  const html = (f.html || '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, 'Adriana Rodríguez')
    .replace(/\{\{\s*empresa\s*\}\}/gi, 'tenant_demo')
    .replace(/\{\{\s*email\s*\}\}/gi, 'destinatario@correo.com')
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, 'https://portal-pilot.vercel.app/api/public/campana/unsubscribe/TOKEN');
  renderPreview('<base target="_blank">' + html);
}

/* ── Destinatarios (preview desde el formulario) ──── */
async function previewDestinatarios() {
  const f = leerForm();
  if (f.destino_tipo !== 'all' && !f.destino_valor) { toast('Indica el destino antes de consultar', 'err'); return; }
  const btn = event.target;
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  try {
    const d = await api('/admin/campanas/preview-destinatarios', {
      method: 'POST',
      body: JSON.stringify({ destino_tipo: f.destino_tipo, destino_valor: f.destino_valor })
    });
    document.getElementById('cDestResumen').style.display = '';
    document.getElementById('cDestTotal').textContent = d.total;
    const porEmpresa = (d.por_empresa || []).map(e => `${esc(e.empresa_codigo)}=${e.total}`).join(', ');
    document.getElementById('cDestDetalle').textContent = porEmpresa ? ' · ' + porEmpresa : '';
    toast(d.total + ' destinatarios encontrados', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ── Guardar / cargar ─────────────────────────────── */
async function guardarCampana() {
  const f = leerForm();
  if (currentId) f.programada_at = undefined;
  if (!validarForm(f)) return null;
  setEstadoBtn('btnGuardar', true, '<i class="fas fa-spinner fa-spin"></i> Guardando…');
  try {
    let d;
    if (currentId) {
      d = await api('/admin/campanas/' + currentId, { method: 'PUT', body: JSON.stringify(f) });
    } else {
      d = await api('/admin/campanas', { method: 'POST', body: JSON.stringify(f) });
      currentId = d.campana.id;
    }
    document.getElementById('campIdTag').textContent = '#' + currentId + ' · ' + d.campana.estado;
    toast('Campaña guardada', 'ok');
    return d.campana;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  } finally {
    setEstadoBtn('btnGuardar', false, '<i class="fas fa-save"></i> Guardar borrador');
  }
}

async function editarCampana(id) {
  try {
    const d = await api('/admin/campanas/' + id);
    const c = d.campana;
    document.getElementById('detailModal').classList.remove('active');
    currentId = c.id;
    document.getElementById('cNombre').value = c.nombre || '';
    document.getElementById('cAsunto').value = c.asunto || '';
    document.getElementById('cHtml').value = c.html || '';
    document.getElementById('cTexto').value = c.texto || '';
    document.getElementById('cRemitente').value = c.remitente || '';
    document.getElementById('cDestinoTipo').value = c.destino_tipo || 'all';
    document.getElementById('cDestinoValor').value = c.destino_valor || '';
    onDestinoTipoChange();
    document.getElementById('campIdTag').textContent = '#' + c.id + ' · ' + c.estado;
    const total = c.total_destinatarios || 0;
    if (total) {
      document.getElementById('cDestResumen').style.display = '';
      document.getElementById('cDestTotal').textContent = total;
      document.getElementById('cDestDetalle').textContent = ` · ${c.enviados || 0} enviados · ${c.abiertos || 0} abiertos · ${c.clicks || 0} clicks · ${c.bajas || 0} bajas`;
    } else {
      document.getElementById('cDestResumen').style.display = 'none';
    }
    const bloqueada = c.estado === 'enviando' || c.estado === 'enviada';
    setFormEditable(!bloqueada);
    setEstadoBtn('btnPreparar', bloqueada, '<i class="fas fa-box-open"></i> Preparar');
    setEstadoBtn('btnEnviar', bloqueada, '<i class="fas fa-paper-plane"></i> Enviar ahora');
    setEstadoBtn('btnProgramar', bloqueada, '<i class="fas fa-clock"></i> Programar');
    setEstadoBtn('btnTest', bloqueada, '<i class="fas fa-vial"></i> Enviar test');
    const cancelBtn = document.getElementById('btnCancelar');
    cancelBtn.style.display = (c.estado === 'enviando' || c.estado === 'programada') ? '' : 'none';
    setEstadoBtn('btnCancelar', c.estado === 'enviada' || c.estado === 'cancelada');
    refreshPreview();
    cambiarTab('editor');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function setFormEditable(editable) {
  ['cNombre', 'cAsunto', 'cHtml', 'cTexto', 'cRemitente', 'cDestinoTipo', 'cDestinoValor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !editable;
  });
  document.getElementById('cVars').style.pointerEvents = editable ? '' : 'none';
  document.getElementById('cVars').style.opacity = editable ? '' : '0.4';
  document.getElementById('btnGuardar').disabled = !editable;
}

/* ── Enviar test ──────────────────────────────────── */
async function enviarTest() {
  let c = currentId && campanas.find(x => x.id === currentId);
  if (!c) {
    c = await guardarCampana();
    if (!c) return;
  }
  if (!c.remitente) c.remitente = document.getElementById('cRemitente').value.trim();
  const email = window.prompt('Correo de prueba:', '');
  if (!email) return;
  setEstadoBtn('btnTest', true, '<i class="fas fa-spinner fa-spin"></i> Enviando test…');
  try {
    const r = await api('/admin/campanas/' + c.id + '/test', { method: 'POST', body: JSON.stringify({ email }) });
    const ok = r && Array.isArray(r.rejected) && r.rejected.length === 0;
    toast(ok
      ? 'Test enviado a ' + email + (r.messageId ? ' (' + String(r.messageId).slice(0, 18) + ')' : '')
      : 'El SMTP rechazó el envío: ' + ((r && r.smtp) || 'consultar log'), ok ? 'ok' : 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setEstadoBtn('btnTest', false, '<i class="fas fa-vial"></i> Enviar test');
  }
}

/* ── Preparar / enviar / programar ────────────────── */
async function prepararCampana() {
  let c = currentId && campanas.find(x => x.id === currentId);
  if (!c || c.estado === 'borrador') {
    c = await guardarCampana();
    if (!c) return;
  }
  if (c.estado === 'enviada' || c.estado === 'enviando') { toast('La campaña ya fue enviada o está en envío', 'warn'); return; }
  setEstadoBtn('btnPreparar', true, '<i class="fas fa-spinner fa-spin"></i> Preparando…');
  try {
    const d = await api('/admin/campanas/' + c.id + '/preparar', { method: 'POST' });
    document.getElementById('cDestResumen').style.display = '';
    document.getElementById('cDestTotal').textContent = d.total;
    toast('Lista preparada: ' + d.total + ' destinatarios', 'ok');
    await loadCampanas();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setEstadoBtn('btnPreparar', false, '<i class="fas fa-box-open"></i> Preparar');
  }
}

function setPercent(pct, enviados, total, lote) {
  document.getElementById('sendFill').style.width = pct + '%';
  document.getElementById('sendPct').textContent = pct + '%';
  document.getElementById('sendInfo').textContent = `${enviados} / ${total} enviados`;
  document.getElementById('sendLote').textContent = lote || '';
}

async function enviarAhora() {
  let c = currentId && campanas.find(x => x.id === currentId);
  if (!c || c.estado === 'borrador' || c.estado === 'programada') {
    c = await guardarCampana();
    if (!c) return;
  }
  if (c.estado === 'enviada') { toast('La campaña ya fue enviada', 'warn'); return; }
  if (c.estado !== 'enviando' && !(c.total_destinatarios > 0)) {
    try {
      const d = await api('/admin/campanas/' + c.id + '/preparar', { method: 'POST' });
      toast('Lista preparada: ' + d.total + ' destinatarios', 'ok');
    } catch (e) {
      toast(e.message, 'err');
      return;
    }
  }
  sendLoop = true;
  document.getElementById('sendBar').classList.add('active');
  setEstadoBtn('btnEnviar', true, '<i class="fas fa-paper-plane"></i> Enviando…');
  setEstadoBtn('btnPreparar', true);
  setEstadoBtn('btnProgramar', true);
  const cancelBtn = document.getElementById('btnCancelar');
  cancelBtn.style.display = '';

  // Marcar campaña en curso con una cancelación previa
  if (c.estado === 'cancelada') {
    const upd = await api('/admin/campanas/' + c.id, { method: 'PUT', body: { programada_at: null } });
    c = upd.campana;
  }

  let erroresEnLote = 0;
  try {
    for (;;) {
      if (!sendLoop) break;
      const resp = await api('/admin/campanas/' + c.id + '/procesar', { method: 'POST', body: JSON.stringify({}) });
      const stats = resp.stats || {};
      const total = stats.total_destinatarios || resp.pendientes || 1;
      const hecho = (stats.enviados || 0) + (stats.errores || 0) + (stats.rebotes || 0);
      const pct = total ? Math.min(100, Math.round(hecho / total * 100)) : 0;
      setPercent(pct, stats.enviados || 0, total, `${resp.lote ? `último lote: ${resp.lote.enviados} ok / ${resp.lote.errores} err` : ''}`);
      if (resp.finalizada) {
        document.getElementById('sendFill').style.width = '100%';
        document.getElementById('sendPct').textContent = '100%';
        toast('Campaña enviada', 'ok');
        break;
      }
      // Pequeña pausa entre lotes para no abusar del runtime serverless
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (e) {
    toast(e.message, 'err');
    erroresEnLote++;
  } finally {
    sendLoop = false;
    setTimeout(() => document.getElementById('sendBar').classList.remove('active'), 2500);
    setEstadoBtn('btnEnviar', false, '<i class="fas fa-paper-plane"></i> Enviar ahora');
    setEstadoBtn('btnPreparar', false, '<i class="fas fa-box-open"></i> Preparar');
    setEstadoBtn('btnProgramar', false, '<i class="fas fa-clock"></i> Programar');
    cancelBtn.style.display = 'none';
    if (erroresEnLote) toast('Hubo errores en el envío. Revisa el detalle.', 'warn');
    await loadCampanas();
  }
}

async function programarCampana() {
  let c = currentId && campanas.find(x => x.id === currentId);
  if (!c || c.estado === 'borrador') {
    c = await guardarCampana();
    if (!c) return;
  }
  if (!(c.total_destinatarios > 0)) {
    try {
      const d = await api('/admin/campanas/' + c.id + '/preparar', { method: 'POST' });
      if (d.total === 0) { toast('No hay destinatarios para programar', 'err'); return; }
    } catch (e) { toast(e.message, 'err'); return; }
  }
  const cuando = window.prompt('Fecha y hora para programar (formato YYYY-MM-DDTHH:MM):', '2026-01-01T09:00');
  if (!cuando) return;
  const f = new Date(cuando);
  if (isNaN(f)) { toast('Fecha inválida', 'err'); return; }
  setEstadoBtn('btnProgramar', true, '<i class="fas fa-spinner fa-spin"></i> Programando…');
  try {
    const d = await api('/admin/campanas/' + c.id + '/programar', { method: 'POST', body: JSON.stringify({ programada_at: f.toISOString() }) });
    toast('Programada para ' + fmtFecha(d.campana.programada_at), 'ok');
    await loadCampanas();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setEstadoBtn('btnProgramar', false, '<i class="fas fa-clock"></i> Programar');
  }
}

async function cancelarCampana(id) {
  const cid = id || currentId;
  if (!cid) return;
  if (!window.confirm('¿Cancelar el envío de esta campaña? Los correos pendientes no se enviarán.')) return;
  sendLoop = false;
  try {
    await api('/admin/campanas/' + cid + '/cancelar', { method: 'POST' });
    toast('Campaña cancelada', 'ok');
    document.getElementById('btnCancelar').style.display = 'none';
    await loadCampanas();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function eliminarCampana(id) {
  if (!window.confirm('¿Eliminar esta campaña y su historial de destinatarios?')) return;
  try {
    await api('/admin/campanas/' + id, { method: 'DELETE' });
    toast('Campaña eliminada', 'ok');
    if (currentId === id) nuevaCampana();
    await loadCampanas();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── Detalle (stats + destinatarios + eventos) ────── */
async function verDetalle(id) {
  document.getElementById('detailModal').classList.add('active');
  document.getElementById('detailTitulo').textContent = 'Campaña #' + id;
  document.getElementById('detailBody').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando detalle…';
  try {
    const d = await api('/admin/campanas/' + id);
    const c = d.campana;
    const st = {
      total: c.total_destinatarios || 0,
      enviados: c.enviados || 0,
      abiertos: c.abiertos || 0,
      clicks: c.clicks || 0,
      bajas: c.bajas || 0,
      errores: c.errores || 0,
      rebotes: c.rebotes || 0
    };
    const tcr = st.total ? Math.round(st.abiertos / st.total * 100) : 0;
    const ctr = st.total ? Math.round(st.clicks / st.total * 100) : 0;
    let html = `
      <div class="camp-toolbar" style="margin-bottom:14px;">
        <span class="status-badge ${ESTADO_CLS[c.estado] || 'st-neutral'}"><span class="action-dot"></span>${esc(c.estado)}</span>
        ${!['enviando', 'enviada'].includes(c.estado) ? `<button class="btn btn-ghost btn-xs" onclick="editarCampana('${c.id}')"><i class="fas fa-pen"></i> Editar</button>` : ''}
        ${c.estado === 'enviando' || c.estado === 'programada' ? `<button class="btn btn-danger btn-xs" onclick="cancelarCampana('${c.id}')"><i class="fas fa-ban"></i> Cancelar</button>` : ''}
        <button class="btn btn-danger btn-xs" onclick="eliminarCampana('${c.id}')"><i class="fas fa-trash"></i> Eliminar</button>
      </div>
      <div class="camp-stats" style="margin:0 0 14px;">
        ${statCell(st.total, 'Destinatarios')}
        ${statCell(st.enviados, 'Enviados')}
        ${statCell(st.abiertos, 'Aperturas')}
        ${statCell(st.clicks, 'Clicks')}
        ${statCell(st.bajas, 'Bajas')}
        ${statCell(st.errores + st.rebotes, 'Errores')}
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;font-size:12px;color:var(--gray2);">
        <span><b style="color:var(--cyan);">${tcr}%</b> tasa de apertura</span>
        <span><b style="color:var(--cyan);">${ctr}%</b> tasa de clicks</span>
        <span><i class="fas fa-clock"></i> Programada: ${fmtFecha(c.programada_at)}</span>
        <span><i class="fas fa-circle-check"></i> Enviada: ${fmtFecha(c.enviada_at)}</span>
      </div>
      <h3 style="font-size:13px;color:var(--white);margin:0 0 8px;"><i class="fas fa-users"></i> Destinatarios (${(d.destinatarios || []).length})</h3>`;
    const dest = d.destinatarios || [];
    if (!dest.length) {
      html += '<div class="camp-empty"><i class="fas fa-inbox"></i>Sin destinatarios preparados todavía.</div>';
    } else {
      html += `<div class="camp-table-wrap"><table class="camp-table">
        <thead><tr><th>Email</th><th>Nombre</th><th>Empresa</th><th>Estado</th><th>Apertura</th><th>Click</th></tr></thead><tbody>
        ${dest.map(r => `
          <tr><td class="camp-mono">${esc(r.email)}</td><td>${esc(r.nombre || '—')}</td><td>${esc(r.empresa_codigo || '—')}</td>
          <td><span class="status-badge ${r.estado === 'enviado' ? 'st-ok' : r.estado === 'error' ? 'st-error' : r.estado === 'rebotado' ? 'st-pending' : 'st-neutral'}"><span class="action-dot"></span>${esc(r.estado || '—')}</span></td>
          <td>${r.abierto_at ? '<i class="fas fa-eye" style="color:var(--green);"></i> ' : ''}${fmtFecha(r.abierto_at)}</td>
          <td>${r.click_at ? '<i class="fas fa-hand-pointer" style="color:var(--green);"></i> ' : ''}${fmtFecha(r.click_at)}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    const eventos = d.eventos || [];
    if (eventos.length) {
      html += `<h3 style="font-size:13px;color:var(--white);margin:16px 0 8px;"><i class="fas fa-wave-square"></i> Eventos recientes (${eventos.length})</h3>
      <div class="camp-table-wrap"><table class="camp-table">
        <thead><tr><th>Tipo</th><th>Detalle</th><th>Fecha</th></tr></thead><tbody>
        ${eventos.map(e => `<tr><td><span class="status-badge ${e.tipo === 'open' ? 'st-info' : e.tipo === 'click' ? 'st-ok' : 'st-pending'}">${esc(e.tipo)}</span></td><td class="camp-mono" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.url || e.ip || '—')}</td><td>${fmtFecha(e.created_at)}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    document.getElementById('detailBody').innerHTML = html;
  } catch (e) {
    document.getElementById('detailBody').innerHTML = '<div class="camp-empty"><i class="fas fa-exclamation-triangle"></i>' + esc(e.message) + '</div>';
  }
}

function statCell(v, label) {
  return `<div class="camp-stat"><div class="v">${v}</div><div class="l">${label}</div></div>`;
}

function cerrarModal() { document.getElementById('detailModal').classList.remove('active'); }
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'detailModal') cerrarModal();
}, true);

/* ── Lista de campañas ────────────────────────────── */
async function loadCampanas() {
  const host = document.getElementById('campList');
  host.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--gray);"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const d = await api('/admin/campanas');
    campanas = d.campanas || [];
    renderCampanas();
  } catch (e) {
    console.error('[CAMPANAS]', e);
    host.innerHTML = `<div class="camp-empty"><i class="fas fa-exclamation-triangle"></i>Error al cargar: ${esc(e.message)}</div>`;
  }
}

function renderCampanas() {
  const host = document.getElementById('campList');
  if (!campanas.length) {
    host.innerHTML = '<div class="camp-empty"><i class="fas fa-envelope-open-text"></i>No hay campañas todavía.<br><button class="btn btn-acc" style="margin-top:14px;" onclick="nuevaCampana()"><i class="fas fa-plus"></i> Crear la primera</button></div>';
    return;
  }
  host.innerHTML = campanas.map(c => {
    const total = c.total_destinatarios || 0;
    const hecho = (c.enviados || 0) + (c.errores || 0) + (c.rebotes || 0);
    const pct = total ? Math.round(hecho / total * 100) : 0;
    return `
    <div class="camp-card">
      <div class="camp-card-head">
        <div style="min-width:0;">
          <div class="camp-card-title">
            <i class="fas ${ESTADO_ICO[c.estado] || 'fa-file-pen'}"></i> ${esc(c.nombre)}
            <span class="status-badge ${ESTADO_CLS[c.estado] || 'st-neutral'}"><span class="action-dot"></span>${esc(c.estado)}</span>
            ${c.programada_at && !['enviada', 'cancelada'].includes(c.estado) ? `<span class="badge-canal"><i class="fas fa-clock"></i> ${fmtFecha(c.programada_at)}</span>` : ''}
          </div>
          <div class="camp-card-sub"><span class="camp-mono">${esc(c.asunto)}</span> &nbsp;·&nbsp; ${total} destinatarios &nbsp;·&nbsp; creada ${fmtFecha(c.created_at)}</div>
        </div>
        <div class="camp-card-actions">
          <button class="btn btn-ghost btn-xs" onclick="verDetalle('${c.id}')" title="Ver detalle"><i class="fas fa-magnifying-glass-chart"></i></button>
          ${c.estado !== 'enviada' && c.estado !== 'enviando' ? `<button class="btn btn-ghost btn-xs" onclick="editarCampana('${c.id}')" title="Editar"><i class="fas fa-pen"></i></button>` : ''}
          ${c.estado === 'enviando' ? `<button class="btn btn-danger btn-xs" onclick="cancelarCampana('${c.id}')" title="Cancelar envío"><i class="fas fa-ban"></i></button>` : ''}
          <button class="btn btn-danger btn-xs" onclick="eliminarCampana('${c.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      ${total ? `
      <div class="camp-progress"><span style="width:${pct}%"></span></div>
      <div class="camp-stats">
        ${statCell(c.enviados || 0, 'Enviados')}
        ${statCell(c.abiertos || 0, 'Aperturas')}
        ${statCell(c.clicks || 0, 'Clicks')}
        ${statCell(c.bajas || 0, 'Bajas')}
        ${statCell((c.errores || 0) + (c.rebotes || 0), 'Errores')}
      </div>` : ''}
    </div>`;
  }).join('');
}

/* ── Bajas (suppression) ──────────────────────────── */
async function loadBajas() {
  const host = document.getElementById('bajasList');
  host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray);"><i class="fas fa-spinner fa-spin"></i></div>';
  try {
    const d = await api('/admin/campanas/suppression/lista');
    const bajas = d.bajas || [];
    if (!bajas.length) {
      host.innerHTML = '<div class="camp-empty"><i class="fas fa-user-slash"></i>No hay bajas registradas. Los correos que cancelan la suscripción aparecen aquí.</div>';
      return;
    }
    host.innerHTML = `<div class="camp-table-wrap"><table class="camp-table">
      <thead><tr><th>Email</th><th>Motivo</th><th>Fecha</th><th></th></tr></thead><tbody>
      ${bajas.map(b => `<tr>
        <td class="camp-mono">${esc(b.email)}</td>
        <td>${esc(b.motivo || 'unsubscribe')}</td>
        <td>${fmtFecha(b.created_at)}</td>
        <td style="text-align:right;"><button class="btn btn-ghost btn-xs" title="Reactivar (quitar de bajas)" onclick="quitarBaja('${esc(b.email)}')"><i class="fas fa-rotate-left"></i></button></td>
      </tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) {
    host.innerHTML = `<div class="camp-empty"><i class="fas fa-exclamation-triangle"></i>${esc(e.message)}</div>`;
  }
}

async function quitarBaja(email) {
  if (!window.confirm('¿Reactivar este correo para futuras campañas?')) return;
  try {
    await api('/admin/campanas/suppression/' + encodeURIComponent(email), { method: 'DELETE' });
    toast(email + ' reactivado', 'ok');
    loadBajas();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── Init ─────────────────────────────────────────── */
async function cargarTenants() {
  try {
    const res = await fetch(API_BASE + '/admin/cobranza', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      const ops = (data.tenants || []).map(t => `<option value="${esc(t.empresa_codigo)}">`).join('');
      document.getElementById('cTenantList').innerHTML = ops;
    }
  } catch (e) { console.warn('[CAMPANAS] tenants:', e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cDestinoTipo').addEventListener('change', onDestinoTipoChange);
  onDestinoTipoChange();
  const html = document.getElementById('cHtml');
  html.addEventListener('input', () => { if (document.getElementById('sendBar').classList.contains('active')) return; });
  cargarTenants();
  loadCampanas();
  loadBajas();
});