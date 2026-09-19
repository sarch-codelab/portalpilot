/* ── Validación KYC por tenant — pp/validacion_tenant.html ── */
'use strict';

const API_BASE = '/api';
let expedientes = [];  // [{empresa_codigo, empresa_nombre, documentos: [...]}]
let tenantSel = '';

const TIPO_LABEL = {
  rtn: 'RTN', escritura_constitutiva: 'Escritura constitutiva', representante_legal: 'Representante legal',
  permiso_operacion: 'Permiso de operación', matricula_comerciante: 'Matrícula de comerciante',
  contrato: 'Contrato', otro: 'Otro'
};
const DOCS_REQUERIDOS = ['rtn', 'escritura_constitutiva', 'representante_legal'];
const EST_CLS = { pendiente: 'st-warning', aprobado: 'st-ok', rechazado: 'st-error' };

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
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
    const res = await fetch(API_BASE + '/admin/kyc', { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    expedientes = data.expedientes || [];
    renderKpis();
    renderClientes();
    if (tenantSel) renderCliente();
  } catch (err) {
    console.error('[KYC]', err);
    const es404 = String(err.message).includes('404');
    document.getElementById('clientesKyc').innerHTML = `<div class="empty-state" style="padding:30px;"><i class="fas fa-database"></i><p>${es404
      ? 'La tabla <strong>documentos_tenant</strong> aún no existe. Ejecuta supabase/migracion_incidentes_validacion.sql en Supabase.'
      : 'Error al cargar los expedientes.'}</p></div>`;
  }
}

function renderKpis() {
  const validados = expedientes.filter(e => e.documentos.some(d => d.estado === 'aprobado') && DOCS_REQUERIDOS.every(r => e.documentos.some(d => d.tipo === r && d.estado === 'aprobado'))).length;
  const pendientes = expedientes.filter(e => e.documentos.some(d => d.estado === 'pendiente')).length;
  const rechazados = expedientes.reduce((s, e) => s + e.documentos.filter(d => d.estado === 'rechazado').length, 0);
  document.getElementById('kpiValidados').textContent = validados;
  document.getElementById('kpiPendientes').textContent = pendientes;
  document.getElementById('kpiRechazados').textContent = rechazados;
  document.getElementById('kpiClientes').textContent = expedientes.length;
}

function estadoExpediente(e) {
  const docs = e.documentos || [];
  if (!docs.length) return { label: 'Sin iniciar', cls: 'st-neutral' };
  const faltan = DOCS_REQUERIDOS.filter(r => !docs.some(d => d.tipo === r && d.estado === 'aprobado'));
  if (docs.some(d => d.estado === 'rechazado')) return { label: 'Con rechazos', cls: 'st-error' };
  if (docs.some(d => d.estado === 'pendiente')) return { label: 'En revisión', cls: 'st-warning' };
  if (faltan.length) return { label: 'Incompleto (' + faltan.length + ')', cls: 'st-info' };
  return { label: 'Validado', cls: 'st-ok' };
}

function renderClientes() {
  const host = document.getElementById('clientesKyc');
  const q = (document.getElementById('globalSearch')?.value || '').toLowerCase();
  const lista = expedientes.filter(e => !q || ((e.empresa_nombre || '') + ' ' + e.empresa_codigo).toLowerCase().includes(q));
  if (!lista.length) {
    host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray);font-size:13px;"><i class="fas fa-folder-open" style="font-size:26px;display:block;margin-bottom:8px;opacity:.5;"></i>No hay expedientes que coincidan.</div>';
    return;
  }
  host.innerHTML = lista.map(e => {
    const est = estadoExpediente(e);
    const aprobados = e.documentos.filter(d => d.estado === 'aprobado').length;
    return `<div class="alert-item ${tenantSel === e.empresa_codigo ? 'ai-info' : ''}" style="cursor:pointer;${tenantSel === e.empresa_codigo ? 'border-color:var(--accent);' : ''}" onclick="seleccionarTenant('${esc(e.empresa_codigo)}')">
      <div class="alert-item-icon" style="background:rgba(139,92,246,.15);color:var(--accent);"><i class="fas fa-folder"></i></div>
      <div class="alert-item-body">
        <div class="alert-item-title">${esc(e.empresa_nombre || e.empresa_codigo)}</div>
        <div class="alert-item-meta"><span><i class="fas fa-file"></i> ${aprobados}/${e.documentos.length} documentos aprobados</span></div>
      </div>
      <div class="alert-item-side"><span class="status-badge ${est.cls}"><span class="action-dot"></span>${est.label}</span></div>
    </div>`;
  }).join('');
}

function seleccionarTenant(codigo) {
  tenantSel = codigo;
  renderClientes();
  renderCliente();
}

function renderCliente() {
  const host = document.getElementById('kycDetalle');
  const e = expedientes.find(x => x.empresa_codigo === tenantSel);
  document.getElementById('kycTitulo').innerHTML = '<i class="fas fa-folder"></i> ' + (e ? esc(e.empresa_nombre || e.empresa_codigo) : 'Selecciona un cliente');
  if (!e) {
    host.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray);font-size:13px;">Elige un expediente a la izquierda para ver y validar su documentación.</div>';
    return;
  }
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="font-size:12px;color:var(--gray);">${e.documentos.length} documento(s) en el expediente</span>
      <button class="btn btn-acc btn-xs" onclick="openNuevoDoc()"><i class="fas fa-plus"></i> Agregar documento</button>
    </div>
    ${e.documentos.length ? e.documentos.map(d => `
      <div class="alert-item ai-${d.estado === 'aprobado' ? 'success' : d.estado === 'rechazado' ? 'critical' : 'warning'}" style="padding:12px 14px;">
        <div class="alert-item-icon"><i class="fas fa-file-lines"></i></div>
        <div class="alert-item-body">
          <div class="alert-item-title">${esc(TIPO_LABEL[d.tipo] || d.tipo)}${d.numero ? ' <span style="font-weight:400;color:var(--gray);font-size:11px;">· ' + esc(d.numero) + '</span>' : ''}</div>
          <div class="alert-item-meta">
            <span><i class="fas fa-clock"></i> ${fmtFecha(d.created_at)}</span>
            ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener" style="color:var(--cyan);"><i class="fas fa-external-link"></i> Ver archivo</a>` : ''}
            ${d.notas ? '<span>' + esc(d.notas) + '</span>' : ''}
          </div>
        </div>
        <div class="alert-item-side">
          <span class="status-badge ${EST_CLS[d.estado] || 'st-warning'}"><span class="action-dot"></span>${esc(d.estado)}</span>
          <div style="display:flex;gap:6px;">
            ${d.estado !== 'aprobado' ? `<button class="btn btn-ghost btn-xs" title="Aprobar" onclick="cambiarEstadoDoc('${esc(d.id)}','aprobado')"><i class="fas fa-check" style="color:var(--green);"></i></button>` : ''}
            ${d.estado !== 'rechazado' ? `<button class="btn btn-ghost btn-xs" title="Rechazar" onclick="cambiarEstadoDoc('${esc(d.id)}','rechazado')"><i class="fas fa-xmark" style="color:var(--red);"></i></button>` : ''}
            <button class="btn btn-ghost btn-xs" title="Eliminar" onclick="eliminarDoc('${esc(d.id)}')"><i class="fas fa-trash" style="color:var(--red);"></i></button>
          </div>
        </div>
      </div>`).join('') : '<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">Sin documentos todavía. Agrega el RTN y la escritura constitutiva para iniciar.</div>'}`;
}

function openNuevoDoc() {
  const sel = document.getElementById('docTenant');
  sel.innerHTML = expedientes.map(e => `<option value="${esc(e.empresa_codigo)}" ${e.empresa_codigo === tenantSel ? 'selected' : ''}>${esc(e.empresa_nombre || e.empresa_codigo)}</option>`).join('');
  ['docNumero', 'docUrl', 'docNotas'].forEach(id => { document.getElementById(id).value = ''; });
  openModal('docModal');
}

async function guardarDocumento() {
  const payload = {
    empresa_codigo: document.getElementById('docTenant').value,
    tipo: document.getElementById('docTipo').value,
    numero: document.getElementById('docNumero').value.trim(),
    url: document.getElementById('docUrl').value.trim(),
    notas: document.getElementById('docNotas').value.trim()
  };
  if (!payload.empresa_codigo) { toast('Selecciona un cliente', 'err'); return; }
  if (!payload.url) { toast('La URL del documento es requerida', 'err'); return; }
  const btn = document.getElementById('docSaveBtn');
  btn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/admin/kyc', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al guardar el documento');
    toast('Documento agregado', 'ok');
    closeModal('docModal');
    tenantSel = payload.empresa_codigo;
    loadData();
  } catch (err) { toast(err.message, 'err'); }
  finally { btn.disabled = false; }
}

async function cambiarEstadoDoc(id, estado) {
  try {
    const res = await fetch(API_BASE + '/admin/kyc/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ estado })
    });
    if (!res.ok) throw new Error('Error al actualizar el estado');
    toast('Documento ' + estado, 'ok');
    loadData();
  } catch (err) { toast(err.message, 'err'); }
}

function eliminarDoc(id) {
  document.getElementById('confirmMessage').textContent = '¿Eliminar este documento del expediente?';
  document.getElementById('confirmActionBtn').onclick = async () => {
    try {
      const res = await fetch(API_BASE + '/admin/kyc/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error('Error al eliminar');
      toast('Documento eliminado', 'ok');
      closeModal('confirmModal');
      loadData();
    } catch (err) { toast(err.message, 'err'); }
  };
  openModal('confirmModal');
}

function exportCsv() {
  const filas = [['Empresa', 'Codigo', 'Tipo', 'Numero', 'Estado', 'URL', 'Notas', 'Creado']];
  expedientes.forEach(e => e.documentos.forEach(d => {
    filas.push([e.empresa_nombre || e.empresa_codigo, e.empresa_codigo, TIPO_LABEL[d.tipo] || d.tipo, d.numero, d.estado, d.url, d.notas, d.created_at]);
  }));
  if (filas.length <= 1) { toast('No hay datos para exportar', 'warn'); return; }
  const csv = filas.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kyc_documentos_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

document.addEventListener('DOMContentLoaded', loadData);
