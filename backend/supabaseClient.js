const axios = require('axios');

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

function from(table) {
  const urlBase = getSupabaseUrl();
  const key = getSupabaseKey();

  if (!urlBase || !key) {
    console.warn(`[SUPABASE] ADVERTENCIA: SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados al consultar la tabla "${table}".`);
  }

  const restBase = `${urlBase}/rest/v1`;
  const serviceHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  let _select = null;
  let _filters = [];
  let _orderCol = null;
  let _orderAsc = true;
  let _limit = null;
  let _single = false;
  let _maybeSingle = false;
  let _op = 'select';
  let _body = null;
  let _onConflict = null;

  const builder = {
    select(cols) { _op = 'select'; _select = cols || '*'; return builder; },
    eq(col, val) { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return builder; },
    neq(col, val) { _filters.push(`${col}=neq.${encodeURIComponent(val)}`); return builder; },
    in(col, vals) { _filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(v)).join(',')})`); return builder; },
    gte(col, val) { _filters.push(`${col}=gte.${encodeURIComponent(val)}`); return builder; },
    lte(col, val) { _filters.push(`${col}=lte.${encodeURIComponent(val)}`); return builder; },
    ilike(col, pattern) { _filters.push(`${col}=ilike.${encodeURIComponent(pattern)}`); return builder; },
    single() { _single = true; return builder; },
    maybeSingle() { _maybeSingle = true; return builder; },
    order(col, opts) { _orderCol = col; _orderAsc = opts && opts.ascending !== undefined ? opts.ascending : true; return builder; },
    limit(n) { _limit = n; return builder; },

    insert(data) { _op = 'insert'; _body = data; return builder; },
    upsert(data, opts) { _op = 'upsert'; _body = data; _onConflict = opts && opts.onConflict ? opts.onConflict : null; return builder; },
    update(data) { _op = 'update'; _body = data; return builder; },
    delete() { _op = 'delete'; return builder; },

    then(resolve, reject) {
      const exec = async () => {
        try {
          const headers = { ...serviceHeaders };
          let resp;

          if (_op === 'select') {
            const params = new URLSearchParams();
            params.set('select', _select || '*');
            _filters.forEach(f => params.append('and', `(${f})`));
            if (_orderCol) params.set('order', `${_orderCol}.${_orderAsc ? 'asc' : 'desc'}`);
            if (_limit) params.set('limit', _limit);
            if (_single || _maybeSingle) headers.Prefer = 'return=representation';

            resp = await axios.get(`${restBase}/${table}?${params.toString()}`, { headers });
            let rows = resp.data || [];

            if (_single) {
              if (rows.length === 0) return resolve({ data: null, error: { message: 'Row not found', code: 'PGRST116' } });
              return resolve({ data: rows[0], error: null });
            }
            if (_maybeSingle) {
              return resolve({ data: rows[0] || null, error: null });
            }
            return resolve({ data: rows, error: null });

          } else if (_op === 'insert') {
            resp = await axios.post(`${restBase}/${table}`, _body, { headers });
            return resolve({ data: resp.data, error: null });

          } else if (_op === 'upsert') {
            if (_onConflict) headers.Prefer = `return=representation,resolution=merge-duplicates,on_conflict=${_onConflict}`;
            else headers.Prefer = 'return=representation,resolution=merge-duplicates';
            resp = await axios.post(`${restBase}/${table}`, _body, { headers });
            return resolve({ data: resp.data, error: null });

          } else if (_op === 'update') {
            const params = new URLSearchParams();
            _filters.forEach(f => params.append('and', `(${f})`));
            resp = await axios.patch(`${restBase}/${table}?${params.toString()}`, _body, { headers });
            return resolve({ data: resp.data, error: null });

          } else if (_op === 'delete') {
            const params = new URLSearchParams();
            _filters.forEach(f => params.append('and', `(${f})`));
            resp = await axios.delete(`${restBase}/${table}?${params.toString()}`, { headers });
            return resolve({ data: null, error: null });
          }
        } catch (err) {
          console.error(`[SUPABASE REST ERROR] ${_op.toUpperCase()} en "${table}":`, err.response?.data || err.message);
          return resolve({ data: null, error: err.response?.data || { message: err.message } });
        }
      };
      exec();
    }
  };

  return builder;
}

const supabaseClient = {
  from,
  auth: {
    signInWithPassword: async () => ({ data: null, error: { message: 'Supabase Auth deshabilitado (usando PostgreSQL directo)' } })
  }
};

function requireSupabase(res) {
  if (!getSupabaseUrl() || !getSupabaseKey()) {
    if (res) res.status(503).json({ error: 'Supabase no está configurado en las variables de entorno' });
    return false;
  }
  return true;
}

module.exports = {
  supabase: supabaseClient,
  requireSupabase
};
