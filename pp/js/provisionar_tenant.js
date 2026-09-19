/* ── Wizard de provisionamiento de tenant — pp/provisionar_tenant.html ── */
'use strict';

const API_BASE = '/api';
let paso = 1;
const TOTAL_PASOS = 4;
let planes = [];
let features = [];
let planSel = '';
let tenantCreado = null;

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
  try {
    const res = await fetch(API_BASE + '/admin/planes', { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      planes = data.planes || [];
      features = data.features || [];
    }
  } catch (e) { console.warn('[PROVISIONAR] fallback de planes:', e.message); }
  if (!planes.length) {
    planes = [
      { clave: 'starter', nombre: 'Starter (Prueba)', precio_mensual: 499, descripcion: 'Trial de 15 días con toda la plataforma abierta para evaluar.' },
      { clave: 'business', nombre: 'Business', precio_mensual: 1499, descripcion: 'POS avanzado, IA integrada, multisucursal, hasta 15 usuarios.' },
      { clave: 'enterprise', nombre: 'Enterprise', precio_mensual: 4999, descripcion: 'Acceso completo: bots RPA, multiempresa, IA dedicada, API.' }
    ];
  }
  if (!features.length) {
    features = ['fleet', 'multiempresa', 'ia_avanzada', 'api_keys', 'automation', 'seguridad_avanzada', 'membresias', 'puntos', 'sucursales', 'transferencias', 'web_consulta', 'canal_moderno'];
  }
  renderPlanes();
  renderFeatures();
  goStep(1);
}

function renderPlanes() {
  document.getElementById('planCards').innerHTML = planes.map(p => `
    <div class="pp-plan-card ${planSel === p.clave ? 'sel' : ''}" data-plan="${esc(p.clave)}" onclick="selPlan('${esc(p.clave)}')">
      <div class="pl-name">${esc(p.nombre || p.clave)}</div>
      <div class="pl-price">L ${Number(p.precio_mensual || 0).toLocaleString('es-HN')}<small> /mes</small></div>
      <div class="pl-desc">${esc(p.descripcion || '')}</div>
    </div>`).join('');
}

function selPlan(clave) {
  planSel = clave;
  document.querySelectorAll('.pp-plan-card').forEach(c => c.classList.toggle('sel', c.dataset.plan === clave));
}

function renderFeatures() {
  document.getElementById('featuresGrid').innerHTML = features.map(f => `
    <label class="pp-check">
      <input type="checkbox" class="feat-chk" value="${esc(f)}">
      <span style="text-transform:capitalize;">${esc(f.replace(/_/g, ' '))}</span>
    </label>`).join('');
  document.querySelectorAll('.feat-chk').forEach(chk => {
    chk.addEventListener('change', () => chk.closest('.pp-check').classList.toggle('on', chk.checked));
  });
}

function addApikeyRow() {
  const wrap = document.getElementById('apikeysWrap');
  const row = document.createElement('div');
  row.className = 'form-row apikey-row';
  row.innerHTML = '<div class="form-group"><input type="text" class="apikey-nombre" placeholder="Nombre de la clave..."></div>' +
    '<div class="form-group" style="display:flex;align-items:center;"><button class="btn btn-ghost btn-sm" onclick="removeApikeyRow(this)"><i class="fas fa-trash"></i></button></div>';
  wrap.appendChild(row);
}
function removeApikeyRow(btn) {
  const rows = document.querySelectorAll('.apikey-row');
  if (rows.length <= 1) { toast('Debe quedar al menos una fila (déjala vacía si no se usa)', 'warn'); return; }
  btn.closest('.apikey-row').remove();
}

function goStep(n) {
  paso = n;
  for (let i = 1; i <= TOTAL_PASOS; i++) {
    document.getElementById('pane' + i).style.display = i === n ? 'block' : 'none';
    const stepEl = document.querySelector('.pp-step[data-step="' + i + '"]');
    stepEl.classList.toggle('active', i === n);
    stepEl.classList.toggle('done', i < n);
  }
  document.getElementById('btnPrev').style.visibility = n === 1 ? 'hidden' : 'visible';
  const btnNext = document.getElementById('btnNext');
  btnNext.style.display = 'block';
  if (n === TOTAL_PASOS - 1) btnNext.innerHTML = 'Provisionar cliente <i class="fas fa-rocket"></i>';
  else if (n === TOTAL_PASOS) { btnNext.style.display = 'none'; renderResumen(); }
  else btnNext.innerHTML = 'Siguiente <i class="fas fa-arrow-right"></i>';
}

function nextStep() {
  // Validar antes de salir del paso 3 (dispara la creación del tenant)
  if (paso === TOTAL_PASOS - 1) {
    if (!(validarPaso(1) && validarPaso(2) && validarPaso(3))) return;
    renderResumen();
    crearTenant();
    return;
  }
  if (paso === 2 && !validarPaso(2)) return;
  if (paso < TOTAL_PASOS) goStep(paso + 1);
}
function prevStep() { if (paso > 1) goStep(paso - 1); }

function validarPaso(n) {
  if (n === 1) {
    if (!document.getElementById('fNombre').value.trim()) { toast('El nombre de la empresa es requerido', 'err'); return false; }
  }
  if (n === 2) {
    if (!planSel) { toast('Selecciona el plan contratado', 'err'); return false; }
  }
  if (n === 3) {
    const email = document.getElementById('fEmailAdmin').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Ingresa un email válido para el administrador', 'err'); return false; }
  }
  return true;
}

function renderResumen() {
  const feats = [...document.querySelectorAll('.feat-chk:checked')].map(c => c.value);
  const keys = [...document.querySelectorAll('.apikey-nombre')].map(i => i.value.trim()).filter(Boolean);
  const items = [
    ['Empresa', document.getElementById('fNombre').value || '—'],
    ['Dominio', document.getElementById('fDominio').value || '(auto)'],
    ['País / Zona', document.getElementById('fPais').value + ' · ' + document.getElementById('fZona').value],
    ['Plan', (planes.find(p => p.clave === planSel) || {}).nombre || planSel],
    ['Features extra', feats.length ? feats.join(', ') : '(solo las del plan)'],
    ['Admin inicial', document.getElementById('fEmailAdmin').value || '—'],
    ['API keys', keys.length ? keys.join(', ') : '(ninguna)'],
    ['Notas', document.getElementById('fNotas').value || '—']
  ];
  document.getElementById('resumenWizard').innerHTML = items.map(([k, v]) =>
    `<div class="pp-summary-item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
}

async function crearTenant() {
  if (!validarPaso(1) || !validarPaso(2) || !validarPaso(3)) return;
  const btn = document.getElementById('btnNext');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Provisionando…';
  const featuresSel = [...document.querySelectorAll('.feat-chk:checked')].map(c => c.value);
  const apikeys = [...document.querySelectorAll('.apikey-nombre')].map(i => i.value.trim()).filter(Boolean);
  try {
    const res = await fetch(API_BASE + '/admin/provisionar', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({
        nombre: document.getElementById('fNombre').value.trim(),
        dominio: document.getElementById('fDominio').value.trim(),
        pais: document.getElementById('fPais').value,
        zonaHoraria: document.getElementById('fZona').value,
        notas: document.getElementById('fNotas').value.trim(),
        plan: planSel,
        features: featuresSel,
        emailAdmin: document.getElementById('fEmailAdmin').value.trim(),
        nombreAdmin: document.getElementById('fNombreAdmin').value.trim(),
        apikeys
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al provisionar el cliente');
    tenantCreado = data;
    document.getElementById('wizardNav').style.display = 'none';
    document.getElementById('resultadoCreacion').style.display = 'block';
    document.getElementById('codigoCreado').textContent = data.tenant?.codigo || '—';
    const extras = [];
    if (data.apikeys && data.apikeys.length) extras.push('API keys generadas: ' + data.apikeys.map(k => k.nombre).join(', '));
    if (data.tenant?.link_primer_acceso) extras.push('Enlace de activación enviado a ' + data.tenant.email_admin);
    document.getElementById('resultadoExtra').textContent = extras.join(' · ');
    toast('Cliente provisionado correctamente', 'ok');
  } catch (err) {
    toast(err.message, 'err');
    goStep(3);
  } finally {
    btn.disabled = false;
  }
}

function reiniciarWizard() {
  ['fNombre', 'fDominio', 'fNotas', 'fEmailAdmin', 'fNombreAdmin'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.querySelectorAll('.feat-chk').forEach(c => { c.checked = false; c.closest('.pp-check').classList.remove('on'); });
  planSel = '';
  renderPlanes();
  document.getElementById('wizardNav').style.display = 'flex';
  document.getElementById('resultadoCreacion').style.display = 'none';
  goStep(1);
}

// El botón final del wizard usa nextStep() (valida y crea); no se necesita
// un listener adicional para evitar doble ejecución.
document.addEventListener('DOMContentLoaded', init);
