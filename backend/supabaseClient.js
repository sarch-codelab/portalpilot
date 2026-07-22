const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[SUPABASE] WARNING: SUPABASE_URL o SUPABASE_SERVICE_KEY no están definidas. Login mixto deshabilitado para Supabase.');
} else {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    console.log('[SUPABASE] Cliente inicializado correctamente');
  } catch (err) {
    console.error('[SUPABASE] Error al inicializar cliente:', err.message);
    supabase = null;
  }
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(503).json({ error: 'Supabase no está configurado. Agrega SUPABASE_URL y SUPABASE_SERVICE_KEY al .env' });
    return false;
  }
  return true;
}

module.exports = { supabase, requireSupabase };
