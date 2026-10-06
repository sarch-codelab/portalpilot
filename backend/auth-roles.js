/**
 * auth-roles.js — cálculo de rol efectivo.
 *
 * Vive aparte de server.js a propósito: es la decisión que decide si una
 * cuenta entra como ROOT (y con eso ve la vista de plataforma y todos los
 * endpoints requireRoot), así que tiene que poder probarse de verdad, sin
 * levantar el servidor ni la base de datos.
 *
 * REGLA: el ROOT se concede por ROL GLOBAL, nunca por el tenant al que
 * pertenece la cuenta. Pertenecer al tenant 'ROOT' es un dato de negocio,
 * no un permiso.
 */

'use strict';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function normalizeTenantCode(code) {
  return (code || '').toString().trim().toUpperCase();
}

function isGlobalAdminRole(role) {
  return ['root', 'root pp', 'superadmin', 'super admin'].includes(normalizeRole(role));
}

/**
 * Rol con el que se presenta al usuario. NO decide permisos (eso lo hace
 * requireRoot/requireTenantAdmin contra la sesión), pero sí decide si
 * `isRootUser()` devuelve true, y por eso no puede depender del código de
 * empresa: antes lo hacía (`|| tenantCode === 'ROOT'`) y convertía en
 * superadmin a cualquier cuenta alojada en el tenant ROOT, aunque su
 * rol_global fuera 'user'.
 */
function resolveDisplayRole(userRow, tenantRow) {
  const userEmail = String(userRow && (userRow.email || '')).toLowerCase().trim();
  const tenEmail = String(tenantRow && (tenantRow.email || tenantRow.correo || tenantRow.email_representante || tenantRow.correo_representante || '')).toLowerCase().trim();
  const globalRole = normalizeRole(userRow && userRow.rol_global);

  if (isGlobalAdminRole(globalRole)) {
    return globalRole === 'super admin' ? 'superadmin' : globalRole;
  }
  if (userEmail && tenEmail && userEmail === tenEmail) return 'Owner';
  return userRow.rol || userRow.rol_global || 'admin';
}

/** Espejo de isRootUser() en server.js, para poder probarlo aislado. */
function isRootUser(user) {
  return isGlobalAdminRole(user && user.rol);
}

module.exports = {
  normalizeRole,
  normalizeTenantCode,
  isGlobalAdminRole,
  resolveDisplayRole,
  isRootUser,
};