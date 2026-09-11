// Carga dinamica de modulos desde el backend (slugs reales por area/plan)
const MODULO_INFO = {
  'POS': { icon: 'fa-cash-register' },
  'Canal Moderno': { icon: 'fa-store' },
  'Canal Tradicional': { icon: 'fa-shop' },
  'Chat IA': { icon: 'fa-robot' },
  'Comercial': { icon: 'fa-briefcase' },
  'Compras & Proveedores': { icon: 'fa-truck' },
  'Contabilidad': { icon: 'fa-calculator' },
  'Cotizaciones': { icon: 'fa-file-invoice' },
  'CRM': { icon: 'fa-handshake' },
  'CRM Avanzado': { icon: 'fa-user-tie' },
  'Facturación SAR': { icon: 'fa-file-invoice-dollar' },
  'Fiscal Avanzado': { icon: 'fa-landmark' },
  'Inventario': { icon: 'fa-boxes-stacked' },
  'Membresías': { icon: 'fa-id-card' },
  'Multi-Empresa': { icon: 'fa-building' },
  'Retail': { icon: 'fa-shopping-bag' },
  'RRHH': { icon: 'fa-users' },
  'Sector Retail': { icon: 'fa-tags' },
  'Seguridad': { icon: 'fa-shield-halved' },
  'Configuración': { icon: 'fa-gear' },
  'Soporte': { icon: 'fa-headset' },
  'Supply Chain': { icon: 'fa-boxes' },
  'Analytics': { icon: 'fa-chart-line' }
};
const SLUG_TO_MODULO = {
  pos_caja: 'POS', pos_pulperia: 'POS', pos_ventas: 'POS', pos_multicaja: 'POS', pos_escaner: 'POS',
  inventario_rapido: 'Inventario', inventario_basico: 'Inventario', inventario_multibodega: 'Inventario', inventario_avanzado: 'Inventario', control_stock: 'Inventario', transferencias_bodega: 'Inventario',
  facturacion_sar: 'Facturación SAR',
  credito_clientes: 'CRM', cuentas_por_cobrar: 'CRM', clientes_proveedores: 'CRM',
  gestion_membresias: 'Membresías', ventas_mayoreo: 'Membresías',
  analytics_ventas: 'Analytics', reportes_comerciales: 'Analytics',
  despacho_flotas: 'Supply Chain', flota_vehiculos: 'Supply Chain',
  automatizacion_rpa: 'Comercial', api_keys_seguridad: 'Seguridad'
};
const MODULOS_FALLBACK = ['POS','Canal Moderno','Canal Tradicional','Chat IA','Comercial','Compras & Proveedores','Contabilidad','Cotizaciones','CRM','CRM Avanzado','Facturación SAR','Fiscal Avanzado','Inventario','Membresías','Multi-Empresa','Retail','RRHH','Sector Retail','Seguridad','Configuración','Soporte','Supply Chain','Analytics'];

function renderModulos(nombres) {
  const grid = document.getElementById('modulosGrid');
  if (!grid) return;
  grid.innerHTML = '';
  nombres.forEach(function(nombre) {
    const info = MODULO_INFO[nombre] || { icon: 'fa-cube' };
    const card = document.createElement('a');
    card.className = 'area-card';
    card.href = 'dashboard.html';
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    card.innerHTML = '<div class="area-icon"><i class="fas ' + info.icon + '"></i></div>' +
                     '<h3>' + nombre + '</h3>' +
                     '<div class="btn-ingresar">Acceder <i class="fas fa-arrow-right"></i></div>';
    grid.appendChild(card);
  });
  Array.prototype.forEach.call(grid.querySelectorAll('.area-card'), function(card, i) {
    setTimeout(function() { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; }, 100 + i * 60);
  });
}

async function cargarModulos() {
  const grid = document.getElementById('modulosGrid');
  if (!grid) return;
  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/tenant/modules', { headers: { 'Authorization': 'Bearer ' + (token || '') } });
    const data = await res.json();
    const slugs = (data && Array.isArray(data.modulos_activos)) ? data.modulos_activos : [];
    let nombres = [];
    slugs.forEach(function(s) { const n = SLUG_TO_MODULO[s]; if (n && nombres.indexOf(n) === -1) nombres.push(n); });
    if (nombres.length === 0) nombres = MODULOS_FALLBACK.slice();
    renderModulos(nombres);
  } catch (e) {
    renderModulos(MODULOS_FALLBACK.slice());
  } finally {
    const sk = document.getElementById('areasSkeleton');
    if (sk) sk.style.display = 'none';
  }
}
cargarModulos();