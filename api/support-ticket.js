/* api/support-ticket.js — Vercel Serverless: receives support form submissions */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── SMTP para notificar al equipo de soporte ── */
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;
const SMTP_CONFIGURADO = Boolean(SMTP_USER && SMTP_PASS);

async function notificarEquipo(ticket) {
  if (!SMTP_CONFIGURADO) {
    console.warn('[SOPORTE] SMTP no configurado (SMTP_USER/SMTP_PASS), no se envió notificación por correo.');
    return;
  }

  const fecha = new Date(ticket.created_at).toLocaleString('es-HN');
  const asunto = `[Soporte] Nuevo ticket (${ticket.categoria})`;
  const texto = [
    'Nuevo ticket de soporte recibido',
    '',
    `De: ${ticket.nombre} <${ticket.email}>`,
    `Categoría: ${ticket.categoria}`,
    `Prioridad: ${ticket.prioridad}`,
    `Empresa: ${ticket.empresa || 'N/A'} · Plan ${ticket.plan}`,
    `Fecha: ${fecha}`,
    'Mensaje:',
    ticket.mensaje
  ].join('\n');

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0a15; color: #e2e8f0; border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 16px; padding: 30px;">
      <div style="text-align: center; border-bottom: 1px solid #1e1b4b; padding-bottom: 20px; margin-bottom: 25px;">
        <span style="font-size: 24px; font-weight: 800; color: #ffffff;">Portal <span style="color: #8b5cf6;">Pilot</span></span>
        <p style="color: #94a3b8; font-size: 13px;">Notificaciones del Ecosistema</p>
      </div>
      <h2 style="color: #ffffff; font-size: 18px;">Nuevo ticket de soporte recibido</h2>
      <p style="color: #94a3b8; font-size: 14px;">Un cliente abrió un ticket en portalpilot.hn/support</p>
      <div style="background-color: #111022; border-left: 4px solid #8b5cf6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 10px;"><strong style="color: #ffffff;">De:</strong> ${ticket.nombre} &lt;${ticket.email}&gt;</p>
        <p style="margin: 0 0 10px;"><strong style="color: #ffffff;">Categoría:</strong> ${ticket.categoria} · <strong style="color: #ffffff;">Prioridad:</strong> ${ticket.prioridad}</p>
        <p style="margin: 0 0 10px;"><strong style="color: #ffffff;">Empresa:</strong> ${ticket.empresa || 'N/A'} · <strong style="color: #ffffff;">Plan:</strong> ${ticket.plan}</p>
        <p style="margin: 0 0 10px;"><strong style="color: #ffffff;">Fecha:</strong> ${fecha}</p>
        <p style="margin: 0;"><strong style="color: #ffffff;">Mensaje:</strong><br>${ticket.mensaje}</p>
      </div>
      <div style="font-size: 11px; color: #64748b; text-align: center; margin-top: 35px; border-top: 1px solid #1e1b4b; padding-top: 20px;">
        © 2026 Portal Pilot. Todos los derechos reservados.
      </div>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: false, // 🔧 FIX VERCEL: desactivar pool para evitar conexiones muertas en serverless
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000
  });

  await transporter.sendMail({
    from: `"Notificaciones Portal Pilot" <${EMAIL_FROM}>`,
    replyTo: EMAIL_FROM,
    to: SMTP_USER,
    subject: asunto,
    text: texto,
    html
  });
  console.log(`[SOPORTE] Correo de nuevo ticket enviado a ${SMTP_USER}`);
}

module.exports = async function handler(req, res) {
  /* CORS */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, company, plan, category, priority, message } = req.body || {};

  /* Validate required fields */
  if (!name || !email || !category || !message) {
    return res.status(400).json({
      error: 'Campos requeridos: name, email, category, message'
    });
  }

  /* Basic email validation */
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  /* Sanitize */
  const ticket = {
    nombre: escapeHtml(name).slice(0, 200),
    email: escapeHtml(email).slice(0, 200),
    empresa: escapeHtml(company || '').slice(0, 200),
    plan: escapeHtml(plan || 'none').slice(0, 50),
    categoria: escapeHtml(category).slice(0, 50),
    prioridad: escapeHtml(priority || 'normal').slice(0, 20),
    mensaje: escapeHtml(message).slice(0, 5000),
    estado: 'open',
    created_at: new Date().toISOString()
  };

  try {
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
      return res.status(503).json({ error: 'El servicio de soporte no está configurado.' });
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .insert([ticket])
      .select()
      .single();

    if (error) {
      console.error('Supabase support ticket insert failed:', error.message);
      return res.status(503).json({ error: 'No se pudo guardar el ticket en la nube.' });
    }

    /* Notificar al equipo por correo. El ticket ya está guardado, así que un fallo
       del envío de email no debe romper la confirmación al usuario. */
    try {
      await notificarEquipo(ticket);
    } catch (mailErr) {
      console.error('[SOPORTE] Error enviando correo de ticket:', mailErr.message);
    }

    return res.status(201).json({
      success: true,
      ticketId: data.id,
      message: 'Ticket creado exitosamente'
    });

  } catch (err) {
    console.error('Support ticket error:', err);
    return res.status(500).json({
      error: 'Error al procesar el ticket. Intenta de nuevo o contacta a portalpilot.hn@gmail.com'
    });
  }
};