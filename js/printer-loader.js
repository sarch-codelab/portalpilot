/* ─── Printer Loading Overlay helper ─────────────── */
(function () {
  var CSS_LOADED = false;
  var OVERLAY = null;
  var ANIM_MS = 6400;

  var MARKUP = '' +
    '<div class="card">' +
    '  <div class="scene">' +
    '    <div class="paper-group">' +
    '      <div class="paper-shadow"></div>' +
    '      <div class="paper">' +
    '        <div class="ink ink-1"></div>' +
    '        <div class="ink ink-2"></div>' +
    '        <div class="ink ink-3"></div>' +
    '        <div class="ink ink-4"></div>' +
    '        <div class="ink ink-5"></div>' +
    '        <div class="ink ink-6"></div>' +
    '        <div class="ink ink-7"></div>' +
    '        <div class="ink ink-8"></div>' +
    '      </div>' +
    '    </div>' +
    '    <div class="printer">' +
    '      <div class="printer-ambient-shadow"></div>' +
    '      <div class="printer-top"><div class="printer-top-inner"></div></div>' +
    '      <div class="printer-body">' +
    '        <div class="slot"></div>' +
    '        <div class="panel"><div class="panel-line-lg"></div><div class="panel-line-sm"></div></div>' +
    '        <div class="buttons"><div class="btn"></div><div class="btn"></div><div class="btn"></div></div>' +
    '        <div class="led-wrap"><div class="led"></div><div class="led-glow-wrap"><div class="led-glow"></div></div></div>' +
    '        <div class="vents"><div class="vent"></div><div class="vent"></div><div class="vent"></div></div>' +
    '        <div class="tray"><div class="tray-inner"></div></div>' +
    '        <div class="brand"></div>' +
    '      </div>' +
    '    </div>' +
    '  </div>' +
    '  <div class="status">' +
    '    <span class="st ready">Ready</span>' +
    '    <span class="st feeding">Feeding paper...</span>' +
    '    <span class="st printing">Printing...</span>' +
    '    <span class="st ejecting">Ejecting...</span>' +
    '    <span class="st done">Done</span>' +
    '  </div>' +
    '</div>';

  function loadCss() {
    if (CSS_LOADED) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../css/printer-loader.css';
    document.head.appendChild(link);
    CSS_LOADED = true;
  }

  function ensureOverlay() {
    if (OVERLAY && OVERLAY.parentNode) return OVERLAY;
    OVERLAY = document.createElement('div');
    OVERLAY.className = 'pp-printer-overlay';
    OVERLAY.innerHTML = '<div class="pp-loader-label">Generando documento</div>' + MARKUP;
    document.body.appendChild(OVERLAY);
    return OVERLAY;
  }

  function restart() {
    if (!OVERLAY) return;
    var card = OVERLAY.querySelector('.card');
    if (!card) return;
    var clone = card.cloneNode(true);
    card.parentNode.replaceChild(clone, card);
  }

  /**
   * PPPrinter.run(action)
   * Muestra la animación de impresión de principio a fin y luego ejecuta `action`.
   */
  window.PPPrinter = {
    run: function (action) {
      loadCss();
      var overlay = ensureOverlay();
      restart();
      overlay.classList.add('active');
      setTimeout(function () {
        overlay.classList.remove('active');
        if (typeof action === 'function') {
          try { action(); } catch (err) { console.error('[PPPrinter]', err); }
        }
      }, ANIM_MS + 150);
    },
    duration: ANIM_MS
  };
})();