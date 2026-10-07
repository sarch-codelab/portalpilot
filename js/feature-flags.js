(function() {
  'use strict';

  var FLAGS_CACHE = null;
  var FLAGS_PROMISE = null;
  var STORAGE_KEY = 'pp_feature_flags_v1';

  var DEFAULTS = {
    FLAG_BETA: true,
    FLAG_2FA_ADMINS: false,
    FLAG_DASH_ANALYTICS: false,
    FLAG_MULTIREGION: false,
    FLAG_AUTOSCALING_BOTS: true
  };

  function extractFlagsFromConfig(config) {
    if (!config || !config.configuraciones) return null;
    var flags = {};
    var found = false;
    config.configuraciones.forEach(function(c) {
      if (c.clave && c.clave.indexOf('FLAG_') === 0) {
        flags[c.clave] = c.valor === 'true';
        found = true;
      }
    });
    return found ? flags : null;
  }

  function loadFromStorage() {
    try {
      var stored = localStorage.getItem('pp_feature_flags_v1');
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          var flags = { ...DEFAULTS, ...parsed };
          FLAGS_CACHE = flags;
          FLAGS_PROMISE = Promise.resolve(flags);
          return flags;
        }
      }
    } catch (e) {}
    return null;
  }

  function saveToStorage(flags) {
    try { localStorage.setItem('pp_feature_flags_v1', JSON.stringify(flags)); } catch (e) {}
  }

  function loadFlags() {
    if (FLAGS_CACHE) return Promise.resolve(FLAGS_CACHE);
    if (FLAGS_PROMISE) return FLAGS_PROMISE;

    // 1. Try localStorage first (instant, works offline)
    var stored = loadFromStorage();
    if (stored) return FLAGS_PROMISE;

    // 2. Try public endpoint (no auth)
    FLAGS_PROMISE = fetch('/api/public/flags', { credentials: 'omit' })
      .then(function(res) { return res.ok ? res.json() : Promise.reject(res.status); })
      .then(function(data) {
        var flags = data && data.flags ? data.flags : {};
        Object.keys(DEFAULTS).forEach(function(k) {
          if (flags[k] === undefined) flags[k] = DEFAULTS[k];
        });
        FLAGS_CACHE = flags;
        saveToStorage(flags);
        return flags;
      })
      // Fallback: try config endpoint (requires auth)
      .catch(function(err) {
        return fetch('/api/global/config', {
          headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('token') || '') }
        })
          .then(function(res) { 
            if (res.status === 401) throw new Error('401');
            return res.ok ? res.json() : Promise.reject(res.status); 
          })
          .then(function(data) {
            var flags = extractFlagsFromConfig(data);
            if (!flags) throw new Error('No flags in config');
            Object.keys(DEFAULTS).forEach(function(k) {
              if (flags[k] === undefined) flags[k] = DEFAULTS[k];
            });
            FLAGS_CACHE = flags;
            saveToStorage(flags);
            return flags;
          });
      })
      // Final fallback: defaults
      .catch(function(err) {
        FLAGS_CACHE = { ...DEFAULTS };
        saveToStorage(FLAGS_CACHE);
        return FLAGS_CACHE;
      });

    return FLAGS_PROMISE;
  }

  function extractFlagsFromConfig(config) {
    if (!config || !config.configuraciones) return null;
    var flags = {};
    var found = false;
    config.configuraciones.forEach(function(c) {
      if (c.clave && c.clave.indexOf('FLAG_') === 0) {
        flags[c.clave] = c.valor === 'true';
        found = true;
      }
    });
    return found ? flags : null;
  }

  // Allow direct flag injection (used by global_settings.js which has auth)
  function setFlags(flags) {
    FLAGS_CACHE = flags;
    FLAGS_PROMISE = Promise.resolve(flags);
    saveToStorage(flags);
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
    try { localStorage.removeItem('pp_feature_flags_v1'); } catch (e) {}
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
    setFlags: setFlags,
    DEFAULTS: DEFAULTS
  };

  // Auto-cargar al inicio
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFlags);
  } else {
    loadFlags();
  }
})();