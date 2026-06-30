// Detectar si estamos en localhost y apuntar al API de producción
const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const API_ROOT = isLocalhost ? 'https://portal-pilot.vercel.app' : '';

// Toggle ver/ocultar contraseña
function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');
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

// Cambiar entre tabs Login/Registro
function switchTab(tab) {
  document.getElementById('panelLogin').classList.toggle('active', tab === 'login');
  document.getElementById('panelRegister').classList.toggle('active', tab === 'register');
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
}

// Mostrar mensajes en el DOM (NO alert)
function showMessage(text, type) {
  const msgDiv = document.getElementById('loginMessage');
  if (!msgDiv) return;
  msgDiv.textContent = text;
  msgDiv.className = 'login-message ' + type;
  msgDiv.style.display = 'block';
  setTimeout(() => { msgDiv.style.display = 'none'; }, 5000);
}

// Variables para el registro
let regStep = 1;

// Ir al siguiente paso del registro
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

// Actualizar indicadores de pasos
function updateSteps() {
  [1, 2, 3].forEach(i => {
    const dot = document.getElementById('sdot' + i);
    const lbl = document.getElementById('slabel' + i);
    if (i < regStep) { 
      dot.className = 'step-dot done'; 
      dot.innerHTML = '<i class="fas fa-check" style="font-size:11px;"></i>'; 
    } else if (i === regStep) { 
      dot.className = 'step-dot active'; 
      dot.textContent = i; 
      lbl.style.color = 'var(--accent)'; 
    } else { 
      dot.className = 'step-dot'; 
      dot.textContent = i; 
      lbl.style.color = 'var(--gray)'; 
    }
  });
  [1, 2].forEach(i => {
    const line = document.getElementById('sline' + i);
    line.className = 'step-line' + (i < regStep ? ' done' : '');
  });
}

// Verificar fuerza de contraseña
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
    { pct: '25%', bg: '#f87171', txt: 'Contraseña débil' },
    { pct: '50%', bg: '#fb923c', txt: 'Contraseña regular' },
    { pct: '75%', bg: '#facc15', txt: 'Contraseña buena' },
    { pct: '100%', bg: '#34d399', txt: 'Contraseña fuerte' }
  ];
  const l = levels[Math.max(0, score - 1)];
  fill.style.width = l.pct; 
  fill.style.background = l.bg; 
  lbl.textContent = l.txt; 
  lbl.style.color = l.bg;
}

// Registro de usuario
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
  btns[1].innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando cuenta...'; 
  btns[1].disabled = true;

  try {
    const res = await fetch(`${API_ROOT}/api/registro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    btns[1].innerHTML = '<i class="fas fa-rocket"></i> Crear Cuenta'; 
    btns[1].disabled = false;

    if (!res.ok) {
      showMessage(data.error || 'Error al crear la cuenta', 'error');
    } else {
      showMessage('¡Cuenta creada! Inicia sesión para continuar.', 'success');
      setTimeout(() => switchTab('login'), 2000);
    }
  } catch (error) {
    btns[1].innerHTML = '<i class="fas fa-rocket"></i> Crear Cuenta'; 
    btns[1].disabled = false;
    showMessage('Error de conexión con el servidor.', 'error');
  }
}

// 2FA y otros helpers
function trigger2FA() {
  const strip = document.querySelector('#panelLogin .biometric-row .bio-text');
  const btn = document.querySelector('#panelLogin .btn-bio');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  setTimeout(() => {
    btn.innerHTML = '<i class="fas fa-check"></i> Listo';
    btn.style.background = 'rgba(52,211,153,0.15)'; 
    btn.style.color = 'var(--green)'; 
    btn.style.borderColor = 'rgba(52,211,153,0.3)';
    strip.innerHTML = '<strong style="color:var(--green);">2FA VERIFICADO</strong><br>Redirigiendo al dashboard...';
  }, 2200);
}

function toggle2FAEnroll(btn) {
  if (btn.textContent.trim() === 'Activar') {
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    setTimeout(() => {
      btn.innerHTML = '<i class="fas fa-check"></i> Activo';
      btn.style.background = 'rgba(52,211,153,0.15)'; 
      btn.style.color = 'var(--green)'; 
      btn.style.borderColor = 'rgba(52,211,153,0.3)';
    }, 1500);
  }
}

function ssoClick(p) {
  showMessage(`Redirigiendo a inicio de sesión con ${p}...`, 'success');
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
  const msgDiv = document.getElementById('recEmailMessage');
  if (!email || !email.includes('@')) {
    msgDiv.textContent = 'Ingresa un correo electrónico válido.';
    msgDiv.className = 'login-message error';
    msgDiv.style.display = 'block';
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
    const data = await res.json();
    
    btn.innerHTML = orig;
    btn.disabled = false;
    
    if (res.ok) {
      document.getElementById('recStepEmail').style.display = 'none';
      document.getElementById('recStepVerify').style.display = 'block';
      const verifyMsgDiv = document.getElementById('recVerifyMessage');
      verifyMsgDiv.textContent = 'Si tu correo está registrado, se ha enviado un código de recuperación.';
      verifyMsgDiv.className = 'login-message success';
      verifyMsgDiv.style.display = 'block';
    } else {
      msgDiv.textContent = data.error || 'Error al enviar código.';
      msgDiv.className = 'login-message error';
      msgDiv.style.display = 'block';
    }
  } catch (err) {
    btn.innerHTML = orig;
    btn.disabled = false;
    msgDiv.textContent = 'Error de conexión con el servidor.';
    msgDiv.className = 'login-message error';
    msgDiv.style.display = 'block';
  }
}

async function verifyRecoveryAndChange() {
  const email = document.getElementById('recoveryEmailInput').value.trim();
  const code = document.getElementById('recoveryCodeInput').value.trim();
  const newPassword = document.getElementById('recoveryNewPassInput').value;
  const msgDiv = document.getElementById('recVerifyMessage');
  
  if (!code || code.length !== 6) {
    msgDiv.textContent = 'Introduce el código de 6 dígitos.';
    msgDiv.className = 'login-message error';
    msgDiv.style.display = 'block';
    return;
  }
  
  if (!newPassword || newPassword.length < 8) {
    msgDiv.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.';
    msgDiv.className = 'login-message error';
    msgDiv.style.display = 'block';
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
    const data = await res.json();
    
    btn.innerHTML = orig;
    btn.disabled = false;
    
    if (res.ok) {
      msgDiv.textContent = '✓ Contraseña restablecida con éxito. Inicia sesión.';
      msgDiv.className = 'login-message success';
      msgDiv.style.display = 'block';
      setTimeout(() => {
        closeRecoveryModal();
        switchTab('login');
      }, 2000);
    } else {
      msgDiv.textContent = data.error || 'Código incorrecto o expirado.';
      msgDiv.className = 'login-message error';
      msgDiv.style.display = 'block';
    }
  } catch (err) {
    btn.innerHTML = orig;
    btn.disabled = false;
    msgDiv.textContent = 'Error de conexión con el servidor.';
    msgDiv.className = 'login-message error';
    msgDiv.style.display = 'block';
  }
}

// ==========================================
// LOGIN FUNCIONAL (SIN ALERTS)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
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
      const response = await fetch(`${API_ROOT}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Guardar token y datos
        const normalizedEmpresa = (data.user.empresa_codigo || '').toString().trim().toUpperCase();
        const empresaNombre = data.user.empresa_nombre || (normalizedEmpresa === 'ROOT' ? 'Portal Pilot' : normalizedEmpresa);
        localStorage.setItem('token', data.token);
        localStorage.setItem('userRole', data.user.rol);
        localStorage.setItem('userName', data.user.nombre);
        localStorage.setItem('userEmail', data.user.email);
        localStorage.setItem('empresaCodigo', normalizedEmpresa);
        localStorage.setItem('empresaNombre', empresaNombre);
        localStorage.setItem('currentAccountId', data.user.id);

        if (data.accounts && data.accounts.length > 1) {
          const normAccounts = data.accounts.map(a => ({ 
            ...a, 
            empresa_codigo: (a.empresa_codigo||'').toString().trim().toUpperCase(),
            empresa_nombre: a.empresa_nombre || (a.empresa_codigo === 'ROOT' ? 'Portal Pilot' : a.empresa_codigo)
          }));
          localStorage.setItem('linkedAccounts', JSON.stringify(normAccounts));
        } else {
          localStorage.removeItem('linkedAccounts');
        }

        console.log('✅ Login exitoso - Token guardado');

        const userStatus = (data.user.status || '').toString().toLowerCase();
        const pendingStates = ['pending', 'pendiente', 'pending_activation', 'pendiente_activacion', 'pendiente-activacion', 'first_access', 'primer_acceso', 'pending-first-access'];
        
        if (pendingStates.includes(userStatus)) {
          localStorage.setItem('pendingUserId', data.user.id);
          localStorage.setItem('pendingEmail', data.user.email);
          localStorage.setItem('currentAccountId', data.user.id);
          showMessage('Primer acceso detectado. Ve a cambiar tu contraseña.', 'success');
          setTimeout(() => {
            window.location.href = `primer_acceso.html?email=${encodeURIComponent(data.user.email)}`;
          }, 1000);
        } else {
          localStorage.removeItem('pendingUserId');
          localStorage.removeItem('pendingEmail');
          showMessage('Acceso concedido. Redirigiendo...', 'success');
          setTimeout(() => {
            window.location.href = 'pp/welcome.html';
          }, 1000);
        }
      } else {
        showMessage(data.error || 'Credenciales inválidas', 'error');
        btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Entrar al Portal';
        btn.disabled = false;
      }
    } catch (error) {
      console.error('❌ Error de conexión:', error);
      showMessage('Error de conexión. Verifica que el servidor esté corriendo.', 'error');
      btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Entrar al Portal';
      btn.disabled = false;
    }
  });
});