/* ── Stream de logs en tiempo real — pp/logs_realtime.html ── */
'use strict';

const API_BASE = '/api';
const POLL_MS = 4000;
const MAX_LINES = 300;

let live = true;
let vistos = new Set();          // ids ya mostrados: `${fuente}:${id}`
let fuentes = new Set(['auditoria', 'automation_runs', 'seguridad_eventos']);
let timer = null;
let primeraCarga = true;

function authHeaders() { return { 'Authorization': `Bearer ${localStorage.getItem('token')}` }; }
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

const consoleEl = () => document.getElementById('streamConsole');

function fmtHora(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (isNaN(d)) return '--:--:--';
  return d.toLocaleTimeString('es-HN', { hour12: false });
}

function agregarLinea(ev) {
  const cons = consoleEl();
  if (!cons) return;
  const line = document.createElement('div');
  line.className = 'pp-console-line src-' + esc(ev.fuente);
  const nivel = (ev.nivel || '').toLowerCase();
  const icono = nivel === 'error' ? '<i class="fas fa-xmark" style="color:var(--red);"></i> ' :
    nivel === 'warning' ? '<i class="fas fa-triangle-exclamation" style="color:var(--yellow);"></i> ' : '';
  line.innerHTML =
    `<span class="t">${fmtHora(ev.created_at)}</span>` +
    `<span class="src">${esc(ev.fuente === 'automation_runs' ? 'BOTS' : ev.fuente === 'seguridad_eventos' ? 'SEGURIDAD' : 'AUDITORÍA')}</span>` +
    `<span class="msg">${icono}${esc(ev.mensaje || '')}${ev.empresa_codigo ? ` <span style="color:var(--cyan);">[${esc(ev.empresa_codigo)}]</span>` : ''}${ev.usuario ? ` <span style="color:var(--gray);">· ${esc(ev.usuario)}</span>` : ''}</span>`;
  cons.prepend(line);
  while (cons.children.length > MAX_LINES) cons.removeChild(cons.lastChild);
}

function esLineaVacia(texto) {
  return consoleEl().children.length === 0 || consoleEl().children[0].textContent.includes(texto);
}

async function poll() {
  if (!live && !primeraCarga) return;
  try {
    const srcs = [...fuentes].join(',');
    const res = await fetch(API_BASE + '/admin/stream?limit=30&fuentes=' + encodeURIComponent(srcs), { headers: authHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const eventos = data.eventos || [];
    if (primeraCarga) {
      consoleEl().innerHTML = '';
    }
    // Los nuevos van primero; prepend en orden inverso para que el más nuevo quede arriba
    const nuevos = eventos.filter(ev => !vistos.has(ev.fuente + ':' + ev.id));
    if (primeraCarga && !eventos.length) {
      consoleEl().innerHTML = '<div class="pp-console-line"><span class="msg" style="color:var(--gray);">Esperando eventos… El stream mostrará actividad apenas ocurra.</span></div>';
    }
    nuevos.forEach(ev => {
      vistos.add(ev.fuente + ':' + ev.id);
      agregarLinea(ev);
    });
    if (nuevos.length && !primeraCarga) setStatus(nuevos.length + ' evento(s) nuevo(s) · ' + new Date().toLocaleTimeString('es-HN'));
    else setStatus('En vivo · ' + vistos.size + ' eventos vistos');
    primeraCarga = false;
  } catch (err) {
    console.error('[STREAM]', err);
    setStatus('Reconectando… (' + err.message + ')');
  }
}

function setStatus(txt) {
  const el = document.getElementById('streamStatus');
  if (el) el.textContent = txt;
}

function toggleSrc(fuente, chip) {
  if (fuentes.has(fuente)) {
    fuentes.delete(fuente);
    chip.classList.remove('on');
  } else {
    fuentes.add(fuente);
    chip.classList.add('on');
  }
  poll();
}

function toggleLive() {
  live = !live;
  const chip = document.getElementById('liveChip');
  chip.classList.toggle('on', live);
  document.getElementById('liveLabel').textContent = live ? 'EN VIVO' : 'PAUSADO';
  if (live) { primeraCarga = false; poll(); }
}

function clearConsole() {
  consoleEl().innerHTML = '<div class="pp-console-line"><span class="msg" style="color:var(--gray);">Consola limpiada. El stream sigue activo.</span></div>';
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
}

document.addEventListener('DOMContentLoaded', () => {
  poll();
  startTimer();
});
