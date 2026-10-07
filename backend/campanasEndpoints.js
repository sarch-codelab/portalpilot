/* ═══════════════════════════════════════════════════════════════
   CAMPAÑAS DE EMAIL (/api/admin/campanas/* y /api/public/campana/*)
   Panel ROOT para envío de correos promocionales/masivos.

   - Admin (auth + ROOT): CRUD campañas, preview destinatarios,
     preparar, procesar por lotes, programar, cancelar, test,
     lista de bajas (suppression).
   - Público (sin auth): pixel de apertura, tracking de clicks y
     baja (unsubscribe) con cabecera List-Unsubscribe.

   Se registra como factory desde server.js:

     const campanas = require('./campanasEndpoints');
     const r = campanas.createRouter({ supabase, requireSupabase,
       handleServerError, normalizeTenantCode, enviarCorreo,
       registrarAuditoria, getPublicBaseUrl });
     app.use('/api/admin/campanas', authenticate, requireRoot, r.admin);
     app.use('/api/public/campana', r.publico);
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const express = require('express');
const crypto = require('crypto');

const BATCH_POR_INVOCACION = 25;   // correos por ejecución (límite serverless)
const DELAY_ENTRE_ENVIOS_MS = 250; // rate-limit suave entre correos
const MAX_DESTINATARIOS = 5000;    // tope de seguridad por campaña

function nuevoToken() {
  return crypto.randomBytes(18).toString('hex');
}

function htmlConfVisible(mensaje) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Portal Pilot</title></head>
  <body style="margin:0;background:#04040a;color:#c4c4d4;font-family:system-ui,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
    <div style="max-width:440px;padding:40px 28px;text-align:center;background:#0e0e1c;border:1px solid rgba(139,92,246,.25);border-radius:18px;margin:24px;">
      <img src="https://portal-pilot.vercel.app/img/iconos/robot_logo.png" alt="Portal Pilot" width="48" height="48" style="display:block;margin:0 auto 16px;">
      <h1 style="font-size:18px;color:#fff;margin:0 0 10px;">${mensaje.titulo}</h1>
      <p style="font-size:14px;line-height:1.6;color:#9ca3af;margin:0;">${mensaje.texto}</p>
    </div>
  </body></html>`;
}

module.exports.createRouter = function createRouter(deps) {
  const {
    supabase,
    requireSupabase,
    handleServerError,
    normalizeTenantCode,
    enviarCorreo,
    registrarAuditoria,
    getPublicBaseUrl,
    defaultFrom: defaultFromDep = ''
  } = deps;

  const admin = express.Router();
  admin.use(express.json({ limit: '2mb' }));

  const publico = express.Router();

  // ── Utilidades ────────────────────────────────────────────────
  function baseUrl(req) {
    if (typeof getPublicBaseUrl === 'function') {
      const v = getPublicBaseUrl(req);
      if (v) return String(v).replace(/\/+$/, '');
    }
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'portal-pilot.vercel.app';
    return `${proto}://${host}`;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function soloHttp(url) {
    try {
      const u = new URL(String(url));
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch (e) { /* noop */ }
    return null;
  }

  async function resolverDestinatarios(tipo, valor) {
    const vistos = new Set();
    const lista = [];
    const push = (u) => {
      const email = String(u && u.email || '').trim().toLowerCase();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
      if (vistos.has(email)) return;
      vistos.add(email);
      lista.push({
        email,
        nombre: (u && (u.nombre || '')) || null,
        empresa_codigo: (u && u.empresa_codigo) || null,
        usuario_id: (u && u.id) || null
      });
    };

    const t = String(tipo || 'all').toLowerCase();
  const fromPorDefecto = function () {
    if (defaultFromDep) return defaultFromDep;
    return 'Portal Pilot <portalpilot.hn@gmail.com>';
  };
    if (t === 'emails') {
      String(valor || '').split(/[\s,;]+/).forEach(e => push({ email: e }));
    } else {
      const columnas = 'id, nombre, email, empresa_codigo, activo, estado';
      let query = supabase.from('usuarios').select(columnas).not('email', 'is', null);
      if (t === 'tenant') {
        query = query.eq('empresa_codigo', normalizeTenantCode(valor));
      }
      query = query.limit(MAX_DESTINATARIOS);
      const { data, error } = await query;
      if (error) throw error;
      (data || []).forEach(u => {
        if (u.activo === false) return;
        if (u.estado && String(u.estado).toLowerCase() !== 'activo') return;
        push(u);
      });
    }

    // Excluir bajas (suppression)
    if (lista.length) {
      const emails = lista.map(x => x.email);
      const { data: sup } = await supabase.from('email_suppression').select('email').in('email', emails);
      const bloqueados = new Set((sup || []).map(s => String(s.email).toLowerCase()));
      return lista.filter(x => !bloqueados.has(x.email));
    }
    return lista;
  }

  // Reemplaza variables, envuelve enlaces y añade pixel + pie de baja.
  function renderContenido(html, destinatario, token, base) {
    const bajaUrl = `${base}/api/public/campana/unsubscribe/${token}`;
    let out = String(html == null ? '' : html);

    // 1) Envolver enlaces http(s) con tracking de click (excepto la baja)
    out = out.replace(/(<a\b[^>]*\bhref=)(["'])(https?:\/\/[^"']+)\2/gi, (m, pre, q, url) => {
      if (url.indexOf('/api/public/campana/') !== -1) return m;
      const track = `${base}/api/public/campana/click/${token}?u=${encodeURIComponent(url)}`;
      return `${pre}${q}${track}${q}`;
    });

    // 2) Variables de plantilla
    const nombre = (destinatario && destinatario.nombre) || 'cliente';
    const empresa = (destinatario && destinatario.empresa_codigo) || 'Portal Pilot';
    out = out.replace(/\{\{\s*nombre\s*\}\}/gi, esc(nombre))
      .replace(/\{\{\s*empresa\s*\}\}/gi, esc(empresa))
      .replace(/\{\{\s*email\s*\}\}/gi, esc(destinatario && destinatario.email || ''))
      .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, bajaUrl);

    const tieneBaja = out.toLowerCase().indexOf('unsubscribe') !== -1 || out.indexOf(bajaUrl) !== -1;

    // 3) Pixel de apertura
    const pixel = `<img src="${base}/api/public/campana/open/${token}" width="1" height="1" alt="" style="display:block;border:0;outline:none;width:1px;height:1px;">`;

    // 4) Pie de baja
    const pie = tieneBaja ? '' : `
      <div style="margin-top:28px;padding-top:16px;border-top:1px solid #2a2a3a;font-size:12px;color:#6b7280;text-align:center;font-family:Arial,sans-serif;">
        Recibiste este correo de Portal Pilot.
        <a href="${bajaUrl}" style="color:#8b5cf6;text-decoration:underline;">Cancelar suscripción</a>
      </div>`;

    if (/<\/body>/i.test(out)) {
      return out.replace(/<\/body>/i, `${pie}${pixel}</body>`);
    }
    return out + pie + pixel;
  }

  // Recalcula contadores de la campaña desde la tabla de destinatarios.
  async function recalcularStats(campanaId) {
    const cuenta = async (filtro) => {
      let q = supabase.from('campana_destinatarios').select('*', { count: 'exact', head: true }).eq('campana_id', campanaId);
      if (filtro) q = filtro(q);
      const { count } = await q;
      return count || 0;
    };
    const total = await cuenta();
    const enviados = await cuenta(q => q.eq('estado', 'enviado'));
    const errores = await cuenta(q => q.eq('estado', 'error'));
    const rebotes = await cuenta(q => q.eq('estado', 'rebotado'));
    const abiertos = await cuenta(q => q.not('abierto_at', 'is', null));
    const clicks = await cuenta(q => q.not('click_at', 'is', null));
    const { count: bajas } = await supabase.from('campana_eventos')
      .select('*', { count: 'exact', head: true }).eq('campana_id', campanaId).eq('tipo', 'unsubscribe');
    const stats = {
      total_destinatarios: total,
      enviados, errores, rebotes, abiertos, clicks,
      bajas: bajas || 0,
      updated_at: new Date().toISOString()
    };
    await supabase.from('campanas').update(stats).eq('id', campanaId);
    return stats;
  }

  // ═══ ADMIN: LISTAR ═════════════════════════════════════════════
  admin.get('/', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data, error } = await supabase.from('campanas')
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (error) return handleServerError(res, error);
      res.json({ campanas: data || [] });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: DETALLE ════════════════════════════════════════════
  admin.get('/:id', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data: campana, error } = await supabase.from('campanas').select('*').eq('id', req.params.id).maybeSingle();
      if (error) return handleServerError(res, error);
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      const { data: destinos } = await supabase.from('campana_destinatarios')
        .select('id,email,nombre,empresa_codigo,estado,error,enviado_at,abierto_at,click_at')
        .eq('campana_id', req.params.id).order('created_at', { ascending: true }).limit(500);
      const { data: eventos } = await supabase.from('campana_eventos')
        .select('tipo,url,created_at').eq('campana_id', req.params.id).order('created_at', { ascending: false }).limit(100);
      res.json({ campana, destinatarios: destinos || [], eventos: eventos || [] });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: CREAR ══════════════════════════════════════════════
  admin.post('/', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const b = req.body || {};
      if (!b.nombre || !b.asunto || !b.html) {
        return res.status(400).json({ error: 'nombre, asunto y html son requeridos' });
      }
      const fila = {
        nombre: String(b.nombre).slice(0, 200),
        asunto: String(b.asunto).slice(0, 300),
        html: String(b.html),
        texto: b.texto ? String(b.texto).slice(0, 20000) : null,
        remitente: b.remitente ? String(b.remitente).slice(0, 200) : fromPorDefecto(),
        destino_tipo: ['all', 'tenant', 'emails'].includes(b.destino_tipo) ? b.destino_tipo : 'all',
        destino_valor: b.destino_valor ? String(b.destino_valor).slice(0, 1000) : null,
        estado: 'borrador',
        created_by: (req.user && (req.user.email || req.user.nombre)) || 'root'
      };
      const { data, error } = await supabase.from('campanas').insert(fila).select().single();
      if (error) return handleServerError(res, error);
      await registrarAuditoria('ROOT', 'campana_creada', `Campaña creada: ${fila.nombre}`, 'campanas', fila.created_by, req);
      res.status(201).json({ campana: data });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: ACTUALIZAR ═════════════════════════════════════════
  admin.put('/:id', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const b = req.body || {};
      const upd = { updated_at: new Date().toISOString() };
      if (b.nombre != null) upd.nombre = String(b.nombre).slice(0, 200);
      if (b.asunto != null) upd.asunto = String(b.asunto).slice(0, 300);
      if (b.html != null) upd.html = String(b.html);
      if (b.texto != null) upd.texto = String(b.texto).slice(0, 20000);
      if (b.remitente != null) upd.remitente = String(b.remitente).slice(0, 200);
      if (b.destino_tipo != null && ['all', 'tenant', 'emails'].includes(b.destino_tipo)) upd.destino_tipo = b.destino_tipo;
      if (b.destino_valor != null) upd.destino_valor = String(b.destino_valor).slice(0, 1000);
      if (b.programada_at != null) upd.programada_at = b.programada_at || null;
      const { data: actual } = await supabase.from('campanas').select('estado,total_destinatarios').eq('id', req.params.id).maybeSingle();
      if (!actual) return res.status(404).json({ error: 'Campaña no encontrada' });
      if (['enviando', 'enviada'].includes(actual.estado) && (b.html != null || b.asunto != null)) {
        return res.status(409).json({ error: 'No se puede editar una campaña ya enviada o en envío' });
      }
      const { data, error } = await supabase.from('campanas').update(upd).eq('id', req.params.id).select().single();
      if (error) return handleServerError(res, error);
      res.json({ campana: data });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: ELIMINAR ═══════════════════════════════════════════
  admin.delete('/:id', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      await supabase.from('campana_eventos').delete().eq('campana_id', req.params.id);
      await supabase.from('campana_destinatarios').delete().eq('campana_id', req.params.id);
      const { error } = await supabase.from('campanas').delete().eq('id', req.params.id);
      if (error) return handleServerError(res, error);
      await registrarAuditoria('ROOT', 'campana_eliminada', `Campaña eliminada: ${req.params.id}`, 'campanas', (req.user && req.user.email) || 'root', req);
      res.json({ success: true });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: PREVIEW DE DESTINATARIOS ═══════════════════════════
  admin.post('/preview-destinatarios', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const b = req.body || {};
      const lista = await resolverDestinatarios(b.destino_tipo, b.destino_valor);
      const empresas = {};
      lista.forEach(d => { empresas[d.empresa_codigo || '—'] = (empresas[d.empresa_codigo || '—'] || 0) + 1; });
      res.json({
        total: lista.length,
        muestra: lista.slice(0, 20),
        por_empresa: Object.entries(empresas).map(([empresa_codigo, total]) => ({ empresa_codigo, total })).sort((a, b) => b.total - a.total).slice(0, 30)
      });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: TEST (envío de prueba) ═════════════════════════════
  admin.post('/:id/test', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'email requerido' });
      const { data: campana } = await supabase.from('campanas').select('*').eq('id', req.params.id).maybeSingle();
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      const token = nuevoToken();
      const base = baseUrl(req);
      const html = renderContenido(campana.html, { nombre: 'Prueba', email, empresa_codigo: 'TEST' }, token, base);
      const info = await enviarCorreo({
        to: email,
        from: campana.remitente || fromPorDefecto(),
        subject: '[PRUEBA] ' + campana.asunto,
        html,
        text: campana.texto || undefined,
        headers: {
          'List-Unsubscribe': `<${base}/api/public/campana/unsubscribe/${token}>, <mailto:portalpilot.hn@gmail.com?subject=unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      });
      res.json({
        success: true,
        enviado_a: email,
        messageId: info && info.messageId || null,
        accepted: (info && info.accepted) || [],
        rejected: (info && info.rejected) || [],
        smtp: (info && info.response) || null
      });
    } catch (e) {
      if (e && e.code === 'SMTP_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      handleServerError(res, e);
    }
  });

  // ═══ ADMIN: PREPARAR (resolver + insertar destinatarios) ═══════
  admin.post('/:id/preparar', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data: campana } = await supabase.from('campanas').select('*').eq('id', req.params.id).maybeSingle();
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      if (['enviando', 'enviada'].includes(campana.estado)) {
        return res.status(409).json({ error: 'La campaña ya está en envío o enviada' });
      }
      // Limpiar destinatarios y eventos previos
      await supabase.from('campana_eventos').delete().eq('campana_id', campana.id);
      await supabase.from('campana_destinatarios').delete().eq('campana_id', campana.id);
      const lista = await resolverDestinatarios(campana.destino_tipo, campana.destino_valor);
      if (!lista.length) return res.status(400).json({ error: 'No hay destinatarios para esta campaña' });
      const filas = lista.map(d => ({
        campana_id: campana.id,
        email: d.email,
        nombre: d.nombre,
        empresa_codigo: d.empresa_codigo,
        usuario_id: d.usuario_id,
        token: nuevoToken(),
        estado: 'pendiente'
      }));
      // Insertar en trozos para evitar payloads enormes
      for (let i = 0; i < filas.length; i += 500) {
        const { error } = await supabase.from('campana_destinatarios').insert(filas.slice(i, i + 500));
        if (error) return handleServerError(res, error);
      }
      await supabase.from('campanas').update({
        total_destinatarios: filas.length,
        enviados: 0, errores: 0, abiertos: 0, clicks: 0, rebotes: 0, bajas: 0,
        estado: 'borrador',
        updated_at: new Date().toISOString()
      }).eq('id', campana.id);
      res.json({ success: true, total: filas.length });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: PROCESAR LOTE (envía hasta BATCH pendientes) ═══════
  admin.post('/:id/procesar', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data: campana } = await supabase.from('campanas').select('*').eq('id', req.params.id).maybeSingle();
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      if (campana.estado === 'cancelada') return res.status(409).json({ error: 'Campaña cancelada' });

      if (campana.estado !== 'enviando') {
        await supabase.from('campanas').update({ estado: 'enviando', updated_at: new Date().toISOString() }).eq('id', campana.id);
      }

      const { data: pendientes, error } = await supabase.from('campana_destinatarios')
        .select('id,email,nombre,empresa_codigo,token')
        .eq('campana_id', campana.id).eq('estado', 'pendiente')
        .order('created_at', { ascending: true }).limit(BATCH_POR_INVOCACION);
      if (error) return handleServerError(res, error);

      const base = baseUrl(req);
      let enviados = 0, errores = 0;

      for (const d of (pendientes || [])) {
        // Re-chequear baja antes de enviar
        const { data: sup } = await supabase.from('email_suppression').select('email').eq('email', d.email).maybeSingle();
        if (sup) {
          await supabase.from('campana_destinatarios').update({ estado: 'rebotado', error: 'En baja (unsubscribe)' }).eq('id', d.id);
          continue;
        }
        const html = renderContenido(campana.html, d, d.token, base);
        try {
          const info = await enviarCorreo({
            to: d.email,
            from: campana.remitente || fromPorDefecto(),
            subject: campana.asunto,
            html,
            text: campana.texto || undefined,
            replyTo: 'portalpilot.hn@gmail.com',
            headers: {
              'List-Unsubscribe': `<${base}/api/public/campana/unsubscribe/${d.token}>, <mailto:portalpilot.hn@gmail.com?subject=unsubscribe>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
          });
          await supabase.from('campana_destinatarios').update({ estado: 'enviado', enviado_at: new Date().toISOString(), error: null }).eq('id', d.id);
          enviados++;
        } catch (err) {
          await supabase.from('campana_destinatarios').update({ estado: 'error', error: String(err && err.message || err).slice(0, 500) }).eq('id', d.id);
          errores++;
        }
        if (DELAY_ENTRE_ENVIOS_MS) await new Promise(r => setTimeout(r, DELAY_ENTRE_ENVIOS_MS));
      }

      const stats = await recalcularStats(campana.id);
      const pendientesRestantes = Math.max(0, stats.total_destinatarios - stats.enviados - stats.errores - stats.rebotes);
      if (pendientesRestantes === 0) {
        await supabase.from('campanas').update({ estado: 'enviada', enviada_at: new Date().toISOString() }).eq('id', campana.id);
        await registrarAuditoria('ROOT', 'campana_enviada', `Campaña enviada: ${campana.nombre} (${stats.enviados} correos)`, 'campanas', (req.user && req.user.email) || 'root', req);
      }
      res.json({
        success: true,
        lote: { enviados, errores },
        enviados: stats.enviados,
        pendientes: pendientesRestantes,
        finalizada: pendientesRestantes === 0,
        stats
      });
    } catch (e) {
      if (e && e.code === 'SMTP_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      handleServerError(res, e);
    }
  });

  // ═══ ADMIN: PROGRAMAR ══════════════════════════════════════════
  admin.post('/:id/programar', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const cuando = (req.body && req.body.programada_at) || null;
      if (!cuando) return res.status(400).json({ error: 'programada_at requerido' });
      const fecha = new Date(cuando);
      if (isNaN(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
      const { data: campana } = await supabase.from('campanas').select('total_destinatarios,estado').eq('id', req.params.id).maybeSingle();
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      if (!campana.total_destinatarios) return res.status(400).json({ error: 'Prepara los destinatarios antes de programar' });
      const { data, error } = await supabase.from('campanas')
        .update({ estado: 'programada', programada_at: fecha.toISOString(), updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) return handleServerError(res, error);
      res.json({ campana: data });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: CANCELAR ═══════════════════════════════════════════
  admin.post('/:id/cancelar', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data, error } = await supabase.from('campanas')
        .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().single();
      if (error) return handleServerError(res, error);
      res.json({ campana: data });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══ ADMIN: BAJAS (suppression) ════════════════════════════════
  admin.get('/suppression/lista', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { data, error } = await supabase.from('email_suppression').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) return handleServerError(res, error);
      res.json({ bajas: data || [] });
    } catch (e) { handleServerError(res, e); }
  });

  admin.delete('/suppression/:email', async (req, res) => {
    try {
      if (!requireSupabase(res)) return;
      const { error } = await supabase.from('email_suppression').delete().eq('email', String(req.params.email).toLowerCase());
      if (error) return handleServerError(res, error);
      res.json({ success: true });
    } catch (e) { handleServerError(res, e); }
  });

  // ═══════════════════════════════════════════════════════════════
  // PÚBLICO: pixel, click y baja
  // ═══════════════════════════════════════════════════════════════

  const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

  async function destinatarioPorToken(token) {
    const { data } = await supabase.from('campana_destinatarios')
      .select('id,campana_id,email,abierto_at,click_at').eq('token', token).maybeSingle();
    return data || null;
  }

  publico.get('/open/:token', async (req, res) => {
    try {
      const d = await destinatarioPorToken(req.params.token);
      if (d && !d.abierto_at) {
        await supabase.from('campana_destinatarios').update({ abierto_at: new Date().toISOString() }).eq('id', d.id);
        await supabase.from('campana_eventos').insert({
          campana_id: d.campana_id, destinatario_id: d.id, tipo: 'open',
          user_agent: String(req.headers['user-agent'] || '').slice(0, 300), ip: String(req.ip || '').slice(0, 60)
        });
      }
    } catch (e) { /* nunca romper el pixel */ }
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.end(PIXEL_GIF);
  });

  publico.get('/click/:token', async (req, res) => {
    try {
      const d = await destinatarioPorToken(req.params.token);
      const url = soloHttp(req.query.u);
      if (d) {
        if (!d.click_at) {
          await supabase.from('campana_destinatarios').update({ click_at: new Date().toISOString() }).eq('id', d.id);
          await supabase.from('campana_eventos').insert({
            campana_id: d.campana_id, destinatario_id: d.id, tipo: 'click', url: url || null,
            user_agent: String(req.headers['user-agent'] || '').slice(0, 300), ip: String(req.ip || '').slice(0, 60)
          });
        }
      }
      return res.redirect(302, url || 'https://portal-pilot.vercel.app');
    } catch (e) {
      return res.redirect(302, 'https://portal-pilot.vercel.app');
    }
  });

  async function procesarBaja(token, req) {
    const d = await destinatarioPorToken(token);
    if (!d) return false;
    await supabase.from('email_suppression').upsert([{ email: d.email, motivo: 'unsubscribe' }], { onConflict: 'email' });
    await supabase.from('campana_eventos').insert({
      campana_id: d.campana_id, destinatario_id: d.id, tipo: 'unsubscribe', ip: String(req.ip || '').slice(0, 60)
    });
    return true;
  }

  publico.get('/unsubscribe/:token', async (req, res) => {
    try { await procesarBaja(req.params.token, req); } catch (e) { /* noop */ }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlConfVisible({
      titulo: 'Suscripción cancelada',
      texto: 'Ya no recibirás más correos promocionales de Portal Pilot. Si fue un error, escríbenos a portalpilot.hn@gmail.com.'
    }));
  });

  // One-Click (List-Unsubscribe-Post)
  publico.post('/unsubscribe/:token', express.json(), async (req, res) => {
    try { await procesarBaja(req.params.token, req); } catch (e) { /* noop */ }
    res.json({ success: true });
  });

  return { admin, publico };
};