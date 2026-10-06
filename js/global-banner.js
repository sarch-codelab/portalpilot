(function() {
  'use strict';

  var bannerUrl = '/api/public/banner';
  var bannerEl = null;
  var dismissedKey = 'globalBannerDismissed';

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
      if (!data.active || !data.message) return;
      if (isDismissed(data.message)) return;
      createBanner(data);
    } catch (e) {
      console.warn('[GlobalBanner] No se pudo cargar el banner:', e);
    }
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadBanner);
    } else {
      loadBanner();
    }
  }

  init();

  // Exponer para testing/debug
  window.GlobalBanner = {
    load: loadBanner,
    dismiss: dismissBanner,
    isDismissed: isDismissed
  };
})();