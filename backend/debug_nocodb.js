const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const NOCODB_URL = process.env.NOCODB_URL || 'https://app.nocodb.com';
const API_TOKEN = process.env.NOCODB_API_TOKEN || process.env.NOCODB_API_KEY || '';
const tablas = {
  usuarios: '/api/v2/tables/mv83zjc2acolkh6/records',
  empresas: '/api/v2/tables/mfmktdwy014a8l5/records'
};
const nocodb = axios.create({ baseURL: NOCODB_URL, headers: { 'xc-token': API_TOKEN, 'Content-Type': 'application/json' } });
(async function() {
  try {
    for (const [name, table] of Object.entries(tablas)) {
      const resp = await nocodb.get(table, { params: { limit: 3 } });
      console.log('TABLE', name);
      console.log(JSON.stringify(resp.data, null, 2));
      console.log('---');
    }
  } catch (err) {
    console.error('ERR', err.response ? { status: err.response.status, data: err.response.data } : err.message);
  }
})();
