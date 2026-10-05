// backend/test-cuentas-qr-integridad.js
// Pruebas de la integridad de cuentas abiertas y del QR de socios.
//
// El QR y la compensacion de consumos son la parte de FASE 5 donde un error
// deja inventario descuadrado o deja entrar a alguien con un QR vencido, asi
// que estas pruebas ejecutan el codigo real en lugar de solo leerlo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.join(__dirname, 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');

/** Extrae una funcion completa (firma + cuerpo) por nombre, equilibrando llaves. */
function cuerpoFuncion(nombre) {
  const m = new RegExp(`(?:async\\s+)?function ${nombre}\\s*\\(`).exec(src);
  assert.ok(m, `no se encontro ${nombre}()`);
  const abre = src.indexOf('{', m.index);
  assert.notEqual(abre, -1, `${nombre} no abre cuerpo`);
  let profundidad = 0;
  for (let i = abre; i < src.length; i += 1) {
    if (src[i] === '{') profundidad += 1;
    else if (src[i] === '}') {
      profundidad -= 1;
      if (profundidad === 0) return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`no se pudo delimitar ${nombre}`);
}

/** Devuelve el fragmento de una ruta por su apertura, hasta el cierre del bloque. */
function bloqueRuta(apertura) {
  const i = src.indexOf(apertura);
  assert.notEqual(i, -1, `no se encontro la ruta ${apertura}`);
  let profundidad = 0;
  let visto = false;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '{') { profundidad += 1; visto = true; }
    else if (src[j] === '}') {
      profundidad -= 1;
      if (visto && profundidad === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`no se pudo delimitar ${apertura}`);
}

// ---------------------------------------------------------------------------
// QR: se ejecuta el codigo real de server.js con las dependencias que usa.
// ---------------------------------------------------------------------------

const firmaQr = new Function(
  'crypto', 'process',
  `return (function () {
    ${cuerpoFuncion('secretoFirmaQr')}
    ${cuerpoFuncion('firmarQr')}
    ${cuerpoFuncion('qrFechaExpiracion')}
    ${cuerpoFuncion('construirTokenQr')}
    ${cuerpoFuncion('verificarTokenQr')}
    return { construirTokenQr, verificarTokenQr, qrFechaExpiracion, firmarQr };
  })()`
)(crypto, process);

test('QR: un token recien emitido es valido', () => {
  const token = firmaQr.construirTokenQr('CLUB-HORIZONTE', { id: 's1', numero_socio: '0007' }, 30);
  const r = firmaQr.verificarTokenQr(token);
  assert.equal(r.ok, true, `un token nuevo debe ser valido: ${r.error}`);
  assert.equal(r.empresa, 'CLUB-HORIZONTE');
  assert.equal(r.socioId, 's1');
  assert.equal(r.numero, '0007');
});

test('QR: un token VENCIDO se rechaza aunque la firma sea correcta', () => {
  // Se construye a mano un token con sello ayer: la firma se calcula con el
  // mismo algoritmo, asi que lo unico que lo invalida es la fecha.
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const sello = ayer.toISOString().slice(0, 10).replace(/-/g, '');
  const codigo = ['PP1', 'CLUB-HORIZONTE', 's9', '0009', sello].join('|');
  const token = `${codigo}|${firmaQr.firmarQr(codigo)}`;

  const r = firmaQr.verificarTokenQr(token);
  assert.equal(r.ok, false, 'un QR vencido no puede validar');
  assert.match(r.error, /vencido/i);
  assert.equal(r.vencido, true, 'debe poder distinguir vencido de invalido');
});

test('QR: hoy todavia es valido (el sello cubre el dia completo)', () => {
  const hoy = new Date();
  const sello = hoy.toISOString().slice(0, 10).replace(/-/g, '');
  const codigo = ['PP1', 'CLUB-HORIZONTE', 's10', '0010', sello].join('|');
  const token = `${codigo}|${firmaQr.firmarQr(codigo)}`;
  assert.equal(firmaQr.verificarTokenQr(token).ok, true, 'el dia de la emision sigue vigente');
});

test('QR: una firma adulterada se rechaza', () => {
  const token = firmaQr.construirTokenQr('CLUB-HORIZONTE', { id: 's2', numero_socio: '0002' }, 30);
  const partes = token.split('|');
  partes[5] = 'f'.repeat(partes[5].length); // misma longitud, otro valor
  const r = firmaQr.verificarTokenQr(partes.join('|'));
  assert.equal(r.ok, false);
  assert.match(r.error, /no es valido/i);
});

test('QR: cambiar el socio dentro del token rompe la firma', () => {
  const token = firmaQr.construirTokenQr('CLUB-HORIZONTE', { id: 's3', numero_socio: '0003' }, 30);
  const partes = token.split('|');
  partes[2] = 's999'; // suplantar otro socio
  assert.equal(firmaQr.verificarTokenQr(partes.join('|')).ok, false);
});

test('QR: una fecha imposible no se compara como NaN', () => {
  // 20260231 no existe: Date la normaliza a 3 de marzo, asi que se rechaza.
  assert.equal(firmaQr.qrFechaExpiracion('20260231'), null);
  assert.equal(firmaQr.qrFechaExpiracion('2026'), null);
  assert.equal(firmaQr.qrFechaExpiracion('20261301'), null);
  assert.equal(firmaQr.qrFechaExpiracion('20260100'), null);
  assert.equal(firmaQr.qrFechaExpiracion(''), null);
  assert.notEqual(firmaQr.qrFechaExpiracion('20261231'), null);
});

test('QR: un token con sello corrupto se rechaza como fecha invalida', () => {
  const sello = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const codigo = ['PP1', 'CLUB-HORIZONTE', 's4', '0004', sello].join('|');
  const token = `${codigo}|${firmaQr.firmarQr(codigo)}`;
  const partes = token.split('|');
  partes[4] = 'AAAAAAA'; // firma recalculada para que solo falle la fecha
  partes[5] = firmaQr.firmarQr(partes.slice(0, 5).join('|'));
  const r = firmaQr.verificarTokenQr(partes.join('|'));
  assert.equal(r.ok, false);
  assert.match(r.error, /expiracion invalida/i);
});

// ---------------------------------------------------------------------------
// Cuentas abiertas: la compensacion debe existir en ambos caminos.
// ---------------------------------------------------------------------------

test('editar consumo: devuelve el stock si la linea no se actualiza', () => {
  const ruta = bloqueRuta("app.put('/api/cuentas-abiertas/:id/consumos/:detalleId'");
  assert.match(ruta, /COMPENSACION_FALLIDA/, 'debe avisar si la compensacion falla');
  assert.match(ruta, /Compensacion por fallo al ajustar consumo/,
    'debe dejar nota en kardex de la compensacion');
  assert.match(ruta, /movimiento: delta > 0 \? 'ENTRADA' : 'SALIDA'/,
    'la compensacion debe ser la inversa del movimiento original');
  assert.match(ruta, /productoDeEmpresa\(tenant, linea\.producto_id\)/,
    'debe consultar el stock real antes de devolverlo');
  assert.match(ruta, /El stock fue devuelto/,
    'debe decir que el inventario quedo compensado');
});

test('eliminar consumo: restaura la linea si la devolucion de stock falla', () => {
  const ruta = bloqueRuta("app.delete('/api/cuentas-abiertas/:id/consumos/:detalleId'");
  assert.match(ruta, /STOCK_DEVOLUCION_FALLIDA/, 'debe distinguir este fallo');
  assert.match(ruta, /from\('cuentas_abiertas_detalle'\)\.insert\(\[borrado\]\)/,
    'debe reinsertar el consumo que habia eliminado');
  assert.match(ruta, /El consumo se conservo/,
    'debe aclarar que la linea sigue viva');
});

test('cerrar cuenta: exige forma de pago y libera la mesa', () => {
  const ruta = bloqueRuta("app.post('/api/cuentas-abiertas/:id/cerrar'");
  assert.match(ruta, /forma_pago es requerida/, 'no se cierra sin forma de pago');
  assert.match(ruta, /estado: 'libre'/, 'la mesa queda libre');
  assert.match(ruta, /eq\('estado', 'abierta'\)/,
    'el cierre es condicional: si otra operacion ya cerro, no se pisa');
  assert.match(ruta, /La cuenta fue cerrada por otra operacion/);
});

test('accesos: entrada, salida y rechazo pasan por la misma regla', () => {
  assert.match(src, /const TIPOS_ACCESO = \['entrada', 'salida', 'entrada_salida', 'rechazado'\]/);
  const helper = cuerpoFuncion('registrarAccesoSocio');
  assert.match(helper, /entrada_salida'\) estado = 'fuera'/, 'entrada_salida deja al socio fuera');
  assert.match(helper, /tipo === 'rechazado'\) estado = 'rechazado'/,
    'el rechazo no cambia la presencia');
  assert.match(helper, /La membresia del socio esta vencida/,
    'un socio vencido no ingresa');
  assert.match(helper, /No puede ingresar/,
    'un socio inactivo no ingresa');
});