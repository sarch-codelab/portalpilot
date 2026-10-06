/**
 * test-helpers-modulos.js — utilidades compartidas por las pruebas de
 * modulos avanzados (aislamiento de tenant, gates, consolidación).
 *
 * Aquí vive el Supabase EN MEMORIA. No es un mock laxo: implementa el
 * subconjunto del query builder que usa modulosAvanzadosEndpoints.js y aplica
 * los filtros de verdad. Por eso, si un handler olvida un `.eq('empresa_codigo',
 * ...)`, la prueba ve filas ajenas y falla igual que lo haría en Postgres.
 */

'use strict';

const express = require('express');
const crypto = require('node:crypto');

const { createRouter } = require('./modulosAvanzadosEndpoints');

const TIEMPO_LIMITE_MS = 4000;
const fetchReal = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => fetchReal(url, {
  ...opts,
  signal: opts.signal || AbortSignal.timeout(TIEMPO_LIMITE_MS),
});

function normalizarTenant(c) { return (c || '').toString().trim().toUpperCase(); }

function crearSupabaseFalso(semilla = {}) {
  const tablas = JSON.parse(JSON.stringify(semilla));
  const log = [];

  function coincide(rowa, filtros) {
    return filtros.every(f => {
      if (f.tipo === 'eq') return String(rowa[f.col]) === String(f.valor);
      if (f.tipo === 'in') return f.valores.map(String).includes(String(rowa[f.col]));
      if (f.tipo === 'gte') return String(rowa[f.col]) >= String(f.valor);
      if (f.tipo === 'lte') return String(rowa[f.col]) <= String(f.valor);
      return true;
    });
  }

  function consulta(nombre) {
    const filtros = [];
    let orden = null;
    let limite = null;
    let modo = 'select';

    const api = {
      select() { return api; },
      eq(col, valor) { filtros.push({ tipo: 'eq', col, valor }); return api; },
      in(col, valores) { filtros.push({ tipo: 'in', col, valores }); return api; },
      gte(col, valor) { filtros.push({ tipo: 'gte', col, valor }); return api; },
      lte(col, valor) { filtros.push({ tipo: 'lte', col, valor }); return api; },
      order(col, opts = {}) { orden = { col, asc: opts.ascending !== false }; return api; },
      limit(n) { limite = n; return api; },

      insert(filas) {
        modo = 'insert';
        api._nuevas = (Array.isArray(filas) ? filas : [filas]).map(f => ({ id: crypto.randomUUID(), ...f }));
        return api;
      },
      upsert(filas, opciones = {}) {
        modo = 'upsert';
        api._nuevas = (Array.isArray(filas) ? filas : [filas]).map(f => ({ ...f }));
        api._conflicto = opciones.onConflict;
        return api;
      },
      update(cambios) { modo = 'update'; api._cambios = cambios; return api; },
      delete() { modo = 'delete'; return api; },

      _ejecutar() {
        const t = tablas[nombre] || (tablas[nombre] = []);
        const anotar = () => log.push({ tabla: nombre, modo, filtros: filtros.slice() });

        if (modo === 'select') {
          let filas = t.filter(f => coincide(f, filtros));
          if (orden) filas = [...filas].sort((a, b) => {
            const va = String(a[orden.col]), vb = String(b[orden.col]);
            return orden.asc ? va.localeCompare(vb) : vb.localeCompare(va);
          });
          if (limite) filas = filas.slice(0, limite);
          anotar();
          return { data: filas, error: null };
        }

        if (modo === 'insert') {
          t.push(...api._nuevas);
          anotar();
          return { data: api._nuevas[0], error: null };
        }

        if (modo === 'upsert') {
          const cols = String(api._conflicto || '').split(',').map(c => c.trim());
          const salientes = [];
          for (const nueva of api._nuevas) {
            const i = t.findIndex(f => cols.every(c => String(f[c]) === String(nueva[c])));
            if (i >= 0) {
              const fusionada = { ...t[i], ...nueva };
              t[i] = fusionada;
              salientes.push(fusionada);
            } else {
              const conId = { id: crypto.randomUUID(), ...nueva };
              t.push(conId);
              salientes.push(conId);
            }
          }
          anotar();
          return { data: salientes[0], error: null };
        }

        if (modo === 'update') {
          let cambiados = 0;
          t.forEach((f, i) => {
            if (coincide(f, filtros)) { t[i] = { ...f, ...api._cambios }; cambiados++; }
          });
          anotar();
          return { data: cambiados ? t.filter(f => coincide(f, filtros)) : [], error: null };
        }

        const quedan = t.filter(f => !coincide(f, filtros));
        const borrados = t.length - quedan.length;
        tablas[nombre] = quedan;
        anotar();
        return { data: borrados, error: null };
      },

      then(resolve, reject) {
        return Promise.resolve().then(() => api._ejecutar()).then(resolve, reject);
      },

      maybeSingle() {
        return Promise.resolve().then(() => api._ejecutar()).then(r => ({
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null),
          error: r.error,
        }));
      },
      single() { return api.maybeSingle(); },
    };
    return api;
  }

  return { from: (nombre) => consulta(nombre), _tablas: tablas, _log: log };
}

/**
 * Monta el router real sobre Express con middlewares equivalentes a los de
 * server.js. `req` es la fábrica del usuario simulado (token → empresa/rol).
 */
function construirApp({ supabase, planPorTenant = {}, req }) {
  const app = express();
  app.use(express.json());
  app.use((r, _res, next) => { r.user = req(r); next(); });

  const requireSupabase = () => true;
  const getTenantCode = (r) => r.user?.empresa_codigo || '';

  const requirePlanFeature = (feature) => (r, res, next) => {
    const tenant = normalizarTenant(getTenantCode(r));
    const features = planPorTenant[tenant] || [];
    if (!features.includes(feature)) {
      return res.status(403).json({ error: `Requiere plan: ${feature}`, code: 'PLAN_LIMIT' });
    }
    next();
  };

  const requireTenantAdmin = (r, res, next) => {
    const rol = String(r.user?.rol || '').toLowerCase();
    if (!['owner', 'admin', 'administrador', 'root'].includes(rol)) {
      return res.status(403).json({ error: 'Requiere rol admin' });
    }
    next();
  };

  app.use(createRouter({
    supabase,
    requirePlanFeature,
    requireTenantAdmin,
    requireSupabase,
    getTenantCode,
    normalizeTenantCode: normalizarTenant,
    resolverEmpresaSupabase: async () => null,
    // El stack se imprime en la consola del test: si el router lanza, hay que
    // ver dónde, no solo el mensaje.
    handleServerError: (res, e) => {
      console.error('[test] error del router:', e);
      res.status(500).json({ error: String(e?.message || e) });
    },
  }));
  return app;
}

async function conServidor(app, fn) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // undici mantiene vivo el socket del pool de fetch; sin cortar esas
    // conexiones server.close() no resuelve y el test queda colgado.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

const TODAS_LAS_FEATURES = [
  'operacion_completa', 'rrhh_planillas', 'fiscal_avanzado', 'crm_avanzado', 'multiempresa',
];

module.exports = {
  crearSupabaseFalso, construirApp, conServidor,
  normalizarTenant, TODAS_LAS_FEATURES,
};