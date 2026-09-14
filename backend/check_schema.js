// Diagnóstico de esquema: verifica contra la DB conectada las tablas/columnas/RPC
// que el backend espera. Ejecutar: node backend/check_schema.js
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const checks = [
    ['rpc incrementar_tenant_uso', () => sb.rpc('incrementar_tenant_uso', { p_empresa_codigo: 'ZZZ', p_recurso: 't', p_periodo: '2026-09', p_cantidad: 0 })],
    ['col usuarios.token_version', () => sb.from('usuarios').select('token_version').limit(1)],
    ['tabla tenant_sessions', () => sb.from('tenant_sessions').select('id').limit(1)],
    ['tabla tenant_integrations', () => sb.from('tenant_integrations').select('integration_key').limit(1)],
    ['tabla subscriptions', () => sb.from('subscriptions').select('empresa_codigo').limit(1)],
    ['tabla planes', () => sb.from('planes').select('clave').limit(1)],
    ['tabla plan_features', () => sb.from('plan_features').select('feature').limit(1)],
    ['tabla plan_limits', () => sb.from('plan_limits').select('recurso').limit(1)],
    ['tabla tenant_usage', () => sb.from('tenant_usage').select('cantidad').limit(1)],
    ['tabla ai_usage_log', () => sb.from('ai_usage_log').select('tokens_total').limit(1)],
    ['tabla billing_payments', () => sb.from('billing_payments').select('id').limit(1)],
    ['tabla seguridad_eventos', () => sb.from('seguridad_eventos').select('id').limit(1)],
    ['tabla api_keys (col clave_prefix)', () => sb.from('api_keys').select('clave_prefix').limit(1)],
    ['col tenants.area', () => sb.from('tenants').select('area').limit(1)],
    ['col tenants.tamano', () => sb.from('tenants').select('tamano').limit(1)],
    ['col clientes.limite_credito', () => sb.from('clientes').select('limite_credito').limit(1)],
    ['col clientes.saldo_pendiente', () => sb.from('clientes').select('saldo_pendiente').limit(1)],
    ['col transacciones.usuario_id', () => sb.from('transacciones').select('usuario_id').limit(1)],
  ];
  for (const [name, fn] of checks) {
    try {
      const { error } = await fn();
      console.log(`${error ? '✗' : '✓'} ${name}${error ? ' — ' + error.message.slice(0, 90) : ''}`);
    } catch (e) { console.log(`✗ ${name} — EXCEPCIÓN: ${e.message.slice(0, 90)}`); }
  }
})();
