let createClient = null;
let supabase = null;

try {
  const mod = require('@supabase/supabase-js');
  createClient = mod.createClient;
  console.log('[SUPABASE] Paquete @supabase/supabase-js cargado correctamente');
} catch (err) {
  console.error('[SUPABASE] No se pudo cargar @supabase/supabase-js:', err.message);
  console.warn('[SUPABASE] El servidor funcionará solo con NocoDB. Las rutas de Supabase retornarán 503.');
}

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!createClient || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  const reasons = [];
  if (!createClient) reasons.push('paquete no disponible');
  if (!SUPABASE_URL) reasons.push('SUPABASE_URL no definida');
  if (!SUPABASE_SERVICE_KEY) reasons.push('SUPABASE_SERVICE_KEY no definida');
  console.warn(`[SUPABASE] Cliente NO inicializado: ${reasons.join(', ')}`);
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
