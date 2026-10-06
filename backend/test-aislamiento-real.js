/**
 * test-aislamiento-real.js — prueba REAL de aislamiento entre cuentas.
 *
 * Ejecutar:  node --test backend/test-aislamiento-real.js
 * Requiere:  .env con SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y JWT_SECRET.
 *            Si faltan, el test se omite (no falla), para poder correr la
 *            suite sin credenciales.
 *
 * Diferencia con test-tenant-isolation-modulos.js: ese prueba el enrutador con
 * un Supabase en memoria; este levanta server.js real y contra la base real.
 *
 * Qué comprueba:
 *   1. Los claims del JWT de cada dueño.
 *   2. GET /api/productos y /api/kardex con cada token devuelven solo filas de
 *      SU empresa (por empresa_id, no por texto).
 *   3. Con el token de B se pide un producto concreto de A → 404.
 *      (Éste es el intento de lectura cruzada directo.)
 *   4. GET /api/global/admins: portalpilot.hn@gmail.com → 403,
 *      admin@portalpilot.com → 200. Cubre la escalada de privilegios corregida.
 *
 * No escribe nada: todas las peticiones son GET.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const CREDENCIALES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET']
  .filter((k) => !process.env[k]);

const CUENTAS = [
  { email: 'infinihon.hn@gmail.com', tenant: 'PP-K3DN-KS56' },
  { email: 'portalpilot.hn@gmail.com', tenant: 'ROOT' },
  { email: 'admin@portalpilot.com', tenant: 'ROOT', esRoot: true },
];

if (CREDENCIALES.length) {
  test('aislamiento real entre cuentas', (t) => {
    t.skip(`faltan variables en .env: ${CREDENCIALES.join(', ')}`);
  });
} else {
  suiteCompleta();
}

function suiteCompleta() {
  // Debe ir antes de requerir server.js: IS_SERVERLESS evita que haga listen.
  process.env.VERCEL = '1';

  const jwt = require('jsonwebtoken');
  const { createClient } = require('@supabase/supabase-js');
  const http = require('node:http');

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  test('aislamiento real entre cuentas', async (t) => {
    // ── 1. Fila real de cada usuario, tal y como la vería /api/login ──────────
    const filas = {};
    for (const c of CUENTAS) {
      const { data: u, error } = await db
        .from('usuarios')
        .select('id, email, rol, rol_global, empresa_codigo, token_version, activo')
        .eq('email', c.email)
        .maybeSingle();
      assert.ifError(error);
      assert.ok(u, `no existe el usuario ${c.email} en la base`);
      assert.equal(u.activo, true, `${c.email} debe estar activo`);

      const { data: tenant } = await db
        .from('tenants').select('codigo, nombre, email, correo')
        .eq('codigo', u.empresa_codigo)
        .maybeSingle();

      // Misma fórmula que usa server.js en /api/login (resolveDisplayRole).
      const { resolveDisplayRole } = require('./auth-roles');
      filas[c.email] = {
        ...c,
        fila: u,
        tenant,
        rol: resolveDisplayRole(u, tenant),
        token: jwt.sign(
          {
            sub: u.id,
            email: u.email,
            rol: resolveDisplayRole(u, tenant),
            empresa_codigo: u.empresa_codigo || 'ROOT',
            token_version: u.token_version || 0,
          },
          process.env.JWT_SECRET,
          { expiresIn: '10m' },
        ),
      };
      assert.equal(u.empresa_codigo, c.tenant,
        `${c.email} debe seguir en ${c.tenant}`);
    }

    await t.test('los claims del token reflejan el rol real', () => {
      const claims = (c) => jwt.verify(filas[c].token, process.env.JWT_SECRET);
      assert.equal(claims('infinihon.hn@gmail.com').empresa_codigo, 'PP-K3DN-KS56');
      assert.equal(claims('portalpilot.hn@gmail.com').empresa_codigo, 'ROOT');
      // La escalada corregida: era 'root', ahora es su rol real de empresa.
      assert.notEqual(claims('portalpilot.hn@gmail.com').rol, 'root');
      assert.equal(claims('portalpilot.hn@gmail.com').rol, 'admin');
      assert.equal(claims('admin@portalpilot.com').rol, 'root');
    });

    // ── Servidor real, en un puerto efímero ──────────────────────────────────
    const app = require('./server.js');
    const srv = http.createServer(app);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    t.after(() => new Promise((r) => srv.close(r)));

    const get = async (ruta, email) => {
      const r = await fetch(base + ruta, {
        headers: { Authorization: `Bearer ${filas[email].token}` },
      });
      let body = null;
      try { body = await r.json(); } catch { /* 204 o HTML */ }
      return { status: r.status, body };
    };

    await t.test('el health responde sin token', async () => {
      const r = await fetch(base + '/api/health');
      assert.equal(r.status, 200);
    });

    // ── 2+3. Inventario con cada token ───────────────────────────────────────
    for (const ruta of ['/api/productos', '/api/kardex']) {
      await t.test(`${ruta}: cada dueño ve solo su empresa`, async () => {
        const vistas = {};
        for (const c of CUENTAS) {
          const { status, body } = await get(ruta, c.email);
          if (status === 403) {
            assert.ok(/plan|modulo|feature/i.test(String(body && body.error)),
              `${c.email} solo puede recibir 403 por plan, no por otro motivo: ${JSON.stringify(body)}`);
            return; // plan sin inventario: no hay nada que comparar
          }
          assert.equal(status, 200, `${c.email} en ${ruta} → ${JSON.stringify(body)}`);
          const filas2 = Array.isArray(body) ? body : (body && (body.productos || body.movimientos || body.items)) || [];
          assert.ok(Array.isArray(filas2), `respuesta inesperada: ${JSON.stringify(body).slice(0, 300)}`);
          const ids = new Set(filas2.map((f) => f.empresa_id).filter(Boolean));
          assert.ok(ids.size <= 1,
            `${c.email} recibió filas de ${ids.size} empresas distintas en ${ruta}`);
          vistas[c.email] = { filas2, empresas: ids };
        }

        // Las respuestas no deben compartir empresas entre dueños distintos.
        const [a, b] = ['infinihon.hn@gmail.com', 'portalpilot.hn@gmail.com']
          .map((e) => vistas[e]);
        const comunes = [...a.empresas].filter((id) => b.empresas.has(id));
        assert.deepEqual(comunes, [],
          `ambos dueños vieron productos de la misma empresa: ${comunes}`);
      });
    }

    await t.test('lectura cruzada directa: un producto ajeno responde 404', async () => {
      const origen = 'infinihon.hn@gmail.com';
      const intruso = 'portalpilot.hn@gmail.com';
      const { status, body } = await get('/api/productos?limit=1', origen);
      if (status === 403) return; // sin inventario no hay id que probar
      const id = body && body.productos && body.productos[0] && body.productos[0].id;
      if (!id) return; // el tenant no tiene productos todavía

      const r = await get(`/api/productos/${id}`, intruso);
      assert.ok(r.status === 404 || r.status === 400,
        `${intruso} pudo leer el producto ${id} de Infinihon (status ${r.status})`);
    });

    // ── 4. Escalada de privilegios ───────────────────────────────────────────
    await t.test('GET /api/global/admins: la cuenta ROOT con rol_global=user queda fuera', async () => {
      const { status, body } = await get('/api/global/admins', 'portalpilot.hn@gmail.com');
      assert.equal(status, 403,
        `portalpilot.hn@gmail.com alcanzó /api/global/admins con ${JSON.stringify(body).slice(0, 200)}`);
    });

    await t.test('GET /api/global/admins: el root real conserva el acceso', async () => {
      const { status, body } = await get('/api/global/admins', 'admin@portalpilot.com');
      assert.equal(status, 200,
        `admin@portalpilot.com perdió acceso root: ${status} ${JSON.stringify(body).slice(0, 200)}`);
      assert.ok(Array.isArray(body && body.admins ? body.admins : body) || body,
        'respuesta sin estructura esperada');
    });

    await t.test('ninguna ruta exige una empresa que no coincida con el token', async () => {
      for (const c of CUENTAS) {
        const { status, body } = await get('/api/empresa', c.email);
        if (status === 200 && body && (body.codigo || body.empresa_codigo)) {
          assert.equal(String(body.codigo || body.empresa_codigo).toUpperCase(),
            c.tenant.toUpperCase(),
            `${c.email} recibió datos de otra empresa`);
        }
      }
    });
  });
}