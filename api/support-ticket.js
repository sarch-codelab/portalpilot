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
    name: escapeHtml(name).slice(0, 200),
    email: escapeHtml(email).slice(0, 200),
    company: escapeHtml(company || '').slice(0, 200),
    plan: escapeHtml(plan || 'none').slice(0, 50),
    category: escapeHtml(category).slice(0, 50),
    priority: escapeHtml(priority || 'normal').slice(0, 20),
    message: escapeHtml(message).slice(0, 5000),
    status: 'open',
    created_at: new Date().toISOString()
  };

  try {
    /* Try to store in Supabase if configured */
    if (process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY)) {
      const { data, error } = await supabase
        .from('support_tickets')
        .insert([ticket])
        .select()
        .single();

      if (error) {
        /* If table doesn't exist, log and continue */
        console.warn('Supabase insert failed (table may not exist):', error.message);
      } else {
        return res.status(201).json({
          success: true,
          ticketId: data.id,
          message: 'Ticket creado exitosamente'
        });
      }
    }

    /* Fallback: log to console and return success */
    console.log('=== SUPPORT TICKET ===');
    console.log(JSON.stringify(ticket, null, 2));
    console.log('======================');

    return res.status(201).json({
      success: true,
      ticketId: 'LOG-' + Date.now(),
      message: 'Ticket registrado. Responderemos a ' + email + ' en menos de 24 horas.'
    });

  } catch (err) {
    console.error('Support ticket error:', err);
    return res.status(500).json({
      error: 'Error al procesar el ticket. Intenta de nuevo o contacta a portalpilot.hn@gmail.com'
    });
  }
};
