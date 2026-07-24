/* js/documentacion.js — Docs page: sidebar nav, global search, section switching */

(function(){
  'use strict';

  /* ── Section index (sidebar titles + keywords) ── */
  const SECTIONS = [
    { id:'intro', title:'Introducción', cat:'Primeros Pasos' },
    { id:'instalacion', title:'Instalación', cat:'Primeros Pasos' },
    { id:'primeros-pasos', title:'Primeros pasos', cat:'Primeros Pasos' },
    { id:'ws-facturacion', title:'Facturación SAR', cat:'Workspace' },
    { id:'ws-inventario', title:'Inventario', cat:'Workspace' },
    { id:'ws-contabilidad', title:'Contabilidad', cat:'Workspace' },
    { id:'ws-nomina', title:'Nómina', cat:'Workspace' },
    { id:'ws-ia', title:'Asistente IA', cat:'Workspace' },
    { id:'ws-offline', title:'Modo Offline', cat:'Workspace' },
    { id:'bots-intro', title:'Bots RPA', cat:'Enterprise' },
    { id:'bots-flow', title:'Editor de Flujos', cat:'Enterprise' },
    { id:'bots-ia', title:'Configuración IA Bots', cat:'Enterprise' },
    { id:'bots-triggers', title:'Triggers y Webhooks', cat:'Enterprise' },
    { id:'sl-creates', title:'Crear Serverless', cat:'Serverless' },
    { id:'sl-deploy', title:'Desplegar Function', cat:'Serverless' },
    { id:'api-auth', title:'Autenticación API', cat:'API' },
    { id:'api-endpoints', title:'Endpoints', cat:'API' },
    { id:'planes', title:'Comparar Planes', cat:'Planes' }
  ];

  /* ── Build content index from DOM ── */
  const contentIndex = [];
  function buildContentIndex(){
    SECTIONS.forEach(sec => {
      const el = document.getElementById('sec-' + sec.id);
      if (!el) return;
      const text = el.textContent.toLowerCase().replace(/\s+/g,' ').trim();
      /* Extract paragraphs for snippets */
      const paragraphs = [];
      el.querySelectorAll('p, li, td, pre, h1, h2, h3').forEach(p => {
        const t = p.textContent.trim();
        if (t.length > 10) paragraphs.push(t);
      });
      contentIndex.push({ id: sec.id, title: sec.title, cat: sec.cat, text, paragraphs });
    });
  }

  /* ── Search engine ── */
  function globalSearch(query){
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const results = [];

    contentIndex.forEach(sec => {
      /* Check if ALL words match */
      const allMatch = words.every(w => sec.text.includes(w));
      if (!allMatch) return;

      /* Find snippet with first match */
      let snippet = '';
      for (const p of sec.paragraphs) {
        const pl = p.toLowerCase();
        if (words.some(w => pl.includes(w))) {
          /* Extract context around first match */
          const idx = words.reduce((i, w) => {
            const pos = pl.indexOf(w);
            return pos >= 0 && (i < 0 || pos < i) ? pos : i;
          }, -1);
          if (idx >= 0) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(p.length, idx + 100);
            snippet = (start > 0 ? '...' : '') + p.slice(start, end) + (end < p.length ? '...' : '');
          } else {
            snippet = p.slice(0, 120) + (p.length > 120 ? '...' : '');
          }
          break;
        }
      }

      results.push({ id: sec.id, title: sec.title, cat: sec.cat, snippet });
    });

    return results;
  }

  /* ── Sidebar category toggle ── */
  window.toggleSidebarCat = function(el){
    el.classList.toggle('collapsed');
  };

  /* ── Section switching ── */
  window.showSection = function(linkEl, sectionId){
    document.querySelectorAll('.doc-section').forEach(s => s.style.display = 'none');
    const target = document.getElementById('sec-' + sectionId);
    if (target) target.style.display = 'block';
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    if (linkEl) linkEl.classList.add('active');
    document.getElementById('docsMain').scrollTo(0, 0);
    window.scrollTo(0, 0);
    const sidebar = document.getElementById('docsSidebar');
    if (sidebar && window.innerWidth <= 900) sidebar.classList.remove('open');
    /* Clear search results */
    const sr = document.getElementById('searchResults');
    if (sr) sr.innerHTML = '';
  };

  /* ── Sidebar search (filters links) ── */
  const searchInput = document.getElementById('sidebarSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function(){
      const q = this.value.trim().toLowerCase();

      /* Show/hide sidebar links */
      document.querySelectorAll('.sidebar-link').forEach(link => {
        const sectionId = link.dataset.section;
        const data = SECTIONS.find(s => s.id === sectionId);
        if (!data) return;
        const match = !q || data.title.toLowerCase().includes(q) || data.cat.toLowerCase().includes(q);
        link.style.display = match ? '' : 'none';
      });
      if (!q) {
        document.querySelectorAll('.sidebar-cat').forEach(c => {
          c.classList.remove('collapsed');
          c.style.display = '';
        });
      }

      /* Global content search — show inline results */
      const resultsBox = document.getElementById('searchResults');
      if (!resultsBox) return;

      if (!q || q.length < 2) {
        resultsBox.innerHTML = '';
        resultsBox.style.display = 'none';
        return;
      }

      const results = globalSearch(q);
      if (!results.length) {
        resultsBox.innerHTML = '<div class="sr-item"><div class="sr-title" style="color:var(--text-muted)">Sin resultados para "' + q + '"</div></div>';
      } else {
        resultsBox.innerHTML = results.map(r =>
          `<div class="sr-item" onclick="goToResult('${r.id}')">
            <div class="sr-meta">${r.cat}</div>
            <div class="sr-title">${r.title}</div>
            <div class="sr-snippet">${r.snippet}</div>
          </div>`
        ).join('');
      }
      resultsBox.style.display = 'block';
    });

    /* Close results when clicking outside */
    document.addEventListener('click', function(e){
      if (!e.target.closest('.sidebar-search')) {
        const sr = document.getElementById('searchResults');
        if (sr) sr.style.display = 'none';
      }
    });
  }

  /* ── Go to search result ── */
  window.goToResult = function(sectionId){
    const link = document.querySelector(`.sidebar-link[data-section="${sectionId}"]`);
    if (link) {
      /* Expand parent category */
      const cat = link.closest('.sidebar-cat');
      if (cat) cat.classList.remove('collapsed');
      showSection(link, sectionId);
    }
    const sr = document.getElementById('searchResults');
    if (sr) { sr.innerHTML = ''; sr.style.display = 'none'; }
    const searchInput = document.getElementById('sidebarSearch');
    if (searchInput) searchInput.value = '';
  };

  /* ── Mobile menu ── */
  window.toggleMenu = function(){
    document.getElementById('mobileMenu').classList.toggle('open');
  };

  /* ── Hash navigation ── */
  function handleHash(){
    const hash = window.location.hash.replace('#','');
    if (hash) {
      const link = document.querySelector(`.sidebar-link[data-section="${hash}"]`);
      if (link) showSection(link, hash);
    }
  }
  window.addEventListener('hashchange', handleHash);

  /* ── Init ── */
  buildContentIndex();
  if (window.location.hash) handleHash();
})();
