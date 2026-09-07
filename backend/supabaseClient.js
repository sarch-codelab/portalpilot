const { createClient } = require('@supabase/supabase-js');

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

let _supabase = null;
let _initAttempted = false;

function getSupabase() {
  if (_supabase) return _supabase;
  if (_initAttempted) return null;
  _initAttempted = true;
  
  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabaseKey();
  
  console.log('[SUPABASE] Init attempt:', { hasUrl: !!supabaseUrl, hasKey: !!supabaseKey, urlPrefix: supabaseUrl?.substring(0, 40) });
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[SUPABASE] No configurado: falta URL o KEY');
    return null;
  }
  
  try {
    _supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'public' },
      global: { fetch: (url, options) => {
        // Timeout de 10s para serverless
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
      }}
    });
    console.log('[SUPABASE] Cliente REAL creado OK');
    return _supabase;
  } catch (e) {
    console.error('[SUPABASE] Error creando cliente:', e.message);
    _supabase = null;
    return null;
  }
}

const supabase = getSupabase();

function requireSupabase(res) {
  const client = getSupabase();
  if (!client) {
    if (res) res.status(503).json({ error: 'Supabase no está configurado en las variables de entorno' });
    return false;
  }
  return true;
}

module.exports = {
  get supabase() { return getSupabase(); },
  requireSupabase,
  getSupabaseUrl,
  getSupabaseKey
};