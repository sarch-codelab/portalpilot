(function () {
  'use strict';

  function readJson(res) {
    return res.json().catch(function () { return {}; });
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return readJson(res).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Error del servidor');
        return data || {};
      });
    });
  }

  function group(secret) {
    return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
  }

  function start(container, setupToken, onSuccess, onError) {
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:18px 0;">Generando código de seguridad…</p>';
    post('/api/login/2fa/setup', { setupToken: setupToken }).then(function (data) {
      renderSetup(container, data, setupToken, onSuccess, onError);
    }).catch(function (e) {
      container.innerHTML = '';
      onError(e.message);
    });
  }

  function renderSetup(container, data, setupToken, onSuccess, onError) {
    container.innerHTML =
      '<p style="margin:0 0 14px;font-size:13px;color:var(--text-dim);">Tu organización exige verificación en dos pasos para administradores. Escanea el código con tu app de autenticación (Google Authenticator, Authy, 1Password).</p>' +
      '<div style="display:flex;justify-content:center;margin-bottom:12px;"><div id="ppLogin2faQr" style="background:#fff;padding:8px;border-radius:10px;"></div></div>' +
      '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;background:rgba(148,163,184,.12);border-radius:8px;padding:8px 10px;margin-bottom:14px;">' +
      '<code id="ppLogin2faSecret" style="word-break:break-all;font-size:12px;"></code>' +
      '<button type="button" id="ppLogin2faCopy" style="flex:none;padding:6px 10px;border-radius:7px;border:1px solid rgba(148,163,184,.3);background:transparent;color:inherit;font-size:12px;cursor:pointer;">Copiar</button>' +
      '</div>' +
      '<div class="field"><label>CÓDIGO 2FA</label>' +
      '<div class="input-wrap"><i class="fas fa-shield-halved"></i>' +
      '<input type="text" id="ppLogin2faCode" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code" ' +
      'style="font-size:24px;letter-spacing:8px;text-align:center;"></div></div>' +
      '<button type="button" class="btn-submit" id="ppLogin2faBtn"><i class="fas fa-shield-halved"></i> Activar y entrar</button>' +
      '<div id="ppLogin2faErr" style="display:none;margin-top:12px;font-size:13px;color:#f87171;"></div>';

    var secretEl = document.getElementById('ppLogin2faSecret');
    if (secretEl) secretEl.textContent = group(data.secret);

    var qrBox = document.getElementById('ppLogin2faQr');
    if (qrBox && window.QRCode) {
      try {
        new window.QRCode(qrBox, { text: data.otpauthUri, width: 156, height: 156, correctLevel: window.QRCode.CorrectLevel.M });
      } catch (e) { if (qrBox) qrBox.style.display = 'none'; }
    } else if (qrBox) {
      qrBox.style.display = 'none';
    }

    var copyBtn = document.getElementById('ppLogin2faCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        try { if (navigator.clipboard) navigator.clipboard.writeText(data.secret); } catch (e) { /* noop */ }
      });
    }

    var input = document.getElementById('ppLogin2faCode');
    var btn = document.getElementById('ppLogin2faBtn');
    var errEl = document.getElementById('ppLogin2faErr');

    function showErr(msg) {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }

    function submit() {
      var code = String((input && input.value) || '').replace(/\D/g, '');
      if (code.length !== 6) { showErr('Ingresa el código de 6 dígitos.'); return; }
      if (errEl) errEl.style.display = 'none';
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando…'; }
      post('/api/login/2fa/setup-confirm', { setupToken: setupToken, code: code }).then(function (res) {
        renderBackupCodes(container, res, onSuccess);
      }).catch(function (e) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-halved"></i> Activar y entrar'; }
        showErr(e.message);
      });
    }

    if (btn) btn.addEventListener('click', submit);
    if (input) {
      input.addEventListener('input', function () { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      input.focus();
    }
  }

  function renderBackupCodes(container, data, onSuccess) {
    var codes = data.backupCodes || [];
    var html = '<p style="margin:0 0 10px;font-size:13px;color:#86efac;font-weight:600;">2FA activado correctamente.</p>' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-dim);">Guarda estos códigos de respaldo en un lugar seguro. Cada uno sirve una sola vez.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">';
    codes.forEach(function (c) {
      html += '<code style="text-align:center;padding:8px;border-radius:7px;background:rgba(148,163,184,.14);font-size:12px;">' + String(c).replace(/</g, '&lt;') + '</code>';
    });
    html += '</div><button type="button" class="btn-submit" id="ppLogin2faDone"><i class="fas fa-check"></i> He guardado mis códigos</button>';
    container.innerHTML = html;
    var done = document.getElementById('ppLogin2faDone');
    if (done) done.addEventListener('click', function () { onSuccess(data); });
  }

  window.PLLogin2FASetup = { start: start };
})();
