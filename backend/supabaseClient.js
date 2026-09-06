const { createClient } = require('@supabase/supabase-js');

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabaseKey();

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' }
  });
  console.log('[STARTUP] Supabase client REAL: ACTIVO');
} else {
  console.warn('[STARTUP] Supabase client: INACTIVO (falta URL o KEY)');
}

function requireSupabase(res) {
  if (!supabase) {
    if (res) res.status(503).json({ error: 'Supabase no está configurado en las variables de entorno' });
    return false;
  }
  return true;
}

module.exports = {
  supabase,
  requireSupabase
};