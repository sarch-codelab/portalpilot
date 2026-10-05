/**
 * erpIntegrity.js — Integridad transaccional del ERP (Portal Pilot)
 * ─────────────────────────────────────────────────────────────────────────────
 * Reglas que este módulo garantiza y que antes vivían sueltas en server.js:
 *
 *  1. El PRECIO NUNCA lo decide el cliente. Toda venta (POS o fiada) recalcula
 *     subtotal / ISV / descuento / total a partir de `productos.precio_venta`
 *     e `productos.isv_rate` del tenant. Si el cliente envía otros importes,
 *     mandan los del servidor.
 *  2. El STOCK NUNCA se descuenta "best effort". Un movimiento de inventario
 *     es todo-o-nada: si un solo renglón falla (stock insuficiente, producto
 *     inexistente), se revierten los renglones ya aplicados y la operación
 *     completa se rechaza. Nunca queda una venta sin su asiento de inventario.
 *  3. Todo movimiento de stock deja asiento en `kardex` con el stock anterior
 *     y el nuevo, para que el historial sea auditable y reversible.
 *
 * No depende de nada fuera de Supabase: recibe el cliente ya construido.
 */

'use strict';

class IntegridadError extends Error {
  constructor(message, code = 'INTEGRIDAD', status = 400, detalles = null) {
    super(message);
    this.name = 'IntegridadError';
    this.code = code;
    this.status = status;
    this.detalles = detalles;
  }
}

/** Redondeo monetario a 2 decimales evitando el arrastre binario de IEEE-754. */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function toInt(n) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : 0;
}

/** Acumula líneas repetidas del mismo producto para no se lanzan N RPC por el mismo id. */
function agruparItems(items) {
  const porProducto = new Map();
  const sinProducto = [];
  for (const raw of items || []) {
    const cantidad = toInt(raw && raw.cantidad);
    if (cantidad <= 0) continue;
    if (!raw || !raw.producto_id) {
      sinProducto.push({ ...raw, cantidad });
      continue;
    }
    const prev = porProducto.get(raw.producto_id);
    if (prev) prev.cantidad += cantidad;
    else porProducto.set(raw.producto_id, { ...raw, cantidad });
  }
  return { porProducto, sinProducto };
}

/**
 * Calcula el precio autoritativo de cada renglón leyendo el catálogo del tenant.
 *
 * @param {object} supabase  cliente de Supabase
 * @param {string} tenant    empresa_codigo normalizado (viene SIEMPRE del JWT)
 * @param {Array}  items     renglones enviados por el cliente
 * @param {object} opts
 *   - permitirPrecioManual  si true, un cajero puede aplicar un precio distinto
 *                          al de catálogo (queda registrado para auditoría)
 *   - permitirStockNegativo si true, no se bloquea la venta sin existencias
 * @returns {Promise<{lines, subtotal, isv, descuento, total, preciosModificados}>}
 */
async function calcularLineas(supabase, tenant, items, opts = {}) {
  const { porProducto, sinProducto } = agruparItems(items);
  const ids = [...porProducto.keys()];

  let catalogo = new Map();
  if (ids.length) {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, codigo, barcode, precio_venta, isv_rate, exento, stock_actual, activo')
      .eq('empresa_codigo', tenant)
      .in('id', ids);
    if (error) throw new IntegridadError(`No se pudo leer el catálogo: ${error.message}`, 'CATALOGO_LEIDO', 500);
    for (const p of data || []) catalogo.set(p.id, p);
  }

  const faltantes = ids.filter((id) => !catalogo.has(id));
  if (faltantes.length) {
    // No filtramos por empresa_codigo en la respuesta para no revelar existencia
    // de productos de otro tenant; solo informing que no son válidos aquí.
    throw new IntegridadError(
      'Uno o más productos no existen en el catálogo de esta empresa.',
      'PRODUCTO_NO_ENCONTRADO',
      400,
      { productos: faltantes }
    );
  }

  const inactivos = ids.filter((id) => catalogo.get(id).activo === false);
  if (inactivos.length) {
    throw new IntegridadError(
      'Uno o más productos están inactivos y no admiten venta.',
      'PRODUCTO_INACTIVO',
      400,
      { productos: inactivos }
    );
  }

  const lines = [];
  let subtotal = 0;
  let isv = 0;
  let preciosModificados = false;

  for (const [id, item] of porProducto.entries()) {
    const p = catalogo.get(id);
    const precioCatalogo = Number(p.precio_venta) || 0;
    const precioEnviado = item.precio_unitario == null ? null : Number(item.precio_unitario);
    let precioUnitario = precioCatalogo;

    const difiereDelCatalogo =
      precioEnviado != null && Number.isFinite(precioEnviado) && money(precioEnviado) !== money(precioCatalogo);

    if (difiereDelCatalogo) {
      // Queda registrado siempre, exista o no permiso: es una auditoría de
      // precio. Solo un Owner/Administrador puede cobrar distinto al catálogo.
      preciosModificados = true;
      precioUnitario = opts.permitirPrecioManual ? precioEnviado : precioCatalogo;
    }

    const totalLinea = money(precioUnitario * item.cantidad);
    subtotal = money(subtotal + totalLinea);

    // Exento = 0%; si no, se aplica la tasa ISV configurada en el producto.
    const tasa = p.exento ? 0 : (Number(p.isv_rate) || 0);
    isv = money(isv + totalLinea * tasa);

    lines.push({
      producto_id: p.id,
      codigo: p.codigo || '',
      nombre: p.nombre || item.nombre || '',
      cantidad: item.cantidad,
      precio_unitario: precioUnitario,
      precio_catalogo: precioCatalogo,
      isv_rate: tasa,
      exento: !!p.exento,
      total_linea: totalLinea,
      stock_disponible: Number(p.stock_actual) || 0,
    });
  }

  // Renglones sin producto_id (artículos libres de mostrador). No mueven stock.
  for (const item of sinProducto) {
    const precioUnitario = opts.permitirPrecioManual ? (Number(item.precio_unitario) || 0) : 0;
    const totalLinea = money(precioUnitario * item.cantidad);
    subtotal = money(subtotal + totalLinea);
    lines.push({
      producto_id: null,
      codigo: (item.codigo || '').toString().slice(0, 60),
      nombre: (item.nombre || 'Artículo libre').toString().slice(0, 200),
      cantidad: item.cantidad,
      precio_unitario: precioUnitario,
      precio_catalogo: null,
      isv_rate: 0,
      exento: true,
      total_linea: totalLinea,
      stock_disponible: null,
    });
  }

  const descuento = opts.permitirDescuento === false ? 0 : Math.max(0, money(opts.descuento || 0));
  const total = money(subtotal + isv - descuento);
  if (total < 0) {
    throw new IntegridadError('El total no puede ser negativo.', 'TOTAL_NEGATIVO', 400);
  }

  return { lines, subtotal, isv, descuento, total, preciosModificados };
}

/**
 * Aplica un movimiento de inventario todo-o-nada y deja el asiento en kardex.
 *
 * Si un renglón falla, revierte los ya aplicados (delta contrario) antes de
 * lanzar el error, de modo que el stock del tenant queda exactamente como
 * estaba. Quien llama puede entonces abortar la venta sin dejar residuos.
 *
 * @returns {Promise<{movimientos: Array<{linea, anterior, nuevo}>}>}
 */
async function aplicarMovimientoStock(supabase, ctx, lineas) {
  const {
    empresa, tenant, referenciaTipo, referenciaId, usuario, notas,
    movimiento = 'SALIDA', permitirStockNegativo = false, kardexTipo,
  } = ctx;

  const aplicados = [];

  for (const linea of lineas) {
    if (!linea.producto_id) continue; // artículo libre: no toca inventario

    const delta = movimiento === 'ENTRADA' ? linea.cantidad : -linea.cantidad;

    if (!permitirStockNegativo && movimiento !== 'ENTRADA') {
      if (linea.stock_disponible != null && linea.stock_disponible < linea.cantidad) {
        throw new IntegridadError(
          `Stock insuficiente de "${linea.nombre}". Disponible: ${linea.stock_disponible}, solicitado: ${linea.cantidad}.`,
          'STOCK_INSUFICIENTE',
          409,
          { producto_id: linea.producto_id, nombre: linea.nombre, disponible: linea.stock_disponible, solicitado: linea.cantidad }
        );
      }
    }

    const { data, error } = await supabase.rpc('pp_ajustar_stock', {
      p_empresa_codigo: tenant,
      p_producto_id: linea.producto_id,
      p_delta: delta,
    });

    if (error || !data || !data.length) {
      await revertirMovimientos(supabase, tenant, aplicados);
      const motivo = error ? error.message : 'sin respuesta del inventario';
      throw new IntegridadError(
        `No se pudo actualizar el inventario de "${linea.nombre}": ${motivo}`,
        'STOCK_AJUSTE_FALLIDO',
        409,
        { producto_id: linea.producto_id, nombre: linea.nombre }
      );
    }

    const anterior = data[0].anterior;
    const nuevo = data[0].nuevo;
    aplicados.push({ linea, anterior, nuevo, delta });

    const { error: kdxErr } = await supabase.from('kardex').insert([{
      empresa_id: empresa.id,
      empresa_codigo: tenant,
      producto_id: linea.producto_id,
      tipo_movimiento: kardexTipo || (movimiento === 'ENTRADA' ? 'ENTRADA_COMPRA' : (movimiento === 'AJUSTE' ? 'AJUSTE' : 'SALIDA_VENTA')),
      cantidad: linea.cantidad,
      cantidad_anterior: anterior,
      cantidad_nueva: nuevo,
      costo_unitario: linea.precio_unitario,
      referencia_tipo: referenciaTipo,
      referencia_id: referenciaId,
      notas: notas || null,
      usuario_id: usuario ? usuario.sub : null,
      usuario_nombre: usuario ? (usuario.nombre || '') : '',
    }]);

    if (kdxErr) {
      // El asiento es parte de la operación: si falla, también se revierte.
      await revertirMovimientos(supabase, tenant, aplicados);
      throw new IntegridadError(
        `No se pudo registrar el movimiento de inventario de "${linea.nombre}": ${kdxErr.message}`,
        'KARDEX_FALLIDO',
        500,
        { producto_id: linea.producto_id }
      );
    }
  }

  return { movimientos: aplicados };
}

/** Compensa los deltas ya aplicados. Best-effort pero con registro de fallos. */
async function revertirMovimientos(supabase, tenant, aplicados) {
  for (const a of aplicados.slice().reverse()) {
    try {
      await supabase.rpc('pp_ajustar_stock', {
        p_empresa_codigo: tenant,
        p_producto_id: a.linea.producto_id,
        p_delta: -a.delta,
      });
      await supabase.from('kardex').insert([{
        empresa_codigo: tenant,
        producto_id: a.linea.producto_id,
        tipo_movimiento: 'REVERSION',
        cantidad: a.linea.cantidad,
        cantidad_anterior: a.nuevo,
        cantidad_nueva: a.anterior,
        costo_unitario: a.linea.precio_unitario,
        referencia_tipo: 'REVERSION',
        notas: 'Reversión automática por operación atómica fallida',
      }]);
    } catch (e) {
      console.error('[Integridad] reversión de stock fallida para', a.linea.producto_id, e.message);
    }
  }
}

module.exports = {
  IntegridadError,
  money,
  calcularLineas,
  aplicarMovimientoStock,
  revertirMovimientos,
};
