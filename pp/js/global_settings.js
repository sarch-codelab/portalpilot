// Conexion real de pp/global_settings.html con el backend (/api/global/*)
var GS_FLAG_IDS = {
  'FLAG_BETA': 'flag-beta',
  'FLAG_2FA_ADMINS': 'flag-2fa-admins',
  'FLAG_DASH_ANALYTICS': 'flag-dash-analytics',
  'FLAG_MULTIREGION': 'flag-multiregion',
  'FLAG_AUTOSCALING_BOTS': 'flag-autoscaling-bots'
};
var GS_FLAG_DESC = {
  'FLAG_BETA': 'Modo Beta para nuevos features',
  'FLAG_2FA_ADMINS': 'Requiere 2FA para todos los admins',
  'FLAG_DASH_ANALYTICS': 'Analytics detallados en dashboard',
  'FLAG_MULTIREGION': 'Multi-region (CDN global)',
  'FLAG_AUTOSCALING_BOTS': 'Auto-scaling de bots RPA'
};
var GS_DEFAULTS = {
  'FLAG_BETA': 'true',
  'FLAG_2FA_ADMINS': 'true',
  'FLAG_DASH_ANALYTICS': 'false',
  'FLAG_MULTIREGION': 'false',
  'FLAG_AUTOSCALING_BOTS': 'true'
};
var GS_ADMINS = [];
var GS_CONFIG = {};

function gsEsc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function gsTiempoDesde(iso) {
  if (!iso) return 'Nunca';
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var dif = Date.now() - d.getTime();
  if (dif < 60000) return 'ahora';
  if (dif < 3600000) return 'hace ' + Math.max(1, Math.floor(dif / 60000)) + ' min';
  if (dif < 86400000) return 'hace ' + Math.floor(dif / 3600000) + ' h';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}
function gsApi(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers || {}, { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') });
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(url, opts).then(function (resp) {
    return resp.json().then(function (data) {
      return { ok: resp.ok, status: resp.status, json: data };
    }).catch(function () { return { ok: resp.ok, status: resp.status, json: null }; });
  });
}

function setBannerStatusUI() {
  var el = document.getElementById('bannerActive');
  if (!el) return;
  var status = document.getElementById('bannerStatus');
  if (!status) return;
  var active = el.checked;
  status.textContent = active ? 'Activo' : 'Inactivo';
  status.className = 'settings-card-badge ' + (active ? 'live' : 'warning');
}

function aplicarFlagsDesdeConfig() {
  Object.keys(GS_FLAG_IDS).forEach(function (clave) {
    var el = document.getElementById(GS_FLAG_IDS[clave]);
    if (!el) return;
    var cfg = GS_CONFIG[clave];
    if (cfg && (cfg.valor === 'true' || cfg.valor === 'false')) {
      el.checked = String(cfg.valor).toLowerCase() === 'true';
    }
  });
}

function aplicarBannerDesdeConfig() {
  var h = function (k) { return GS_CONFIG[k] ? GS_CONFIG[k].valor : ''; };
  var activeEl = document.getElementById('bannerActive');
  if (activeEl) activeEl.checked = h('BANNER_ACTIVE') === 'true';
  var tipo = document.getElementById('bannerType');
  if (tipo) {
    var tv = h('BANNER_TYPE');
    if (['info', 'warning', 'danger'].indexOf(tv) !== -1) tipo.value = tv;
  }
  var msg = document.getElementById('bannerMessage');
  if (msg) msg.value = h('BANNER_MESSAGE');
  var st = document.getElementById('bannerStart');
  if (st) st.value = h('BANNER_START');
  var fin = document.getElementById('bannerEnd');
  if (fin) fin.value = h('BANNER_END');
  setBannerStatusUI();
  if (typeof updateBannerPreview === 'function') updateBannerPreview();
}

function cargarUltimosCambios(configs) {
  var box = document.getElementById('ultimosCambios');
  if (!box) return;
  var list = (configs || []).slice().sort(function (a, b) {
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  }).slice(0, 8);
  if (!list.length) {
    box.innerHTML = '<div style="color:var(--gray);font-size:12px">No hay cambios registrados todav&iacute;a.</div>';
    return;
  }
  box.innerHTML = list.map(function (c) {
    return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
      '<span style="color:var(--text)">' + gsEsc(c.clave) + '</span><span style="color:var(--gray)">' + gsTiempoDesde(c.updated_at) + '</span></div>';
  }).join('');
}

function renderAdmins() {
  var list = document.getElementById('adminsList');
  if (!list) return;
  list.innerHTML = '';
  if (!GS_ADMINS.length) {
    list.innerHTML = '<div style="color:var(--gray);font-size:12px;padding:20px 0">No hay administradores globales registrados.</div>';
    return;
  }
  GS_ADMINS.forEach(function (a) {
    var initials = gsEsc(String(a.nombre || '-').split(' ').filter(Boolean).map(function (n) { return n[0]; }).slice(0, 2).join('')).toUpperCase();
    var role = String(a.rol || 'admin'); role = role.charAt(0).toUpperCase() + role.slice(1);
    var item = document.createElement('div'); item.className = 'admin-item';
    var last = a.ultimo_acceso ? gsTiempoDesde(a.ultimo_acceso) : 'Nunca';
    var statusColor = a.activo ? 'var(--green)' : 'var(--gray)';
    var statusText = a.activo ? 'Activo' : 'Inactivo';
    item.innerHTML = '<div class="admin-avatar">' + initials + '</div>' +
      '<div class="admin-info"><div class="admin-name">' + gsEsc(a.nombre || 'Sin nombre') + '</div><div class="admin-email">' + gsEsc(a.email || '') + '</div><span class="admin-role">' + gsEsc(role) + '</span></div>' +
      '<div class="admin-meta"><span><i class="fas fa-clock"></i> ' + gsEsc(last) + '</span><span style="color:' + statusColor + '"><i class="fas fa-circle" style="font-size:6px"></i> ' + statusText + '</span></div>' +
      '<div class="admin-actions"><button class="action-icon-btn" title="Editar" onclick="editAdmin(\'' + gsEsc(a.id) + '\')"><i class="fas fa-edit"></i></button><button class="action-icon-btn danger" title="Eliminar" onclick="confirmDeleteAdmin(\'' + gsEsc(a.id) + '\', \'' + gsEsc(a.nombre || '') + '\')"><i class="fas fa-user-minus"></i></button></div>';
    list.appendChild(item);
  });
}

function guardarCambiosConfigs(configs, okMsg) {
  return gsApi('/api/global/config', { method: 'PUT', body: { configuraciones: configs } }).then(function (r) {
    if (r.ok) {
      showToast(okMsg || 'Configuracion guardada', 'success');
      return loadGlobalSettings();
    }
    showToast((r.json && r.json.error) || 'No se pudo guardar la configuracion', 'error');
    throw new Error('config_save_failed');
  });
}

function persistirBanner() {
  var configs = [
    { clave: 'BANNER_ACTIVE', valor: String(document.getElementById('bannerActive') ? document.getElementById('bannerActive').checked : false) },
    { clave: 'BANNER_TYPE', valor: document.getElementById('bannerType') ? document.getElementById('bannerType').value : 'info' },
    { clave: 'BANNER_MESSAGE', valor: document.getElementById('bannerMessage') ? document.getElementById('bannerMessage').value : '' },
    { clave: 'BANNER_START', valor: document.getElementById('bannerStart') ? document.getElementById('bannerStart').value : '' },
    { clave: 'BANNER_END', valor: document.getElementById('bannerEnd') ? document.getElementById('bannerEnd').value : '' }
  ];
  return guardarCambiosConfigs(configs, 'Banner guardado globalmente');
}

function bannerKeysActuales() {
  return {
    BANNER_ACTIVE: String(document.getElementById('bannerActive') ? document.getElementById('bannerActive').checked : false),
    BANNER_TYPE: document.getElementById('bannerType') ? document.getElementById('bannerType').value : 'info',
    BANNER_MESSAGE: document.getElementById('bannerMessage') ? document.getElementById('bannerMessage').value : '',
    BANNER_START: document.getElementById('bannerStart') ? document.getElementById('bannerStart').value : '',
    BANNER_END: document.getElementById('bannerEnd') ? document.getElementById('bannerEnd').value : ''
  };
}

function flagsConfigsActuales() {
  return Object.keys(GS_FLAG_IDS).map(function (clave) {
    var el = document.getElementById(GS_FLAG_IDS[clave]);
    return { clave: clave, valor: String(!!(el && el.checked)), descripcion: GS_FLAG_DESC[clave] };
  });
}

// ===== OVERRIDES =====
function toggleBanner() {
  setBannerStatusUI();
  persistirBanner();
}
function previewBanner() {
  updateBannerPreview();
  if (document.getElementById('bannerMessage') && document.getElementById('bannerMessage').value) showToast('Vista previa actualizada', 'info');
}
function publishBanner() {
  var msg = document.getElementById('bannerMessage') ? document.getElementById('bannerMessage').value : '';
  if (!msg.trim()) { showToast('Ingresa un mensaje para publicar', 'warning'); return; }
  var active = document.getElementById('bannerActive');
  if (active) { active.checked = true; setBannerStatusUI(); }
  persistirBanner().then(function () { showToast('Banner publicado globalmente', 'success'); }).catch(function () {});
}

function saveFlags() {
  guardarCambiosConfigs(flagsConfigsActuales(), 'Feature flags guardados');
}
function resetFlags() {
  if (!window.confirm('Resetear todos los feature flags a valores por defecto?')) return;
  var configs = Object.keys(GS_DEFAULTS).map(function (clave) {
    return { clave: clave, valor: GS_DEFAULTS[clave], descripcion: GS_FLAG_DESC[clave] };
  });
  guardarCambiosConfigs(configs, 'Flags reseteados a valores por defecto');
}
function saveAllSettings() {
  var keys = bannerKeysActuales();
  var configs = Object.keys(GS_FLAG_IDS).map(function (clave) {
    return { clave: clave, valor: String(!!(document.getElementById(GS_FLAG_IDS[clave]) && document.getElementById(GS_FLAG_IDS[clave]).checked)), descripcion: GS_FLAG_DESC[clave] };
  });
  Object.keys(keys).forEach(function (k) { configs.push({ clave: k, valor: keys[k] }); });
  guardarCambiosConfigs(configs, 'Toda la configuracion guardada').then(function () {
    var btn = document.getElementById('saveAllBtn');
    if (btn) btn.style.display = 'none';
  });
}

function createAdmin() {
  var form = document.getElementById('addAdminForm');
  if (!form) return;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  var email = document.getElementById('adminEmail') ? document.getElementById('adminEmail').value.trim() : '';
  var nombre = document.getElementById('adminName') ? document.getElementById('adminName').value.trim() : '';
  var btn = form.closest('.modal') ? form.closest('.modal').querySelector('.btn-acc') : null;
  var orig = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...'; btn.disabled = true; }
  gsApi('/api/global/admins', { method: 'POST', body: { email: email, nombre: nombre } }).then(function (r) {
    if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    if (r.ok && r.status < 300) {
      closeModal('addAdminModal');
      form.reset();
      showToast('Administrador agregado: ' + email, 'success');
      loadGlobalSettings();
    } else {
      showToast((r.json && r.json.error) || 'No se pudo agregar el administrador', 'error');
    }
  }).catch(function () { if (btn) { btn.innerHTML = orig; btn.disabled = false; } });
}

function confirmDeleteAdmin(id, name) {
  var box = document.getElementById('confirmMessage');
  if (box) box.textContent = 'Remover el acceso de administrador de "' + name + '"? No podra acceder a este panel hasta ser promovido de nuevo.';
  var btn = document.getElementById('confirmBtn');
  var dlg = document.getElementById('confirmDialog');
  if (btn) {
    btn.onclick = function () {
      gsApi('/api/global/admins/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
        if (dlg) dlg.classList.remove('active');
        if (r.ok) {
          showToast('"' + name + '" removido del panel global', 'success');
          loadGlobalSettings();
        } else {
          showToast((r.json && r.json.error) || 'No se pudo eliminar', 'error');
        }
      });
    };
  }
  if (dlg) dlg.classList.add('active');
}

function exportSettings() {
  var payload = { configuraciones: Object.keys(GS_CONFIG).map(function (k) { return GS_CONFIG[k]; }), admins: GS_ADMINS, exportado: new Date().toISOString() };
  gsDescargarJSON('portalpilot_config_' + new Date().toISOString().slice(0, 10) + '.json', payload);
  showToast('Configuracion exportada', 'success');
}
function backupSettings() {
  var payload = { configuraciones: Object.keys(GS_CONFIG).map(function (k) { return GS_CONFIG[k]; }), admins: GS_ADMINS, backup: new Date().toISOString() };
  gsDescargarJSON('backup_portalpilot_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json', payload);
  showToast('Backup de configuracion creado', 'success');
}
function gsDescargarJSON(nombre, datos) {
  var blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}

function viewAuditLog() {
  window.location.href = 'auditoria.html';
}

// ===== ENV VARIABLES (Almacenadas en configuraciones_globales con prefijo ENV_) =====
var GS_ENV_PREFIX = 'ENV_';
function gsEnvData(entry) {
  if (!entry) return null;
  var clave = String(entry.clave || '');
  if (clave.indexOf(GS_ENV_PREFIX) !== 0) return null;
  return { key: clave.slice(GS_ENV_PREFIX.length), valor: entry.valor, env: entry.entorno || 'production', sensitive: !!entry.sensible, descripcion: entry.descripcion };
}
function renderEnvVars() {
  var tbody = document.getElementById('envTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  var list = Object.keys(GS_CONFIG).map(function (k) { return GS_CONFIG[k]; }).map(gsEnvData).filter(Boolean);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--gray);text-align:center;padding:24px">No hay variables de entorno guardadas. Crea la primera.</td></tr>';
    return;
  }
  list.forEach(function (v) {
    var row = document.createElement('tr');
    var masked = v.sensitive ? 'masked' : '';
    var onclickAttr = v.sensitive ? "this.classList.toggle('masked')" : '';
    var envLabel = String(v.env).charAt(0).toUpperCase() + String(v.env).slice(1);
    row.innerHTML = '<td><span class="env-key">' + gsEsc(v.key) + '</span></td>' +
      '<td><span class="env-value ' + masked + '" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;" onclick="' + onclickAttr + '">' + gsEsc(v.valor) + '</span></td>' +
      '<td><span style="padding:2px 8px;border-radius:4px;background:rgba(139,92,246,0.15);color:var(--cyan);font-size:11px;font-weight:600">' + gsEsc(envLabel) + '</span></td>' +
      '<td class="env-actions"><button class="env-btn" title="Editar" onclick="editEnvVar(\'' + gsEsc(v.key) + '\')"><i class="fas fa-edit"></i></button><button class="env-btn danger" title="Eliminar" onclick="confirmDeleteEnv(\'' + gsEsc(v.key) + '\')"><i class="fas fa-trash"></i></button></td>';
    tbody.appendChild(row);
  });
}
function gsEnvModal(key) {
  var modal = document.createElement('div'); modal.className = 'modal-overlay active';
  var prev = key ? GS_CONFIG[GS_ENV_PREFIX + key] : null;
  modal.innerHTML = '<div class="modal" style="max-width:440px;">' +
    '<div class="modal-header"><div class="modal-title"><i class="fas fa-key" style="margin-right:8px;color:var(--accent);"></i>' + (key ? 'Editar variable' : 'Nueva variable') + '</div>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()"><i class="fas fa-times"></i></button></div>' +
    '<div class="modal-body">' +
    '<div class="form-group"><label class="form-label">Nombre de la variable</label><input type="text" class="form-input" id="gsEnvKey" placeholder="API_KEY" value="' + gsEsc(key || '') + '" ' + (key ? 'readonly' : 'required') + '></div>' +
    '<div class="form-group"><label class="form-label">Valor</label><input type="text" class="form-input" id="gsEnvValue" placeholder="valor" value="' + gsEsc(prev ? prev.valor : '') + '"></div>' +
    '<div class="form-row">' +
    '<div class="form-group"><label class="form-label">Entorno</label><select class="form-select" id="gsEnvEntorno"><option value="production" ' + ((!prev || prev.entorno === 'production') ? 'selected' : '') + '>Production</option><option value="development" ' + (prev && prev.entorno === 'development' ? 'selected' : '') + '>Development</option><option value="test" ' + (prev && prev.entorno === 'test' ? 'selected' : '') + '>Test</option></select></div>' +
    '<div class="form-group"><label class="form-label">Sensible</label><select class="form-select" id="gsEnvSensible"><option value="false" ' + (!prev || !prev.sensible ? 'selected' : '') + '>No</option><option value="true" ' + (prev && prev.sensible ? 'selected' : '') + '>Sí (enmascarar)</option></select></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Descripción (opcional)</label><input type="text" class="form-input" id="gsEnvDesc" value="' + gsEsc(prev ? prev.descripcion : '') + '"></div>' +
    '</div>' +
    '<div class="modal-footer"><button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Cancelar</button><button class="btn btn-acc" id="gsEnvSaveBtn"><i class="fas fa-save"></i> Guardar variable</button></div>' +
    '</div>';
  document.body.appendChild(modal);
  return modal;
}
function addEnvVar() {
  var modal = gsEnvModal(null);
  modal.querySelector('#gsEnvSaveBtn').addEventListener('click', function () {
    var k = String(modal.querySelector('#gsEnvKey').value || '').trim().toUpperCase();
    var rawKey = k.replace(/[^A-Za-z0-9_]/g, '_');
    if (!rawKey) { showToast('Ingresa un nombre de variable valido', 'warning'); return; }
    var configs = [{
      clave: GS_ENV_PREFIX + rawKey,
      valor: modal.querySelector('#gsEnvValue').value,
      entorno: modal.querySelector('#gsEnvEntorno').value,
      sensible: modal.querySelector('#gsEnvSensible').value === 'true',
      descripcion: (modal.querySelector('#gsEnvDesc').value || 'Variable de entorno').trim() || 'Variable de entorno'
    }];
    var btn = modal.querySelector('#gsEnvSaveBtn'), orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; btn.disabled = true;
    gsApi('/api/global/config', { method: 'PUT', body: { configuraciones: configs } }).then(function (r) {
      btn.innerHTML = orig; btn.disabled = false;
      if (r.ok) {
        modal.remove();
        showToast('Variable ' + rawKey + ' guardada', 'success');
        loadGlobalSettings();
      } else {
        showToast((r.json && r.json.error) || 'No se pudo guardar la variable', 'error');
      }
    }).catch(function () { btn.innerHTML = orig; btn.disabled = false; });
  });
}
function editEnvVar(key) {
  var modal = gsEnvModal(key);
  modal.querySelector('#gsEnvSaveBtn').addEventListener('click', function () {
    var configs = [{
      clave: GS_ENV_PREFIX + key,
      valor: modal.querySelector('#gsEnvValue').value,
      entorno: modal.querySelector('#gsEnvEntorno').value,
      sensible: modal.querySelector('#gsEnvSensible').value === 'true',
      descripcion: (modal.querySelector('#gsEnvDesc').value || 'Variable de entorno').trim() || 'Variable de entorno'
    }];
    var btn = modal.querySelector('#gsEnvSaveBtn'), orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; btn.disabled = true;
    gsApi('/api/global/config', { method: 'PUT', body: { configuraciones: configs } }).then(function (r) {
      btn.innerHTML = orig; btn.disabled = false;
      if (r.ok) {
        modal.remove();
        showToast('Variable ' + key + ' actualizada', 'success');
        loadGlobalSettings();
      } else {
        showToast((r.json && r.json.error) || 'No se pudo guardar la variable', 'error');
      }
    }).catch(function () { btn.innerHTML = orig; btn.disabled = false; });
  });
}
function confirmDeleteEnv(key) {
  var box = document.getElementById('confirmMessage');
  if (box) box.textContent = 'Eliminar la variable de entorno "' + key + '"? Esta accion puede afectar el funcionamiento de la plataforma.';
  var dlg = document.getElementById('confirmDialog');
  var btn = document.getElementById('confirmBtn');
  if (btn) {
    btn.onclick = function () {
      gsApi('/api/global/config/' + encodeURIComponent(GS_ENV_PREFIX + key), { method: 'DELETE' }).then(function (r) {
        if (dlg) dlg.classList.remove('active');
        if (r.ok) {
          showToast('"' + key + '" eliminada', 'success');
          loadGlobalSettings();
        } else {
          showToast((r.json && r.json.error) || 'No se pudo eliminar la variable', 'error');
        }
      });
    };
  }
  if (dlg) dlg.classList.add('active');
}
function syncEnvVars() {
  showToast('Sincronizando variables...', 'info');
  loadGlobalSettings();
}

function editAdmin(id) {
  var admin = null;
  GS_ADMINS.forEach(function (a) { if (String(a.id) === String(id)) admin = a; });
  if (!admin) { showToast('Administrador no encontrado', 'warning'); return; }
  var modal = document.createElement('div'); modal.className = 'modal-overlay active';
  modal.innerHTML = '<div class="modal" style="max-width:440px;">' +
    '<div class="modal-header"><div class="modal-title"><i class="fas fa-user-edit" style="margin-right:8px;color:var(--accent);"></i>Editar administrador</div>' +
    '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove()"><i class="fas fa-times"></i></button></div>' +
    '<div class="modal-body">' +
    '<div class="form-group"><label class="form-label">Nombre</label><input type="text" class="form-input" id="gsAdminName" value="' + gsEsc(admin.nombre || '') + '"></div>' +
    '<div class="form-group"><label class="form-label">Email</label><input type="email" class="form-input" value="' + gsEsc(admin.email || '') + '" readonly></div>' +
    '<div class="form-group"><label class="form-label">Rol global</label><input type="text" class="form-input" value="' + gsEsc(String(admin.rol || 'root')) + '" readonly></div>' +
    '</div>' +
    '<div class="modal-footer"><button class="btn btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()">Cancelar</button><button class="btn btn-acc" id="gsAdminSaveBtn"><i class="fas fa-save"></i> Guardar cambios</button></div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });
  modal.querySelector('#gsAdminSaveBtn').addEventListener('click', function () {
    var nombre = modal.querySelector('#gsAdminName').value;
    var btn = modal.querySelector('#gsAdminSaveBtn'), orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; btn.disabled = true;
    gsApi('/api/users/' + encodeURIComponent(admin.id), { method: 'PUT', body: { nombre: nombre } }).then(function (r) {
      btn.innerHTML = orig; btn.disabled = false;
      if (r.ok) {
        modal.remove();
        showToast('Administrador actualizado', 'success');
        loadGlobalSettings();
      } else {
        showToast((r.json && r.json.error) || 'No se pudo guardar los cambios', 'error');
      }
    }).catch(function () { btn.innerHTML = orig; btn.disabled = false; });
  });
}

function loadGlobalSettings() {
  gsApi('/api/global/config').then(function (r) {
    if (r.ok && r.json && Array.isArray(r.json.configuraciones)) {
      var mapa = {};
      r.json.configuraciones.forEach(function (c) { mapa[c.clave] = c; });
      GS_CONFIG = mapa;
      aplicarFlagsDesdeConfig();
      aplicarBannerDesdeConfig();
      cargarUltimosCambios(r.json.configuraciones);
      renderEnvVars();
    } else {
      var box = document.getElementById('ultimosCambios');
      if (box) box.innerHTML = '<div style="color:var(--gray);font-size:12px">No se pudo cargar la configuracion global.</div>';
    }
  }).catch(function () {});
  gsApi('/api/global/admins').then(function (r) {
    if (r.ok && r.json && Array.isArray(r.json.admins)) {
      GS_ADMINS = r.json.admins;
      renderAdmins();
    }
  }).catch(function () {});
}

function gsInit() { loadGlobalSettings(); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', gsInit);
} else {
  gsInit();
}
window.addEventListener('load', function () { setTimeout(loadGlobalSettings, 50); });