/* ═══════════════════════════════════════════════════════════════
   MÓDULOS AVANZADOS — contabilidad · rrhh · fiscal_advanced ·
   crm_advanced · multi_empresa

   POR QUÉ ESTE ARCHIVO
   Las pantallas Flutter de estos 5 módulos eran "mock": listas de
   ejemplo hardcoded en memoria, o SharedPreferences locales sin
   backend. Se cobraban (L.75–110/mes en el cotizador) y no
   persistían, y sus endpoints no existían, así que no había nada
   que gatear. Este router añade la API real + el gate de plan.

   Se registra desde server.js:

     const modulosAvanzados = require('./modulosAvanzadosEndpoints');
     app.use('/api', authenticate, modulosAvanzados.createRouter({
       supabase, requirePlanFeature, requireTenantAdmin,
       requireSupabase, getTenantCode, normalizeTenantCode,
       resolverEmpresaSupabase, handleServerError,
     }));

   CONVENCIONES
   · Scope multi-tenant SIEMPRE por empresa_codigo normalizado.
   · Las lecturas que el usuario no debe poder esquivar con ?empresa_codigo=
     ignoran ese parámetro: el tenant sale del JWT (getTenantCode).
   · Idempotencia en escrituras offline (retry de la app no duplica filas).
   · Cada handler degrada a 404 MIGRATION_PENDING si falta la tabla, para no
     romper el despliegue si la migración aún no se aplicó.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const express = require('express');

/* Tasas de nómina honduras.
   Fuente: constantes que ya usa la app (nomina_home.dart) — NO se inventan
   tasas nuevas aquí. Todas son CONFIGURABLES por empresa vía
   `configuracion_fiscal`, porque estas tasas cambian por decreto.
   Verificar vigencia antes de cada declaración. */
const TASAS_NOMINA_DEFAULT = {
  ihss_empleado: 0.025, // 2.5% ISSS (del trabajador)
  rap_empleado: 0.015, // 1.5% RAP (del trabajador)
  ihss_empleador: 0.031, // 3.1% ISSS (patrono)
  rpv_empleador: 0.02, // 2% RPV (patrono)
  inpcafam: 0.0, // 0% por defecto: la tasa vigente la fija el dueño.
  limite_ihss: 15631.78, // tope mensual de aporte IHSS
};

/* Retenciones de renta/IVA que aplica un negocio HONduro.
   `alicuota` es la fracción por defecto según tipo de persona. */
const ALICUOTAS_RETENCION = {
  persona_natural: { ISR: 0.1, IVA: 0.0, IUE: 0.0, GH: 0.0 },
  personeria_juridica: { ISR: 0.0, IVA: 0.01, IUE: 0.01, GH: 0.0 },
};

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function txt(v, max = 300) {
  return (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
}

function idem(v) {
  return txt(v, 60).toUpperCase();
}

/* Varias columnas son uuid en Postgres (documentos_sar.factura_id,
   usuarios.id, asientos.id). Mandar texto libre produce 22P02 y un 500
   que el usuario no entiende. Este helper deja pasar solo uuid válido y
   descarta el resto como null. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuidOrNull(v) {
  const s = txt(v, 60);
  return UUID_RE.test(s) ? s : null;
}

function periodoDe(fechaISO) {
  if (!fechaISO) return new Date().toISOString().slice(0, 7);
  const s = String(fechaISO);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 7) : d.toISOString().slice(0, 7);
}

function soloFecha(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

/* ── CRUD genérico por tabla, con gate de plan ──────────────────────────
   Cada "recurso" declara: tabla, feature, etiqueta y las columnas que la
   app puede escribir. Esto evita 40 handlers casi idénticos y mantiene el
   gate y el scope en un solo sitio (que es justamente donde estaban los
   agujeros).                                                     */
function crearRecurso(router, deps, cfg) {
  const {
    requirePlanFeature, requireTenantAdmin, requireSupabase,
    getTenantCode, normalizeTenantCode, handleServerError,
  } = deps;

  const leer = [
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res, next) => {
      const tenant = normalizeTenantCode(getTenantCode(req));
      if (!tenant) return res.status(400).json({ error: 'Token sin empresa asignada.' });
      req._tenant = tenant;
      next();
    },
    async (req, res) => {
      try {
        let q = deps.supabase.from(cfg.tabla).select('*').eq('empresa_codigo', req._tenant);
        if (cfg.columnasFiltro) {
          for (const col of cfg.columnasFiltro) {
            if (req.query[col] !== undefined && req.query[col] !== '') {
              q = q.eq(col, String(req.query[col]));
            }
          }
        }
        if (cfg.orden) q = q.order(cfg.orden.column, { ascending: cfg.orden.asc !== false });
        const { data, error } = await q;
        if (error) return responderError(res, handleServerError, error, cfg.tabla);
        return res.json({ [cfg.clave]: data || [] });
      } catch (err) { return responderError(res, handleServerError, err, cfg.tabla); }
    },
  ];

  router.get(cfg.ruta, ...llegar(leer, cfg, requirePlanFeature));

  router.post(cfg.ruta,
    requirePlanFeature(cfg.feature),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        if (!tenant) return res.status(400).json({ error: 'Token sin empresa asignada.' });
        const b = cfg.desdeBody(req.body);
        // Hook de validación async (opcional): se usa donde el cuerpo
        // contiene referencias que deben existir de verdad en otra tabla
        // (ej. el código de una filial debe ser una empresa registrada).
        if (cfg.validar) {
          const v = await cfg.validar(b, tenant, req);
          if (v && v.ok === false) {
            return res.status(v.status || 400).json({ error: v.error, code: v.code || 'VALIDACION' });
          }
        }
        const fila = cfg.construir(b, tenant, req);
        const faltan = (cfg.requeridos || []).filter(c => fila[c] === undefined || fila[c] === null || fila[c] === '');
        if (faltan.length) return res.status(400).json({ error: `Faltan campos obligatorios: ${faltan.join(', ')}` });

        if (cfg.idempotencia) {
          const dup = await cfg.idempotencia(deps.supabase, tenant, fila);
          if (dup) return res.status(200).json({ [cfg.claveSingular]: dup, idempotent: true });
        }

        const { data, error } = await deps.supabase.from(cfg.tabla).insert([fila]).select().maybeSingle();
        if (error) return responderError(res, handleServerError, error, cfg.tabla);
        return res.status(201).json({ [cfg.claveSingular]: data || null });
      } catch (err) { return responderError(res, handleServerError, err, cfg.tabla); }
    });

  if (cfg.editable !== false) {
    router.put(`${cfg.ruta}/:id`,
      requireTenantAdmin,
      requirePlanFeature(cfg.feature),
      (req, res, next) => { if (!requireSupabase(res)) return; next(); },
      async (req, res) => {
        try {
          const tenant = normalizeTenantCode(getTenantCode(req));
          if (cfg.validar) {
            const v = await cfg.validar(req.body, tenant, req);
            if (v && v.ok === false) {
              return res.status(v.status || 400).json({ error: v.error, code: v.code || 'VALIDACION' });
            }
          }
          const update = { ...cfg.actualizar(req.body), updated_at: new Date().toISOString() };
          const { data, error } = await deps.supabase.from(cfg.tabla).update(update)
            .eq('id', req.params.id).eq('empresa_codigo', tenant);
          if (error) return responderError(res, handleServerError, error, cfg.tabla);
          const row = Array.isArray(data) ? data[0] : data;
          if (!row) return res.status(404).json({ error: `${cfg.etiqueta} no encontrado` });
          return res.json({ [cfg.claveSingular]: row, success: true });
        } catch (err) { return responderError(res, handleServerError, err, cfg.tabla); }
      });
  }

  if (cfg.borrable !== false) {
    router.delete(`${cfg.ruta}/:id`,
      requireTenantAdmin,
      requirePlanFeature(cfg.feature),
      (req, res, next) => { if (!requireSupabase(res)) return; next(); },
      async (req, res) => {
        try {
          const tenant = normalizeTenantCode(getTenantCode(req));
          // Se pide `select('id')` para saber cuántas filas realmente
          // tocaron el DELETE. Sin esto, borrar un id de otro tenant
          // respondía "success": el filtro de empresa lo protegía, pero la
          // API mentía, y el cliente no distinguía "no existe" de "borrado".
          const { data, error } = await deps.supabase.from(cfg.tabla)
            .delete().eq('id', req.params.id).eq('empresa_codigo', tenant).select('id');
          if (error) return responderError(res, handleServerError, error, cfg.tabla);
          if (!data || !data.length) return res.status(404).json({ error: `${cfg.etiqueta} no encontrado` });
          return res.json({ success: true });
        } catch (err) { return responderError(res, handleServerError, err, cfg.tabla); }
      });
  }
}

function llegar(handlers, cfg, requirePlanFeature) {
  // El gate va entre el scope y el handler de lectura.
  return [handlers[0], handlers[1], requirePlanFeature(cfg.feature), handlers[2]];
}

function responderError(res, handleServerError, error, tabla) {
  const code = String(error?.code || '');
  const msg = String(error?.message || '');
  if (code === '42P01' || /relation .* does not exist|schema cache/i.test(msg)) {
    return res.status(404).json({
      error: `La tabla ${tabla} aún no existe. Aplica supabase/migracion_modulos_avanzados_v1.sql.`,
      code: 'MIGRATION_PENDING', tabla,
    });
  }
  if (code === '23505' || /duplicate key/i.test(msg)) {
    return res.status(409).json({ error: 'Ya existe un registro con esa clave (duplicado).', code: 'DUPLICATE' });
  }
  return handleServerError(res, error);
}

/* ═══════════════════════════════════════════════════════════════
   FACTORY
   ═══════════════════════════════════════════════════════════════ */
module.exports.createRouter = function createRouter(deps) {
  const router = express.Router();
  const { supabase, requirePlanFeature, normalizeTenantCode, getTenantCode, requireSupabase, handleServerError, requireTenantAdmin } = deps;

  async function configFiscal(tenant) {
    try {
      const { data } = await supabase.from('configuracion_fiscal')
        .select('configuracion').eq('empresa_codigo', tenant).maybeSingle();
      return { ...(data?.configuracion || {}) };
    } catch { return {}; }
  }

  // ───────────────────────────────────────────────────────────────
  // 1. CONTABILIDAD — feature 'operacion_completa' (incluida en
  //    Pulpería y Tienda, según los presets de planes.html)
  // ───────────────────────────────────────────────────────────────
  const F_CONT = 'operacion_completa';

  crearRecurso(router, deps, {
    tabla: 'cuentas_contables', feature: F_CONT,
    ruta: '/api/contabilidad/cuentas', clave: 'cuentas', claveSingular: 'cuenta',
    etiqueta: 'Cuenta', orden: { column: 'codigo', asc: true },
    requeridos: ['codigo', 'nombre'],
    desdeBody: (b) => b?.cuenta || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      codigo: txt(b.codigo, 20),
      nombre: txt(b.nombre, 120),
      tipo: txt(b.tipo, 20) || 'activo',
      padre_codigo: txt(b.padre_codigo, 20) || null,
      nivel: parseInt(b.nivel, 10) || 1,
      naturaleza: txt(b.naturaleza, 20) || 'deudora',
      saldo: num(b.saldo),
      activa: b.activa === undefined ? true : !!b.activa,
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'tipo', 'padre_codigo', 'naturaleza', 'notas'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      if (b.nivel !== undefined) u.nivel = parseInt(b.nivel, 10) || 1;
      if (b.activa !== undefined) u.activa = !!b.activa;
      if (b.saldo !== undefined) u.saldo = num(b.saldo);
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('cuentas_contables').select('*')
        .eq('empresa_codigo', tenant).eq('codigo', fila.codigo).maybeSingle();
      return data || null;
    },
  });

  /* Siembra el plan de cuentas INFOFIN de ejemplo (empresa_codigo
     '__default__') en la empresa del usuario la primera vez. Idempotente. */
  router.post('/api/contabilidad/plan-cuentas/sembrar',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data: yaHay } = await supabase.from('cuentas_contables')
          .select('id').eq('empresa_codigo', tenant).limit(1);
        if (yaHay && yaHay.length) {
          return res.json({ success: true, yaSembrado: true, cuentas: yaHay.length });
        }
        const { data: base } = await supabase.from('cuentas_contables')
          .select('codigo,nombre,tipo,padre_codigo,nivel,naturaleza')
          .eq('empresa_codigo', '__default__');
        if (!base || !base.length) {
          return res.status(409).json({ error: 'No hay plantilla de plan de cuentas (__default__).' });
        }
        const filas = base.map(c => ({ ...c, empresa_codigo: tenant }));
        const { error } = await supabase.from('cuentas_contables').insert(filas);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({ success: true, cuentas: filas.length });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Asientos + detalle. El 'numero' se autoincrementa por empresa para que
     dos usuarios creando a la vez no choquen (UNIQUE empresa_codigo,numero). */
  router.post('/api/contabilidad/asientos',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const b = req.body?.asiento || req.body || {};
        const concepto = txt(b.concepto, 200);
        if (!concepto) return res.status(400).json({ error: 'El concepto del asiento es requerido' });

        const detalle = Array.isArray(b.detalle) ? b.detalle : [];
        const debe = detalle.reduce((s, d) => s + num(d.debe), 0);
        const haber = detalle.reduce((s, d) => s + num(d.haber), 0);
        if (Math.abs(debe - haber) > 0.01) {
          return res.status(400).json({
            error: `El asiento no balancea: debe L.${debe.toFixed(2)} vs haber L.${haber.toFixed(2)}.`,
            code: 'ASIENTO_DESBALANCEADO',
          });
        }

        const fecha = soloFecha(b.fecha);
        const base = {
          empresa_codigo: tenant,
          usuario_id: req.user?.sub || null,
          fecha,
          concepto,
          referencia: txt(b.referencia, 60) || null,
          periodo: periodoDe(fecha),
          estado: txt(b.estado, 20) || 'borrador',
          notas: txt(b.notas, 500) || null,
        };

        /* El correlativo es MAX(numero)+1 y hay UNIQUE(empresa_codigo,numero),
           así que dos usuarios guardando a la vez pueden obtener el mismo
           numero y uno recibe 23505. No se puede dejar el 23505 como error de
           usuario: se reintenta con el siguiente numero. Backstop de 5
           intentos; en el peor caso se devuelve 409 con mensaje accionable. */
        let asiento = null;
        for (let intento = 1; intento <= 5 && !asiento; intento++) {
          const { data: ultimo } = await supabase.from('asientos_contables')
            .select('numero').eq('empresa_codigo', tenant)
            .order('numero', { ascending: false }).limit(1);
          const numero = (ultimo && ultimo[0]?.numero ? Number(ultimo[0].numero) : 0) + intento;

          const { data, error } = await supabase.from('asientos_contables')
            .insert([{ ...base, numero }]).select().maybeSingle();
          if (error) {
            if (String(error.code) === '23505') continue; // choque de correlativo
            return res.status(500).json({ error: error.message });
          }
          asiento = data;
        }
        if (!asiento) {
          return res.status(409).json({
            error: 'No se pudo asignar el correlativo del asiento porque hay varios guardando al mismo tiempo. Reintenta en un momento.',
            code: 'NUMERO_ASIENTO_EN_USO',
          });
        }

        if (detalle.length) {
          const filas = detalle.map(d => ({
            asiento_id: asiento.id,
            empresa_codigo: tenant,
            cuenta_codigo: txt(d.cuenta_codigo, 20),
            cuenta_nombre: txt(d.cuenta_nombre, 120) || null,
            debe: num(d.debe),
            haber: num(d.haber),
          }));
          const { error: eDet } = await supabase.from('asientos_contables_detalle').insert(filas);
          if (eDet) {
            // No dejamos un asiento huérfano: se revierte.
            await supabase.from('asientos_contables').delete().eq('id', asiento.id);
            return res.status(500).json({ error: 'No se pudo guardar el detalle del asiento: ' + eDet.message });
          }
        }
        return res.status(201).json({ asiento });
      } catch (err) { return handleServerError(res, err); }
    });

  router.get('/api/contabilidad/asientos/:id',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data: asiento } = await supabase.from('asientos_contables')
          .select('*').eq('id', req.params.id).eq('empresa_codigo', tenant).maybeSingle();
        if (!asiento) return res.status(404).json({ error: 'Asiento no encontrado' });
        const { data: detalle } = await supabase.from('asientos_contables_detalle')
          .select('*').eq('asiento_id', req.params.id).eq('empresa_codigo', tenant);
        return res.json({ asiento: { ...asiento, detalle: detalle || [] } });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Estado de resultado por periodo, derivado de transacciones reales. */
  router.get('/api/contabilidad/estado-resultados',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const periodo = txt(req.query.periodo, 7) || periodoDe();
        const { data, error } = await supabase.from('transacciones')
          .select('tipo,categoria,monto,fecha')
          .eq('empresa_codigo', tenant);
        if (error) return res.status(500).json({ error: error.message });

        let ingresos = 0, egresos = 0;
        const porCategoria = {};
        (data || []).forEach(t => {
          const fecha = String(t.fecha || '');
          if (periodo && !fecha.startsWith(periodo)) return;
          const monto = num(t.monto);
          const tipo = String(t.tipo || '').toLowerCase();
          const esIngreso = ['ingreso', 'venta', 'cobro'].includes(tipo);
          if (esIngreso) ingresos += monto; else egresos += monto;
          const cat = txt(t.categoria, 60) || 'Sin categoría';
          porCategoria[cat] = (porCategoria[cat] || 0) + (esIngreso ? monto : -monto);
        });
        return res.json({
          periodo, ingresos, egresos, utilidad: ingresos - egresos,
          por_categoria: Object.entries(porCategoria).map(([categoria, monto]) => ({ categoria, monto })),
          movimientos: (data || []).length,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  crearRecurso(router, deps, {
    tabla: 'cierres_contables', feature: F_CONT,
    ruta: '/api/contabilidad/cierres', clave: 'cierres', claveSingular: 'cierre',
    etiqueta: 'Cierre', orden: { column: 'periodo', asc: false },
    columnasFiltro: ['periodo', 'estado'],
    requeridos: ['periodo'],
    desdeBody: (b) => b?.cierre || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      periodo: txt(b.periodo, 7),
      ingresos: num(b.ingresos),
      egresos: num(b.egresos),
      utilidad: num(b.utilidad, num(b.ingresos) - num(b.egresos)),
      estado: txt(b.estado, 20) || 'abierto',
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['notas', 'cerrado_por'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 120); });
      if (b.estado !== undefined) u.estado = txt(b.estado, 20);
      if (b.fecha_cierre !== undefined) u.fecha_cierre = soloFecha(b.fecha_cierre);
      ['ingresos', 'egresos', 'utilidad'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('cierres_contables').select('*')
        .eq('empresa_codigo', tenant).eq('periodo', fila.periodo).maybeSingle();
      return data || null;
    },
  });

  crearRecurso(router, deps, {
    tabla: 'conciliaciones_bancarias', feature: F_CONT,
    ruta: '/api/contabilidad/conciliaciones', clave: 'conciliaciones', claveSingular: 'conciliacion',
    etiqueta: 'Conciliación', orden: { column: 'periodo', asc: false },
    columnasFiltro: ['periodo', 'estado'],
    requeridos: ['periodo'],
    desdeBody: (b) => b?.conciliacion || b || {},
    construir: (b, tenant) => {
      const libro = num(b.saldo_libro), banco = num(b.saldo_banco);
      return {
        empresa_codigo: tenant,
        cuenta_bancaria: txt(b.cuenta_bancaria, 40) || 'general',
        periodo: txt(b.periodo, 7),
        fecha: soloFecha(b.fecha),
        saldo_libro: libro,
        saldo_banco: banco,
        diferencia: Math.round((libro - banco) * 100) / 100,
        estado: txt(b.estado, 20) || 'pendiente',
        conciliado_por: txt(b.conciliado_por, 120) || null,
        notas: txt(b.notas, 500) || null,
      };
    },
    actualizar: (b) => {
      const u = {};
      ['notas', 'conciliado_por', 'estado'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 200); });
      ['saldo_libro', 'saldo_banco', 'diferencia'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      if (b.fecha !== undefined) u.fecha = soloFecha(b.fecha);
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('conciliaciones_bancarias').select('*')
        .eq('empresa_codigo', tenant).eq('cuenta_bancaria', fila.cuenta_bancaria)
        .eq('periodo', fila.periodo).maybeSingle();
      return data || null;
    },
  });

  /* Configuración de impuestos por empresa (reemplaza el prefs
     'impuestos_config' que vivía solo en el dispositivo). */
  router.get('/api/contabilidad/config-impuestos',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        return res.json({ config: await configFiscal(tenant) });
      } catch (err) { return handleServerError(res, err); }
    });

  router.put('/api/contabilidad/config-impuestos',
    requirePlanFeature(F_CONT),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const actual = await configFiscal(tenant);
        const nuevo = { ...actual, ...(req.body?.config || req.body || {}) };
        const { data, error } = await supabase.from('configuracion_fiscal')
          .upsert({ empresa_codigo: tenant, configuracion: nuevo, updated_at: new Date().toISOString() },
            { onConflict: 'empresa_codigo' }).select().maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ config: (data && data.configuracion) || nuevo, success: true });
      } catch (err) { return handleServerError(res, err); }
    });

  // ───────────────────────────────────────────────────────────────
  // 2. RRHH — feature 'rrhh_planillas' (solo Club / Enterprise /
  //    Personalizado; NO Pulpería ni Tienda)
  // ───────────────────────────────────────────────────────────────
  const F_RRHH = 'rrhh_planillas';

  crearRecurso(router, deps, {
    tabla: 'empleados', feature: F_RRHH,
    ruta: '/api/rrhh/empleados', clave: 'empleados', claveSingular: 'empleado',
    etiqueta: 'Empleado', orden: { column: 'nombre', asc: true },
    requeridos: ['nombre'],
    desdeBody: (b) => b?.empleado || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      nombre: txt(b.nombre, 120),
      // La app separa nombre y apellido; el servidor conserva el nombre
      // completo en `nombre` y guarda el apellido aparte para no tener que
      // partirlo de vuelta cada vez que se abre el formulario.
      apellido: txt(b.apellido, 120) || null,
      identidad: txt(b.identidad || b.cedula, 30) || null,
      rtn: txt(b.rtn, 30) || null,
      puesto: txt(b.puesto || b.cargo, 80) || null,
      departamento: txt(b.departamento, 80) || null,
      salario_base: num(b.salario_base ?? b.salario),
      bonificaciones: num(b.bonificaciones),
      horas_extra: num(b.horas_extra),
      deducciones: num(b.deducciones),
      fecha_ingreso: b.fecha_ingreso ? soloFecha(b.fecha_ingreso) : null,
      estado: txt(b.estado, 20) || 'activo',
      banco: txt(b.banco, 60) || null,
      cuenta_bancaria: txt(b.cuenta_bancaria, 40) || null,
      email: txt(b.email, 120) || null,
      telefono: txt(b.telefono, 30) || null,
      contacto_emergencia: txt(b.contacto_emergencia, 120) || null,
      telefono_emergencia: txt(b.telefono_emergencia, 30) || null,
      direccion: txt(b.direccion, 200) || null,
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'apellido', 'puesto', 'departamento', 'estado', 'banco', 'cuenta_bancaria',
        'email', 'telefono', 'contacto_emergencia', 'telefono_emergencia', 'direccion', 'notas']
        .forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      if (b.identidad !== undefined || b.cedula !== undefined) u.identidad = txt(b.identidad || b.cedula, 30);
      if (b.rtn !== undefined) u.rtn = txt(b.rtn, 30);
      ['salario_base', 'salario', 'bonificaciones', 'horas_extra', 'deducciones'].forEach(c => {
        if (b[c] !== undefined) u[c === 'salario' ? 'salario_base' : c] = num(b[c]);
      });
      if (b.fecha_ingreso !== undefined) u.fecha_ingreso = b.fecha_ingreso ? soloFecha(b.fecha_ingreso) : null;
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      if (!fila.identidad) return null;
      const { data } = await sb.from('empleados').select('*')
        .eq('empresa_codigo', tenant).eq('identidad', fila.identidad).maybeSingle();
      return data || null;
    },
  });

  /* Cálculo de nómina. Reusa EXACTAMENTE las constantes que ya usaba la app
     en nomina_home.dart para no cambiarle la matemática al usuario; todas
     son configurables por empresa en `configuracion_fiscal`. */
  router.post('/api/rrhh/nomina/calcular',
    requirePlanFeature(F_RRHH),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const anio = parseInt(req.body?.anio, 10) || new Date().getFullYear();
        const mes = parseInt(req.body?.mes, 10) || (new Date().getMonth() + 1);
        if (mes < 1 || mes > 12) return res.status(400).json({ error: 'Mes inválido (1-12)' });

        const tasas = { ...TASAS_NOMINA_DEFAULT, ...(await configFiscal(tenant)) };

        const { data: empleados, error } = await supabase.from('empleados')
          .select('*').eq('empresa_codigo', tenant).eq('estado', 'activo');
        if (error) return res.status(500).json({ error: error.message });
        if (!empleados || !empleados.length) {
          return res.json({ recibos: [], total_neto: 0, mensaje: 'No hay empleados activos.' });
        }

        const recibos = empleados.map(e => {
          const base = num(e.salario_base);
          const tope = num(tasas.limite_ihss, TASAS_NOMINA_DEFAULT.limite_ihss);
          const baseIHSS = Math.min(base, tope);
          const ihss = round2(baseIHSS * num(tasas.ihss_empleado, 0.025));
          const rap = round2(baseIHSS * num(tasas.rap_empleado, 0.015));
          const inpcafam = round2(base * num(tasas.inpcafam, 0));
          const bonos = num(e.bonificaciones) + round2(num(e.horas_extra) * 0.01 * base);
          const otrasDed = num(e.deducciones);
          const bruto = round2(base + bonos);
          const deducciones = round2(ihss + rap + inpcafam + otrasDed);
          const ihssEmpleador = round2(baseIHSS * num(tasas.ihss_empleador, 0.031));
          const rpvEmpleador = round2(base * num(tasas.rpv_empleador, 0.02));
          return {
            id: `${e.id}_${anio}_${String(mes).padStart(2, '0')}`,
            empresa_codigo: tenant,
            empleado_id: e.id,
            mes, anio,
            salario_base: round2(base),
            bonos: round2(bonos),
            horas_extra: num(e.horas_extra),
            deducciones: round2(deducciones),
            // Del trabajador (van al recibo): ISSS y RAP.
            isss: ihss,
            rap,
            inpcafam,
            // Del patrono (van a la planilla del patrono): IHSS y RPV.
            ihss: ihssEmpleador,
            ihss_empleador: ihssEmpleador,
            rpv: rpvEmpleador,
            rtn: round2(bruto - deducciones),
            neta: round2(bruto - deducciones),
            costo_total_empleador: round2(bruto + ihssEmpleador + rpvEmpleador),
            pagado: false,
            fecha_pago: null,
            comentarios: `Base ${base.toFixed(2)} + bonos ${bonos.toFixed(2)} - ISSS ${ihss.toFixed(2)} - RAP ${rap.toFixed(2)}`
              + ` | Patrono: IHSS ${ihssEmpleador.toFixed(2)} + RPV ${rpvEmpleador.toFixed(2)}`,
          };
        });

        const totalNeto = round2(recibos.reduce((s, r) => s + r.neta, 0));

        /* Recalcular NO puede borrar el pago ya realizado. Si un recibo del
           mismo periodo ya está pagado, recuperamos pagado/fecha_pago antes
           del upsert; de lo contrario un recálculo reabriría una nómina que
           el usuario ya había pagado. */
        const { data: yaPagos } = await supabase.from('nomina')
          .select('empleado_id,pagado,fecha_pago')
          .eq('empresa_codigo', tenant).eq('anio', anio).eq('mes', mes).eq('pagado', true);
        const pagos = new Map((yaPagos || []).map(p => [String(p.empleado_id), p]));
        recibos.forEach(r => {
          const p = pagos.get(String(r.empleado_id));
          if (p) { r.pagado = true; r.fecha_pago = p.fecha_pago; }
        });

        // Persistir: una nómina por empleado y periodo (upsert por clave).
        const { error: eIns } = await supabase.from('nomina').upsert(recibos,
          { onConflict: 'empresa_codigo,empleado_id,anio,mes' });
        if (eIns) {
          if (eIns.code === '42P01' || /relation .* does not exist/i.test(String(eIns.message))) {
            return res.status(404).json({ error: 'La tabla nomina aún no existe.', code: 'MIGRATION_PENDING', tabla: 'nomina' });
          }
          return res.status(500).json({ error: eIns.message });
        }

        return res.json({
          recibos, total_neto: totalNeto,
          total_costo_empleador: round2(recibos.reduce((s, r) => s + r.costo_total_empleador, 0)),
          anio, mes,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  router.get('/api/rrhh/nomina',
    requirePlanFeature(F_RRHH),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();
        const mes = parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
        const { data, error } = await supabase.from('nomina')
          .select('*').eq('empresa_codigo', tenant).eq('anio', anio).eq('mes', mes)
          .order('empleado_id');
        if (error) return res.status(500).json({ error: error.message });
        const recibos = data || [];
        return res.json({
          recibos,
          total_neto: round2(recibos.reduce((s, r) => s + num(r.neta || r.rtn), 0)),
          anio, mes,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Recibo imprimible de un empleado para un periodo. */
  router.get('/api/rrhh/recibo/:empleadoId',
    requirePlanFeature(F_RRHH),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const anio = parseInt(req.query.anio, 10) || new Date().getFullYear();
        const mes = parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
        const { data: empleado } = await supabase.from('empleados')
          .select('*').eq('id', req.params.empleadoId).eq('empresa_codigo', tenant).maybeSingle();
        if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
        const { data: recibo } = await supabase.from('nomina')
          .select('*').eq('empresa_codigo', tenant).eq('empleado_id', req.params.empleadoId)
          .eq('anio', anio).eq('mes', mes).maybeSingle();
        if (!recibo) return res.status(404).json({ error: `No hay nómina calculada para ${anio}-${String(mes).padStart(2, '0')}.` });
        return res.json({ recibo: { ...recibo, empleado } });
      } catch (err) { return handleServerError(res, err); }
    });

  router.put('/api/rrhh/nomina/:id/pagar',
    requirePlanFeature(F_RRHH),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data, error } = await supabase.from('nomina')
          .update({ pagado: true, fecha_pago: new Date().toISOString() })
          .eq('id', req.params.id).eq('empresa_codigo', tenant).select().maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Recibo de nómina no encontrado' });
        return res.json({ recibo: data, success: true });
      } catch (err) { return handleServerError(res, err); }
    });

  // ───────────────────────────────────────────────────────────────
  // 3. FISCAL_ADVANCED — feature 'fiscal_avanzado' (Club / Enterprise /
  //    Personalizado)
  // ───────────────────────────────────────────────────────────────
  const F_FISCAL = 'fiscal_avanzado';

  crearRecurso(router, deps, {
    tabla: 'retenciones', feature: F_FISCAL,
    ruta: '/api/fiscal/retenciones', clave: 'retenciones', claveSingular: 'retencion',
    etiqueta: 'Retención', orden: { column: 'fecha', asc: false },
    columnasFiltro: ['periodo_fiscal', 'tipo', 'estado'],
    requeridos: ['proveedor', 'tipo'],
    desdeBody: (b) => b?.retencion || b || {},
    construir: (b, tenant) => {
      const tipo = idem(b.tipo) || 'ISR';
      const tipoPersoneria = idem(b.tipo_personeria) || 'PERSONERIA_JURIDICA';
      const tabla = ALICUOTAS_RETENCION[String(tipoPersoneria).toLowerCase()] || ALICUOTAS_RETENCION.personeria_juridica;
      const pct = b.porcentaje !== undefined && b.porcentaje !== null && b.porcentaje !== ''
        ? num(b.porcentaje)
        : (tabla[tipo] ?? 0);
      const base = num(b.monto_base);
      const monto = b.monto !== undefined && b.monto !== null && b.monto !== ''
        ? num(b.monto)
        : round2(base * pct);
      const fecha = soloFecha(b.fecha);
      return {
        empresa_codigo: tenant,
        tipo,
        proveedor: txt(b.proveedor, 150),
        proveedor_rtn: txt(b.proveedor_rtn, 30) || null,
        tipo_personeria: String(tipoPersoneria).toLowerCase(),
        monto_base: base,
        porcentaje: pct,
        monto,
        fecha,
        periodo_fiscal: txt(b.periodo_fiscal, 7) || periodoDe(fecha),
        estado: txt(b.estado, 20) || 'registrada',
        comprobante: txt(b.comprobante, 60) || null,
        notas: txt(b.notas, 500) || null,
      };
    },
    actualizar: (b) => {
      const u = {};
      ['proveedor', 'estado', 'comprobante', 'notas', 'periodo_fiscal'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      if (b.tipo !== undefined) u.tipo = idem(b.tipo);
      if (b.proveedor_rtn !== undefined) u.proveedor_rtn = txt(b.proveedor_rtn, 30);
      if (b.tipo_personeria !== undefined) u.tipo_personeria = String(b.tipo_personeria).toLowerCase();
      ['monto_base', 'porcentaje', 'monto'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      if (b.fecha !== undefined) u.fecha = soloFecha(b.fecha);
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      if (!fila.proveedor_rtn || !fila.periodo_fiscal) return null;
      const { data } = await sb.from('retenciones').select('*')
        .eq('empresa_codigo', tenant).eq('tipo', fila.tipo)
        .eq('proveedor_rtn', fila.proveedor_rtn).eq('periodo_fiscal', fila.periodo_fiscal).maybeSingle();
      return data || null;
    },
  });

  router.get('/api/fiscal/retenciones-resumen',
    requirePlanFeature(F_FISCAL),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data, error } = await supabase.from('retenciones')
          .select('tipo,monto,periodo_fiscal,estado').eq('empresa_codigo', tenant);
        if (error) return res.status(500).json({ error: error.message });
        const porTipo = {}, porPeriodo = {};
        let total = 0;
        (data || []).forEach(r => {
          const m = num(r.monto);
          total += m;
          porTipo[r.tipo] = round2((porTipo[r.tipo] || 0) + m);
          porPeriodo[r.periodo_fiscal] = round2((porPeriodo[r.periodo_fiscal] || 0) + m);
        });
        return res.json({
          total: round2(total), por_tipo: porTipo, por_periodo: porPeriodo,
          retenciones: (data || []).length,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Libros contables: saldos por cuenta. Lee cuentas_contables + asientos, y
     por lo tanto comparte el gate de operacion_completa para el plan de
     cuentas pero exige fiscal_avanzado para el libro completo. */
  router.get('/api/fiscal/libros',
    requirePlanFeature(F_FISCAL),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const periodo = txt(req.query.periodo, 7);
        let qAs = supabase.from('asientos_contables').select('id,fecha,concepto,estado').eq('empresa_codigo', tenant);
        if (periodo) qAs = qAs.gte('fecha', `${periodo}-01`).lte('fecha', `${periodo}-31`);
        const { data: asientos, error } = await qAs.order('fecha', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        const ids = (asientos || []).map(a => a.id);
        let detalle = [];
        if (ids.length) {
          // Defense in depth: los asientos ya vienen filtrados por tenant,
          // pero el detalle se vuelve a filtrar. Si mañana alguien cambia el
          // scope de arriba, aquí no se cuela nada de otra empresa.
          const { data: d } = await supabase.from('asientos_contables_detalle')
            .select('*').in('asiento_id', ids).eq('empresa_codigo', tenant);
          detalle = d || [];
        }
        const { data: cuentas } = await supabase.from('cuentas_contables')
          .select('*').eq('empresa_codigo', tenant).order('codigo');
        const porCuenta = {};
        detalle.forEach(d => {
          const k = d.cuenta_codigo;
          porCuenta[k] = porCuenta[k] || { cuenta: k, nombre: d.cuenta_nombre || '', debe: 0, haber: 0 };
          porCuenta[k].debe = round2(porCuenta[k].debe + num(d.debe));
          porCuenta[k].haber = round2(porCuenta[k].haber + num(d.haber));
        });
        const libros = (cuentas || []).map(c => {
          const mov = porCuenta[c.codigo];
          return {
            codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, nivel: c.nivel,
            debe: mov ? mov.debe : 0,
            haber: mov ? mov.haber : 0,
            saldo: round2((mov ? mov.debe : 0) - (mov ? mov.haber : 0)),
          };
        });
        return res.json({ libros, periodo: periodo || null, asientos: (asientos || []).length });
      } catch (err) { return handleServerError(res, err); }
    });

  crearRecurso(router, deps, {
    tabla: 'documentos_sar', feature: F_FISCAL,
    ruta: '/api/fiscal/documentos-sar', clave: 'documentos', claveSingular: 'documento',
    etiqueta: 'Documento', orden: { column: 'created_at', asc: false },
    columnasFiltro: ['estado_sar'],
    desdeBody: (b) => b?.documento || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      // factura_id es uuid en la BD: un string no-uuid lo convertía en
      // error 22P02 de Postgres. Se valida antes de insertar.
      factura_id: uuidOrNull(b.factura_id),
      serie: txt(b.serie, 10) || null,
      correlativo: txt(b.correlativo, 20) || null,
      cae: txt(b.cae, 60) || null,
      receptor_nombre: txt(b.receptor_nombre, 150) || null,
      receptor_rtn: txt(b.receptor_rtn, 30) || null,
      total: num(b.total),
      estado_sar: txt(b.estado_sar, 20) || 'pendiente',
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['notas', 'estado_sar', 'cae', 'respuesta_sar', 'correlativo', 'serie'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 2000); });
      if (b.total !== undefined) u.total = num(b.total);
      if (b.estado_sar !== undefined) u.fecha_envio = new Date().toISOString();
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      if (!fila.correlativo || !fila.serie) return null;
      const { data } = await sb.from('documentos_sar').select('*')
        .eq('empresa_codigo', tenant).eq('serie', fila.serie).eq('correlativo', fila.correlativo).maybeSingle();
      return data || null;
    },
  });

  // ───────────────────────────────────────────────────────────────
  // 4. CRM_ADVANCED — feature 'crm_avanzado' (Club / Enterprise /
  //    Personalizado)
  // ───────────────────────────────────────────────────────────────
  const F_CRM = 'crm_avanzado';

  crearRecurso(router, deps, {
    tabla: 'crm_leads', feature: F_CRM,
    ruta: '/api/crm-avanzado/leads', clave: 'leads', claveSingular: 'lead',
    etiqueta: 'Lead', orden: { column: 'created_at', asc: false },
    columnasFiltro: ['etapa', 'estado', 'origen'],
    requeridos: ['nombre'],
    desdeBody: (b) => b?.lead || b || {},
    construir: (b, tenant, req) => ({
      empresa_codigo: tenant,
      // usuario_id sale del JWT, nunca del body: el cliente no puede
      // atribuir un lead a otro usuario.
      usuario_id: req?.user?.sub || null,
      nombre: txt(b.nombre, 150),
      contacto: txt(b.contacto, 120) || null,
      telefono: txt(b.telefono, 30) || null,
      email: txt(b.email, 150) || null,
      origen: txt(b.origen, 40) || null,
      etapa: txt(b.etapa, 30) || 'nuevo',
      valor_estimado: num(b.valor_estimado),
      probabilidad: Math.max(0, Math.min(100, num(b.probabilidad))),
      fecha_cierre_esperada: b.fecha_cierre_esperada ? soloFecha(b.fecha_cierre_esperada) : null,
      perdido_motivo: txt(b.perdido_motivo, 300) || null,
      notas: txt(b.notas, 1000) || null,
      estado: txt(b.estado, 20) || 'activo',
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'contacto', 'telefono', 'email', 'origen', 'etapa', 'perdido_motivo', 'notas', 'estado']
        .forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 1000); });
      ['valor_estimado', 'probabilidad'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      if (b.fecha_cierre_esperada !== undefined) u.fecha_cierre_esperada = b.fecha_cierre_esperada ? soloFecha(b.fecha_cierre_esperada) : null;
      return u;
    },
    idempotencia: null,
  });

  /* Pipeline: valor ponderado por etapa. Lo que de verdad un dueño de
     pulpería quiere ver: "tengo L.X en negociación". */
  router.get('/api/crm-avanzado/pipeline',
    requirePlanFeature(F_CRM),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data, error } = await supabase.from('crm_leads')
          .select('etapa,valor_estimado,probabilidad,estado').eq('empresa_codigo', tenant).eq('estado', 'activo');
        if (error) return res.status(500).json({ error: error.message });
        const porEtapa = {};
        let total = 0, ponderado = 0;
        (data || []).forEach(l => {
          const v = num(l.valor_estimado);
          const e = txt(l.etapa, 30) || 'nuevo';
          porEtapa[e] = porEtapa[e] || { etapa: e, count: 0, valor: 0, ponderado: 0 };
          porEtapa[e].count += 1;
          porEtapa[e].valor = round2(porEtapa[e].valor + v);
          const p = num(l.probabilidad) / 100;
          porEtapa[e].ponderado = round2(porEtapa[e].ponderado + v * p);
          total = round2(total + v);
          ponderado = round2(ponderado + v * p);
        });
        return res.json({ etapas: Object.values(porEtapa), total, ponderado, leads: (data || []).length });
      } catch (err) { return handleServerError(res, err); }
    });

  crearRecurso(router, deps, {
    tabla: 'crm_campanas', feature: F_CRM,
    ruta: '/api/crm-avanzado/campanas', clave: 'campanas', claveSingular: 'campana',
    etiqueta: 'Campaña', orden: { column: 'fecha_inicio', asc: false },
    columnasFiltro: ['estado', 'canal'],
    requeridos: ['nombre'],
    desdeBody: (b) => b?.campana || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      nombre: txt(b.nombre, 150),
      canal: txt(b.canal, 30) || 'whatsapp',
      segmento: txt(b.segmento, 120) || null,
      fecha_inicio: soloFecha(b.fecha_inicio),
      fecha_fin: b.fecha_fin ? soloFecha(b.fecha_fin) : null,
      presupuesto: num(b.presupuesto),
      invertido: num(b.invertido),
      objetivo: txt(b.objetivo, 300) || null,
      resultados: txt(b.resultados, 1000) || null,
      estado: txt(b.estado, 20) || 'planeada',
      notas: txt(b.notas, 1000) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'canal', 'segmento', 'objetivo', 'resultados', 'estado', 'notas'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 1000); });
      ['presupuesto', 'invertido'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      if (b.fecha_inicio !== undefined) u.fecha_inicio = soloFecha(b.fecha_inicio);
      if (b.fecha_fin !== undefined) u.fecha_fin = b.fecha_fin ? soloFecha(b.fecha_fin) : null;
      return u;
    },
    idempotencia: null,
  });

  crearRecurso(router, deps, {
    tabla: 'crm_segmentos', feature: F_CRM,
    ruta: '/api/crm-avanzado/segmentos', clave: 'segmentos', claveSingular: 'segmento',
    etiqueta: 'Segmento', orden: { column: 'nombre', asc: true },
    requeridos: ['nombre'],
    desdeBody: (b) => b?.segmento || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      nombre: txt(b.nombre, 120),
      descripcion: txt(b.descripcion, 500) || null,
      criterios: normalizarCriterios(b.criterios),
      total_clientes: 0,
      activa: b.activa === undefined ? true : !!b.activa,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'descripcion'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      if (b.criterios !== undefined) u.criterios = normalizarCriterios(b.criterios);
      if (b.activa !== undefined) u.activa = !!b.activa;
      if (b.total_clientes !== undefined) u.total_clientes = parseInt(b.total_clientes, 10) || 0;
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('crm_segmentos').select('*')
        .eq('empresa_codigo', tenant).eq('nombre', fila.nombre).maybeSingle();
      return data || null;
    },
  });

  /* Cuenta cuántos clientes reales caen en cada segmento (no un número
     inventado como antes, que venía hardcoded en la pantalla). */
  router.post('/api/crm-avanzado/segmentos/:id/calcular',
    requirePlanFeature(F_CRM),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data: seg } = await supabase.from('crm_segmentos')
          .select('*').eq('id', req.params.id).eq('empresa_codigo', tenant).maybeSingle();
        if (!seg) return res.status(404).json({ error: 'Segmento no encontrado' });
        const crit = seg.criterios || {};
        const minimo = num(crit.minimo);
        const maximo = num(crit.maximo);
        const desdeDias = parseInt(crit.ultima_compra_dias, 10);
        const desde = desdeDias > 0
          ? new Date(Date.now() - desdeDias * 86400000).toISOString().slice(0, 10) : null;

        let q = supabase.from('clientes').select('*').eq('empresa_codigo', tenant);
        const { data: clientes, error } = await q;
        if (error) return res.status(500).json({ error: error.message });

        let total = 0;
        (clientes || []).forEach(c => {
          const activo = c.activo !== false;
          if (!activo) return;
          if (minimo > 0 && num(c.total_compras) < minimo) return;
          if (maximo > 0 && num(c.total_compras) > maximo) return;
          if (desde && String(c.ultima_compra || '').slice(0, 10) > desde) return;
          total += 1;
        });
        const { data, error: eUp } = await supabase.from('crm_segmentos')
          .update({ total_clientes: total, updated_at: new Date().toISOString() })
          .eq('id', req.params.id).eq('empresa_codigo', tenant).select().maybeSingle();
        if (eUp) return res.status(500).json({ error: eUp.message });
        return res.json({ segmento: data, total_clientes: total });
      } catch (err) { return handleServerError(res, err); }
    });

  crearRecurso(router, deps, {
    tabla: 'crm_fidelizacion', feature: F_CRM,
    ruta: '/api/crm-avanzado/fidelizacion', clave: 'programas', claveSingular: 'programa',
    etiqueta: 'Programa', orden: { column: 'nombre', asc: true },
    requeridos: ['nombre'],
    desdeBody: (b) => b?.programa || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      nombre: txt(b.nombre, 120),
      tipo: txt(b.tipo, 20) || 'puntos',
      puntos_por_lemp: num(b.puntos_por_lemp, 1),
      minimo_canje: num(b.minimo_canje, 100),
      valor_punto: num(b.valor_punto, 1),
      vigencia_dias: parseInt(b.vigencia_dias, 10) || 365,
      estado: txt(b.estado, 20) || 'activo',
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'tipo', 'estado', 'notas'].forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      ['puntos_por_lemp', 'minimo_canje', 'valor_punto'].forEach(c => { if (b[c] !== undefined) u[c] = num(b[c]); });
      if (b.vigencia_dias !== undefined) u.vigencia_dias = parseInt(b.vigencia_dias, 10) || 365;
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('crm_fidelizacion').select('*')
        .eq('empresa_codigo', tenant).eq('nombre', fila.nombre).maybeSingle();
      return data || null;
    },
  });

  // ───────────────────────────────────────────────────────────────
  // 5. MULTI_EMPRESA — feature 'multiempresa' (ya existía; Club /
  //    Enterprise / Personalizado)
  // ───────────────────────────────────────────────────────────────
  const F_MULTI = 'multiempresa';

  /* VÍNCULOS ENTRE EMPRESAS — la parte de seguridad de este módulo.
     `empresas_filiales.codigo` lo escribía el cliente sin validar y el
     consolidado hacía .in('empresa_codigo', codigos) sobre transacciones.
     Eso permitía que un tenant registrara el código de otro y obtuviera
     sus cifras consolidadas: fuga real entre empresas.

     Ahora una filial solo puede existir si hay un VÍNCULO CONFIRMADO por
     la propia empresa hija. El padre solicita, el admin del hijo acepta,
     y solo entonces el consolidado puede leer los datos de esa filial. */
  router.get('/api/multi-empresa/vinculos',
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data, error } = await supabase.from('empresa_vinculos')
          .select('*').eq('padre_codigo', tenant).order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ vinculos: data || [] });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Solicitudes donde ESTA empresa es la hija: las/admin de la filial
     decide si cede sus cifras a la matriz. */
  router.get('/api/multi-empresa/vinculos/recibidos',
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data, error } = await supabase.from('empresa_vinculos')
          .select('*').eq('hija_codigo', tenant).eq('estado', 'pendiente')
          .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ solicitudes: data || [] });
      } catch (err) { return handleServerError(res, err); }
    });

  router.post('/api/multi-empresa/vinculos',
    requireTenantAdmin,
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const padre = normalizeTenantCode(getTenantCode(req));
        const hija = normalizeTenantCode(req.body?.hija_codigo);
        if (!hija) return res.status(400).json({ error: 'Indica el código de la empresa filial.' });
        if (hija === padre) {
          return res.status(400).json({ error: 'Una empresa no puede ser filial de sí misma.' });
        }
        // La filial debe existir como empresa real en el catálogo.
        const { data: existe } = await supabase.from('empresas')
          .select('codigo,nombre,estado').eq('codigo', hija).maybeSingle();
        if (!existe) {
          return res.status(400).json({ error: `No existe una empresa con el código "${hija}".` });
        }
        if (String(existe.estado || '').toLowerCase() === 'suspendida') {
          return res.status(400).json({ error: 'Esa empresa está suspendida y no puede vincularse.' });
        }
        const participacion = num(req.body?.participacion, 100);
        if (participacion <= 0 || participacion > 100) {
          return res.status(400).json({ error: 'La participación debe estar entre 0 y 100%.' });
        }
        const { data, error } = await supabase.from('empresa_vinculos').upsert({
          padre_codigo: padre,
          hija_codigo: hija,
          participacion,
          estado: 'pendiente',
          solicitado_por: req.user?.sub || null,
          confirmado_por: null,
          confirmado_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'padre_codigo,hija_codigo' }).select().maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json({
          vinculo: data,
          mensaje: `Se envió la solicitud a ${existe.nombre}. El consolidado se activa cuando esa empresa la acepte.`,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  router.put('/api/multi-empresa/vinculos/:id',
    requireTenantAdmin,
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const { data: vinculo } = await supabase.from('empresa_vinculos')
          .select('*').eq('id', req.params.id).maybeSingle();
        if (!vinculo) return res.status(404).json({ error: 'Vínculo no encontrado' });

        /* Solo la HIJA acepta o rechaza su propio vínculo. Que el padre
           no pueda auto-confirmarse es justamente lo que cierra la fuga. */
        if (normalizeTenantCode(vinculo.hija_codigo) !== tenant) {
          return res.status(403).json({
            error: 'Solo la empresa filial puede confirmar o rechazar este vínculo.',
            code: 'NO_AUTORIZADO',
          });
        }
        /* idem() normaliza a MAYÚSCULAS (sirve para los códigos de
           empresa). Si se compara contra una lista en minúsculas, NINGÚN
           estado sería válido: confirmar o rechazar un vínculo daba 400
           siempre y el flujo de autorización de filiales quedaba muerto. */
        const estado = idem(req.body?.estado).toLowerCase();
        if (!['confirmado', 'rechazado'].includes(estado)) {
          return res.status(400).json({ error: "El estado debe ser 'confirmado' o 'rechazado'." });
        }
        const { data, error } = await supabase.from('empresa_vinculos').update({
          estado,
          confirmado_por: req.user?.sub || null,
          confirmado_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', req.params.id).select().maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ vinculo: data, success: true });
      } catch (err) { return handleServerError(res, err); }
    });

  /* Filiales declaradas por ESTA empresa. El código debe existir como
     empresa real en el catálogo y ser distinto del propio tenant. La
     autorización para consolidar vive en empresa_vinculos. */
  async function filialValida(tenant, codigo) {
    const c = normalizeTenantCode(codigo);
    if (!c) return { ok: false, error: 'El código de la filial es obligatorio.' };
    if (c === tenant) return { ok: false, error: 'La filial debe ser una empresa distinta a la tuya.' };
    const { data } = await supabase.from('empresas')
      .select('codigo,nombre,estado').eq('codigo', c).maybeSingle();
    if (!data) return { ok: false, error: `No existe una empresa registrada con el código "${c}".` };
    return { ok: true, empresa: data };
  }

  crearRecurso(router, deps, {
    tabla: 'empresas_filiares', feature: F_MULTI,
    ruta: '/api/multi-empresa/filiales', clave: 'filiales', claveSingular: 'filial',
    etiqueta: 'Filial', orden: { column: 'nombre', asc: true },
    requeridos: ['codigo', 'nombre'],
    desdeBody: (b) => b?.filial || b || {},
    // En POST el código es obligatorio; en PUT solo se valida si viene.
    validar: async (b, tenant) => {
      const p = b?.participacion;
      if (p !== undefined && p !== null && p !== '') {
        const n = num(p, -1);
        if (n <= 0 || n > 100) {
          return { ok: false, error: 'La participación debe estar entre 0 y 100%.' };
        }
      }
      if (b?.codigo === undefined) return { ok: true };
      return filialValida(tenant, b.codigo);
    },
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      codigo: normalizeTenantCode(b.codigo),
      nombre: txt(b.nombre, 150),
      rtn: txt(b.rtn, 30) || null,
      actividad: txt(b.actividad, 200) || null,
      pais: idem(b.pais) || 'HN',
      ciudad: txt(b.ciudad, 80) || null,
      direccion: txt(b.direccion, 300) || null,
      telefono: txt(b.telefono, 30) || null,
      email: txt(b.email, 150) || null,
      participacion: num(b.participacion, 100),
      estado: txt(b.estado, 20) || 'activa',
      notas: txt(b.notas, 500) || null,
    }),
    actualizar: (b) => {
      const u = {};
      ['nombre', 'rtn', 'actividad', 'ciudad', 'direccion', 'telefono', 'email', 'estado', 'notas']
        .forEach(c => { if (b[c] !== undefined) u[c] = txt(b[c], 500); });
      if (b.pais !== undefined) u.pais = idem(b.pais);
      if (b.participacion !== undefined) u.participacion = num(b.participacion, 100);
      // Cambiar el código revalida contra el catálogo de empresas.
      if (b.codigo !== undefined) u.codigo = normalizeTenantCode(b.codigo);
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('empresas_filiares').select('*')
        .eq('empresa_codigo', tenant).eq('codigo', fila.codigo).maybeSingle();
      return data || null;
    },
  });

  crearRecurso(router, deps, {
    tabla: 'tipos_cambio', feature: F_MULTI,
    ruta: '/api/multi-empresa/tipos-cambio', clave: 'tipos_cambio', claveSingular: 'tipo_cambio',
    etiqueta: 'Tipo de cambio', orden: { column: 'fecha', asc: false },
    columnasFiltro: ['moneda'],
    requeridos: ['tasa'],
    desdeBody: (b) => b?.tipo_cambio || b || {},
    construir: (b, tenant) => ({
      empresa_codigo: tenant,
      moneda: idem(b.moneda) || 'USD',
      fecha: soloFecha(b.fecha),
      tasa: num(b.tasa, -1),
      fuente: txt(b.fuente, 20) || 'manual',
      notas: txt(b.notas, 300) || null,
    }),
    actualizar: (b) => {
      const u = {};
      if (b.tasa !== undefined) u.tasa = num(b.tasa);
      if (b.fuente !== undefined) u.fuente = txt(b.fuente, 20);
      if (b.notas !== undefined) u.notas = txt(b.notas, 300);
      if (b.fecha !== undefined) u.fecha = soloFecha(b.fecha);
      return u;
    },
    idempotencia: async (sb, tenant, fila) => {
      const { data } = await sb.from('tipos_cambio').select('*')
        .eq('empresa_codigo', tenant).eq('moneda', fila.moneda).eq('fecha', fila.fecha).maybeSingle();
      return data || null;
    },
  });

  /* Consolidado: suma los ingresos/egresos de cada filial registrada a
     partir de SUS propias transacciones, ponderado por participación. */
  router.post('/api/multi-empresa/consolidado/calcular',
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        const periodo = txt(req.body?.periodo, 7) || periodoDe();

        const { data: filiales } = await supabase.from('empresas_filiales')
          .select('*').eq('empresa_codigo', tenant);

        /* Lista blanca: solo las filiales que ELLAS MISMAS confirmaron el
           vínculo pueden aportar cifras. Antes bastaba con escribir el
           código de otra empresa para leer su consolidado. */
        const { data: vinculos } = await supabase.from('empresa_vinculos')
          .select('hija_codigo,participacion')
          .eq('padre_codigo', tenant).eq('estado', 'confirmado');
        const autorizadas = new Map((vinculos || []).map(v => [
          normalizeTenantCode(v.hija_codigo), num(v.participacion, 100),
        ]));

        const { data: propias } = await supabase.from('transacciones')
          .select('tipo,monto,fecha').eq('empresa_codigo', tenant);

        // Solo los códigos de la lista blanca llegan al .in().
        const codigosAutorizados = (filiales || [])
          .map(f => normalizeTenantCode(f.codigo))
          .filter(c => autorizadas.has(c));

        const { data: hijas } = codigosAutorizados.length
          ? await supabase.from('transacciones')
            .select('empresa_codigo,tipo,monto,fecha')
            .in('empresa_codigo', codigosAutorizados)
          : { data: [] };

        const detalle = [];
        let ingresos = 0, egresos = 0;
        const acumulado = (nombre, codigo, participacion, tx) => {
          let ing = 0, egr = 0;
          (tx || []).forEach(t => {
            const fecha = String(t.fecha || '');
            if (periodo && !fecha.startsWith(periodo)) return;
            const m = num(t.monto);
            const tipo = String(t.tipo || '').toLowerCase();
            if (['ingreso', 'venta', 'cobro'].includes(tipo)) ing += m; else egr += m;
          });
          const part = num(participacion, 100) / 100;
          ingresos += ing * part;
          egresos += egr * part;
          detalle.push({
            filial: nombre || codigo, codigo,
            participacion: num(participacion, 100),
            ingresos: round2(ing), egresos: round2(egr),
            utilidad: round2(ing - egr), consolidada: round2((ing - egr) * part),
          });
        };

        for (const f of filiales || []) {
          const codigo = normalizeTenantCode(f.codigo);
          if (!autorizadas.has(codigo)) continue;
          const tx = (hijas || []).filter(t => normalizeTenantCode(t.empresa_codigo) === codigo);
          acumulado(f.nombre, codigo, autorizadas.get(codigo), tx);
        }
        acumulado(null, tenant, 100, propias || []);

        const fila = {
          empresa_codigo: tenant,
          periodo,
          ingresos: round2(ingresos),
          egresos: round2(egresos),
          utilidad: round2(ingresos - egresos),
          estado: 'calculado',
        };
        const { data, error } = await supabase.from('consolidados_financieros')
          .upsert(fila, { onConflict: 'empresa_codigo,periodo' }).select().maybeSingle();
        if (error) return res.status(500).json({ error: error.message });

        /* Se reportan las filiales declaradas pero NO autorizadas para que la
           UI diga por qué el total está incompleto, en vez de mostrar un
           consolidado silenciosamente más bajo. */
        const pendientes = (filiales || [])
          .filter(f => !autorizadas.has(normalizeTenantCode(f.codigo)))
          .map(f => ({ codigo: f.codigo, nombre: f.nombre, motivo: 'sin_vinculo_confirmado' }));

        return res.json({
          consolidado: data, detalle, periodo,
          filiales_pendientes: pendientes,
          mensaje: pendientes.length
            ? `${pendientes.length} filial(es) no se incluyen: todavía no aceptaron compartir sus datos.`
            : null,
        });
      } catch (err) { return handleServerError(res, err); }
    });

  router.get('/api/multi-empresa/consolidado',
    requirePlanFeature(F_MULTI),
    (req, res, next) => { if (!requireSupabase(res)) return; next(); },
    async (req, res) => {
      try {
        const tenant = normalizeTenantCode(getTenantCode(req));
        let q = supabase.from('consolidados_financieros').select('*').eq('empresa_codigo', tenant);
        if (req.query.periodo) q = q.eq('periodo', txt(req.query.periodo, 7));
        const { data, error } = await q.order('periodo', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ consolidados: data || [] });
      } catch (err) { return handleServerError(res, err); }
    });

  return router;
};

function normalizarCriterios(c) {
  if (c && typeof c === 'object') return c;
  if (typeof c === 'string') {
    try { const p = JSON.parse(c); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
  }
  return {};
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports.TASAS_NOMINA_DEFAULT = TASAS_NOMINA_DEFAULT;
module.exports.ALICUOTAS_RETENCION = ALICUOTAS_RETENCION;