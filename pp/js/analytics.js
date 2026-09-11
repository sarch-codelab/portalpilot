// ── Analytics — Data & Charts ─────────────────
const API_BASE = '/api';
let summaryData = null;
let analyticsFilters = { period: '7', tenant: '', metric: 'usage' };

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}` }; }

// ── Load Dashboard Summary ─────────────────
async function loadAnalytics() {
  try {
    const params = new URLSearchParams({ period: analyticsFilters.period });
    if (analyticsFilters.tenant) params.set('tenant', analyticsFilters.tenant);
    const res = await fetch(`${API_BASE}/dashboard/summary?${params}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar');
    summaryData = await res.json();
    renderKPIs();
    renderCharts();
    renderActivityTable();
  } catch (err) {
    console.error('[ANALYTICS] Error:', err);
  }
}

// ── Render KPI Cards ─────────────────
function renderKPIs() {
  if (!summaryData) return;
  const kpis = summaryData.kpis || {};
  const cards = document.querySelectorAll('.kpi-card');
  if (cards.length >= 6) {
    setKPI(cards[0], formatNum(kpis.usuariosTotal || 0), 'Total Usuarios');
    setKPI(cards[1], formatNum(kpis.usuariosActivosHoy || 0), 'Usuarios Activos (hoy)');
    setKPI(cards[2], 'L ' + formatNum(kpis.ingresoMes || 0), 'Ingresos del mes');
    const paidRate = kpis.facturasCount > 0 ? ((1 - (kpis.facturasPendientes || 0) / kpis.facturasCount) * 100).toFixed(1) + '%' : '—';
    setKPI(cards[3], paidRate, 'Facturas cobradas');
    setKPI(cards[4], 'L ' + formatNum(kpis.balanceMes || 0), 'Balance del mes');
    setKPI(cards[5], formatNum(kpis.lowStock || 0), 'Productos con stock bajo');
  }
}

function setKPI(card, value, label) {
  const valEl = card.querySelector('.kpi-value');
  const lblEl = card.querySelector('.kpi-label');
  if (valEl) valEl.textContent = value;
  if (lblEl) lblEl.textContent = label;
}

function formatNum(n) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ── Render Charts ─────────────────
function renderCharts() {
  if (!summaryData) return;
  renderGrowthChart();
  renderActivityChart();
}

function renderGrowthChart() {
  const container = document.getElementById('chartGrowth');
  if (!container) return;
  const dias = summaryData.usage7d || summaryData.dias || summaryData.ultimosDias || [];
  if (!dias.length) {
    container.innerHTML = '<div class="chart-placeholder"><i class="fas fa-chart-area"></i><p>Sin datos de actividad reciente</p></div>';
    return;
  }
  const series = analyticsFilters.metric === 'revenue'
    ? [{ key: 'ingresos', label: 'Ingresos', color: 'var(--accent)' }, { key: 'gastos', label: 'Gastos', color: 'var(--red)' }]
    : analyticsFilters.metric === 'growth'
      ? [{ key: 'usuarios', label: 'Usuarios nuevos', color: 'var(--green)' }]
      : [{ key: 'facturas', label: 'Facturas', color: 'var(--accent)' }, { key: 'transacciones', label: 'Transacciones', color: 'var(--green)' }];
  const maxVal = Math.max(1, ...dias.map(d => series.reduce((sum, item) => sum + (Number(d[item.key]) || 0), 0)));
  container.innerHTML = `<div style="display:flex;align-items:flex-end;gap:2px;height:180px;padding:16px 0;">
    ${dias.map(d => {
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%;justify-content:flex-end;">
        <div style="display:flex;flex-direction:column;width:100%;gap:1px;">
          ${series.map(item => {
            const value = ((Number(d[item.key]) || 0) / maxVal) * 100;
            return `<div style="width:100%;height:${value}px;background:${item.color};border-radius:3px;min-height:${value > 0 ? '4px' : '0'};"></div>`;
          }).join('')}
        </div>
        <div style="font-size:10px;color:var(--gray);margin-top:4px;">${d.label || d.fecha?.slice(5) || ''}</div>
      </div>`;
    }).join('')}
  </div>
  <div style="display:flex;gap:16px;justify-content:center;margin-top:8px;">
    ${series.map(item => `<span style="font-size:11px;color:var(--gray);"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${item.color};margin-right:4px;"></span>${item.label}</span>`).join('')}
  </div>`;
}

function renderActivityChart() {
  const container = document.getElementById('chartActivity');
  if (!container) return;
  const roles = summaryData.roles || [];
  const gastos = summaryData.gastosCategoria || [];
  const rolesData = Array.isArray(roles)
    ? Object.fromEntries(roles.map(item => [item.rol || 'Usuario', item.count || 0]))
    : roles;
  const gastosData = Array.isArray(gastos)
    ? Object.fromEntries(gastos.map(item => [item.categoria || 'Otro', item.monto || 0]))
    : gastos;
  const rolesIsObj = rolesData && typeof rolesData === 'object' && Object.keys(rolesData).length > 0;
  const gastosIsObj = gastosData && typeof gastosData === 'object' && Object.keys(gastosData).length > 0;
  const hasRoles = rolesIsObj && Object.keys(rolesData).length > 0;
  const hasGastos = gastosIsObj && Object.keys(gastosData).length > 0;
  if (!hasRoles && !hasGastos) {
    container.innerHTML = '<div class="chart-placeholder"><i class="fas fa-chart-bar"></i><p>Sin datos de distribución</p></div>';
    return;
  }
  const data = hasRoles ? rolesData : gastosData;
  const total = Object.values(data).reduce((s, v) => s + v, 0) || 1;
  const colors = ['#8b5cf6', '#34d399', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
  container.innerHTML = `<div style="padding:16px 0;">
    ${Object.entries(data).map(([key, val], i) => {
      const pct = ((val / total) * 100).toFixed(1);
      const color = colors[i % colors.length];
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:12px;height:12px;border-radius:3px;background:${color};flex-shrink:0;"></div>
        <div style="flex:1;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:12px;color:var(--text);">${key}</span>
            <span style="font-size:11px;color:var(--gray);">${pct}%</span>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Render Activity Table ─────────────────
function renderActivityTable() {
  if (!summaryData) return;
  const tbody = document.getElementById('recentActivityBody');
  if (!tbody) return;
  const events = summaryData.actividadReciente || [];
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray);padding:24px;">Sin actividad reciente</td></tr>';
    return;
  }
  tbody.innerHTML = events.map(e => {
    const parts = (e.detalle || '').split(' · ');
    const meta = parts[0] || '';
    const dateStr = parts[1] || '';
    const impact = getImpact(e.tipo);
    return `<tr>
      <td>${esc(dateStr)}</td>
      <td>${esc(e.titulo)}</td>
      <td>${esc(meta)}</td>
      <td><span class="impact-badge ${impact.cls}">${impact.label}</span></td>
    </tr>`;
  }).join('');
}

function getImpact(tipo) {
  if (tipo === 'factura' || tipo === 'ingreso') return { cls: 'high', label: 'Alto' };
  if (tipo === 'usuario') return { cls: 'medium', label: 'Medio' };
  return { cls: 'low', label: 'Bajo' };
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── Reveal Animations ─────────────────
function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ── Load Tenants for Filter ─────────────────
async function loadTenants() {
  const sel = document.getElementById('filterTenant');
  if (!sel) return;
  try {
    const res = await fetch(`${API_BASE}/tenants`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const tenants = data.tenants || data || [];
    tenants.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.codigo || t.id;
      opt.textContent = t.nombre_empresa || t.nombre || t.codigo;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

function applyAnalyticsFilters() {
  analyticsFilters.period = document.getElementById('filterPeriod')?.value === 'today' ? '1' : (document.getElementById('filterPeriod')?.value || '7d').replace('d', '');
  analyticsFilters.tenant = document.getElementById('filterTenant')?.value || '';
  analyticsFilters.metric = document.getElementById('filterMetric')?.value || 'usage';
  loadAnalytics();
}

function resetAnalyticsFilters() {
  document.getElementById('filterPeriod').value = '7d';
  document.getElementById('filterTenant').value = '';
  document.getElementById('filterMetric').value = 'usage';
  applyAnalyticsFilters();
}

// ── Init ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filterPeriod')?.addEventListener('change', applyAnalyticsFilters);
  document.getElementById('filterTenant')?.addEventListener('change', applyAnalyticsFilters);
  document.getElementById('filterMetric')?.addEventListener('change', applyAnalyticsFilters);
  document.querySelector('.filter-reset')?.addEventListener('click', resetAnalyticsFilters);
  document.querySelector('.page-actions .btn-ghost')?.addEventListener('click', loadAnalytics);
  document.querySelectorAll('.chart-actions button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.chart-actions button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      document.getElementById('filterPeriod').value = button.dataset.period.toLowerCase();
      applyAnalyticsFilters();
    });
  });
  loadAnalytics();
  loadTenants();
  initReveal();
});
