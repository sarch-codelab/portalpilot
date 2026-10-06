/**
 * test-auth-roles.js — el rol efectivo decide si una cuenta entra como ROOT.
 *
 * Ejecutar:  node --test backend/test-auth-roles.js
 *
 * Este archivo fija un agujero que ya existió: `resolveDisplayRole` concedía
 * root a cualquier usuario cuyo empresa_codigo fuera 'ROOT'
 * (`isGlobalAdminRole(globalRole) || tenantCode === 'ROOT'`).
 *
 * Consecuencia medida: portalpilot.hn@gmail.com tiene rol_global='user' y
 * empresa_codigo='ROOT'. Con esa condición pasaba isRootUser() →true, con lo
 * cual alcanzaba la vista de plataforma (que lee billing_payments, tenants y
 * usuarios SIN filtro de empresa) y los 16 endpoints requireRoot, entre ellos
 * POST /api/global/admins, que escribe rol_global='root' sobre CUALQUIER
 * usuario del sistema. Es decir, podía autopromocerse y luego leer datos de
 * otros tenants.
 *
 * La regla que queda: el root se concede por ROL GLOBAL. El empresa_codigo es
 * un dato de negocio, nunca un permiso.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRole, isGlobalAdminRole, resolveDisplayRole, isRootUser,
} = require('./auth-roles');

// ─────────────────────────────────────────────────────────────────────────────
// Las filas reales de la base, para que el test describa a quién afectaba.
// ─────────────────────────────────────────────────────────────────────────────

const INFINIHON = {
  email: 'infinihon.hn@gmail.com', empresa_codigo: 'PP-K3DN-KS56',
  rol: 'owner', rol_global: 'owner', activo: true,
};
const PORTALPILOT = {
  email: 'portalpilot.hn@gmail.com', empresa_codigo: 'ROOT',
  rol: 'admin', rol_global: 'user', activo: true,
};
const ADMIN_PP = {
  email: 'admin@portalpilot.com', empresa_codigo: 'ROOT',
  rol: 'root', rol_global: 'root', activo: true,
};

// ─────────────────────────────────────────────────────────────────────────────

test('pertenecer al tenant ROOT NO concede superadmin', () => {
  const rol = resolveDisplayRole(PORTALPILOT, null);
  assert.equal(rol, 'admin', 'su rol real es admin');
  assert.equal(isRootUser({ rol }), false,
    'una cuenta con rol_global=user no puede entrar como root por vivir en ROOT');
});

test('ningún rol_global no-root se convierte en root por su empresa_codigo', () => {
  for (const codigo of ['ROOT', 'PP-K3DN-KS56', 'CUALQUIER-CODIGO']) {
    const u = { email: 'x@y.com', empresa_codigo: codigo, rol: 'admin', rol_global: 'user' };
    assert.equal(isRootUser({ rol: resolveDisplayRole(u, null) }), false,
      `empresa_codigo=${codigo} no debe producing root`);
  }
});

test('el root real sigue siendo root', () => {
  assert.equal(resolveDisplayRole(ADMIN_PP, null), 'root');
  assert.equal(isRootUser({ rol: resolveDisplayRole(ADMIN_PP, null) }), true);
});

test('rol_global gana sobre el rol de la empresa', () => {
  assert.equal(resolveDisplayRole({ ...INFINIHON, rol_global: 'super admin' }, null), 'superadmin');
  assert.equal(resolveDisplayRole({ ...INFINIHON, rol_global: 'root' }, null), 'root');
  assert.equal(isRootUser({ rol: resolveDisplayRole({ ...INFINIHON, rol_global: 'root' }, null) }), true);
});

test('el dueño de empresa (correo = correo del tenant) conserva Owner', () => {
  const tenantRow = { email: INFINIHON.email, nombre: 'Infinihon' };
  assert.equal(resolveDisplayRole(INFINIHON, tenantRow), 'Owner');
  assert.equal(isRootUser({ rol: resolveDisplayRole(INFINIHON, tenantRow) }), false);
});

test('un Owner de empresa NO puede llegar a requireRoot', () => {
  // Es el caso que más importa: el dueño de Infinihon debe poder operar SU
  // empresa y nada más.
  const rol = resolveDisplayRole(INFINIHON, { email: INFINIHON.email });
  assert.equal(isRootUser({ rol }), false);
  assert.equal(isGlobalAdminRole(rol), false);
});

test('los dos dueños quedan en tenants distintos y ninguno es root', () => {
  const a = resolveDisplayRole(INFINIHON, { email: INFINIHON.email });
  const b = resolveDisplayRole(PORTALPILOT, null);
  assert.notEqual(a, b);
  assert.equal(isRootUser({ rol: a }), false);
  assert.equal(isRootUser({ rol: b }), false);
});

test('normalizeRole tolera el formato con guiones y espacios', () => {
  assert.equal(normalizeRole('Super-Admin'), 'super admin');
  assert.equal(normalizeRole('  ROOT  '), 'root');
  assert.equal(normalizeRole('root_pp'), 'root pp');
  assert.equal(isGlobalAdminRole('ROOT_PP'), true);
  assert.equal(isGlobalAdminRole(''), false);
  assert.equal(isGlobalAdminRole(undefined), false);
  assert.equal(isGlobalAdminRole(null), false);
  assert.equal(isGlobalAdminRole('user'), false);
});

test('un rol vacío no degenera en root', () => {
  assert.equal(isRootUser({}), false);
  assert.equal(isRootUser(null), false);
  assert.equal(resolveDisplayRole({}, null), 'admin');
});

test('los_ENDPOINTS requireRoot no dependen solo de empresa_codigo', () => {
  // Guarda de regresión sobre el archivo: si alguien vuelve a colar un
  // `tenantCode === 'ROOT'` en la lógica de roles, esto falla.
  const fs = require('node:fs');
  const path = require('node:path');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const cuerpo = server.slice(server.indexOf('function isRootUser'));
  assert.ok(!/tenantCode\s*===\s*'ROOT'/.test(cuerpo),
    'isRootUser no puede concederse por empresa_codigo');
});