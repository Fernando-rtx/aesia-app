/**
 * app.js — Controlador principal de la App Marcación AESIA
 * Autenticación: Email + Contraseña
 * Marcación: Un solo clic basado en la cuenta activa
 */
import {
  getMemberByCarnet, getMemberByUid, saveRecord, getNextAction,
  saveMember, deleteMember, getMembers,
  filterRecords, exportToCSV, deleteRecord,
  auth, loginWithGoogle, logout, onAuthChange,
  isCurrentUserAdmin, loginWithEmail, registerWithEmail, resetPassword
} from './db.js';

import {
  renderDashboard, renderMarcar, renderMembers, renderHistorial,
  showMarcarResult, showMarcarError,
  renderMemberForm, renderRecordsTable, renderMembers as reloadMembers,
  esc
} from './ui.js';

// ─── Ubicación AESIA (UES FMOcc) ──────────────────────────────────────────────
const AESIA_LAT = 13.969583;
const AESIA_LON = -89.574638;
const MAX_DISTANCE_METERS = 50;

// ─── Estado Global ────────────────────────────────────────────────────────────
let currentView   = 'marcar';
let clockInterval = null;

// ─── Helpers de Alerta del Login ─────────────────────────────────────────────
function authErrorMsg(code) {
  const map = {
    'auth/email-already-in-use'  : 'Este correo ya tiene una cuenta. Inicia sesión.',
    'auth/weak-password'         : 'La contraseña debe tener al menos 6 caracteres.',
    'auth/user-not-found'        : 'No existe cuenta con este correo.',
    'auth/wrong-password'        : 'Correo o contraseña incorrectos.',
    'auth/invalid-email'         : 'El formato del correo no es válido.',
    'auth/invalid-credential'    : 'Correo o contraseña incorrectos.',
    'auth/too-many-requests'     : 'Demasiados intentos. Espera un momento.',
    'auth/network-request-failed': 'Error de red. Verifica tu conexión a Internet.',
    'auth/popup-closed-by-user'  : 'Ventana cerrada. Intenta de nuevo.',
  };
  return map[code] || 'Error inesperado. Intenta de nuevo.';
}

function showLoginAlert(msg, type = 'error') {
  const el = document.getElementById('login-alert');
  if (!el) return;
  el.textContent = msg;
  el.className = `login-alert login-alert--${type}`;
}

function hideLoginAlert() {
  const el = document.getElementById('login-alert');
  if (el) el.className = 'login-alert hidden';
}

// ─── Inicialización ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupClock();

  // ── Estado de sesión ──
  onAuthChange(async (user) => {
    const overlay  = document.getElementById('login-overlay');
    const userInfo = document.getElementById('user-info');

    if (user) {
      overlay.classList.add('hidden');
      hideLoginAlert();

      // Mostrar avatar y email
      const safeEmail    = esc(user.email || '');
      const isGooglePhoto = user.photoURL && /^https:\/\/lh\d*\.googleusercontent\.com\//.test(user.photoURL);
      const avatarHtml   = isGooglePhoto
        ? `<img src="${esc(user.photoURL)}" class="avatar-small" referrerpolicy="no-referrer"/>`
        : `<span class="avatar-small avatar-small--text">${esc((user.email || '?').charAt(0).toUpperCase())}</span>`;

      if (userInfo) {
        userInfo.innerHTML = `${avatarHtml} ${safeEmail} <button id="logout-btn" class="btn-icon">🚪</button>`;
        document.getElementById('logout-btn')?.addEventListener('click', logout);
      }

      // Primera carga
      if (document.getElementById('main-content').innerHTML === '') {
        const admin = await isCurrentUserAdmin();
        setupNavigation();
        applyNavVisibility(admin);
        navigateTo('marcar');
      }
    } else {
      overlay.classList.remove('hidden');
      document.getElementById('main-content').innerHTML = '';
    }
  });

  // ── Toggle Login / Registro ──
  let isRegisterMode = false;

  function setMode(register) {
    isRegisterMode = register;
    hideLoginAlert();
    const title      = document.getElementById('login-title');
    const subtitle   = document.getElementById('login-subtitle');
    const authBtn    = document.getElementById('email-auth-btn');
    const toggleBtn  = document.getElementById('toggle-register-btn');
    const forgotBtn  = document.getElementById('forgot-pass-btn');

    document.getElementById('field-name').classList.toggle('hidden', !register);
    document.getElementById('field-carnet').classList.toggle('hidden', !register);
    document.getElementById('field-pass2').classList.toggle('hidden', !register);

    if (register) {
      title.textContent    = 'Crear cuenta';
      subtitle.textContent = 'Completa tus datos para registrarte.';
      authBtn.textContent  = 'Crear cuenta';
      toggleBtn.textContent = '¿Ya tienes cuenta? Inicia sesión';
      forgotBtn.style.display = 'none';
    } else {
      title.textContent    = 'AESIA Marcación';
      subtitle.textContent = 'Inicia sesión para registrar tu asistencia.';
      authBtn.textContent  = 'Iniciar Sesión';
      toggleBtn.textContent = '¿No tienes cuenta? Regístrate';
      forgotBtn.style.display = '';
    }
  }

  document.getElementById('toggle-register-btn')?.addEventListener('click', () => setMode(!isRegisterMode));

  // ── Submit formulario ──
  document.getElementById('email-auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideLoginAlert();

    const email  = document.getElementById('auth-email')?.value.trim() || '';
    const pass   = document.getElementById('auth-pass')?.value || '';
    const pass2  = document.getElementById('auth-pass2')?.value || '';
    const name   = document.getElementById('auth-name')?.value.trim() || '';
    const carnet = document.getElementById('auth-carnet')?.value.trim().toUpperCase() || '';
    const btn    = document.getElementById('email-auth-btn');

    if (!email || !pass) { showLoginAlert('Completa el correo y la contraseña.'); return; }

    if (isRegisterMode) {
      if (!name)   { showLoginAlert('Escribe tu nombre completo.'); return; }
      if (!carnet) { showLoginAlert('Escribe tu número de carnet.'); return; }
      if (pass !== pass2) { showLoginAlert('Las contraseñas no coinciden.'); return; }
      if (pass.length < 6) { showLoginAlert('La contraseña debe tener al menos 6 caracteres.'); return; }

      btn.disabled = true;
      btn.textContent = 'Creando cuenta...';
      try {
        await registerWithEmail(name, carnet, email, pass);
        // onAuthChange se encarga de cerrar el overlay automáticamente
      } catch (err) {
        showLoginAlert(err.message.length < 80 ? err.message : authErrorMsg(err.code));
        btn.disabled = false;
        btn.textContent = 'Crear cuenta';
      }
    } else {
      btn.disabled = true;
      btn.textContent = 'Ingresando...';
      try {
        await loginWithEmail(email, pass);
      } catch (err) {
        showLoginAlert(authErrorMsg(err.code));
        btn.disabled = false;
        btn.textContent = 'Iniciar Sesión';
      }
    }
  });

  // ── Recuperar contraseña ──
  document.getElementById('forgot-pass-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email')?.value.trim() || '';
    if (!email) { showLoginAlert('Escribe tu correo primero y luego haz clic aquí.'); return; }
    try {
      await resetPassword(email);
      showLoginAlert(`✅ Correo de recuperación enviado a ${email}. Revisa tu bandeja de entrada.`, 'success');
    } catch (err) {
      showLoginAlert(authErrorMsg(err.code));
    }
  });
});

// ─── Reloj en Tiempo Real ─────────────────────────────────────────────────────
function setupClock() {
  const clockEl = document.getElementById('clock');
  const dateEl  = document.getElementById('clock-date');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateEl.textContent  = now.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  tick();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(tick, 1000);
}

// ─── Navegación SPA ───────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      const target = newBtn.dataset.nav;
      if (['admin-members', 'historial'].includes(target)) {
        requireAdmin(() => navigateTo(target));
      } else {
        navigateTo(target);
      }
    });
  });
}

function applyNavVisibility(isAdmin) {
  ['dashboard', 'admin-members', 'historial'].forEach(tabId => {
    const btn = document.querySelector(`[data-nav="${tabId}"]`);
    if (btn) btn.style.display = isAdmin ? '' : 'none';
  });
  const sep = document.querySelector('.nav-separator');
  if (sep) sep.style.display = isAdmin ? '' : 'none';
}

async function navigateTo(view) {
  currentView = view;
  const content = document.getElementById('main-content');
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.toggle('nav--active', btn.dataset.nav === view);
  });

  content.classList.add('view-exit');
  setTimeout(async () => {
    content.innerHTML = '';
    content.classList.remove('view-exit');
    content.classList.add('view-enter');

    switch (view) {
      case 'dashboard':
        await renderDashboard(content);
        break;
      case 'marcar':
        await setupMarcarView(content);
        break;
      case 'admin-members':
        await renderMembers(content);
        setupMembersEvents(content);
        break;
      case 'historial':
        await renderHistorial(content);
        setupHistorialEvents(content);
        break;
    }

    setTimeout(() => content.classList.remove('view-enter'), 400);
  }, 200);
}

async function requireAdmin(onSuccess) {
  const admin = await isCurrentUserAdmin();
  if (admin) { onSuccess(); }
  else { alert('🔒 Acceso denegado.\n\nTu cuenta no tiene permisos de administrador.'); }
}

// ─── Helpers Geolocalización ──────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R  = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Tu navegador no soporta Geolocalización.')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
  });
}

// ─── Vista de Marcación: un solo clic ────────────────────────────────────────
async function setupMarcarView(container) {
  const user = auth.currentUser;
  if (!user) return;

  // Mostrar loader mientras cargamos el perfil
  container.innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;min-height:300px;opacity:0.5;">
      <span class="clock-time">Cargando perfil...</span>
    </div>`;

  const member     = await getMemberByUid(user.uid);
  const nextAction = member ? await getNextAction(member.carnet) : 'entrada';

  // Renderizar vista de marcación desde ui.js
  renderMarcar(container, member, nextAction);

  const btn = container.querySelector('#marcar-btn');
  if (!btn || !member) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-text">Obteniendo GPS... 🛰️</span>`;

    let outOfBounds = false;

    // Validar GPS
    try {
      const pos  = await getUserLocation();
      const dist = getDistance(pos.coords.latitude, pos.coords.longitude, AESIA_LAT, AESIA_LON);
      if (dist > MAX_DISTANCE_METERS) {
        const ok = confirm(`⚠️ Estás a ${Math.round(dist)} m del local (rango: ${MAX_DISTANCE_METERS} m).\n\n¿Deseas marcar desde fuera del local?`);
        if (!ok) {
          btn.disabled = false;
          await setupMarcarView(container);
          return;
        }
        outOfBounds = true;
      }
    } catch (err) {
      alert(`⚠️ Activa el GPS y acepta los permisos de ubicación para poder marcar.\n\nDetalle: ${err.message}`);
      btn.disabled = false;
      return;
    }

    // Guardar registro
    btn.innerHTML = `<span class="btn-text">Guardando... ☁️</span>`;
    try {
      const action = await getNextAction(member.carnet);
      const record = await saveRecord({ carnet: member.carnet, action, outOfBounds });
      showMarcarResult(container, record, member, action);
      // Refrescar la vista después de mostrar el resultado
      setTimeout(() => setupMarcarView(container), 4500);
    } catch (err) {
      console.error(err);
      showMarcarError(container, 'Error al guardar. Intenta de nuevo.');
      btn.disabled = false;
    }
  });
}

// ─── Lógica de Miembros (Admin) ───────────────────────────────────────────────
function setupMembersEvents(container) {
  container.querySelector('#add-member-btn')?.addEventListener('click', () => {
    showMemberForm(container, null);
  });

  container.querySelector('#members-grid')?.addEventListener('click', async (e) => {
    const editBtn   = e.target.closest('.btn-icon--edit');
    const deleteBtn = e.target.closest('.btn-icon--delete');

    if (editBtn) {
      const carnet  = editBtn.dataset.carnet;
      const members = await getMembers();
      showMemberForm(container, members.find(m => m.carnet === carnet));
    }
    if (deleteBtn) {
      const carnet = deleteBtn.dataset.carnet;
      if (confirm(`¿Eliminar al miembro con carnet ${carnet}?`)) {
        await deleteMember(carnet);
        await reloadMembers(container);
        setupMembersEvents(container);
      }
    }
  });
}

function showMemberForm(container, member) {
  const formContainer = container.querySelector('#member-form-container');
  formContainer.classList.remove('hidden');
  renderMemberForm(formContainer, member);

  formContainer.querySelector('#member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = formContainer.querySelector('button[type="submit"]');
    btn.disabled = true;
    const newMember = {
      name:   formContainer.querySelector('#f-name').value.trim(),
      carnet: formContainer.querySelector('#f-carnet').value.trim().toUpperCase(),
      career: formContainer.querySelector('#f-career').value,
      cycle:  formContainer.querySelector('#f-cycle').value.trim(),
    };
    if (!newMember.name || !newMember.carnet) {
      alert('Nombre y carnet son obligatorios.');
      btn.disabled = false;
      return;
    }
    await saveMember(newMember);
    formContainer.classList.add('hidden');
    await reloadMembers(container);
    setupMembersEvents(container);
  });

  formContainer.querySelector('#cancel-form-btn')?.addEventListener('click', () => {
    formContainer.classList.add('hidden');
  });
}

// ─── Lógica de Historial ──────────────────────────────────────────────────────
function setupHistorialEvents(container) {
  async function applyFilter() {
    const date    = container.querySelector('#filter-date')?.value || '';
    const search  = container.querySelector('#filter-search')?.value.trim() || '';
    const records = await filterRecords({ date: date || undefined, searchTerm: search || undefined });
    const members = await getMembers();
    renderRecordsTable(records, members);
  }

  container.querySelector('#filter-btn')?.addEventListener('click', applyFilter);
  container.querySelector('#clear-filter-btn')?.addEventListener('click', async () => {
    if (container.querySelector('#filter-date'))   container.querySelector('#filter-date').value = '';
    if (container.querySelector('#filter-search')) container.querySelector('#filter-search').value = '';
    applyFilter();
  });
  container.querySelector('#filter-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') applyFilter();
  });
  container.querySelector('#export-btn')?.addEventListener('click', async () => {
    const date    = container.querySelector('#filter-date')?.value || '';
    const search  = container.querySelector('#filter-search')?.value.trim() || '';
    const records = await filterRecords({ date: date || undefined, searchTerm: search || undefined });
    if (!records.length) { alert('No hay registros para exportar.'); return; }
    await exportToCSV(records);
  });
  container.querySelector('#records-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-record-btn');
    if (btn && confirm('¿Eliminar este registro?')) {
      await deleteRecord(btn.dataset.id);
      applyFilter();
    }
  });
}
