// ── Team Management — Data & Interaction ─────────────────
const API_ROOT = '';
const API_BASE = API_ROOT + '/api';
let teamData = null;
let filteredTeam = [];
let currentPage = 1;
const PAGE_SIZE = 20;

function getToken() { return localStorage.getItem('token'); }
function authHeaders() { return { 'Authorization': `Bearer ${getToken()}` }; }

// ── Load Team Data ─────────────────
async function loadTeam() {
  try {
    const [rolesRes, usersRes] = await Promise.all([
      fetch(`${API_BASE}/empresa/roles`, { headers: authHeaders() }),
      fetch(`${API_BASE}/usuarios`, { headers: authHeaders() })
    ]);

    if (!rolesRes.ok) throw new Error('Error al cargar roles');
    const rolesData = await rolesRes.json();

    let usersData = { usuarios: [] };
    if (usersRes.ok) {
      usersData = await usersRes.json();
    }

    teamData = {
      roles: rolesData.roles || {},
      matriz: rolesData.matriz || {},
      usuarios: usersData.usuarios || []
    };

    filteredTeam = [...teamData.usuarios];
    renderStats();
    renderTeam();
  } catch (err) {
    console.error('[TEAM] Error:', err);
    renderErrorState();
  }
}

// ── Render Stats ─────────────────
function renderStats() {
  if (!teamData) return;
  const roles = teamData.roles || {};
  const total = teamData.usuarios.length || 0;

  const statCards = document.querySelectorAll('.stat-card');
  if (statCards.length >= 4) {
    setStat(statCards[0], roles.owner || 0, 'Owners', Math.round((roles.owner / total) * 100) || 0);
    setStat(statCards[1], roles.admin || 0, 'Administradores', Math.round((roles.admin / total) * 100) || 0);
    setStat(statCards[2], roles.miembro || 0, 'Miembros', Math.round((roles.miembro / total) * 100) || 0);
    setStat(statCards[3], total, 'Total Usuarios', 100);
  }
}

function setStat(card, value, label, percentage) {
  const valEl = card.querySelector('.stat-value');
  const lblEl = card.querySelector('.stat-label');
  const barEl = card.querySelector('.stat-bar-fill');
  if (valEl) valEl.textContent = value;
  if (lblEl) lblEl.textContent = label;
  if (barEl) {
    barEl.style.width = `${percentage}%`;
    if (percentage > 90) barEl.classList.add('warning');
    else barEl.classList.remove('warning');
  }
}

// ── Render Team Table ─────────────────
function renderTeam() {
  const tbody = document.getElementById('teamBody');
  if (!tbody) return;

  if (filteredTeam.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-users"></i><p>No hay miembros en el equipo</p></td></tr>';
    return;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredTeam.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = page.map(u => {
    const name = normalizeDisplayName(u.nombre, u.apellido);
    const role = u.rol || u.rol_global || 'Miembro';
    const roleClass = getRoleClass(role);
    const isActive = u.activo !== false;
    const lastAccess = u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Nunca';

    return `<tr>
      <td>
        <div class="user-cell">
          <div class="user-avatar">${getInitials(name)}</div>
          <div class="user-info">
            <div class="user-name">${esc(name)}</div>
            <div class="user-email">${esc(u.email || '')}</div>
          </div>
        </div>
      </td>
      <td><span class="role-badge ${roleClass}">${esc(role)}</span></td>
      <td><span class="status-badge ${isActive ? 'active' : 'inactive'}">${isActive ? 'Activo' : 'Inactivo'}</span></td>
      <td><span class="last-access">${lastAccess}</span></td>
      <td>
        <div class="actions-cell">
          <button class="action-icon-btn" title="Editar" onclick="editUser('${u.id}')"><i class="fas fa-edit"></i></button>
          <button class="action-icon-btn" title="Permisos" onclick="editPermissions('${u.id}')"><i class="fas fa-shield-alt"></i></button>
          ${!isActive ? `<button class="action-icon-btn green" title="Activar" onclick="activateUser('${u.id}')"><i class="fas fa-check"></i></button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function normalizeDisplayName(nombre, apellido) {
  const n = (nombre || '').trim();
  const a = (apellido || '').trim();
  return n && a ? `${n} ${a}` : (n || a || 'Usuario');
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getRoleClass(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('owner') || r === 'ceo') return 'owner';
  if (r.includes('admin') || r.includes('administrador')) return 'admin';
  return 'member';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Error State ─────────────────
function renderErrorState() {
  const tbody = document.getElementById('teamBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Error al cargar el equipo</p></td></tr>';
  }
}

// ── Initialize ─────────────────
document.addEventListener('DOMContentLoaded', function () {
  loadTeam();
});
