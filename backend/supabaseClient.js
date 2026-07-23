const axios = require('axios');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  console.warn(`[SUPABASE] NO inicializado — falta: ${missing.join(', ')}. Rutas de trabajadores retornarán 503.`);
} else {
  const restBase = `${SUPABASE_URL}/rest/v1`;
  const authBase = `${SUPABASE_URL}/auth/v1`;
  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };

  function buildRestHeaders(opts = {}) {
    const h = { ...serviceHeaders };
    if (opts.headers) Object.assign(h, opts.headers);
    return h;
  }

  function from(table) {
    let _select = null;
    let _filters = [];
    let _orderCol = null;
    let _orderAsc = true;
    let _limit = null;
    let _single = false;
    let _maybeSingle = false;
    let _op = 'select';
    let _body = null;

    const builder = {
      select(cols) { _op = 'select'; _select = cols || '*'; return builder; },
      eq(col, val) { _filters.push(`${col}=eq.${encodeURIComponent(val)}`); return builder; },
      ilike(col, pattern) { _filters.push(`${col}=ilike.${encodeURIComponent(pattern)}`); return builder; },
      single() { _single = true; return builder; },
      maybeSingle() { _maybeSingle = true; return builder; },
      order(col, opts) { _orderCol = col; _orderAsc = opts && opts.ascending !== undefined ? opts.ascending : true; return builder; },
      limit(n) { _limit = n; return builder; },

      insert(data) { _op = 'insert'; _body = data; return builder; },
      update(data) { _op = 'update'; _body = data; return builder; },
      delete() { _op = 'delete'; return builder; },

      then(resolve, reject) {
        const exec = async () => {
          try {
            const url = new URL(`${restBase}/${table}`);
            const headers = buildRestHeaders();
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
            const msg = err.response?.data?.message || err.response?.data?.msg || err.message;
            return resolve({ data: null, error: { message: msg } });
          }
        };
        exec().catch(reject);
      }
    };

    return builder;
  }

  const authClient = {
    signInWithPassword({ email, password }) {
      return axios.post(`${authBase}/token?grant_type=password`, { email, password }, {
        headers: { apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' }
      }).then(r => ({ data: { user: r.data.user, session: r.data.session }, error: null }))
        .catch(err => ({ data: null, error: { message: err.response?.data?.error_description || err.message } }));
    },

    admin: {
      createUser({ email, password, email_confirm }) {
        return axios.post(`${authBase}/admin/users`, { email, password, email_confirm }, {
          headers: { ...serviceHeaders, apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
        }).then(r => ({ data: { user: r.data }, error: null }))
          .catch(err => ({ data: null, error: { message: err.response?.data?.msg || err.message } }));
      },

      updateUser(id, updates) {
        return axios.put(`${authBase}/admin/users/${id}`, updates, {
          headers: { ...serviceHeaders, apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
        }).then(r => ({ data: r.data, error: null }))
          .catch(err => ({ data: null, error: { message: err.response?.data?.msg || err.message } }));
      },

      deleteUser(id) {
        return axios.delete(`${authBase}/admin/users/${id}`, {
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
        }).then(() => ({ data: null, error: null }))
          .catch(err => ({ data: null, error: { message: err.response?.data?.msg || err.message } }));
      }
    }
  };

  const storageClient = {
    async upload(bucket, filePath, fileBuffer, contentType) {
      const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`;
      const headers = {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      };
      const resp = await axios.put(url, fileBuffer, { headers, maxBodyLength: Infinity, maxContentLength: Infinity });
      return { data: { path: resp.data.Key || filePath }, error: null };
    },
    getPublicUrl(bucket, filePath) {
      return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
    }
  };

  supabase = { from, auth: authClient, storage: storageClient };
  console.log(`[SUPABASE] Cliente HTTP inicializado (${SUPABASE_URL.substring(0, 30)}...)`);
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(503).json({ error: 'Supabase no está configurado. Agrega SUPABASE_URL y SUPABASE_SERVICE_KEY al .env' });
    return false;
  }
  return true;
}

module.exports = { supabase, requireSupabase };
