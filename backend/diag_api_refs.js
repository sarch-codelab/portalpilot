// Verificación Bloque O: cada /api/... referenciado por empresa/ y pp/
// debe existir como ruta registrada en backend/server.js.
const fs = require('fs'), path = require('path');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const routes = new Set();
for (const m of server.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)) routes.add(m[2]);

const refs = new Set();
const norm = s => s.replace(/\$\{[^}]*\}/g, 'X').replace(/X[\w-]*$/, '').replace(/\/+$/, '');
function scan(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { scan(p); continue; }
    if (!/\.(html|js)$/.test(f)) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/["'`]\/(api\/[a-z0-9\-_/${}.:\d]+)/gi)) refs.add('/' + norm(m[1]));
    for (const m of src.matchAll(/["'`]\.\.\/(api\/[a-z0-9\-_/${}.:\d]+)/gi)) refs.add('/' + norm(m[1]));
  }
}
scan(path.join(__dirname, '..', 'empresa'));
scan(path.join(__dirname, '..', 'pp'));

const routeList = [...routes];
const missing = [...refs].filter(r => {
  if (routes.has(r)) return false;
  return !routeList.some(rt => new RegExp('^' + rt.replace(/:[^/]+/g, '[^/]+') + '$').test(r));
}).sort();

console.log('rutas backend:', routes.size, '| referencias frontend:', refs.size);
if (missing.length) {
  console.log('SIN ENDPOINT:');
  for (const r of missing) console.log(' -', r);
  process.exit(1);
}
console.log('OK: todas las referencias del frontend tienen endpoint en el backend.');
