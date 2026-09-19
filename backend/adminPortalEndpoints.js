/* ═══════════════════════════════════════════════════════════════
   ADMIN PORTAL ENDPOINTS (/api/admin/*)
   Endpoints de solo lectura (y gestión ligera) para las páginas del
   panel admin pp/. Todos requieren autenticación + rol ROOT.
   Se registran como router desde server.js:

     const adminPortal = require('./adminPortalEndpoints');
     app.use('/api/admin', adminPortal);

   Cada handler degrada con elegancia si una tabla aún no fue
   migrada (PostgreSQL 42P01 undefined_table).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const express = require('express');
const { supabase } = require('./supabaseClient');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

// ── Guards (idénticos a server.js; re-definidos aquí por desacople) ──
function normalizeTenantCode(code) {
  return (code || '').toString().trim().toUpperCase();
}

function isRootUser(req) {
  const codigo = normalizeTenantCode(req.user?.empresa_codigo);
  const role = (req.user?.rol || '').toString().trim().toLowerCase();
  const rootCodes = ['ROOT', 'ROOT PP'];
  const rootRoles = ['root', 'root pp', 'superadmin'];
  return rootCodes.includes(codigo) || rootRoles.some(r => role === r);
}

router.use((req, res, next) => {
  if (!isRootUser(req)) {
    return res.status(403).json({ error: 'Esta acción requiere un usuario ROOT.' });
  }
  next();
});

// ── Helpers ─────────────────────────────────────────────────────
function sinTabla(res, e, tabla) {
  if (e && (e.code === '42P01' || /relation .* does not exist|schema cache/i.test(String(e.message || '')))) {
    return res.status(404).json({ error: `La tabla ${tabla} aún no existe. Aplica la migración correspondiente en Supabase.`, code: 'MIGRATION_PENDING', tabla });
  }
  return null;
}

function handleError(res, e, tabla) {
  const pend = sinTabla(res, e, tabla);
  if (pend) return pend;
  console.error('[ADMIN_API]', e?.message || e);
  return res.status(500).json({ error: e?.message || 'Error interno' });
}

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

// ═══ 1) SOPORTE — pp/tickets_soporte.html ═══════════════════════
router.get('/tickets', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('id, ticket_id, empresa_codigo, empresa, nombre, email, telefono, plan, categoria, prioridad, estado, mensaje, asignado_a, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return handleError(res, error, 'support_tickets');
    return res.json({ tickets: data || [] });
  } catch (e) { return handleError(res, e, 'support_tickets'); }
});

router.patch('/tickets/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.asignado_a !== undefined) update.asignado_a = b.asignado_a;
    if (b.prioridad) update.prioridad = String(b.prioridad).slice(0, 20);
    if (b.estado) update.estado = String(b.estado).slice(0, 30);
    if (b.nota) update.respuesta_admin = String(b.nota).slice(0, 5000);
    const { error } = await supabase.from('support_tickets').update(update).eq('id', req.params.id);
    if (error) return handleError(res, error, 'support_tickets');

    // Notificar al cliente in-app si quedó con respuesta y tiene empresa identifiable
    let notificado = false;
    if (b.nota && b.estado && b.empresa_codigo && b.empresa_codigo !== 'ROOT') {
      try {
        const { data: tRow } = await supabase.from('support_tickets').select('empresa_codigo, nombre').eq('id', req.params.id).maybeSingle();
        if (tRow && tRow.empresa_codigo && tRow.empresa_codigo.toUpperCase() !== 'ROOT') {
          await supabase.from('notificaciones').insert({
            empresa_codigo: tRow.empresa_codigo,
            titulo: 'Respuesta a tu ticket de soporte',
            mensaje: String(b.nota).slice(0, 800),
            tipo: 'info',
            prioridad: 'normal',
            link: '/empresa/support'
          });
          notificado = true;
        }
      } catch (e) { console.warn('[ADMIN_API] notif ticket:', e.message); }
    }
    return res.json({ success: true, notificado });
  } catch (e) { return handleError(res, e, 'support_tickets'); }
});

// ═══ 2) BOTS — pp/bot_detail.html ═══════════════════════════════
router.get('/bots', async (req, res) => {
  try {
    let q = supabase.from('automatizaciones').select('id, empresa_codigo, nombre, descripcion, icono, estado, tareas, exito, trigger_flow, accion, created_at');
    if (req.query.tenant) q = q.eq('empresa_codigo', normalizeTenantCode(req.query.tenant));
    const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
    if (error) return handleError(res, error, 'automatizaciones');
    return res.json({ bots: data || [] });
  } catch (e) { return handleError(res, e, 'automatizaciones'); }
});

router.get('/bots/:id/detail', async (req, res) => {
  try {
    const { data: bot, error } = await supabase.from('automatizaciones').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return handleError(res, error, 'automatizaciones');
    if (!bot) return res.status(404).json({ error: 'Bot no encontrado' });

    const [runsRes, rulesRes] = await Promise.all([
      supabase.from('automation_runs').select('*')
        .or(`automatizacion_id.eq.${req.params.id},agente.eq.${(bot.nombre || '').replace(/,/g, '')}`)
        .order('created_at', { ascending: false }).limit(100).then(r => r, () => ({ data: [] })),
      supabase.from('automation_rules').select('id, empresa_codigo, nombre, descripcion, event_type, activo, created_at')
        .or(`automatizacion_id.eq.${req.params.id},agente.eq.${(bot.nombre || '').replace(/,/g, '')}`)
        .order('created_at', { ascending: false }).limit(50).then(r => r, () => ({ data: [] }))
    ]);
    if (!runsRes.error && (!runsRes.data || !runsRes.data.length) && bot.nombre) {
      const r2 = await supabase.from('automation_runs').select('*').eq('agente', bot.nombre).order('created_at', { ascending: false }).limit(100);
      runsRes.data = r2.data || [];
    }
    return res.json({ bot, runs: runsRes.data || [], rules: (rulesRes.data || []).filter(r => r.empresa_codigo === bot.empresa_codigo) });
  } catch (e) { return handleError(res, e, 'automatizaciones'); }
});

// ═══ 3) RENOVACIONES — pp/renovaciones.html ═════════════════════
router.get('/renovaciones', async (req, res) => {
  try {
    const [subsRes, tenRes, renRes, planRes] = await Promise.all([
      supabase.from('subscriptions').select('*').order('updated_at', { ascending: false }).limit(500).then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa, plan').limit(500).then(r => r, () => ({ data: [] })),
      supabase.from('renovaciones').select('id, empresa_codigo, tipo, monto, created_at').order('created_at', { ascending: false }).limit(300).then(r => r, () => ({ data: [] })),
      supabase.from('planes').select('id, clave, nombre, precio_mensual').limit(50).then(r => r, () => ({ data: [] }))
    ]);
    const precioPorPlanId = {};
    const precioPorClave = {};
    (planRes.data || []).forEach(p => { precioPorPlanId[p.id] = Number(p.precio_mensual) || 0; precioPorClave[p.clave] = Number(p.precio_mensual) || 0; });
    const nombrePorCodigo = {};
    const planPorCodigo = {};
    (tenRes.data || []).forEach(t => { nombrePorCodigo[t.codigo] = t.nombre_empresa; planPorCodigo[t.codigo] = t.plan; });

    const suscripciones = (subsRes.data || []).map(s => {
      const precioPlan = (s.plan_id && precioPorPlanId[s.plan_id]) || precioPorClave[planPorCodigo[s.empresa_codigo]] || null;
      const ultima = (renRes.data || []).find(r => r.empresa_codigo === s.empresa_codigo);
      return {
        empresa_codigo: s.empresa_codigo,
        empresa_nombre: nombrePorCodigo[s.empresa_codigo] || s.empresa_codigo,
        plan: planPorCodigo[s.empresa_codigo] || null,
        estado: s.estado,
        current_period_end: s.current_period_end,
        trial_ends_at: s.trial_ends_at,
        monto_mensual: precioPlan,
        proveedor_pago: s.proveedor_pago || 'manual',
        ultima_renovacion: ultima ? ultima.created_at : null
      };
    });
    return res.json({ suscripciones, renovaciones: renRes.data || [] });
  } catch (e) { return handleError(res, e, 'subscriptions'); }
});

// ═══ 4) COBRANZA — pp/facturas_cliente.html ═════════════════════
router.get('/cobranza', async (req, res) => {
  try {
    const [facRes, recRes, ncRes, tenRes] = await Promise.all([
      supabase.from('facturas').select('id, empresa_id, empresa_codigo, correlativo, cliente_nombre, total, estado, created_at').order('created_at', { ascending: false }).limit(2000).then(r => r, () => ({ data: [] })),
      supabase.from('recibos').select('id, empresa_id, empresa_codigo, correlativo, cliente_nombre, total, estado, created_at').order('created_at', { ascending: false }).limit(2000).then(r => r, () => ({ data: [] })),
      supabase.from('notas_credito').select('id, empresa_id, empresa_codigo, correlativo, cliente_nombre, total, estado, created_at').order('created_at', { ascending: false }).limit(2000).then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa').limit(500).then(r => r, () => ({ data: [] }))
    ]);
    const nombrePorCodigo = {};
    (tenRes.data || []).forEach(t => { nombrePorCodigo[t.codigo] = t.nombre_empresa; });

    const documentos = [
      ...(facRes.data || []).map(f => Object.assign(f, { tipo: 'factura' })),
      ...(recRes.data || []).map(r => Object.assign(r, { tipo: 'recibo' })),
      ...(ncRes.data || []).map(n => Object.assign(n, { tipo: 'nota_credito' }))
    ];
    const tenants = [];
    const vistos = new Set();
    for (const d of documentos) {
      const c = d.empresa_codigo;
      if (!c || vistos.has(c)) continue;
      vistos.add(c);
      const docs = documentos.filter(x => x.empresa_codigo === c);
      const facturas = docs.filter(x => x.tipo === 'factura' && x.estado !== 'anulada');
      const totalFacturado = facturas.reduce((s, x) => s + (Number(x.total) || 0), 0);
      const totalCobrado = docs.filter(x => x.tipo === 'recibo').reduce((s, x) => s + (Number(x.total) || 0), 0);
      const totalNC = docs.filter(x => x.tipo === 'nota_credito').reduce((s, x) => s + (Number(x.total) || 0), 0);
      const hoy = Date.now();
      const facturasVencidas = facturas.filter(x => x.estado !== 'pagada' && hoy - new Date(x.created_at || 0).getTime() > 30 * 86400000).length;
      tenants.push({
        empresa_codigo: c,
        empresa_nombre: nombrePorCodigo[c] || c,
        total_facturas: facturas.length,
        total_facturado: totalFacturado,
        total_cobrado: totalCobrado,
        total_notas_credito: totalNC,
        saldo: Math.max(0, totalFacturado - totalCobrado - totalNC),
        facturas_vencidas: facturasVencidas
      });
    }
    return res.json({ tenants, documentos });
  } catch (e) { return handleError(res, e, 'facturas'); }
});

// ═══ 5) ALERTAS — pp/alertas.html ═══════════════════════════════
router.get('/alertas', async (req, res) => {
  try {
    const hace7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const mes = mesActual();

    const [segRes, usageRes, botsRes, limitRes] = await Promise.all([
      supabase.from('seguridad_eventos').select('id, empresa_codigo, evento, severidad, descripcion, usuario_email, ip, created_at')
        .in('severidad', ['warning', 'critical']).gte('created_at', hace7d).order('created_at', { ascending: false }).limit(100).then(r => r, () => ({ data: [] })),
      supabase.from('tenant_usage').select('empresa_codigo, recurso, cantidad').eq('periodo', mes).then(r => r, () => ({ data: [] })),
      supabase.from('automation_runs').select('id, empresa_codigo, agente, mensaje, nivel, created_at')
        .eq('nivel', 'error').gte('created_at', hace7d).order('created_at', { ascending: false }).limit(60).then(r => r, () => ({ data: [] })),
      supabase.from('plan_limits').select('plan_id, recurso, maximo').then(r => r, () => ({ data: [] }))
    ]);

    // Mapa plan_id → límites para detectar uso superado
    const planDeTenant = {};
    try {
      const { data: subs } = await supabase.from('subscriptions').select('empresa_codigo, plan_id');
      (subs || []).forEach(s => { planDeTenant[s.empresa_codigo] = s.plan_id; });
    } catch (e) { /* opcional */ }
    const limiteDe = (empresa, recurso) => {
      const planId = planDeTenant[empresa];
      const lim = (limitRes.data || []).find(l => l.plan_id === planId && l.recurso === recurso);
      return lim ? Number(lim.maximo) : null;
    };

    const alertas = [];
    (segRes.data || []).forEach(ev => alertas.push({
      id: 'seg:' + ev.id, tipo: 'seguridad', severidad: ev.severidad, empresa_codigo: ev.empresa_codigo,
      titulo: ev.evento, descripcion: ev.descripcion || (ev.usuario_email ? 'Usuario: ' + ev.usuario_email : ''), fecha: ev.created_at
    }));
    (usageRes.data || []).forEach(u => {
      const max = limiteDe(u.empresa_codigo, u.recurso);
      if (max && Number(u.cantidad) >= max * 0.8) {
        alertas.push({
          id: 'lim:' + u.empresa_codigo + ':' + u.recurso, tipo: 'limite',
          severidad: Number(u.cantidad) >= max ? 'critical' : 'warning', empresa_codigo: u.empresa_codigo,
          titulo: `${u.recurso} al ${Math.round(u.cantidad / max * 100)}% del plan`,
          descripcion: `Consumo ${u.cantidad} de ${max} en el periodo ${mes}.`, fecha: new Date().toISOString()
        });
      }
    });
    (botsRes.data || []).forEach(b => alertas.push({
      id: 'bot:' + b.id, tipo: 'bot', severidad: 'critical', empresa_codigo: b.empresa_codigo,
      titulo: `Bot fallido: ${b.agente || 'automatización'}`, descripcion: b.mensaje || '', fecha: b.created_at
    }));

    return res.json({ alertas });
  } catch (e) { return handleError(res, e, 'seguridad_eventos'); }
});

// ═══ 6) CONSUMO VS PLANES — pp/consumo_planes.html ══════════════
router.get('/consumo_planes', async (req, res) => {
  try {
    const periodo = String(req.query.periodo || mesActual());
    const [usageRes, limitRes, planRes, subRes, tenRes] = await Promise.all([
      supabase.from('tenant_usage').select('empresa_codigo, recurso, cantidad').eq('periodo', periodo).then(r => r, () => ({ data: [] })),
      supabase.from('plan_limits').select('plan_id, recurso, maximo').then(r => r, () => ({ data: [] })),
      supabase.from('planes').select('id, clave, nombre').then(r => r, () => ({ data: [] })),
      supabase.from('subscriptions').select('empresa_codigo, plan_id').then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa, plan').then(r => r, () => ({ data: [] }))
    ]);
    const nombrePorId = {}, clavePorId = {};
    (planRes.data || []).forEach(p => { nombrePorId[p.id] = p.nombre; clavePorId[p.id] = p.clave; });
    const planIdDe = {}, nombreDe = {}, planClaveDe = {};
    (subRes.data || []).forEach(s => { planIdDe[s.empresa_codigo] = s.plan_id; });
    (tenRes.data || []).forEach(t => { nombreDe[t.codigo] = t.nombre_empresa; planClaveDe[t.codigo] = t.plan; });
    const limiteDe = (planId, recurso) => {
      const lim = (limitRes.data || []).find(l => l.plan_id === planId && l.recurso === recurso);
      return lim ? Number(lim.maximo) : null;
    };
    const filas = (usageRes.data || []).map(u => {
      const pid = planIdDe[u.empresa_codigo] || null;
      return {
        empresa_codigo: u.empresa_codigo,
        empresa_nombre: nombreDe[u.empresa_codigo] || u.empresa_codigo,
        plan: (pid && nombrePorId[pid]) || planClaveDe[u.empresa_codigo] || null,
        recurso: u.recurso,
        cantidad: Number(u.cantidad) || 0,
        maximo: limiteDe(pid, u.recurso)
      };
    });
    return res.json({ periodo, filas });
  } catch (e) { return handleError(res, e, 'tenant_usage'); }
});

// ═══ 7) PLANES (wizard provisionar) ═════════════════════════════
router.get('/planes', async (req, res) => {
  try {
    const [planRes, featRes] = await Promise.all([
      supabase.from('planes').select('id, clave, nombre, descripcion, precio_mensual').order('orden', { ascending: true }).then(r => r, () => ({ data: [] })),
      supabase.from('plan_features').select('feature').then(r => r, () => ({ data: [] }))
    ]);
    return res.json({
      planes: planRes.data || [],
      features: [...new Set((featRes.data || []).map(f => f.feature))]
    });
  } catch (e) { return handleError(res, e, 'planes'); }
});

// ═══ 8) PROVISIONAR TENANT (wizard) ═════════════════════════════
router.post('/provisionar', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.nombre || !b.emailAdmin || !b.plan) {
      return res.status(400).json({ error: 'nombre, emailAdmin y plan son requeridos' });
    }
    // Delegar en el endpoint existente POST /api/tenants reutilizando req/res:
    req.body = {
      nombre: b.nombre, dominio: b.dominio, plan: b.plan, emailAdmin: b.emailAdmin,
      pais: b.pais, zonaHoraria: b.zonaHoraria, notas: b.notas
    };
    const endpointTenants = req.app._router;
    let respuesta = null;
    const fakeRes = {
      status(code) { this._code = code; return this; },
      json(body) { respuesta = { code: this._code, body }; return this; }
    };
    // Ejecutar el handler real registrado en server.js buscando la ruta POST /api/tenants
    const capa = (endpointTenants && endpointTenants.stack || []).filter(l => l.route && l.route.path === '/api/tenants' && l.route.methods.post);
    if (!capa.length) return res.status(501).json({ error: 'POST /api/tenants no registrado' });
    await capa[0].route.stack[capa[0].route.stack.length - 1].handle(req, fakeRes, () => {});
    if (!respuesta || respuesta.code >= 400) {
      return res.status((respuesta && respuesta.code) || 500).json((respuesta && respuesta.body) || { error: 'Error al crear el tenant' });
    }
    const codigo = respuesta.body?.tenant?.codigo;
    // Features extras + API keys
    const apikeysCreadas = [];
    if (Array.isArray(b.features) && b.features.length && codigo) {
      for (const f of b.features.slice(0, 50)) {
        await supabase.from('tenant_features').insert({ empresa_codigo: codigo, feature_key: String(f).slice(0, 60), enabled: true }).then(r => r, e => console.warn('[ADMIN_API] feature:', e.message));
      }
    }
    if (Array.isArray(b.apikeys) && b.apikeys.length && codigo) {
      for (const nombre of b.apikeys.slice(0, 10)) {
        const nombreK = String(nombre).slice(0, 120);
        const clave = 'pk_live_' + require('crypto').randomBytes(24).toString('hex');
        const ins = await supabase.from('api_keys').insert({ empresa_codigo: codigo, nombre: nombreK, clave: clave, clave_prefix: clave.slice(0, 14), activa: true })
          .then(r => r, e => ({ error: e }));
        if (ins.error) console.warn('[ADMIN_API] apikey:', ins.error.message);
        else apikeysCreadas.push({ nombre: nombreK, clave });
      }
    }
    return res.status(201).json({
      tenant: { codigo, nombre: b.nombre, email_admin: b.emailAdmin, link_primer_acceso: true },
      apikeys: apikeysCreadas
    });
  } catch (e) { return handleError(res, e, 'tenants'); }
});

// ═══ 9) INTEGRACIONES — pp/integraciones.html ═══════════════════
router.get('/integraciones', async (req, res) => {
  try {
    const [intRes, tenRes] = await Promise.all([
      supabase.from('tenant_integrations').select('empresa_codigo, integration_key, enabled, connected_at, config').order('empresa_codigo').then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa').limit(500).then(r => r, () => ({ data: [] }))
    ]);
    // Errores recientes de sincronización: si existen runs con nivel error relacionados (best-effort)
    const errores = {};
    try {
      const hace7d = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: runs } = await supabase.from('automation_runs')
        .select('empresa_codigo, agente, mensaje, created_at').eq('nivel', 'error').gte('created_at', hace7d).limit(100);
      (runs || []).forEach(r => { errores[r.empresa_codigo] = errores[r.empresa_codigo] || (r.mensaje || 'Error de sincronización'); });
    } catch (e) { /* opcional */ }

    const conexiones = {};
    (intRes.data || []).forEach(r => {
      conexiones[r.empresa_codigo] = conexiones[r.empresa_codigo] || {};
      conexiones[r.empresa_codigo][r.integration_key] = {
        enabled: r.enabled !== false,
        connected_at: r.connected_at,
        error_reciente: errores[r.empresa_codigo] || null
      };
    });
    // Catálogo espejo del backend (INTEGRACION_CATALOGO en server.js)
    const catalogo = [
      { key: 'whatsapp', nombre: 'WhatsApp Business', descripcion: 'Notificaciones de pedidos y estados por WhatsApp.', icono: 'fa-brands fa-whatsapp' },
      { key: 'telegram', nombre: 'Telegram', descripcion: 'Alertas operativas a canales de Telegram.', icono: 'fa-brands fa-telegram' },
      { key: 'correo', nombre: 'Correo (SMTP)', descripcion: 'Envío de facturas y notificaciones por correo.', icono: 'fa-solid fa-envelope' },
      { key: 'stripe', nombre: 'Stripe', descripcion: 'Cobros con tarjeta para la tienda en línea.', icono: 'fa-brands fa-stripe-s' },
      { key: 'mercadopago', nombre: 'Mercado Pago', descripcion: 'Pagos con tarjeta y transferencias (LATAM).', icono: 'fa-solid fa-money-bill-transfer' },
      { key: 'googlecal', nombre: 'Google Calendar', descripcion: 'Sincronización de citas y reservas.', icono: 'fa-brands fa-google' },
      { key: 'sheets', nombre: 'Google Sheets', descripcion: 'Exportación automática de reportes.', icono: 'fa-solid fa-table' }
    ];
    return res.json({
      catalogo,
      conexiones,
      empresas: (tenRes.data || []).map(t => ({ empresa_codigo: t.codigo, empresa_nombre: t.nombre_empresa }))
    });
  } catch (e) { return handleError(res, e, 'tenant_integrations'); }
});

// ═══ 10) SEGURIDAD Y ACCESOS — pp/seguridad_accesos.html ════════
router.get('/seguridad', async (req, res) => {
  try {
    const hace7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const [sesRes, evRes, keyRes, userRes] = await Promise.all([
      supabase.from('tenant_sessions').select('id, empresa_codigo, usuario_id, ip, dispositivo, ubicacion, ultimo_actividad, revocada')
        .order('ultimo_actividad', { ascending: false }).limit(300).then(r => r, () => ({ data: [] })),
      supabase.from('seguridad_eventos').select('id, empresa_codigo, evento, severidad, usuario_email, ip, dispositivo, created_at')
        .in('evento', ['login_fallido', 'password_changed', 'session_revoked', 'suspicious_activity'])
        .gte('created_at', hace7d).order('created_at', { ascending: false }).limit(200).then(r => r, () => ({ data: [] })),
      supabase.from('api_keys').select('id, empresa_codigo, nombre, clave_prefix, activa, ultimo_uso, created_at')
        .order('created_at', { ascending: false }).limit(500).then(r => r, () => ({ data: [] })),
      supabase.from('usuarios').select('id, nombre, apellido, email, empresa_codigo, two_factor_enabled').limit(1000).then(r => r, () => ({ data: [] }))
    ]);
    const uMap = {};
    (userRes.data || []).forEach(u => { uMap[u.id] = u; });
    const sesiones = (sesRes.data || []).map(s => ({
      id: s.id, empresa_codigo: s.empresa_codigo,
      usuario: s.usuario_id && uMap[s.usuario_id] ? `${uMap[s.usuario_id].nombre || ''} ${uMap[s.usuario_id].apellido || ''}`.trim() || uMap[s.usuario_id].email : '—',
      email: s.usuario_id && uMap[s.usuario_id] ? uMap[s.usuario_id].email : null,
      ip: s.ip, dispositivo: s.dispositivo, ubicacion: s.ubicacion,
      ultimo_actividad: s.ultimo_actividad, revocada: !!s.revocada
    }));
    // IPs sospechosas: agrupar eventos de seguridad por IP (≥3 eventos en 7d, o ≥2 usuarios)
    const porIp = {};
    (evRes.data || []).forEach(ev => {
      if (!ev.ip) return;
      porIp[ev.ip] = porIp[ev.ip] || { ip: ev.ip, empresas: new Set(), usuarios: new Set(), total_eventos: 0, ultimo_evento: ev.created_at };
      porIp[ev.ip].total_eventos += 1;
      if (ev.empresa_codigo) porIp[ev.ip].empresas.add(ev.empresa_codigo);
      if (ev.usuario_email) porIp[ev.ip].usuarios.add(ev.usuario_email);
    });
    const ips_sospechosas = Object.values(porIp)
      .filter(x => x.total_eventos >= 3 || x.usuarios.size >= 2)
      .map(x => ({ ip: x.ip, empresas: [...x.empresas].join(', '), usuarios: [...x.usuarios].join(', '), total_eventos: x.total_eventos, ultimo_evento: x.ultimo_evento }));
    return res.json({
      sesiones,
      fallidos: (evRes.data || []),
      ips_sospechosas,
      api_keys: (keyRes.data || []),
      dos_factores: (userRes.data || []).map(u => ({ email: u.email, empresa_codigo: u.empresa_codigo, habilitado: !!u.two_factor_enabled }))
    });
  } catch (e) { return handleError(res, e, 'tenant_sessions'); }
});

// ═══ 11) CONSUMO IA — pp/consumo_ia.html ════════════════════════
router.get('/consumo_ia', async (req, res) => {
  try {
    const mes = String(req.query.mes || mesActual());
    const desde = `${mes}-01T00:00:00Z`;
    const hasta = new Date(new Date(desde).getTime() + 31 * 86400000).toISOString();
    const [logRes, limitRes, planRes, subRes, tenRes] = await Promise.all([
      supabase.from('ai_usage_log').select('empresa_codigo, tokens_total, cost_estimated, success, funcion, created_at')
        .gte('created_at', desde).lt('created_at', hasta).limit(10000).then(r => r, () => ({ data: [] })),
      supabase.from('plan_limits').select('plan_id, recurso, maximo').eq('recurso', 'ai_tokens').then(r => r, () => ({ data: [] })),
      supabase.from('planes').select('id, clave, nombre').then(r => r, () => ({ data: [] })),
      supabase.from('subscriptions').select('empresa_codigo, plan_id').then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa').then(r => r, () => ({ data: [] }))
    ]);
    const nombreDe = {};
    (tenRes.data || []).forEach(t => { nombreDe[t.codigo] = t.nombre_empresa; });
    const planIdDe = {};
    (subRes.data || []).forEach(s => { planIdDe[s.empresa_codigo] = s.plan_id; });
    const topeDe = (empresa) => {
      const lim = (limitRes.data || []).find(l => l.plan_id === planIdDe[empresa]);
      return lim ? Number(lim.maximo) : null;
    };
    const porTenantMap = {};
    const porFuncion = {};
    (logRes.data || []).forEach(r => {
      const c = r.empresa_codigo;
      porTenantMap[c] = porTenantMap[c] || { empresa_codigo: c, empresa_nombre: nombreDe[c] || c, tokens: 0, llamadas: 0, exitosas: 0, fallidas: 0, costo: 0 };
      porTenantMap[c].tokens += Number(r.tokens_total) || 0;
      porTenantMap[c].llamadas += 1;
      if (r.success) porTenantMap[c].exitosas += 1; else porTenantMap[c].fallidas += 1;
      porTenantMap[c].costo += Number(r.cost_estimated) || 0;
      if (r.funcion) porFuncion[r.funcion] = (porFuncion[r.funcion] || 0) + 1;
    });
    const porTenant = Object.values(porTenantMap).map(t => Object.assign(t, { tope: topeDe(t.empresa_codigo) }));
    return res.json({ mes, porTenant, porFuncion });
  } catch (e) { return handleError(res, e, 'ai_usage_log'); }
});

// ═══ 12) INCIDENTES — pp/incidentes_tenant.html (tabla nueva) ═══
router.get('/incidentes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('incidentes').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) return handleError(res, error, 'incidentes');
    return res.json({ incidencias: data || [] });
  } catch (e) { return handleError(res, e, 'incidentes'); }
});

router.post('/incidentes', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.titulo) return res.status(400).json({ error: 'El título es requerido' });
    const payload = {
      empresa_codigo: normalizeTenantCode(b.empresa_codigo) || null,
      titulo: String(b.titulo).slice(0, 200),
      descripcion: String(b.descripcion || '').slice(0, 3000),
      severidad: ['critica', 'alta', 'media', 'baja'].includes(b.severidad) ? b.severidad : 'media',
      estado: 'abierta',
      responsable: null,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('incidentes').insert(payload).select().single();
    if (error) return handleError(res, error, 'incidentes');
    return res.status(201).json({ incidencia: data });
  } catch (e) { return handleError(res, e, 'incidentes'); }
});

router.patch('/incidentes/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.titulo) update.titulo = String(b.titulo).slice(0, 200);
    if (b.descripcion !== undefined) update.descripcion = String(b.descripcion || '').slice(0, 3000);
    if (b.severidad) update.severidad = b.severidad;
    if (b.estado) {
      update.estado = b.estado;
      if (b.estado === 'resuelta' || b.estado === 'cerrada') update.resuelta_at = new Date().toISOString();
      else update.resuelta_at = null;
    }
    if (b.resolucion !== undefined) update.resolucion = String(b.resolucion || '').slice(0, 3000);
    if (b.responsable !== undefined) update.responsable = b.responsable;
    const { data, error } = await supabase.from('incidentes').update(update).eq('id', req.params.id).select().single();
    if (error) return handleError(res, error, 'incidentes');
    return res.json({ incidencia: data });
  } catch (e) { return handleError(res, e, 'incidentes'); }
});

router.delete('/incidentes/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('incidentes').delete().eq('id', req.params.id);
    if (error) return handleError(res, error, 'incidentes');
    return res.json({ success: true });
  } catch (e) { return handleError(res, e, 'incidentes'); }
});

// ═══ 13) KYC / documentos — pp/validacion_tenant.html (tabla nueva) ══
router.get('/kyc', async (req, res) => {
  try {
    const [docsRes, tenRes] = await Promise.all([
      supabase.from('documentos_tenant').select('*').order('created_at', { ascending: false }).limit(500).then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa').limit(500).then(r => r, () => ({ data: [] }))
    ]);
    const nombrePorCodigo = {};
    (tenRes.data || []).forEach(t => { nombrePorCodigo[t.codigo] = t.nombre_empresa; });
    const expedientes = [];
    const vistos = new Set();
    (docsRes.data || []).forEach(d => {
      if (!vistos.has(d.empresa_codigo)) {
        vistos.add(d.empresa_codigo);
        expedientes.push({ empresa_codigo: d.empresa_codigo, empresa_nombre: nombrePorCodigo[d.empresa_codigo] || d.empresa_codigo, documentos: [] });
      }
    });
    (tenRes.data || []).forEach(t => {
      if (!vistos.has(t.codigo)) { vistos.add(t.codigo); expedientes.push({ empresa_codigo: t.codigo, empresa_nombre: t.nombre_empresa || t.codigo, documentos: [] }); }
    });
    (docsRes.data || []).forEach(d => {
      const exp = expedientes.find(e => e.empresa_codigo === d.empresa_codigo);
      if (exp) exp.documentos.push(d);
    });
    return res.json({ expedientes });
  } catch (e) { return handleError(res, e, 'documentos_tenant'); }
});

router.post('/kyc', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.empresa_codigo || !b.tipo || !b.url) return res.status(400).json({ error: 'empresa_codigo, tipo y url son requeridos' });
    const payload = {
      empresa_codigo: normalizeTenantCode(b.empresa_codigo),
      tipo: String(b.tipo).slice(0, 60),
      numero: String(b.numero || '').slice(0, 100) || null,
      url: String(b.url).slice(0, 1000),
      notas: String(b.notas || '').slice(0, 500) || null,
      estado: 'pendiente'
    };
    const { data, error } = await supabase.from('documentos_tenant').insert(payload).select().single();
    if (error) return handleError(res, error, 'documentos_tenant');
    return res.status(201).json({ documento: data });
  } catch (e) { return handleError(res, e, 'documentos_tenant'); }
});

router.patch('/kyc/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.estado) update.estado = ['pendiente', 'aprobado', 'rechazado'].includes(b.estado) ? b.estado : 'pendante';
    if (b.notas !== undefined) update.notas = String(b.notas || '').slice(0, 500);
    const { data, error } = await supabase.from('documentos_tenant').update(update).eq('id', req.params.id).select().single();
    if (error) return handleError(res, error, 'documentos_tenant');
    return res.json({ documento: data });
  } catch (e) { return handleError(res, e, 'documentos_tenant'); }
});

router.delete('/kyc/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('documentos_tenant').delete().eq('id', req.params.id);
    if (error) return handleError(res, error, 'documentos_tenant');
    return res.json({ success: true });
  } catch (e) { return handleError(res, e, 'documentos_tenant'); }
});

// ═══ 14) FINANZAS — pp/finanzas.html ════════════════════════════
router.get('/finanzas', async (req, res) => {
  try {
    const hace12m = new Date(Date.now() - 365 * 86400000).toISOString();
    const hace90d = new Date(Date.now() - 90 * 86400000).toISOString();

    const [payRes, subRes, planRes, tenRes] = await Promise.all([
      supabase.from('billing_payments').select('empresa_codigo, email, plan, amount, status, created_at')
        .gte('created_at', hace12m).limit(5000).then(r => r, () => ({ data: [] })),
      supabase.from('subscriptions').select('empresa_codigo, plan_id, estado, current_period_end, trial_ends_at').limit(1000).then(r => r, () => ({ data: [] })),
      supabase.from('planes').select('id, clave, nombre, precio_mensual').then(r => r, () => ({ data: [] })),
      supabase.from('tenants').select('codigo, nombre_empresa, plan, estado, created_at').limit(500).then(r => r, () => ({ data: [] }))
    ]);
    const precioPorPlanId = {};
    (planRes.data || []).forEach(p => { precioPorPlanId[p.id] = Number(p.precio_mensual) || 0; });
    const nombreDe = {};
    (tenRes.data || []).forEach(t => { nombreDe[t.codigo] = t.nombre_empresa; });

    // MRR: suma de precio mensual de suscripciones activas
    const pagados = (payRes.data || []).filter(p => ['completed', 'paid', 'success', 'aprobado'].includes(String(p.status || '').toLowerCase()));
    let mrr = 0;
    const mrrPorPlanMap = {};
    (subRes.data || []).forEach(s => {
      if (['active', 'trial'].includes(String(s.estado || '').toLowerCase())) {
        const precio = precioPorPlanId[s.plan_id] || 0;
        mrr += precio;
        const planNombre = (planRes.data || []).find(p => p.id === s.plan_id);
        const k = planNombre ? planNombre.nombre : 'Sin plan';
        mrrPorPlanMap[k] = (mrrPorPlanMap[k] || 0) + precio;
      }
    });
    // Fallback: si no hay subscriptions con precio, aproximar por pagos del último mes
    if (mrr === 0 && pagados.length) {
      const mesAtras = new Date(Date.now() - 30 * 86400000).toISOString();
      mrr = pagados.filter(p => p.created_at >= mesAtras).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    }

    // Serie mensual de cobranza
    const porMes = {};
    pagados.forEach(p => {
      const mes = (p.created_at || '').slice(0, 7);
      if (mes) porMes[mes] = (porMes[mes] || 0) + (Number(p.amount) || 0);
    });
    const ingresos_mensuales = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const mes = d.toISOString().slice(0, 7);
      ingresos_mensuales.push({ mes, total: porMes[mes] || 0 });
    }

    // Pagado por cliente en 12m
    const pagadoPorCliente = {};
    pagados.forEach(p => {
      if (!p.empresa_codigo) return;
      const c = normalizeTenantCode(p.empresa_codigo);
      pagadoPorCliente[c] = (pagadoPorCliente[c] || 0) + (Number(p.amount) || 0);
    });
    const top_clientes = Object.entries(pagadoPorCliente)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([codigo, total]) => {
        const sub = (subRes.data || []).find(s => s.empresa_codigo === codigo);
        const ten = (tenRes.data || []).find(t => t.codigo === codigo);
        const planNombre = sub && sub.plan_id ? (planRes.data || []).find(p => p.id === sub.plan_id)?.nombre : (ten?.plan || null);
        return { empresa_codigo: codigo, empresa_nombre: nombreDe[codigo] || codigo, plan: planNombre, pagado_12m: total, estado: sub ? sub.estado : (ten?.estado || '—') };
      });

    // Churn: clientes activos hace 90d que ya no lo están
    const activosHoy = new Set((subRes.data || []).filter(s => ['active', 'trial'].includes(String(s.estado || '').toLowerCase())).map(s => s.empresa_codigo));
    const activosPasados = new Set((tenRes.data || []).filter(t => t.created_at && t.created_at <= hace90d).map(t => t.codigo));
    const base = activosPasados.size || (tenRes.data || []).length || 0;
    const cancelados = [...activosPasados].filter(c => !activosHoy.has(c)).length;
    const churn_pct = base > 0 ? (cancelados / base * 100) : 0;

    // ARPU
    const tenantsActivos = Math.max(1, activosHoy.size || (tenRes.data || []).length || 1);
    const arpu = mrr / tenantsActivos;

    // Cobranza proyectada 30 días (vencimientos ≤30d)
    const en30 = new Date(Date.now() + 30 * 86400000).toISOString();
    let cobranza = 0;
    (subRes.data || []).forEach(s => {
      if (!['active', 'trial'].includes(String(s.estado || '').toLowerCase())) return;
      const fin = s.current_period_end || s.trial_ends_at;
      if (fin && fin <= en30) cobranza += precioPorPlanId[s.plan_id] || 0;
    });

    // Señales de churn
    const senales_churn = [];
    (subRes.data || []).forEach(s => {
      const hoy = Date.now();
      if (['expired'].includes(String(s.estado || '').toLowerCase())) {
        senales_churn.push({ empresa_codigo: s.empresa_codigo, empresa_nombre: nombreDe[s.empresa_codigo] || s.empresa_codigo, tipo: 'vencido', detalle: 'La suscripción está vencida; no generará renovación automática.' });
      } else if (['cancelled'].includes(String(s.estado || '').toLowerCase())) {
        senales_churn.push({ empresa_codigo: s.empresa_codigo, empresa_nombre: nombreDe[s.empresa_codigo] || s.empresa_codigo, tipo: 'cancelado', detalle: 'Suscripción cancelada.' });
      } else if (['suspended'].includes(String(s.estado || '').toLowerCase())) {
        senales_churn.push({ empresa_codigo: s.empresa_codigo, empresa_nombre: nombreDe[s.empresa_codigo] || s.empresa_codigo, tipo: 'suspendido', detalle: 'Cuenta suspendida.' });
      } else if (['active', 'trial'].includes(String(s.estado || '').toLowerCase())) {
        const fin = s.current_period_end || s.trial_ends_at;
        if (fin && new Date(fin).getTime() < hoy) {
          senales_churn.push({ empresa_codigo: s.empresa_codigo, empresa_nombre: nombreDe[s.empresa_codigo] || s.empresa_codigo, tipo: 'vencido', detalle: `El periodo terminó el ${String(fin).slice(0, 10)} y sigue marcada activa.` });
        }
      }
    });
    Object.keys(pagadoPorCliente).forEach(c => {
      if (!activosHoy.has(c)) {
        senales_churn.push({ empresa_codigo: c, empresa_nombre: nombreDe[c] || c, tipo: 'sin_pagos', detalle: 'Pagó en los últimos 12 meses pero ya no tiene suscripción activa.' });
      }
    });

    return res.json({
      mrr, arpu, churn_pct, cobranza_proyectada_30d: cobranza,
      ingresos_mensuales,
      mrr_por_plan: Object.entries(mrrPorPlanMap).map(([plan, v]) => ({ plan, mrr: v })),
      top_clientes, senales_churn: senales_churn.slice(0, 20)
    });
  } catch (e) { return handleError(res, e, 'billing_payments'); }
});

// ═══ 15) COMUNICADOS — pp/comunicados.html ══════════════════════
router.get('/comunicados', async (req, res) => {
  try {
    const { data, error } = await supabase.from('notificaciones')
      .select('id, empresa_codigo, titulo, mensaje, tipo, prioridad, link, created_at')
      .order('created_at', { ascending: false }).limit(100);
    if (error) return handleError(res, error, 'notificaciones');
    return res.json({ comunicados: data || [] });
  } catch (e) { return handleError(res, e, 'notificaciones'); }
});

router.post('/comunicados', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.titulo || !b.mensaje) return res.status(400).json({ error: 'titulo y mensaje son requeridos' });
    const base = {
      titulo: String(b.titulo).slice(0, 150),
      mensaje: String(b.mensaje).slice(0, 2000),
      tipo: ['info', 'warning', 'success', 'error'].includes(b.tipo) ? b.tipo : 'info',
      prioridad: ['baja', 'normal', 'alta', 'critica'].includes(b.prioridad) ? b.prioridad : 'normal',
      link: b.link ? String(b.link).slice(0, 500) : null,
      created_at: new Date().toISOString()
    };
    let destino = [];
    if (String(b.destino).toUpperCase() === 'ALL') {
      const { data: ten } = await supabase.from('tenants').select('codigo').limit(500);
      destino = (ten || []).map(t => t.codigo);
    } else {
      destino = [normalizeTenantCode(b.destino)];
    }
    if (!destino.length) return res.status(400).json({ error: 'No hay destinatarios' });
    const filas = destino.map(c => Object.assign({}, base, { empresa_codigo: c }));
    const { error } = await supabase.from('notificaciones').insert(filas);
    if (error) return handleError(res, error, 'notificaciones');
    return res.status(201).json({ success: true, destinatarios: destino.length, empresas: destino.length });
  } catch (e) { return handleError(res, e, 'notificaciones'); }
});

// ═══ 16) REGLAS DE ALERTAS — pp/reglas_alertas.html (tabla nueva) ═
router.get('/reglas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('reglas_alertas').select('*').order('created_at', { ascending: false });
    if (error) return handleError(res, error, 'reglas_alertas');
    return res.json({ reglas: data || [] });
  } catch (e) { return handleError(res, e, 'reglas_alertas'); }
});

router.post('/reglas', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.tipo) return res.status(400).json({ error: 'tipo es requerido' });
    const payload = {
      tipo: String(b.tipo).slice(0, 40),
      umbral: Number(b.umbral) || 1,
      nombre: String(b.nombre || '').slice(0, 150) || null,
      severidad: ['info', 'warning', 'critical'].includes(b.severidad) ? b.severidad : 'critical',
      activo: b.activo !== false
    };
    const { data, error } = await supabase.from('reglas_alertas').insert(payload).select().single();
    if (error) return handleError(res, error, 'reglas_alertas');
    return res.status(201).json({ regla: data });
  } catch (e) { return handleError(res, e, 'reglas_alertas'); }
});

router.patch('/reglas/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const update = { updated_at: new Date().toISOString() };
    if (b.tipo) update.tipo = b.tipo;
    if (b.umbral != null) update.umbral = Number(b.umbral) || 1;
    if (b.nombre !== undefined) update.nombre = b.nombre;
    if (b.severidad) update.severidad = b.severidad;
    if (b.activo !== undefined) update.activo = !!b.activo;
    const { data, error } = await supabase.from('reglas_alertas').update(update).eq('id', req.params.id).select().single();
    if (error) return handleError(res, error, 'reglas_alertas');
    return res.json({ regla: data });
  } catch (e) { return handleError(res, e, 'reglas_alertas'); }
});

router.delete('/reglas/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('reglas_alertas').delete().eq('id', req.params.id);
    if (error) return handleError(res, error, 'reglas_alertas');
    return res.json({ success: true });
  } catch (e) { return handleError(res, e, 'reglas_alertas'); }
});

// Evaluar reglas ahora: genera notificaciones para ROOT según umbrales
router.post('/reglas/evaluar', async (req, res) => {
  try {
    const { data: reglas } = await supabase.from('reglas_alertas').select('*').eq('activo', true);
    const activas = reglas || [];
    if (!activas.length) return res.json({ resultado: 'No hay reglas activas', notificaciones: 0 });
    const mes = mesActual();
    let generadas = 0;
    const notifs = [];

    for (const r of activas) {
      try {
        if (r.tipo === 'uso_plan') {
          const { data: usage } = await supabase.from('tenant_usage').select('empresa_codigo, recurso, cantidad').eq('periodo', mes);
          const { data: subs } = await supabase.from('subscriptions').select('empresa_codigo, plan_id');
          const { data: limits } = await supabase.from('plan_limits').select('plan_id, recurso, maximo').then(x => x, () => ({ data: [] }));
          const planDe = {}; (subs || []).forEach(s => { planDe[s.empresa_codigo] = s.plan_id; });
          (usage || []).forEach(u => {
            const lim = (limits || []).find(l => l.plan_id === planDe[u.empresa_codigo] && l.recurso === u.recurso);
            if (lim && lim.maximo > 0 && (u.cantidad / lim.maximo * 100) >= r.umbral) {
              notifs.push({ empresa_codigo: 'ROOT', titulo: `Regla: uso del plan (${u.recurso})`, mensaje: `${u.empresa_codigo}: ${u.recurso} al ${Math.round(u.cantidad / lim.maximo * 100)}% del límite.`, tipo: r.severidad === 'critical' ? 'error' : 'warning', prioridad: 'alta' });
            }
          });
        } else if (r.tipo === 'ticket_sla') {
          const corte = new Date(Date.now() - r.umbral * 3600000).toISOString();
          const { data: ticks } = await supabase.from('support_tickets').select('id, empresa_codigo, nombre, prioridad, created_at')
            .in('estado', ['open', 'in_progress']).lt('created_at', corte).limit(50);
          (ticks || []).forEach(t => notifs.push({ empresa_codigo: 'ROOT', titulo: 'Regla: ticket sin respuesta', mensaje: `Ticket de ${t.nombre || t.empresa_codigo || 'cliente'} lleva más de ${r.umbral}h sin resolver.`, tipo: 'warning', prioridad: 'alta' }));
        } else if (r.tipo === 'renovacion_proxima') {
          const limite = new Date(Date.now() + r.umbral * 86400000).toISOString();
          const { data: subs } = await supabase.from('subscriptions').select('empresa_codigo, estado, current_period_end, trial_ends_at').in('estado', ['active', 'trial']);
          (subs || []).forEach(s => {
            const fin = s.current_period_end || s.trial_ends_at;
            if (fin && fin >= new Date().toISOString() && fin <= limite) {
              notifs.push({ empresa_codigo: 'ROOT', titulo: 'Regla: renovación próxima', mensaje: `${s.empresa_codigo} vence el ${String(fin).slice(0, 10)} (menos de ${r.umbral} días).`, tipo: 'info', prioridad: 'normal' });
            }
          });
        } else if (r.tipo === 'fallos_bot') {
          const hace24 = new Date(Date.now() - 86400000).toISOString();
          const { data: runs } = await supabase.from('automation_runs').select('empresa_codigo, agente').eq('nivel', 'error').gte('created_at', hace24).limit(500);
          const porBot = {};
          (runs || []).forEach(x => { const k = x.empresa_codigo + ':' + (x.agente || '?'); porBot[k] = (porBot[k] || 0) + 1; });
          Object.entries(porBot).forEach(([k, n]) => {
            if (n >= r.umbral) {
              const [emp, bot] = k.split(':');
              notifs.push({ empresa_codigo: 'ROOT', titulo: 'Regla: bot fallando', mensaje: `${bot} de ${emp} acumuló ${n} fallos en 24h.`, tipo: 'error', prioridad: 'alta' });
            }
          });
        } else if (r.tipo === 'logins_fallidos') {
          const hace1h = new Date(Date.now() - 3600000).toISOString();
          const { data: evs } = await supabase.from('seguridad_eventos').select('empresa_codigo').eq('evento', 'login_fallido').gte('created_at', hace1h).limit(500);
          const porEmp = {};
          (evs || []).forEach(x => { porEmp[x.empresa_codigo] = (porEmp[x.empresa_codigo] || 0) + 1; });
          Object.entries(porEmp).forEach(([emp, n]) => {
            if (n >= r.umbral) notifs.push({ empresa_codigo: 'ROOT', titulo: 'Regla: logins fallidos', mensaje: `${emp}: ${n} intentos fallidos en la última hora.`, tipo: 'error', prioridad: 'critica' });
          });
        }
      } catch (e) { console.warn('[ADMIN_API] evaluar regla', r.tipo, e.message); }
    }

    if (notifs.length) {
      const dedup = [];
      const vistos = new Set();
      notifs.forEach(n => {
        const k = n.titulo + '|' + n.mensaje;
        if (!vistos.has(k)) { vistos.add(k); dedup.push(n); }
      });
      await supabase.from('notificaciones').insert(dedup.slice(0, 50));
      generadas = dedup.length;
    }
    // Registrar última evaluación
    await Promise.all(activas.map(r => supabase.from('reglas_alertas').update({ ultima_evaluacion: new Date().toISOString() }).eq('id', r.id).then(() => {}, () => {})));
    return res.json({ resultado: `Evaluación completada: ${generadas} notificación(es) generada(s).`, notificaciones: generadas });
  } catch (e) { return handleError(res, e, 'reglas_alertas'); }
});

// ═══ 17) STREAM — pp/logs_realtime.html ═════════════════════════
router.get('/stream', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const fuentes = String(req.query.fuentes || 'auditoria,automation_runs,seguridad_eventos').split(',').map(s => s.trim()).filter(Boolean);
    const tareas = [];
    if (fuentes.includes('auditoria')) {
      tareas.push(supabase.from('auditoria').select('id, empresa_codigo, accion, descripcion, usuario, created_at')
        .order('created_at', { ascending: false }).limit(limit).then(r => ({
          data: (r.data || []).map(x => ({ fuente: 'auditoria', id: x.id, created_at: x.created_at, empresa_codigo: x.empresa_codigo, mensaje: `${x.accion}${x.descripcion ? ': ' + x.descripcion : ''}`, usuario: x.usuario, nivel: 'info' }))
        }), () => ({ data: [] })));
    }
    if (fuentes.includes('automation_runs')) {
      tareas.push(supabase.from('automation_runs').select('id, empresa_codigo, agente, mensaje, nivel, created_at')
        .order('created_at', { ascending: false }).limit(limit).then(r => ({
          data: (r.data || []).map(x => ({ fuente: 'automation_runs', id: x.id, created_at: x.created_at, empresa_codigo: x.empresa_codigo, mensaje: `${x.agente ? x.agente + ' — ' : ''}${x.mensaje || 'ejecución'}`, nivel: x.nivel || 'info' }))
        }), () => ({ data: [] })));
    }
    if (fuentes.includes('seguridad_eventos')) {
      tareas.push(supabase.from('seguridad_eventos').select('id, empresa_codigo, evento, descripcion, usuario_email, severidad, created_at')
        .order('created_at', { ascending: false }).limit(limit).then(r => ({
          data: (r.data || []).map(x => ({ fuente: 'seguridad_eventos', id: x.id, created_at: x.created_at, empresa_codigo: x.empresa_codigo, mensaje: `${x.evento}${x.descripcion ? ': ' + x.descripcion : ''}`, usuario: x.usuario_email, nivel: x.severidad || 'info' }))
        }), () => ({ data: [] })));
    }
    const resultados = await Promise.all(tareas);
    const eventos = resultados.flatMap(r => r.data || [])
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, limit);
    return res.json({ eventos });
  } catch (e) { return handleError(res, e, 'auditoria'); }
});

// ═══ 18) RESPALDOS Y ROTACIÓN — pp/respaldos_y_rotacion.html ════
router.get('/respaldos', async (req, res) => {
  try {
    const [keyRes, sesRes, healthRes] = await Promise.all([
      supabase.from('api_keys').select('id, empresa_codigo, nombre, clave_prefix, activa, ultimo_uso, created_at')
        .order('created_at', { ascending: false }).limit(500).then(r => r, () => ({ data: [] })),
      supabase.from('tenant_sessions').select('id, empresa_codigo, usuario_id, ip, dispositivo, ultimo_actividad')
        .lt('ultimo_actividad', new Date(Date.now() - 30 * 86400000).toISOString())
        .eq('revocada', false).order('ultimo_actividad', { ascending: false }).limit(200).then(r => r, () => ({ data: [] })),
      fetch(process.env.SELF_HEALTH_URL || 'http://localhost:' + (process.env.PORT || 3000) + '/api/health')
        .then(r => r.json()).catch(() => null)
    ]);
    const uMap = {};
    try {
      const { data: users } = await supabase.from('usuarios').select('id, nombre, apellido, email').limit(1000);
      (users || []).forEach(u => { uMap[u.id] = `${(u.nombre || '')} ${(u.apellido || '')}`.trim() || u.email; });
    } catch (e) { /* opcional */ }
    return res.json({
      generado: new Date().toISOString(),
      api_keys: (keyRes.data || []).map(k => Object.assign(k, { edad_dias: diasDesde(k.created_at) })),
      sesiones_purga: (sesRes.data || []).map(s => Object.assign(s, { usuario: uMap[s.usuario_id] || null })),
      health: healthRes
    });
  } catch (e) { return handleError(res, e, 'api_keys'); }
});

// Revocar API key (desde bastidores)
router.delete('/respaldos/keys/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('api_keys').update({ activa: false }).eq('id', req.params.id);
    if (error) return handleError(res, error, 'api_keys');
    return res.json({ success: true });
  } catch (e) { return handleError(res, e, 'api_keys'); }
});

// Purgar (revocar) sesión antigua
router.delete('/respaldos/sesiones/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('tenant_sessions').update({ revocada: true }).eq('id', req.params.id);
    if (error) return handleError(res, error, 'tenant_sessions');
    return res.json({ success: true });
  } catch (e) { return handleError(res, e, 'tenant_sessions'); }
});

function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / 86400000);
}

module.exports = router;
