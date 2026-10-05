/**
 * test-erp-integrity.js — pruebas de la integridad transaccional del ERP
 * Ejecutar:  node --test backend/test-erp-integrity.js
 *
 * No toca Supabase: usa un cliente falso que reproduce el comportamiento de
 * las funciones RPC y de las tablas tal como están en producción.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularLineas, aplicarMovimientoStock, IntegridadError, money } = require('./erpIntegrity');

const TENANT = 'PULP-LAESQUINA';

/** Cliente Supabase falso con estado en memoria. */
function crearFake({ catalogo = {}, fallaStockEn = null, fallaKardex = false } = {}) {
  const stock = new Map();
  for (const [id, p] of Object.entries(catalogo)) {
    stock.set(id, { actual: Number(p.stock_actual) || 0 });
  }
  const kardex = [];
  const rpcCalls = [];

  // Reproduce el filtrado real de Supabase: .eq() y .in() se combinan y solo
  // devuelven filas que pertenecen al tenant consultado. Así la prueba verifica
  // de verdad que un producto de otra empresa NO es vendible.
  function builder(tabla) {
    let filtroEmpresa = null;
    let filtroIds = null;

    const api = {
      select() { return api; },
      eq(columna, valor) {
        if (columna === 'empresa_codigo') filtroEmpresa = valor;
        return api;
      },
      in(columna, valores) {
        if (columna === 'id') filtroIds = valores;
        return api;
      },
      delete() { return api; },
      __lookup() {
        let rows = Object.values(catalogo);
        if (filtroEmpresa != null) rows = rows.filter((p) => p.empresa_codigo === filtroEmpresa);
        if (filtroIds != null) rows = rows.filter((p) => filtroIds.includes(p.id));
        return { data: rows, error: null };
      },
      insert(filas) {
        if (tabla === 'kardex') {
          if (fallaKardex) return { error: { message: 'kardex caido' } };
          kardex.push(...filas);
        }
        return { error: null };
      },
      then(resolve) { return resolve(api.__lookup()); },
    };
    return api;
  }

  return {
    kardex,
    rpcCalls,
    stock,
    from: builder,
    rpc(nombre, args) {
      rpcCalls.push({ nombre, args });
      const celda = stock.get(args.p_producto_id);
      if (!celda) return { data: null, error: { message: 'producto no encontrado' } };
      if (fallaStockEn && fallaStockEn === args.p_producto_id) {
        return { data: null, error: { message: 'deadlock detectado' } };
      }
      const anterior = celda.actual;
      const nuevo = anterior + args.p_delta;
      if (nuevo < 0) {
        return { data: null, error: { message: 'stock insuficiente' } };
      }
      celda.actual = nuevo;
      return { data: [{ anterior, nuevo }], error: null };
    },
  };
}

const EMPRESA = { id: '11111111-1111-1111-1111-111111111111' };

// ─────────────────────────────────────────────────────────────────────────────
test('el precio lo decide el servidor, no el cliente', async () => {
  const fake = crearFake({
    catalogo: {
      'p1': { id: 'p1', nombre: 'Jabon', codigo: 'JAB', precio_venta: 25, isv_rate: 0.16, exento: false, stock_actual: 10, activo: true, empresa_codigo: TENANT },
    },
  });

  const items = [{ producto_id: 'p1', cantidad: 2, precio_unitario: 1 }];

  const r = await calcularLineas(fake, TENANT, items);

  assert.equal(r.lines[0].precio_unitario, 25, 'debe ignorar el precio de 1 enviado por el cliente');
  assert.equal(r.subtotal, 50);
  assert.equal(r.isv, 8);
  assert.equal(r.total, 58);
});

test('producto de otro tenant o inexistente se rechaza', async () => {
  const fake = crearFake({ catalogo: {} });
  await assert.rejects(
    () => calcularLineas(fake, TENANT, [{ producto_id: 'fantasma', cantidad: 1 }]),
    (e) => e instanceof IntegridadError && e.code === 'PRODUCTO_NO_ENCONTRADO'
  );
});

test('AISLAMIENTO: un producto de otra empresa no se puede vender', async () => {
  // El mismo uuid existe, pero pertenece a otro tenant.
  const fake = crearFake({
    catalogo: {
      'p9': {
        id: 'p9', nombre: 'Producto ajeno', codigo: 'AJENO',
        precio_venta: 999, isv_rate: 0, exento: true,
        stock_actual: 100, activo: true, empresa_codigo: 'OTRA-EMPRESA',
      },
    },
  });
  await assert.rejects(
    () => calcularLineas(fake, TENANT, [{ producto_id: 'p9', cantidad: 1 }]),
    (e) => e.code === 'PRODUCTO_NO_ENCONTRADO'
  );
});

test('producto inactivo no se puede vender', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'X', precio_venta: 5, isv_rate: 0, exento: true, stock_actual: 1, activo: false, empresa_codigo: TENANT } },
  });
  await assert.rejects(
    () => calcularLineas(fake, TENANT, [{ producto_id: 'p1', cantidad: 1 }]),
    (e) => e.code === 'PRODUCTO_INACTIVO'
  );
});

test('exento no lleva ISV', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'Pan', precio_venta: 100, isv_rate: 0.16, exento: true, stock_actual: 5, activo: true, empresa_codigo: TENANT } },
  });
  const r = await calcularLineas(fake, TENANT, [{ producto_id: 'p1', cantidad: 1 }]);
  assert.equal(r.isv, 0);
  assert.equal(r.total, 100);
});

test('renglones repetidos del mismo producto se agrupan', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'Y', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 50, activo: true, empresa_codigo: TENANT } },
  });
  const r = await calcularLineas(fake, TENANT, [
    { producto_id: 'p1', cantidad: 2 },
    { producto_id: 'p1', cantidad: 3 },
  ]);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].cantidad, 5);
  assert.equal(r.subtotal, 50);
});

// ─────────────────────────────────────────────────────────────────────────────
test('venta completa: descuenta stock y deja asiento en kardex', async () => {
  const fake = crearFake({
    catalogo: {
      'p1': { id: 'p1', nombre: 'A', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 10, activo: true, empresa_codigo: TENANT },
      'p2': { id: 'p2', nombre: 'B', precio_venta: 20, isv_rate: 0, exento: true, stock_actual: 4, activo: true, empresa_codigo: TENANT },
    },
  });
  const { lines } = await calcularLineas(fake, TENANT, [
    { producto_id: 'p1', cantidad: 2 },
    { producto_id: 'p2', cantidad: 3 },
  ]);

  await aplicarMovimientoStock(fake, {
    empresa: EMPRESA, tenant: TENANT, referenciaTipo: 'VENTA_POS',
    referenciaId: 'v1', usuario: { sub: 'u1', nombre: 'Cajero' }, movimiento: 'SALIDA',
  }, lines);

  assert.equal(fake.stock.get('p1').actual, 8);
  assert.equal(fake.stock.get('p2').actual, 1);
  assert.equal(fake.kardex.length, 2);
  const k = fake.kardex[0];
  assert.equal(k.tipo_movimiento, 'SALIDA_VENTA');
  assert.equal(k.referencia_tipo, 'VENTA_POS');
  assert.equal(k.usuario_nombre, 'Cajero');
});

test('stock insuficiente: no mueve nada y no escribe kardex', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'A', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 1, activo: true, empresa_codigo: TENANT } },
  });
  const { lines } = await calcularLineas(fake, TENANT, [{ producto_id: 'p1', cantidad: 5 }]);

  await assert.rejects(
    () => aplicarMovimientoStock(fake, { empresa: EMPRESA, tenant: TENANT, movimiento: 'SALIDA' }, lines),
    (e) => e.code === 'STOCK_INSUFICIENTE'
  );
  assert.equal(fake.stock.get('p1').actual, 1, 'el stock no debe moverse');
  assert.equal(fake.kardex.length, 0, 'no debe haber asiento de kardex');
});

test('FALLO A MITAD: revierte los renglones ya descontados', async () => {
  const fake = crearFake({
    catalogo: {
      'p1': { id: 'p1', nombre: 'A', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 10, activo: true, empresa_codigo: TENANT },
      'p2': { id: 'p2', nombre: 'B', precio_venta: 20, isv_rate: 0, exento: true, stock_actual: 10, activo: true, empresa_codigo: TENANT },
    },
    fallaStockEn: 'p2', // el segundo renglón revienta en el RPC
  });
  const { lines } = await calcularLineas(fake, TENANT, [
    { producto_id: 'p1', cantidad: 4 },
    { producto_id: 'p2', cantidad: 1 },
  ]);

  await assert.rejects(
    () => aplicarMovimientoStock(fake, { empresa: EMPRESA, tenant: TENANT, movimiento: 'SALIDA' }, lines),
    (e) => e.code === 'STOCK_AJUSTE_FALLIDO'
  );

  assert.equal(fake.stock.get('p1').actual, 10, 'p1 debe volver a su stock original');
  assert.equal(fake.stock.get('p2').actual, 10, 'p2 nunca debe moverse');
});

test('fallo de kardex también revierte el stock', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'A', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 10, activo: true, empresa_codigo: TENANT } },
    fallaKardex: true,
  });
  const { lines } = await calcularLineas(fake, TENANT, [{ producto_id: 'p1', cantidad: 3 }]);

  await assert.rejects(
    () => aplicarMovimientoStock(fake, { empresa: EMPRESA, tenant: TENANT, movimiento: 'SALIDA' }, lines),
    (e) => e.code === 'KARDEX_FALLIDO'
  );
  assert.equal(fake.stock.get('p1').actual, 10, 'el stock debe quedar intacto');
});

test('un artículo libre (sin producto_id) no toca inventario', async () => {
  const fake = crearFake({ catalogo: {} });
  const { lines, subtotal } = await calcularLineas(fake, TENANT, [
    { nombre: 'Servicio express', cantidad: 2, precio_unitario: 150 },
  ], { permitirPrecioManual: true });

  assert.equal(subtotal, 300);
  await aplicarMovimientoStock(fake, { empresa: EMPRESA, tenant: TENANT, movimiento: 'SALIDA' }, lines);
  assert.equal(fake.rpcCalls.length, 0, 'no debe llamar al RPC sin producto_id');
});

test('sin permiso de precio manual, el artículo libre vale 0', async () => {
  const fake = crearFake({ catalogo: {} });
  const { subtotal } = await calcularLineas(fake, TENANT, [
    { nombre: 'Servicio', cantidad: 1, precio_unitario: 999 },
  ]);
  assert.equal(subtotal, 0);
});

test('el descuento nunca produce total negativo', async () => {
  const fake = crearFake({
    catalogo: { 'p1': { id: 'p1', nombre: 'A', precio_venta: 10, isv_rate: 0, exento: true, stock_actual: 5, activo: true, empresa_codigo: TENANT } },
  });
  await assert.rejects(
    () => calcularLineas(fake, TENANT, [{ producto_id: 'p1', cantidad: 1 }], { descuento: 9999 }),
    (e) => e.code === 'TOTAL_NEGATIVO'
  );
});

test('money redondea a 2 decimales sin arrastre binario', () => {
  assert.equal(money(0.1 + 0.2), 0.3);
  assert.equal(money(19.99 * 3), 59.97);
});