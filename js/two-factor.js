(function () {
  'use strict';

  var API = '';
  var st = { enabled: false, loaded: false };
  var current = null;
  var overlay, titleEl, bodyEl, errEl, primaryBtn, cancelBtn;

  function getToken() {
    try { return localStorage.getItem('token') || ''; } catch (e) { return ''; }
  }

  function api(path, body) {
    var init = { method: body === undefined ? 'GET' : 'POST', headers: {} };
    var tok = getToken();
    if (tok) init.headers.Authorization = 'Bearer ' + tok;
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body || {});
    }
    return fetch(API + path, init).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) {
          var err = new Error((data && data.error) || 'Error del servidor');
          err.status = resp.status;
          throw err;
        }
        return data || {};
      });
    });
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'oninput') node.addEventListener('input', v);
      else if (k === 'onkeydown') node.addEventListener('keydown', v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    } catch (e) { /* noop */ }
    return Promise.resolve();
  }

  var inputStyle = 'width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.65);color:#f8fafc;font-size:18px;letter-spacing:6px;text-align:center;outline:none;';
  var smallBtnStyle = 'flex:none;padding:6px 10px;border-radius:7px;border:1px solid rgba(148,163,184,.35);background:rgba(148,163,184,.12);color:#e2e8f0;font-size:12px;cursor:pointer;';

  function primaryStyle() {
    return 'padding:9px 16px;border-radius:9px;border:0;background:#3b82f6;color:#fff;font-weight:600;font-size:13px;cursor:pointer;';
  }
  function ghostStyle() {
    return 'padding:9px 16px;border-radius:9px;border:1px solid rgba(148,163,184,.3);background:transparent;color:#cbd5e1;font-size:13px;cursor:pointer;';
  }

  function buildShell() {
    if (overlay) return;
    primaryBtn = h('button', { type: 'button', style: primaryStyle() });
    cancelBtn = h('button', { type: 'button', style: ghostStyle() });
    errEl = h('div', { style: 'display:none;margin:10px 0 0;padding:9px 12px;border-radius:8px;background:rgba(239,68,68,.14);color:#fca5a5;font-size:13px;line-height:1.4;' });
    titleEl = h('div', { style: 'font-size:17px;font-weight:700;color:#f8fafc;margin-bottom:14px;' });
    bodyEl = h('div', { style: 'font-size:13px;color:#cbd5e1;line-height:1.55;max-height:70vh;overflow:auto;' });
    var card = h('div', {
      role: 'dialog', 'aria-modal': 'true',
      style: 'width:100%;max-width:420px;background:#0f172a;border:1px solid rgba(148,163,184,.22);border-radius:16px;padding:22px;box-shadow:0 24px 60px rgba(2,6,23,.65);'
    }, titleEl, bodyEl, errEl,
      h('div', { style: 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;' }, cancelBtn, primaryBtn));
    overlay = h('div', {
      style: 'position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.72);'
    }, card);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) settle(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && overlay.style.display === 'flex') settle(false);
    });
    document.body.appendChild(overlay);
  }

  function startDialog(title) {
    buildShell();
    titleEl.textContent = title;
    errEl.style.display = 'none';
    errEl.textContent = '';
    bodyEl.innerHTML = '';
    overlay.style.display = 'flex';
    return new Promise(function (resolve) { current = { resolve: resolve, settled: false }; });
  }

  function settle(ok) {
    if (overlay) overlay.style.display = 'none';
    if (current && !current.settled) {
      current.settled = true;
      current.resolve(!!ok);
    }
    current = null;
  }

  function fail(msg) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }
  function clearFail() {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  function setPrimary(label, handler) {
    if (!label) {
      primaryBtn.style.display = 'none';
      primaryBtn.onclick = null;
      return;
    }
    primaryBtn.style.display = '';
    primaryBtn.disabled = false;
    primaryBtn.textContent = label;
    primaryBtn.onclick = handler;
  }
  function setCancel(label) {
    cancelBtn.textContent = label || 'Cancelar';
    cancelBtn.onclick = function () { settle(false); };
  }

  function renderSetup(data) {
    if (!current) return;
    bodyEl.innerHTML = '';
    clearFail();
    bodyEl.appendChild(h('div', { style: 'margin-bottom:12px;', text: 'Escanea el código con tu app de autenticación (Google Authenticator, Authy, 1Password). Después ingresa el código de 6 dígitos para confirmar.' }));
    var qrWrap = h('div', { style: 'display:flex;justify-content:center;align-items:center;padding:10px;background:#fff;border-radius:12px;width:196px;margin:0 auto 14px;min-height:196px;' });
    bodyEl.appendChild(qrWrap);
    if (window.QRCode) {
      try {
        new window.QRCode(qrWrap, { text: data.otpauthUri, width: 176, height: 176, correctLevel: window.QRCode.CorrectLevel.M });
      } catch (e) { qrWrap.style.display = 'none'; }
    } else {
      qrWrap.style.display = 'none';
    }
    var secretText = String(data.secret || '').replace(/(.{4})/g, '$1 ').trim();
    bodyEl.appendChild(h('div', {
      style: 'display:flex;gap:8px;align-items:center;justify-content:space-between;background:rgba(148,163,184,.1);border-radius:8px;padding:8px 10px;margin-bottom:14px;'
    },
      h('code', { style: 'word-break:break-all;color:#93c5fd;font-size:12px;', text: secretText }),
      h('button', { type: 'button', style: smallBtnStyle, text: 'Copiar', onclick: function () { copy(data.secret); } })));
    bodyEl.appendChild(h('label', { style: 'display:block;margin-bottom:6px;font-weight:600;color:#e2e8f0;', text: 'Código de verificación' }));
    var input = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000', style: inputStyle });
    bodyEl.appendChild(input);
    input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') primaryBtn.click(); });

    setPrimary('Activar 2FA', function () {
      var value = String(input.value || '').replace(/\D/g, '');
      if (value.length !== 6) { fail('Ingresa el código de 6 dígitos.'); return; }
      clearFail();
      primaryBtn.disabled = true;
      primaryBtn.textContent = 'Verificando…';
      api('/api/security/2fa/confirm', { code: value }).then(function (res) {
        if (!current) return;
        renderBackupCodes(res.backupCodes || []);
      }).catch(function (e) {
        if (!current) return;
        primaryBtn.disabled = false;
        primaryBtn.textContent = 'Activar 2FA';
        fail(e.message);
      });
    });
    try { input.focus(); } catch (e) { /* noop */ }
  }

  function renderBackupCodes(codes) {
    bodyEl.innerHTML = '';
    clearFail();
    bodyEl.appendChild(h('div', { style: 'margin-bottom:12px;color:#86efac;font-weight:600;', text: '2FA activado correctamente.' }));
    bodyEl.appendChild(h('div', { style: 'margin-bottom:12px;', text: 'Guarda estos códigos de respaldo en un lugar seguro. Cada uno sirve una sola vez para entrar si pierdes tu dispositivo.' }));
    var grid = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;' });
    (codes || []).forEach(function (c) {
      grid.appendChild(h('code', { style: 'text-align:center;padding:8px;border-radius:7px;background:rgba(148,163,184,.12);color:#e2e8f0;font-size:12px;', text: c }));
    });
    bodyEl.appendChild(grid);
    if (codes && codes.length) {
      bodyEl.appendChild(h('button', { type: 'button', style: smallBtnStyle, text: 'Copiar todos', onclick: function () { copy(codes.join('\n')); } }));
    }
    setPrimary('He guardado mis códigos', function () { settle(true); });
    setCancel('Cerrar');
  }

  function openSetup() {
    var p = startDialog('Activar autenticación en dos pasos');
    setCancel('Cancelar');
    setPrimary('', null);
    bodyEl.innerHTML = '<div style="text-align:center;opacity:.7;padding:20px 0;">Generando secreto…</div>';
    api('/api/security/2fa/setup').then(function (data) {
      renderSetup(data);
    }).catch(function (e) {
      if (!current) return;
      fail(e.message);
      setPrimary('Cerrar', function () { settle(false); });
    });
    return p;
  }

  function openDisable() {
    var p = startDialog('Desactivar autenticación en dos pasos');
    setCancel('Cancelar');
    clearFail();
    bodyEl.appendChild(h('div', { style: 'margin-bottom:14px;', text: 'Ingresa un código actual de tu app de autenticación o uno de tus códigos de respaldo para desactivar 2FA.' }));
    bodyEl.appendChild(h('label', { style: 'display:block;margin-bottom:6px;font-weight:600;color:#e2e8f0;', text: 'Código de verificación' }));
    var input = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', style: inputStyle });
    bodyEl.appendChild(input);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') primaryBtn.click(); });
    setPrimary('Desactivar 2FA', function () {
      var value = String(input.value || '').trim();
      if (!value) { fail('Ingresa tu código 2FA.'); return; }
      clearFail();
      primaryBtn.disabled = true;
      primaryBtn.textContent = 'Verificando…';
      api('/api/security/2fa/disable', { code: value }).then(function () {
        settle(true);
      }).catch(function (e) {
        if (!current) return;
        primaryBtn.disabled = false;
        primaryBtn.textContent = 'Desactivar 2FA';
        fail(e.message);
      });
    });
    try { input.focus(); } catch (e) { /* noop */ }
    return p;
  }

  function refresh() {
    return api('/api/security/2fa/status').then(function (d) {
      st.enabled = !!d.enabled;
      st.loaded = true;
      var box = document.getElementById('toggle2fa');
      if (box) box.checked = st.enabled;
      return st.enabled;
    });
  }

  function toggle2FA(checkbox) {
    var box = checkbox || document.getElementById('toggle2fa');
    var want = box ? !!box.checked : true;
    var after = function (ok) {
      refresh().catch(function () {
        if (box && !ok) box.checked = st.enabled;
      });
    };
    if (st.enabled) {
      if (want) return;
      openDisable().then(after);
    } else {
      if (!want) return;
      openSetup().then(after);
    }
  }

  function init() {
    if (document.getElementById('toggle2fa')) refresh().catch(function () { /* silencioso */ });
  }

  window.PP2FA = { refresh: refresh, toggle: toggle2FA, isEnabled: function () { return st.enabled; } };
  window.toggle2FA = toggle2FA;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
