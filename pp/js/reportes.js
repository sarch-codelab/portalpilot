/* ── Centro de reportes — pp/reportes.html ── */
'use strict';

const API_BASE = '/api';
let tenants = [];
let reporteActual = null; // { titulo, generado, secciones: [{id, titulo, filas: [[...]]}] }

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function toast(msg, tipo) {
  let host = document.getElementById('ppToast');
  if (!host) { host = document.createElement('div'); host.id = 'ppToast'; document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'pp-toast ' + (tipo || '');
  t.innerHTML = '<i class="fas ' + (tipo === 'ok' ? 'fa-check-circle' : 'fa-exclamation-circle') + '"></i><span>' + esc(msg) + '</span>';
  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

async function init() {
  // Fechas por defecto: último mes
  const hoy = new Date();
  const hace30 = new Date(hoy.getTime() - 30 * 86400000);
  document.getElementById('rDesde').value = hace30.toISOString().slice(0, 10);
  document.getElementById('rHasta').value = hoy.toISOString().slice(0, 10);

  document.getElementById('rAlcance').addEventListener('change', function () {
    document.getElementById('wrapTenant').style.display = this.value === 'tenant' ? 'block' : 'none';
  });
  document.querySelectorAll('.r-seccion').forEach(chk => {
    chk.addEventListener('change', () => chk.closest('.pp-check').classList.toggle('on', chk.checked));
  });

  try {
    const res = await fetch(API_BASE + '/admin/cobranza', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      tenants = (data.tenants || []).map(t => ({ codigo: t.empresa_codigo, nombre: t.empresa_nombre || t.empresa_codigo }));
    }
  } catch (e) { console.warn('[REPORTES] tenants:', e.message); }
  document.getElementById('rTenant').innerHTML = tenants.length
    ? tenants.map(t => `<option value="${esc(t.codigo)}">${esc(t.nombre)}</option>`).join('')
    : '<option value="">Sin clientes registrados</option>';
}

async function generarReporte() {
  const secciones = [...document.querySelectorAll('.r-seccion:checked')].map(c => c.value);
  if (!secciones.length) { toast('Selecciona al menos una sección', 'err'); return; }
  const payload = {
    alcance: document.getElementById('rAlcance').value,
    tenant: document.getElementById('rAlcance').value === 'tenant' ? document.getElementById('rTenant').value : null,
    desde: document.getElementById('rDesde').value,
    hasta: document.getElementById('rHasta').value,
    secciones
  };
  const btn = document.querySelector('button[onclick="generarReporte()"]');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando…';
  try {
    const res = await fetch(API_BASE + '/admin/reporte', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al generar el reporte');
    reporteActual = data;
    renderPreview();
    document.getElementById('btnCsv').style.display = 'inline-flex';
    document.getElementById('btnPdf').style.display = 'inline-flex';
    toast('Reporte generado', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-arrow-down"></i> Generar reporte';
  }
}

function renderPreview() {
  const r = reporteActual;
  if (!r) return;
  const host = document.getElementById('reportePreview');
  host.innerHTML = `
    <div style="text-align:center;margin-bottom:18px;">
      <div style="font-family:'Syne';font-weight:800;font-size:17px;color:var(--white);">${esc(r.titulo)}</div>
      <div style="font-size:11px;color:var(--gray);margin-top:4px;">${esc(r.alcance_txt || '')} · Generado ${esc(r.generado)}</div>
    </div>
    ${r.secciones.map(sec => `
      <div style="margin-bottom:22px;">
        <div style="font-size:12px;font-weight:700;color:var(--accent);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">${esc(sec.titulo)}</div>
        ${sec.filas && sec.filas.length ? `<div style="overflow-x:auto;">
          <table class="audit-table pp-table-compact" style="font-size:11px;">
            <thead><tr>${(sec.filas[0] || []).map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${sec.filas.slice(1).map(fila => `<tr>${fila.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>` : '<div style="font-size:12px;color:var(--gray);">Sin datos en el periodo seleccionado.</div>'}
      </div>`).join('')}`;
}

function descargarCsv() {
  const r = reporteActual;
  if (!r) return;
  const partes = [];
  partes.push([r.titulo]);
  partes.push([r.alcance_txt || '', 'Generado: ' + r.generado]);
  partes.push([]);
  r.secciones.forEach(sec => {
    partes.push([sec.titulo]);
    (sec.filas || []).forEach(f => partes.push(f));
    partes.push([]);
  });
  const csv = partes.map(f => f.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `reporte_${(r.alcance || 'global')}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

function descargarPdf() {
  const r = reporteActual;
  if (!r) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Permite las ventanas emergentes para exportar a PDF', 'warn'); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(r.titulo)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;padding:32px;}
      h1{font-size:20px;margin:0 0 4px;}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#7c3aed;margin:26px 0 8px;}
      .meta{font-size:11px;color:#64748b;margin-bottom:20px;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;}
      th{background:#f1f5f9;text-align:left;padding:7px 9px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;}
      td{padding:6px 9px;border:1px solid #e2e8f0;}
      tr:nth-child(even) td{background:#f8fafc;}
    </style></head><body>
    <h1>${esc(r.titulo)}</h1>
    <div class="meta">${esc(r.alcance_txt || '')} · Generado ${esc(r.generado)}</div>
    ${r.secciones.map(sec => `<h2>${esc(sec.titulo)}</h2>` + ((sec.filas && sec.filas.length)
    ? `<table><thead><tr>${sec.filas[0].map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${sec.filas.slice(1).map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '<div style="font-size:11px;color:#64748b;">Sin datos.</div>')).join('')}
    </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

document.addEventListener('DOMContentLoaded', init);
