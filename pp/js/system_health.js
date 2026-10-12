// ── System Health — Data & Monitoring ─────────────────
const API_ROOT = '';
const API_BASE = API_ROOT + '/api';
let healthData = null;
let refreshInterval = null;

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}` }; }

// ── Load System Health ─────────────────
async function loadSystemHealth() {
  try {
    const res = await fetch(`${API_BASE}/system/health`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar');
    healthData = await res.json();
    renderHealthStatus();
    renderServices();
    renderMetrics();
  } catch (err) {
    console.error('[SYSTEM_HEALTH] Error:', err);
    renderErrorState();
  }
}

// ── Render Health Status ─────────────────
function renderHealthStatus() {
  if (!healthData) return;
  const statusEl = document.getElementById('healthStatus');
  const statusBadge = document.getElementById('statusBadge');
  if (!statusEl || !statusBadge) return;

  const isHealthy = healthData.overall === 'healthy';
  statusEl.textContent = isHealthy ? 'Sistema Operativo' : 'Sistema Degradado';
  statusBadge.className = `status-badge ${isHealthy ? 'healthy' : 'degraded'}`;
  statusBadge.textContent = isHealthy ? '✓ Operativo' : '⚠ Degradado';
}

// ── Render Services ─────────────────
function renderServices() {
  if (!healthData) return;
  const container = document.getElementById('servicesContainer');
  if (!container) return;

  const services = healthData.services || [
    { name: 'API Server', status: 'up', latency: 45 },
    { name: 'Database (Supabase)', status: 'up', latency: 120 },
    { name: 'Storage', status: 'up', latency: 85 },
    { name: 'AI Gateway', status: 'up', latency: 230 }
  ];

  container.innerHTML = services.map(s => `
    <div class="service-card ${s.status}">
      <div class="service-header">
        <span class="service-name">${s.name}</span>
        <span class="service-status ${s.status}">
          <i class="fas fa-${s.status === 'up' ? 'check-circle' : 'exclamation-circle'}"></i>
          ${s.status === 'up' ? 'Operativo' : 'Degradado'}
        </span>
      </div>
      <div class="service-metrics">
        <span class="metric">Latencia: ${s.latency}ms</span>
      </div>
    </div>
  `).join('');
}

// ── Render Metrics ─────────────────
function renderMetrics() {
  if (!healthData) return;
  const metrics = healthData.metrics || {
    tenants: 0,
    usuarios: 0,
    facturas: 0,
    tokensIA: 0
  };

  const metricCards = document.querySelectorAll('.metric-card');
  if (metricCards.length >= 4) {
    setMetric(metricCards[0], metrics.tenants || 0, 'Tenants Activos');
    setMetric(metricCards[1], metrics.usuarios || 0, 'Usuarios Totales');
    setMetric(metricCards[2], metrics.facturas || 0, 'Facturas Generadas');
    setMetric(metricCards[3], formatTokens(metrics.tokensIA || 0), 'Tokens IA Consumidos');
  }
}

function setMetric(card, value, label) {
  const valEl = card.querySelector('.metric-value');
  const lblEl = card.querySelector('.metric-label');
  if (valEl) valEl.textContent = formatNum(value);
  if (lblEl) lblEl.textContent = label;
}

function formatNum(n) { return Number(n).toLocaleString('en-US'); }
function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// ── Render Error State ─────────────────
function renderErrorState() {
  const container = document.getElementById('servicesContainer');
  if (container) {
    container.innerHTML = '<div class="error-state"><i class="fas fa-exclamation-triangle"></i><p>No se pudo cargar el estado del sistema</p></div>';
  }
}

// ── Auto-refresh ─────────────────
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(loadSystemHealth, 30000); // 30 segundos
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// ── Initialize ─────────────────
document.addEventListener('DOMContentLoaded', function () {
  loadSystemHealth();
  startAutoRefresh();

  // Cleanup on page unload
  window.addEventListener('beforeunload', stopAutoRefresh);
});
