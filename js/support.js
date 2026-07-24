/* js/support.js — Support page: search, FAQ toggle, form submit */

(function(){
  'use strict';

  /* ── Search data ── */
  const KB = [
    { title: 'Configuración del CAI del SAR', desc: 'Configura tu CAI vigente para facturar electrónicamente', section: 'facturacion', keywords: 'cai sar facturacion emitir rango' },
    { title: 'Crear Bot RPA en Workspace', desc: 'Guía paso a paso para crear un agente de automatización', section: 'bots', keywords: 'bot rpa agente automatizacion workspace flow trigger' },
    { title: 'Cambiar de plan', desc: 'Actualiza o downgrade tu plan de Portal Pilot', section: 'cuenta', keywords: 'plan upgrade downgrade billing facturacion cobro' },
    { title: 'Configurar IA (Gemma 3N / Llama 3)', desc: 'Selecciona y configura el modelo de inteligencia artificial', section: 'ia', keywords: 'ia intelgiencia artificial gemma llama mistral modelo local' },
    { title: 'Gestión de inventario', desc: 'Crea productos, almacenes y controla stock en tiempo real', section: 'inventario', keywords: 'inventario producto stock almacen cantidad' },
    { title: 'Contabilidad y reportes', desc: 'Genera balances, estados de resultados y reportes fiscales', section: 'contabilidad', keywords: 'contabilidad balance reporte estado resultado impuesto' },
    { title: 'Editor de flujos (Flow Editor)', desc: 'Conecta triggers, acciones y condiciones con drag & drop', section: 'bots', keywords: 'flow editor flujo nodo trigger accion condicion delay webhook' },
    { title: 'Modo offline de Workspace', desc: 'Opera sin conexión a internet con sincronización automática', section: 'otro', keywords: 'offline conexion sincronizar internet' },
    { title: 'Seguridad y encriptación de datos', desc: 'AES-256, TLS 1.3, backups automáticos', section: 'otro', keywords: 'seguridad encriptacion datos backup supabase' },
    { title: 'API REST para integraciones', desc: 'Endpoints públicos para conectar sistemas externos', section: 'api', keywords: 'api rest endpoint integracion webhook' },
    { title: 'Gestión de usuarios y roles', desc: 'Crea usuarios, asigna roles y controla permisos por módulo', section: 'cuenta', keywords: 'usuarios roles permisos acceso administrador' },
    { title: 'Facturación electrónica hondureña', desc: 'Cumplimiento con normativa SAR/DEI de Honduras', section: 'facturacion', keywords: 'factura electronica sar dei honduras normativa' },
    { title: 'Configurar WhatsApp Business', desc: 'Integra WhatsApp para notificaciones y ventas', section: 'api', keywords: 'whatsapp business integracion notificacion venta' },
    { title: 'Instalación de Workspace', desc: 'Descarga e instala la app de escritorio', section: 'otro', keywords: 'instalar workspace desktop app escritorio descarga' },
    { title: 'IHSS y RAP en nómina', desc: 'Cálculo automático de deducciones laborales hondureñas', section: 'contabilidad', keywords: 'ihss rap nomina deduccion laboral empleado' }
  ];

  const searchInput = document.getElementById('supportSearch');
  const resultsBox = document.getElementById('searchResults');

  if (searchInput && resultsBox) {
    searchInput.addEventListener('input', function(){
      const q = this.value.trim().toLowerCase();
      resultsBox.innerHTML = '';
      if (q.length < 2) { resultsBox.classList.remove('active'); return; }

      const matches = KB.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.keywords.includes(q)
      ).slice(0, 6);

      if (!matches.length) {
        resultsBox.innerHTML = '<div class="search-result-item"><div class="sr-title" style="color:var(--text-muted)">Sin resultados</div><div class="sr-desc">Intenta con otros términos</div></div>';
      } else {
        matches.forEach(m => {
          resultsBox.innerHTML += `<div class="search-result-item" onclick="document.getElementById('supportSearch').value='${m.title}';document.getElementById('searchResults').classList.remove('active');"><div class="sr-title">${m.title}</div><div class="sr-desc">${m.desc}</div></div>`;
        });
      }
      resultsBox.classList.add('active');
    });

    document.addEventListener('click', function(e){
      if (!e.target.closest('.support-search')) resultsBox.classList.remove('active');
    });
  }

  /* ── FAQ toggle ── */
  window.toggleFaq = function(el){
    const item = el.closest('.faq-item');
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
  };

  /* ── Mobile menu ── */
  window.toggleMenu = function(){
    document.getElementById('mobileMenu').classList.toggle('open');
  };

  /* ── Form submit ── */
  const form = document.getElementById('supportForm');
  const successEl = document.getElementById('formSuccess');
  if (form) {
    form.addEventListener('submit', function(e){
      e.preventDefault();
      const name = document.getElementById('sfName').value.trim();
      const email = document.getElementById('sfEmail').value.trim();
      const category = document.getElementById('sfCategory').value;
      const message = document.getElementById('sfMessage').value.trim();
      if (!name || !email || !category || !message) return;

      const submitBtn = document.getElementById('sfSubmit');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';

      fetch('/api/support-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email,
          company: document.getElementById('sfCompany').value.trim(),
          plan: document.getElementById('sfPlan').value,
          category,
          priority: document.getElementById('sfPriority').value,
          message
        })
      }).then(r => r.json()).then(data => {
        form.style.display = 'none';
        successEl.classList.add('show');
      }).catch(() => {
        form.style.display = 'none';
        successEl.classList.add('show');
      });
    });
  }
})();
