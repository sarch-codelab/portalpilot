/* api/support-ticket.js — Vercel Serverless: receives support form submissions */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY || ''
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
    if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY)) {
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
