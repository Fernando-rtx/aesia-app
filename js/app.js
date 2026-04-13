/**
 * app.js — Controlador principal de la App Marcación AESIA (Vercel + Firebase + GPS)
 */
import {
  getMemberByCarnet, saveRecord, getNextAction,
  saveMember, deleteMember, getMembers,
  checkAdminPass, filterRecords, exportToCSV, deleteRecord,
  auth, loginWithGoogle, logout, onAuthChange
} from './db.js';

import {
  renderDashboard, renderMarcar, renderMembers, renderHistorial,
  showMarcarResult, showMarcarError,
  renderMemberForm, renderRecordsTable, renderMembers as reloadMembers
} from './ui.js';

// ─── Ubicación AESIA (UES FMOcc) ────────────────────────────────────────────────
const AESIA_LAT = 13.969583;
const AESIA_LON = -89.574638;
const MAX_DISTANCE_METERS = 50;

// ─── Estado Global ────────────────────────────────────────────────────────────
let currentView = 'dashboard';
let adminUnlocked = false;
let clockInterval = null;

// ─── Inicialización ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupClock();
  
  // Escuchar estado de sesión
  onAuthChange(user => {
    const overlay = document.getElementById('login-overlay');
    const userInfo = document.getElementById('user-info');
    if (user) {
      overlay.classList.add('hidden');
      if (userInfo) userInfo.innerHTML = `<img src="${user.photoURL}" class="avatar-small"/> ${user.email} <button id="logout-btn" class="btn-icon">🚪</button>`;
      document.getElementById('logout-btn')?.addEventListener('click', logout);
      
      // Primera vez, o si no hemos cargado nada
      if (document.getElementById('main-content').innerHTML === '') {
        setupNavigation();
        navigateTo('marcar');
      }
    } else {
      overlay.classList.remove('hidden');
    }
  });

  document.getElementById('google-login-btn').addEventListener('click', async () => {
    try {
      await loginWithGoogle();
    } catch (e) {
      console.error(e);
      alert("Error iniciando sesión con Google: " + e.message);
    }
  });

});

// ─── Reloj en Tiempo Real ─────────────────────────────────────────────────────
function setupClock() {
  const clockEl = document.getElementById('clock');
  const dateEl = document.getElementById('clock-date');
  if (!clockEl) return;

  function tick() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('es-SV', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dateEl.textContent = now.toLocaleDateString('es-SV', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }
  tick();
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(tick, 1000);
}

// ─── Navegación SPA ───────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    // Evitar multi eventos
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

async function navigateTo(view) {
  currentView = view;
  const content = document.getElementById('main-content');

  // Actualizar nav activo
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.toggle('nav--active', btn.dataset.nav === view);
  });

  // Transición suave
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
        renderMarcar(content);
        setupMarcarForm(content);
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

// ─── Modal Admin Login ────────────────────────────────────────────────────────
function requireAdmin(onSuccess) {
  if (adminUnlocked) { onSuccess(); return; }

  const modal = document.getElementById('admin-modal');
  modal.classList.remove('hidden');
  modal.querySelector('#admin-pass-input').value = '';
  modal.querySelector('#admin-error').textContent = '';
  modal.querySelector('#admin-pass-input').focus();

  modal.querySelector('#admin-login-btn').onclick = () => {
    const pass = modal.querySelector('#admin-pass-input').value;
    if (checkAdminPass(pass)) {
      adminUnlocked = true;
      modal.classList.add('hidden');
      onSuccess();
    } else {
      modal.querySelector('#admin-error').textContent = 'Contraseña incorrecta';
      modal.querySelector('#admin-pass-input').select();
    }
  };

  modal.querySelector('#admin-cancel-btn').onclick = () => {
    modal.classList.add('hidden');
  };

  modal.querySelector('#admin-pass-input').onkeydown = (e) => {
    if (e.key === 'Enter') modal.querySelector('#admin-login-btn').click();
    if (e.key === 'Escape') modal.querySelector('#admin-cancel-btn').click();
  };
}

// ─── Helpers Geolocalización ──────────────────────────────────────────────────
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Tu navegador no soporta Geolocalización."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
  });
}

// ─── Lógica de Marcación con GPS ─────────────────────────────────────────────
function setupMarcarForm(container) {
  const form = container.querySelector('#marcar-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = container.querySelector('#marcar-btn');
    const carnetInput = container.querySelector('#carnet-input');
    const carnet = carnetInput.value.trim().toUpperCase();

    if (!carnet) {
      showMarcarError(container, 'Ingresa tu número de carnet.');
      return;
    }

    try {
      btn.disabled = true;
      btn.innerHTML = `<span class="btn-text">Verificando... ⏳</span>`;
      
      const member = await getMemberByCarnet(carnet);
      if (!member) {
        showMarcarError(container, 'Este carné no está registrado en el sistema.');
        return;
      }

      // Validar GPS
      btn.innerHTML = `<span class="btn-text">Obteniendo GPS... 🛰️</span>`;
      let outOfBounds = false;

      try {
        const position = await getUserLocation();
        const dist = getDistance(position.coords.latitude, position.coords.longitude, AESIA_LAT, AESIA_LON);
        
        if (dist > MAX_DISTANCE_METERS) {
          const proceed = confirm(`⚠️ Estás a ${Math.round(dist)} metros del local (fuera del rango de ${MAX_DISTANCE_METERS}m).\n\n¿Seguro que deseas registrar tu asistencia desde lejos?`);
          if (!proceed) {
            btn.disabled = false;
            btn.innerHTML = `<span class="btn-text">Registrar con GPS 📍</span>`;
            return;
          }
          outOfBounds = true;
        }
      } catch (err) {
        const proceed = confirm(`⚠️ GPS Error: ${err.message}\nNo pudimos validar tu ubicación. ¿Registrar de todas formas?`);
        if (!proceed) {
          btn.disabled = false;
          btn.innerHTML = `<span class="btn-text">Registrar con GPS 📍</span>`;
          return;
        }
        outOfBounds = true; // Si no hay GPS también se considera dudoso
      }

      // Guardar Record
      btn.innerHTML = `<span class="btn-text">Guardando... ☁️</span>`;
      const action = await getNextAction(carnet);
      const record = await saveRecord({ carnet, action, outOfBounds });
      showMarcarResult(container, record, member, action);

    } catch (error) {
      console.error(error);
      showMarcarError(container, 'Error de conexión.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span class="btn-text">Registrar con GPS 📍</span>`;
    }
  });
}

// ─── Lógica de Miembros (Admin) ───────────────────────────────────────────────
function setupMembersEvents(container) {
  container.querySelector('#add-member-btn')?.addEventListener('click', () => {
    showMemberForm(container, null);
  });

  container.querySelector('#members-grid')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.btn-icon--edit');
    const deleteBtn = e.target.closest('.btn-icon--delete');

    if (editBtn) {
      const carnet = editBtn.dataset.carnet;
      const members = await getMembers();
      const member = members.find(m => m.carnet === carnet);
      showMemberForm(container, member);
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
      name: formContainer.querySelector('#f-name').value.trim(),
      carnet: formContainer.querySelector('#f-carnet').value.trim().toUpperCase(),
      career: formContainer.querySelector('#f-career').value,
      cycle: formContainer.querySelector('#f-cycle').value.trim(),
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

  formContainer.querySelector('#cancel-form-btn').addEventListener('click', () => {
    formContainer.classList.add('hidden');
  });
}

// ─── Lógica de Historial ──────────────────────────────────────────────────────
function setupHistorialEvents(container) {
  const filterBtn = container.querySelector('#filter-btn');
  const clearBtn = container.querySelector('#clear-filter-btn');
  const exportBtn = container.querySelector('#export-btn');

  async function applyFilter() {
    const date = container.querySelector('#filter-date').value;
    const carnet = container.querySelector('#filter-carnet').value.trim();
    const records = await filterRecords({ date: date || undefined, carnet: carnet || undefined });
    const members = await getMembers();
    renderRecordsTable(records, members);
  }

  filterBtn?.addEventListener('click', applyFilter);
  clearBtn?.addEventListener('click', async () => {
    container.querySelector('#filter-date').value = '';
    container.querySelector('#filter-carnet').value = '';
    const records = await filterRecords();
    const members = await getMembers();
    renderRecordsTable(records, members);
  });

  container.querySelector('#filter-carnet')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') applyFilter();
  });

  exportBtn?.addEventListener('click', async () => {
    const date = container.querySelector('#filter-date').value;
    const carnet = container.querySelector('#filter-carnet').value.trim();
    const records = await filterRecords({ date: date || undefined, carnet: carnet || undefined });
    if (records.length === 0) {
      alert('No hay registros para exportar.');
      return;
    }
    await exportToCSV(records);
  });

  container.querySelector('#records-table')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-record-btn');
    if (btn) {
      if (confirm('¿Eliminar este registro seguro?')) {
        await deleteRecord(btn.dataset.id);
        applyFilter();
      }
    }
  });

}
