(function() {
  'use strict';

  var FLAGS_CACHE = null;
  var FLAGS_PROMISE = null;

  var DEFAULTS = {
    FLAG_BETA: true,
    FLAG_2FA_ADMINS: false,
    FLAG_DASH_ANALYTICS: false,
    FLAG_MULTIREGION: false,
    FLAG_AUTOSCALING_BOTS: true
  };

  function loadFlags() {
    if (FLAGS_CACHE) return Promise.resolve(FLAGS_CACHE);
    if (FLAGS_PROMISE) return FLAGS_PROMISE;

    FLAGS_PROMISE = fetch('/api/public/flags', { credentials: 'omit' })
      .then(function(res) { return res.ok ? res.json() : Promise.reject(res.status); })
      .then(function(data) {
        var flags = data && data.flags ? data.flags : {};
        Object.keys(DEFAULTS).forEach(function(k) {
          if (flags[k] === undefined) flags[k] = DEFAULTS[k];
        });
        FLAGS_CACHE = flags;
        return flags;
      })
      .catch(function(err) {
        console.warn('[FeatureFlags] Error cargando flags, usando defaults:', err);
        FLAGS_CACHE = { ...DEFAULTS };
        return FLAGS_CACHE;
      });

    return FLAGS_PROMISE;
  }

  function isEnabled(flag) {
    return FLAGS_CACHE && FLAGS_CACHE[flag] === true;
  }

  function waitForFlag(flag) {
    return loadFlags().then(function() { return isEnabled(flag); });
  }

  function invalidateCache() {
    FLAGS_CACHE = null;
    FLAGS_PROMISE = null;
  }

  function onFlagChange(flag, callback) {
    var lastValue = isEnabled(flag);
    setInterval(function() {
      loadFlags().then(function() {
        var current = isEnabled(flag);
        if (current !== lastValue) {
          lastValue = current;
          callback(current);
        }
      });
    }, 30000);
  }

  window.FeatureFlags = {
    load: loadFlags,
    isEnabled: isEnabled,
    waitForFlag: waitForFlag,
    invalidateCache: invalidateCache,
    onFlagChange: onFlagChange,
    DEFAULTS: DEFAULTS
  };

  // Auto-cargar al inicio
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFlags);
  } else {
    loadFlags();
  }
})();