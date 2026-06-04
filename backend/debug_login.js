#!/usr/bin/env node
/**
 * Script de diagnóstico para debuggear problemas de login
 * Uso: node backend/debug_login.js <email>
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios = require('axios');
const bcrypt = require('bcryptjs');

const NOCODB_URL = process.env.NOCODB_URL || 'https://app.nocodb.com';
const API_TOKEN = process.env.NOCODB_API_TOKEN || '';
const USUARIOS_TABLE = '/api/v2/tables/mv83zjc2acolkh6/records';

const testEmail = process.argv[2] || 'test@example.com';

console.log('\n🔍 DIAGNÓSTICO DE LOGIN\n');
console.log('═'.repeat(50));
console.log(`📧 Email a buscar: ${testEmail}`);
console.log('═'.repeat(50));

// Función que usa el servidor para formatear filtros
function formatNocoFilter(value, options = {}) {
  if (value === undefined || value === null) return value;
  const str = String(value).trim();
  if (options.numeric === true) {
    return str;
  }
  return `'${str.replace(/'/g, "''")}'`;
}

// 1. Validar configuración
console.log('\n1️⃣  Verificando configuración...');
console.log(`   ✓ NOCODB_URL: ${NOCODB_URL}`);
console.log(`   ✓ API_TOKEN configurado: ${API_TOKEN ? '✅ SÍ' : '❌ NO'}`);
console.log(`   ✓ USUARIOS_TABLE: ${USUARIOS_TABLE}`);

if (!API_TOKEN) {
  console.error('\n❌ ERROR: NOCODB_API_TOKEN no está configurado en .env');
  process.exit(1);
}

// 2. Crear cliente de API
const nocodbApi = axios.create({
  baseURL: NOCODB_URL,
  headers: {
    'xc-token': API_TOKEN,
    'Content-Type': 'application/json'
  },
  timeout: 15000,
  validateStatus: () => true
});

// 3. Intentar conectarse a NocoDB
async function test() {
  try {
    console.log('\n2️⃣  Conectando a NocoDB...');
    const testUrl = `${NOCODB_URL}${USUARIOS_TABLE}?limit=1`;
    console.log(`   → GET ${testUrl}`);

    const response = await nocodbApi.get(USUARIOS_TABLE, {
      params: { limit: 1 }
    });

    if (response.status === 200) {
      console.log(`   ✅ Conexión exitosa (status: ${response.status})`);
    } else {
      console.log(`   ⚠️  Respuesta inesperada (status: ${response.status})`);
      console.log(`   Respuesta:`, JSON.stringify(response.data, null, 2));
      return;
    }

      // 4. Buscar el usuario por email
    console.log(`\n3️⃣  Buscando usuario con email: ${testEmail}`);

    // Normalizar email (como hace el servidor)
    const emailNorm = testEmail.trim().toLowerCase();
    
    // PRUEBA 1: Con comillas (actual)
    const filterConComillas = `(email,eq,${formatNocoFilter(emailNorm)})`;
    console.log(`   Intento 1 - Con comillas: ${filterConComillas}`);
    
    const userResponse1 = await nocodbApi.get(USUARIOS_TABLE, {
      params: {
        where: filterConComillas,
        limit: 10
      }
    });

    let usuarios = userResponse1.data.list || [];
    
    // PRUEBA 2: Sin comillas
    if (usuarios.length === 0) {
      const filterSinComillas = `(email,eq,${emailNorm})`;
      console.log(`   Intento 2 - Sin comillas: ${filterSinComillas}`);
      
      const userResponse2 = await nocodbApi.get(USUARIOS_TABLE, {
        params: {
          where: filterSinComillas,
          limit: 10
        }
      });
      
      usuarios = userResponse2.data.list || [];
      if (usuarios.length > 0) {
        console.log(`   ✅ ¡FUNCIONÓ sin comillas!`);
      }
    }
    
    const userResponse = userResponse1;
    console.log(`   Status: ${userResponse.status}`);

    if (usuarios.length === 0) {
      console.log(`   ❌ Usuario NO encontrado en la base de datos`);
      console.log('\n   📋 Listando primeros 5 usuarios en la tabla:');

      const allUsersResponse = await nocodbApi.get(USUARIOS_TABLE, {
        params: { limit: 5 }
      });

      const allUsers = allUsersResponse.data.list || [];
      if (allUsers.length === 0) {
        console.log('   ⚠️  La tabla está vacía');
      } else {
        allUsers.forEach((user, idx) => {
          console.log(`   ${idx + 1}. email: "${user.email}" | rol: "${user.rol}" | status: "${user.status}"`);
        });
      }
    } else {
      console.log(`   ✅ Usuario encontrado (${usuarios.length})`);
      
      usuarios.forEach((usuario, idx) => {
        console.log(`\n   📝 Usuario ${idx + 1}:`);
        console.log(`      • Campos del objeto:`, Object.keys(usuario).join(', '));
        console.log(`      • id: ${usuario.id}`);
        console.log(`      • ID: ${usuario.ID}`);
        console.log(`      • Id: ${usuario.Id}`);
        console.log(`      • _id: ${usuario._id}`);
        console.log(`      • nc_: ${usuario['nc_']}`);
        console.log(`      • email: ${usuario.email}`);
        console.log(`      • nombre: ${usuario.nombre}`);
        console.log(`      • rol: ${usuario.rol}`);
        console.log(`      • status: ${usuario.status || usuario.estado}`);
        console.log(`      • empresa_codigo: ${usuario.empresa_codigo}`);
        
        if (usuario.password) {
          if (usuario.password.startsWith('$2')) {
            console.log(`      • password: ✅ Hasheada (bcrypt)`);
          } else if (usuario.password.length > 50) {
            console.log(`      • password: ⚠️  Parece hasheada pero no es bcrypt`);
          } else {
            console.log(`      • password: ⚠️  EN TEXTO PLANO (${usuario.password.length} caracteres)`);
          }
        } else {
          console.log(`      • password: ❌ VACÍA O NO EXISTE`);
        }
        
        // Mostrar TODOS los campos
        console.log(`\n   📋 Todos los campos del usuario:`);
        Object.entries(usuario).forEach(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            console.log(`      ${key}: [objeto]`);
          } else {
            const displayValue = String(value).length > 50 ? String(value).slice(0, 50) + '...' : String(value);
            console.log(`      ${key}: ${displayValue}`);
          }
        });
      });

      // 5. Probar verificación de contraseña
      console.log(`\n4️⃣  Probando verificación de contraseña...`);
      const testPassword = process.argv[3] || 'Test123!';
      console.log(`   Contraseña a probar: ${testPassword}`);

      const usuario = usuarios[0];
      if (!usuario.password) {
        console.log('   ❌ El usuario no tiene contraseña guardada');
      } else if (usuario.password.startsWith('$2')) {
        try {
          const isMatch = await bcrypt.compare(testPassword, usuario.password);
          if (isMatch) {
            console.log(`   ✅ Contraseña CORRECTA`);
          } else {
            console.log(`   ❌ Contraseña INCORRECTA`);
          }
        } catch (err) {
          console.log(`   ❌ Error al verificar bcrypt: ${err.message}`);
        }
      } else {
        const directMatch = usuario.password === testPassword;
        if (directMatch) {
          console.log(`   ✅ Contraseña CORRECTA (comparación directa)`);
          console.log(`   ⚠️  ¡ADVERTENCIA! La contraseña NO está hasheada en la BD`);
        } else {
          console.log(`   ❌ Contraseña INCORRECTA`);
        }
      }

      // 5. Simular lo que hace el servidor
      console.log(`\n5️⃣  Simulando login del servidor...`);
      const rawEmpresa = usuario.empresa_codigo || usuario.Empresa_Codigo || usuario.EmpresaCodigo || usuario.empresaCodigo || 'ROOT';
      const rawRole = usuario.rol || usuario.Rol || usuario.role || usuario.Role || '';
      const rawStatus = usuario.status || usuario.Status || usuario.estado || usuario.Estado || usuario.ESTADO || usuario.STATUS || 'active';
      const rawEmail = usuario.email || usuario.Email || usuario.EMAIL || '';
      const rawId = usuario.id || usuario.ID || usuario.Id || usuario._id;

      console.log(`   Valores extraídos:`);
      console.log(`      • rawId: ${rawId}`);
      console.log(`      • rawRole: "${rawRole}"`);
      console.log(`      • rawEmail: "${rawEmail}"`);
      console.log(`      • rawStatus: "${rawStatus}"`);
      console.log(`      • rawEmpresa: "${rawEmpresa}"`);

      if (!rawId) {
        console.log(`\n   ❌ PROBLEMA: No se pudo obtener el ID del usuario`);
        console.log(`      El servidor no puede crear el token sin ID`);
      } else {
        console.log(`\n   ✅ El servidor podría crear correctamente:`);
        console.log(`      • JWT con sub=${rawId}`);
        console.log(`      • Empresa: ${rawEmpresa.toUpperCase()}`);
        console.log(`      • Rol: ${rawRole}`);
      }
    }

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Diagnóstico completado\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
  }
}

test();
