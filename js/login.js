// ═══════════════════════════════════════════════════════════════
// PORTAL PILOT — LOGIN (CORREGIDO)
// ═══════════════════════════════════════════════════════════════

// Detectar si estamos en localhost y apuntar al API de producción
const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_ROOT = isLocalhost ? 'https://portal-pilot.vercel.app' : '';

// Única declaración de supabase (evita el error "already been declared")
let supabase = null;

async function getSupabaseClient() {
  if (supabase) return supabase;
  try {
    const res = await fetch(`${API_ROOT}/api/config`);
    const config = await res.json();
    if (config.supabaseUrl && config.supabaseAnonKey) {
      supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      return supabase;
    } else {
      console.error('Supabase config is empty or missing from backend.');
    }
  } catch (err) {
    console.error('Error fetching Supabase config from API:', err);
  }
  return null;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: text || 'Respuesta inválida del servidor' };
  }
}

/* ═══════════════════════════════════════════════════════════════
   SISTEMA DE NOTIFICACIONES ISLA DINÁMICA
   ═══════════════════════════════════════════════════════════════ */
const contenedorPila = document.getElementById('contenedor-pila');
const contadorPila = document.getElementById('contador-pila');

let notificaciones = [];
let idCounter = 0;
let animacionEnCurso = false;

const EMOJIS = {
  error: 'Cross%20mark/3D/cross_mark_3d.png',
  success: 'Check%20mark%20button/3D/check_mark_button_3d.png',
  info: 'Information/3D/information_3d.png',
  warning: 'Warning/3D/warning_3d.png'
};

const DURACION_BARRA = 4500;

function crearNotificacion(texto, tipo = 'info') {
  if (animacionEnCurso) {
    setTimeout(() => crearNotificacion(texto, tipo), 100);
    return;
  }

  const id = idCounter++;
  const emoji = EMOJIS[tipo] || EMOJIS.info;

  const notif = document.createElement('div');
  notif.className = 'notificacion';
  notif.dataset.id = id;
  notif.innerHTML = `
    <div class="contenido-notificacion">
      <div class="cuadro-icono">
        <img src="https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${emoji}" alt="${tipo}">
      </div>
      <p class="texto-notificacion">${texto}</p>
    </div>
    <div class="barra-carga ${tipo}"></div>
  `;

  contenedorPila.appendChild(notif);

  if (notificaciones.length > 0 && notificaciones[0].estado === 'visible') {
    pausarBarra(notificaciones[0]);
  }

  notificaciones.unshift({
    id: id,
    elemento: notif,
    timeout: null,
    estado: 'entrando',
    progresoBarra: 0,
    tiempoInicio: null
  });

  if (notificaciones.length > 6) {
    const ultima = notificaciones.pop();
    if (ultima.timeout) clearTimeout(ultima.timeout);
    ultima.elemento.remove();
  }

  animacionEnCurso = true;
  notif.classList.add('entrando');

  notif.addEventListener('animationend', function handler() {
    notif.removeEventListener('animationend', handler);
    notif.classList.remove('entrando');
    notif.classList.add('pos-0', 'visible', 'activa');
    animacionEnCurso = false;

    actualizarPosiciones();
    iniciarBarra(notificaciones[0]);
    notificaciones[0].estado = 'visible';
  });

  notif.addEventListener('click', (e) => {
    e.stopPropagation();
    if (notificaciones[0] && notificaciones[0].id === id) {
      dismissNotificacion(id);
    }
  });

  actualizarContador();
}

function iniciarBarra(notifData) {
  const barra = notifData.elemento.querySelector('.barra-carga');
  const progreso = notifData.progresoBarra;
  const tiempoRestante = DURACION_BARRA * (1 - progreso);

  barra.style.transform = `scaleX(${progreso})`;
  barra.offsetHeight;
  barra.style.transition = `transform ${tiempoRestante}ms linear`;
  barra.style.transform = 'scaleX(1)';

  notifData.tiempoInicio = Date.now();

  notifData.timeout = setTimeout(() => {
    dismissNotificacion(notifData.id);
  }, tiempoRestante);
}

function pausarBarra(notifData) {
  const barra = notifData.elemento.querySelector('.barra-carga');

  if (notifData.tiempoInicio) {
    const tiempoTranscurrido = Date.now() - notifData.tiempoInicio;
    const progresoTotal = (tiempoTranscurrido / DURACION_BARRA) + notifData.progresoBarra;
    notifData.progresoBarra = Math.min(progresoTotal, 1);
  }

  barra.style.transition = 'none';
  barra.style.transform = `scaleX(${notifData.progresoBarra})`;

  if (notifData.timeout) {
    clearTimeout(notifData.timeout);
    notifData.timeout = null;
  }

  notifData.tiempoInicio = null;
}

function actualizarPosiciones() {
  notificaciones.forEach((notif, index) => {
    const el = notif.elemento;

    for (let i = 0; i <= 5; i++) {
      el.classList.remove(`pos-${i}`);
    }

    if (index <= 5) {
      el.classList.add(`pos-${index}`);
    }

    if (index === 0 && notif.estado === 'visible') {
      el.classList.add('activa');
    } else {
      el.classList.remove('activa');
    }
  });
}

function dismissNotificacion(id) {
  const index = notificaciones.findIndex(n => n.id === id);
  if (index === -1 || animacionEnCurso) return;

  const notif = notificaciones[index];
  if (index !== 0) return;

  if (notif.timeout) clearTimeout(notif.timeout);

  animacionEnCurso = true;
  notif.estado = 'saliendo';
  notif.elemento.classList.remove('activa', 'pos-0');
  notif.elemento.classList.add('saliendo');

  notif.elemento.addEventListener('animationend', function handler() {
    notif.elemento.removeEventListener('animationend', handler);
    notif.elemento.remove();
    notificaciones.splice(0, 1);
    animacionEnCurso = false;

    if (notificaciones.length > 0) {
      const siguiente = notificaciones[0];
      siguiente.estado = 'visible';
      siguiente.elemento.classList.add('activa');
      siguiente.elemento.classList.remove('pos-1', 'pos-2', 'pos-3', 'pos-4', 'pos-5');
      siguiente.elemento.classList.add('pos-0');
      iniciarBarra(siguiente);
    }

    actualizarPosiciones();
    actualizarContador();
  });
}

function actualizarContador() {
  if (notificaciones.length > 1) {
    contadorPila.textContent = `${notificaciones.length} notificaciones`;
    contadorPila.classList.add('visible');
  } else {
    contadorPila.classList.remove('visible');
  }
}

/* ═══════════════════════════════════════════════════════════════
   LÓGICA DEL LOGIN
   ═══════════════════════════════════════════════════════════════ */

// Configuración de los botones de ojo (se hace al cargar el DOM)
document.addEventListener('DOMContentLoaded', function () {
  // Asignar eventos a los botones toggle-pw (para que funcionen sin onclick inline)
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const input = this.parentElement.querySelector('input');
      const icon = this.querySelector('i');
      if (input && icon) {
        if (input.type === 'password') {
          input.type = 'text';
          icon.classList.remove('fa-eye');
          icon.classList.add('fa-eye-slash');
        } else {
          input.type = 'password';
          icon.classList.remove('fa-eye-slash');
          icon.classList.add('fa-eye');
        }
      }
    });
  });

  // Login form submit
  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPass').value;
    const btn = document.querySelector('#panelLogin .btn-submit');

    if (!email || !password) {
      showMessage('Por favor, completa correo y contraseña', 'error');
      return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
    btn.disabled = true;

    try {
      const res = await fetch(`${API_ROOT}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });

      const data = await readJsonResponse(res);

      if (!res.ok) {
        showMessage(data.error || 'Credenciales inválidas.', 'error');
        btn.innerHTML = 'Continuar <i class="fas fa-chevron-right" style="font-size:12px;"></i>';
        btn.disabled = false;
        return;
      }

      // Guardar datos de sesión
      const user = data.user;
      const normalizedEmpresa = (user.empresa_codigo || '').toString().trim().toUpperCase();
      const empresaNombre = user.empresa_nombre || (normalizedEmpresa === 'ROOT' ? 'Portal Pilot' : normalizedEmpresa);

      localStorage.setItem('token', data.token);
      localStorage.setItem('userRole', user.rol || '');
      localStorage.setItem('userName', user.nombre || '');
      localStorage.setItem('userApellido', user.apellido || '');
      localStorage.setItem('userEmail', user.email || '');
      localStorage.setItem('userFoto', user.foto_perfil_url || '');
      localStorage.setItem('userBanner', user.banner_perfil_url || '');
      localStorage.setItem('empresaCodigo', normalizedEmpresa);
      localStorage.setItem('empresaNombre', empresaNombre);
      localStorage.setItem('currentAccountId', user.id || '');
      localStorage.setItem('empresaPlan', user.plan || 'starter');
      localStorage.setItem('trialExpired', user.trial_expired ? 'true' : 'false');

      if (data.accounts && data.accounts.length > 1) {
        const normAccounts = data.accounts.map(a => ({
          ...a,
          empresa_codigo: (a.empresa_codigo || '').toString().trim().toUpperCase(),
          empresa_nombre: a.empresa_nombre || (a.empresa_codigo === 'ROOT' ? 'Portal Pilot' : a.empresa_codigo)
        }));
        localStorage.setItem('linkedAccounts', JSON.stringify(normAccounts));
      } else {
        localStorage.removeItem('linkedAccounts');
      }

      const userStatus = (user.status || '').toString().toLowerCase();
      const pendingStates = ['pending', 'pendiente', 'pending_activation', 'pendiente_activacion',
        'pendiente-activacion', 'first_access', 'primer_acceso', 'pending-first-access'];

      if (pendingStates.includes(userStatus)) {
        localStorage.setItem('pendingUserId', user.id);
        localStorage.setItem('pendingEmail', user.email);
        showMessage('Primer acceso detectado. Redirigiendo...', 'info');
        setTimeout(() => {
          window.location.href = `primer_acceso.html?email=${encodeURIComponent(user.email)}`;
        }, 1200);
      } else {
        localStorage.removeItem('pendingUserId');
        localStorage.removeItem('pendingEmail');
        showMessage('Acceso concedido. Redirigiendo...', 'success');
        setTimeout(() => {
          window.location.href = 'pp/welcome.html';
        }, 1200);
      }

    } catch (err) {
      console.error('Error durante autenticación:', err);
      showMessage('Error de conexión. Verifica que el servidor esté corriendo.', 'error');
      btn.innerHTML = 'Continuar <i class="fas fa-chevron-right" style="font-size:12px;"></i>';
      btn.disabled = false;
    }
  });

});

// Funciones globales (usadas en onclick del HTML)
function switchTab(tab) {
  document.getElementById('panelLogin').classList.toggle('active', tab === 'login');
  document.getElementById('panelRegister').classList.toggle('active', tab === 'register');
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');

  const heading = document.querySelector('.auth-heading');
  if (tab === 'login') {
    heading.querySelector('h1').textContent = 'Inicia sesión';
    heading.querySelector('p').textContent = 'Accede a tu portal corporativo seguro';
  } else {
    heading.querySelector('h1').textContent = 'Crea tu cuenta';
    heading.querySelector('p').textContent = 'Configura tu portal corporativo en minutos';
  }
}

let regStep = 1;

function goStep(n) {
  if (n === 2 && regStep === 1) {
    const c = document.getElementById('regCompany').value.trim();
    const code = document.getElementById('regCode').value.trim();
    if (!c || !code) { showMessage('Completa el nombre y código de empresa.', 'error'); return; }
  }
  if (n === 3 && regStep === 2) {
    const e = document.getElementById('regEmail').value.trim();
    const f = document.getElementById('regFirst').value.trim();
    if (!f || !e) { showMessage('Completa nombre y correo corporativo.', 'error'); return; }
    if (!e.includes('@')) { showMessage('Ingresa un correo válido.', 'error'); return; }
  }
  document.getElementById('regStep' + regStep).style.display = 'none';
  regStep = n;
  document.getElementById('regStep' + regStep).style.display = 'block';
  updateSteps();
}

function updateSteps() {
  [1, 2, 3].forEach(i => {
    const dot = document.getElementById('sdot' + i);
    const lbl = document.getElementById('slabel' + i);
    if (i < regStep) {
      dot.className = 'step-dot done';
      dot.innerHTML = '<i class="fas fa-check" style="font-size:11px;"></i>';
      lbl.style.color = 'var(--text-dim)';
    } else if (i === regStep) {
      dot.className = 'step-dot active';
      dot.textContent = i;
      lbl.style.color = 'var(--white)';
    } else {
      dot.className = 'step-dot';
      dot.textContent = i;
      lbl.style.color = 'var(--text-muted)';
    }
  });
  [1, 2].forEach(i => {
    const line = document.getElementById('sline' + i);
    line.className = 'step-line' + (i < regStep ? ' done' : '');
  });
}

function checkStrength(inp) {
  const v = inp.value;
  const w = document.getElementById('strengthWrap');
  const fill = document.getElementById('strengthFill');
  const lbl = document.getElementById('strengthLabel');
  if (!v) { w.style.display = 'none'; return; }
  w.style.display = 'block';
  let score = 0;
  if (v.length >= 8) score++;
  if (/[A-Z]/.test(v)) score++;
  if (/[0-9]/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v)) score++;
  const levels = [
    { pct: '25%', bg: '#ff453a', txt: 'Contraseña débil' },
    { pct: '50%', bg: '#ff9f0a', txt: 'Contraseña regular' },
    { pct: '75%', bg: '#ffd60a', txt: 'Contraseña buena' },
    { pct: '100%', bg: '#30d158', txt: 'Contraseña fuerte' }
  ];
  const l = levels[Math.max(0, score - 1)];
  fill.style.width = l.pct; fill.style.background = l.bg; lbl.textContent = l.txt; lbl.style.color = l.bg;
}

async function doRegister() {
  const p = document.getElementById('regPass').value;
  const p2 = document.getElementById('regPass2').value;
  const terms = document.getElementById('acceptTerms').checked;
  if (!p || !p2) { showMessage('Ingresa y confirma tu contraseña.', 'error'); return; }
  if (p !== p2) { showMessage('Las contraseñas no coinciden.', 'error'); return; }
  if (p.length < 8) { showMessage('La contraseña debe tener al menos 8 caracteres.', 'error'); return; }
  if (!terms) { showMessage('Debes aceptar los términos y condiciones.', 'error'); return; }

  const payload = {
    empresaNombre: document.getElementById('regCompany').value.trim(),
    empresaCodigo: document.getElementById('regCode').value.trim(),
    empresaSector: document.getElementById('regSector').value,
    usuarioNombre: document.getElementById('regFirst').value.trim(),
    usuarioApellido: document.getElementById('regLast').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    rol: document.getElementById('regRole').value,
    password: p,
    dosFaActivo: document.querySelector('#panelRegister .btn-bio').textContent.includes('Activo'),
    terminosAceptados: terms
  };

  const btns = document.querySelectorAll('#regStep3 .btn-submit');
  btns[1].innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...'; btns[1].disabled = true;

  const client = await getSupabaseClient();
  if (!client) {
    showMessage('Error de configuración en el servicio de autenticación.', 'error');
    btns[1].innerHTML = '<i class="fas fa-check"></i> Crear Cuenta'; btns[1].disabled = false;
    return;
  }

  try {
    const { data, error } = await client.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        data: {
          nombre: payload.usuarioNombre,
          apellido: payload.usuarioApellido,
          empresa_nombre: payload.empresaNombre,
          empresa_codigo: payload.empresaCodigo,
          empresa_sector: payload.empresaSector,
          rol: payload.rol,
          dos_fa_activo: payload.dosFaActivo,
          terminos_aceptados: payload.terminosAceptados
        }
      }
    });

    if (error) {
      showMessage(error.message, 'error');
      btns[1].innerHTML = '<i class="fas fa-check"></i> Crear Cuenta'; btns[1].disabled = false;
      return;
    }

    const res = await fetch(`${API_ROOT}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const dbData = await readJsonResponse(res);

    btns[1].innerHTML = '<i class="fas fa-check"></i> Crear Cuenta';
    btns[1].disabled = false;

    if (!res.ok) {
      showMessage(dbData.error || 'Usuario creado en autenticación, pero falló registro en panel local.', 'warning');
      setTimeout(() => switchTab('login'), 3000);
    } else {
      showMessage('¡Cuenta creada y vinculada! Inicia sesión para continuar.', 'success');
      setTimeout(() => switchTab('login'), 2000);
    }
  } catch (error) {
    btns[1].innerHTML = '<i class="fas fa-check"></i> Crear Cuenta'; btns[1].disabled = false;
    showMessage('Error de conexión con el servidor local durante el registro.', 'error');
  }
}

function trigger2FA() {
  const strip = document.querySelector('#panelLogin .biometric-row .bio-text');
  const btn = document.querySelector('#panelLogin .btn-bio');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  setTimeout(() => {
    btn.innerHTML = '<i class="fas fa-check"></i> Listo';
    btn.style.background = 'rgba(48,209,88,0.15)'; btn.style.color = 'var(--green)'; btn.style.borderColor = 'rgba(48,209,88,0.3)';
    strip.innerHTML = '<strong style="color:var(--green);">2FA VERIFICADO</strong>Redirigiendo...';
    showMessage('Autenticación 2FA verificada correctamente', 'success');
  }, 2200);
}

function toggle2FAEnroll(btn) {
  if (btn.textContent.trim() === 'Activar') {
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-check"></i> Activo';
      btn.style.background = 'rgba(48,209,88,0.15)'; btn.style.color = 'var(--green)'; btn.style.borderColor = 'rgba(48,209,88,0.3)';
    }, 1500);
  }
}

function ssoClick(p) {
  showMessage(`Redirigiendo a ${p}...`, 'info');
}

function forgotPw(e) {
  e.preventDefault();
  document.getElementById('recoveryModal').style.display = 'flex';
  document.getElementById('recStepEmail').style.display = 'block';
  document.getElementById('recStepVerify').style.display = 'none';
  const email = document.getElementById('loginEmail').value.trim();
  if (email) {
    document.getElementById('recoveryEmailInput').value = email;
  }
}

function closeRecoveryModal() {
  document.getElementById('recoveryModal').style.display = 'none';
}

async function requestRecoveryCode() {
  const email = document.getElementById('recoveryEmailInput').value.trim();
  if (!email || !email.includes('@')) {
    showMessage('Ingresa un correo electrónico válido.', 'error');
    return;
  }

  const btn = document.querySelector('#recStepEmail .btn-submit');
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_ROOT}/api/recuperacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await readJsonResponse(res);

    btn.innerHTML = orig;
    btn.disabled = false;

    if (res.ok) {
      document.getElementById('recStepEmail').style.display = 'none';
      document.getElementById('recStepVerify').style.display = 'block';
      showMessage('Código enviado a tu correo', 'success');
    } else {
      showMessage(data.error || 'Error al enviar código.', 'error');
    }
  } catch (err) {
    btn.innerHTML = orig;
    btn.disabled = false;
    showMessage('Error de conexión con el servidor.', 'error');
  }
}

async function verifyRecoveryAndChange() {
  const email = document.getElementById('recoveryEmailInput').value.trim();
  const code = document.getElementById('recoveryCodeInput').value.trim();
  const newPassword = document.getElementById('recoveryNewPassInput').value;

  if (!code || code.length !== 6) {
    showMessage('Introduce el código de 6 dígitos.', 'error');
    return;
  }

  if (!newPassword || newPassword.length < 8) {
    showMessage('La nueva contraseña debe tener al menos 8 caracteres.', 'error');
    return;
  }

  const btn = document.querySelector('#recStepVerify .btn-submit');
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restableciendo...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_ROOT}/api/recuperacion/verificar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });
    const data = await readJsonResponse(res);

    btn.innerHTML = orig;
    btn.disabled = false;

    if (res.ok) {
      showMessage('✓ Contraseña restablecida correctamente', 'success');
      setTimeout(() => {
        closeRecoveryModal();
        switchTab('login');
      }, 1500);
    } else {
      showMessage(data.error || 'Código incorrecto o expirado.', 'error');
    }
  } catch (err) {
    btn.innerHTML = orig;
    btn.disabled = false;
    showMessage('Error de conexión con el servidor.', 'error');
  }
}