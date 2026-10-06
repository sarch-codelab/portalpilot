(function() {
  'use strict';

  var bannerUrl = '/api/public/banner';
  var bannerEl = null;
  var dismissedKey = 'globalBannerDismissed';
  var pollTimer = null;
  var POLL_INTERVAL = 30000; // 30 segundos

  function createBanner(data) {
    if (bannerEl) return;

    var banner = document.createElement('div');
    banner.id = 'global-banner';
    banner.className = 'global-banner ' + (data.type || 'info');
    banner.innerHTML = data.message + '<button class="close" aria-label="Cerrar" title="Cerrar">&times;</button>';

    var closeBtn = banner.querySelector('.close');
    closeBtn.onclick = function() {
      dismissBanner();
      var msg = data.message || '';
      try {
        var dismissals = JSON.parse(localStorage.getItem(dismissedKey) || '[]');
        if (!dismissals.includes(msg)) {
          dismissals.push(msg);
          localStorage.setItem(dismissedKey, JSON.stringify(dismissals));
        }
      } catch (e) {}
    };

    document.body.prepend(banner);
    document.body.classList.add('has-global-banner');
    bannerEl = banner;
  }

  function dismissBanner() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
      document.body.classList.remove('has-global-banner');
    }
  }

  function isDismissed(message) {
    try {
      var dismissals = JSON.parse(localStorage.getItem(dismissedKey) || '[]');
      return dismissals.includes(message);
    } catch (e) {
      return false;
    }
  }

  async function loadBanner() {
    try {
      var res = await fetch(bannerUrl, { credentials: 'omit' });
      if (!res.ok) return;
      var data = await res.json();
      if (!data.active || !data.message) {
        // No hay banner activo - remover si existe
        if (bannerEl) dismissBanner();
        return;
      }
      if (isDismissed(data.message)) return;
      // Si ya hay banner con mismo mensaje, no recrear
      if (bannerEl && bannerEl.textContent.indexOf(data.message) !== -1) return;
      dismissBanner(); // Remover anterior si es diferente
      createBanner(data);
    } catch (e) {
      console.warn('[GlobalBanner] No se pudo cargar el banner:', e);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(loadBanner, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        loadBanner();
        startPolling();
      });
    } else {
      loadBanner();
      startPolling();
    }
  }

  init();

  // Exponer para testing/debug
  window.GlobalBanner = {
    load: loadBanner,
    dismiss: dismissBanner,
    isDismissed: isDismissed,
    startPolling: startPolling,
    stopPolling: stopPolling
  };
})();