#!/usr/bin/env node
/**
 * Script para probar el endpoint POST /api/login
 * Uso: node backend/test_login_api.js <email> <password>
 */

const axios = require('axios');

const testEmail = process.argv[2] || 'elsanchezok@yahoo.com';
const testPassword = process.argv[3] || '12345678';
const API_URL = 'http://localhost:3000';

console.log('\n🔐 PRUEBA DE LOGIN API\n');
console.log('═'.repeat(60));
console.log(`📧 Email: ${testEmail}`);
console.log(`🔑 Contraseña: ${testPassword}`);
console.log(`🌐 API URL: ${API_URL}`);
console.log('═'.repeat(60));

async function testLogin() {
  try {
    console.log('\n📤 Enviando POST /api/login...\n');

    const response = await axios.post(`${API_URL}/api/login`, {
      email: testEmail,
      password: testPassword
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      validateStatus: () => true // No lanzar error por status codes
    });

    console.log(`📊 Status: ${response.status}`);
    console.log(`📝 Respuesta completa:\n`);
    console.log(JSON.stringify(response.data, null, 2));

    if (response.status === 200) {
      console.log('\n✅ LOGIN EXITOSO');
      if (response.data.token) {
        console.log(`\n🎫 Token JWT:`);
        console.log(response.data.token);
      }
    } else {
      console.log(`\n❌ LOGIN FALLÓ (${response.status})`);
      console.log(`Error: ${response.data.error}`);
    }

  } catch (error) {
    console.error('\n❌ ERROR de conexión:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   ⚠️  El servidor no está corriendo en http://localhost:3000');
      console.error('   Inicia con: node backend/server.js');
    }
  }
}

testLogin();
