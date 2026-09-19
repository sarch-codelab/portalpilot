/* ── Sidebar compartido del panel admin (PP) ──
   Pinta la navegación agrupada en <nav id="sidebarNav"> y resalta
   la página activa según el nombre del archivo. */
(function () {
  const GRUPOS = [
    {
      titulo: 'Supervisión', items: [
        { href: 'dashboard.html', icon: 'fa-gauge', label: 'Dashboard' },
        { href: 'tenants.html', icon: 'fa-building', label: 'Tenants' },
        { href: 'tenant_detail.html', icon: 'fa-magnifying-glass-chart', label: 'Detalle tenant', oculto: true },
        { href: 'bot_detail.html', icon: 'fa-robot', label: 'Detalle bot', oculto: true },
        { href: 'alertas.html', icon: 'fa-bell', label: 'Alertas' },
        { href: 'logs_realtime.html', icon: 'fa-tower-broadcast', label: 'Logs en vivo' },
        { href: 'incidentes_tenant.html', icon: 'fa-triangle-exclamation', label: 'Incidencias' }
      ]
    },
    {
      titulo: 'Operación', items: [
        { href: 'tickets_soporte.html', icon: 'fa-life-ring', label: 'Soporte' },
        { href: 'bots_rpa.html', icon: 'fa-gears', label: 'Bots RPA' },
        { href: 'integraciones.html', icon: 'fa-plug', label: 'Integraciones' },
        { href: 'provisionar_tenant.html', icon: 'fa-user-plus', label: 'Provisionar' },
        { href: 'validacion_tenant.html', icon: 'fa-file-shield', label: 'Validación KYC' }
      ]
    },
    {
      titulo: 'Finanzas', items: [
        { href: 'finanzas.html', icon: 'fa-chart-line', label: 'Finanzas' },
        { href: 'billing_plans.html', icon: 'fa-credit-card', label: 'Billing & Planes' },
        { href: 'renovaciones.html', icon: 'fa-calendar-check', label: 'Renovaciones' },
        { href: 'facturas_cliente.html', icon: 'fa-file-invoice-dollar', label: 'Cuenta corriente' },
        { href: 'consumo_ia.html', icon: 'fa-brain', label: 'Consumo IA' },
        { href: 'consumo_planes.html', icon: 'fa-arrows-up-to-line', label: 'Uso vs. Plan' },
        { href: 'reportes.html', icon: 'fa-file-export', label: 'Reportes' }
      ]
    },
    {
      titulo: 'Seguridad', items: [
        { href: 'seguridad_accesos.html', icon: 'fa-shield-halved', label: 'Sesiones y accesos' },
        { href: 'respaldos_y_rotacion.html', icon: 'fa-arrows-rotate', label: 'Respaldos y rotación' },
        { href: 'reglas_alertas.html', icon: 'fa-sliders', label: 'Reglas de alertas' }
      ]
    },
    {
      titulo: 'Sistema', items: [
        { href: 'auditoria.html', icon: 'fa-link', label: 'Auditoría' },
        { href: 'analytics.html', icon: 'fa-chart-simple', label: 'Analytics' },
        { href: 'comunicados.html', icon: 'fa-bullhorn', label: 'Comunicados' },
        { href: 'system_health.html', icon: 'fa-heartbeat', label: 'System Health' },
        { href: 'usuarios.html', icon: 'fa-users', label: 'Usuarios' },
        { href: 'global_settings.html', icon: 'fa-cog', label: 'Configuración Global' },
        { href: 'perfil.html', icon: 'fa-user', label: 'Mi perfil', oculto: true }
      ]
    }
  ];

  function paginaActual() {
    const f = (window.location.pathname.split('/').pop() || 'dashboard.html').replace(/\.html$/i, '');
    return f.toLowerCase();
  }

  function render() {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    const actual = paginaActual();
    nav.innerHTML = GRUPOS.map(g => {
      const items = g.items.filter(i => !i.oculto || i.href.replace('.html', '') === actual);
      if (!items.length) return '';
      return `<div class="pp-nav-group">
        <div class="pp-nav-title">${g.titulo}</div>
        ${items.map(i => `<a href="${i.href}" class="sidebar-link ${i.href.replace('.html', '') === actual ? 'active' : ''}"><i class="fas ${i.icon}"></i> <span>${i.label}</span></a>`).join('')}
      </div>`;
    }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
