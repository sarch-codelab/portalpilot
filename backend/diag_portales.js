require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { supabase } = require('./supabaseClient');

(async () => {
  // 1) Diagnóstico factura
  const { data: emp } = await supabase.from('empresas').select('id, codigo').limit(1).maybeSingle();
  console.log('empresa sample:', emp?.codigo);
  const intento = {
    empresa_id: emp?.id, empresa_codigo: emp?.codigo,
    cliente_nombre: 'Diag', total: 10, items: [], estado: 'emitida',
    created_at: new Date().toISOString()
  };
  const { error: e1 } = await supabase.from('facturas').insert([intento]);
  console.log('factura sin sucursal_id →', e1 ? 'ERROR: ' + e1.message : 'OK');

  const intento2 = Object.assign({}, intento, {
    usuario_id: null, correlativo: 'DIAG', cliente_rtn: '', cliente_email: '',
    subtotal: 0, isv: 0, descuento: 0, tipo_documento: 'factura', metodo_pago: '', notas: '',
    sucursal_id: null, bodega_id: null
  });
  let payload = intento2;
  for (let i = 0; i < 8; i++) {
    const r = await supabase.from('facturas').insert([payload]);
    if (!r.error) { console.log('factura OK tras', i, 'reintentos'); break; }
    const m = /could not find the '([a-z_]+)' column/i.exec(r.error.message || '');
    console.log('intento', i, '→', r.error.message.slice(0, 120));
    if (!m) { console.log('ERROR NO-REINTENTABLE:', r.error.message); break; }
    const col = m[1];
    const { [col]: omit, ...rest } = payload;
    payload = rest;
  }

  // 2) Diagnóstico tenants.rtn
  const { data: ten } = await supabase.from('tenants').select('codigo').limit(1).maybeSingle();
  const { error: e3 } = await supabase.from('tenants').update({ rtn: 'TEST-RTN' }).eq('codigo', ten?.codigo);
  console.log('tenants.update rtn →', e3 ? 'ERROR: ' + e3.message : 'OK');
  const { data: ten2 } = await supabase.from('tenants').select('codigo, rtn').eq('codigo', ten?.codigo).maybeSingle();
  console.log('rtn leído de vuelta:', JSON.stringify(ten2));

  // 3) Diagnóstico support_tickets
  const { error: e4 } = await supabase.from('support_tickets').insert({
    nombre: 'Diag', email: 'diag@pp.test', empresa: 'ROOT', categoria: 'otro', prioridad: 'normal', mensaje: 'diag', estado: 'open'
  });
  console.log('support_tickets.insert →', e4 ? 'ERROR: ' + e4.message : 'OK');
  const { error: e5 } = await supabase.from('support_tickets').insert({ nombre: 'Diag2', email: 'diag@pp.test', asunto: 'diag', empresa: 'ROOT', categoria: 'otro', mensaje: 'diag' });
  console.log('support_tickets.insert con asunto →', e5 ? 'ERROR: ' + e5.message : 'OK');
})();
