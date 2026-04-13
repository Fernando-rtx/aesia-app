/**
 * ui.js — Funciones de renderizado de vistas para App Marcación AESIA
 */
import {
  getMembers, getCurrentlyInside, filterRecords,
  exportToCSV, getRecords,
} from './db.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDateTime(isoString) {
  const dt = new Date(isoString);
  return {
    date: dt.toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    time: dt.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function timeDiff(isoString) {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Justo ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  return `Hace ${hrs}h ${m}m`;
}

function badge(action) {
  const isEntrada = action === 'entrada';
  return `<span class="badge badge--${isEntrada ? 'entrada' : 'salida'}">
    <span class="badge__dot"></span>${isEntrada ? 'ENTRADA' : 'SALIDA'}
  </span>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function renderDashboard(container) {
  container.innerHTML = `<div class="dash-loading"><span class="clock-time">Cargando...</span></div>`;
  const inside = await getCurrentlyInside();
  const records = await getRecords(5);
  const members = await getMembers();

  // Hoy
  const today = new Date().toISOString().slice(0, 10);
  let recordsHoy = 0;
  try {
     const filt = await filterRecords({ date: today });
     recordsHoy = filt.length;
  } catch(e) {}

  container.innerHTML = `
    <div class="dashboard">
      <div class="dash-stats">
        <div class="stat-card stat-card--primary">
          <div class="stat-card__icon">👥</div>
          <div class="stat-card__value">${inside.length}</div>
          <div class="stat-card__label">Personas dentro ahora</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon">📋</div>
          <div class="stat-card__value">${members.length}</div>
          <div class="stat-card__label">Miembros registrados</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon">📅</div>
          <div class="stat-card__value">${recordsHoy}</div>
          <div class="stat-card__label">Visitas hoy</div>
        </div>
      </div>

      <div class="dash-panels">
        <div class="glass-panel">
          <h3 class="panel-title">
            <span class="dot dot--green"></span> Actualmente en el local
          </h3>
          ${inside.length === 0
            ? `<div class="empty-state">
                <span class="empty-icon">🏠</span>
                <p>El local está vacío</p>
              </div>`
            : `<ul class="inside-list">
                ${inside.map(p => `
                  <li class="inside-item">
                    <div class="avatar">${p.name.charAt(0).toUpperCase()}</div>
                    <div class="inside-info">
                      <span class="inside-name">${p.name}</span>
                      <span class="inside-meta">${p.carnet} · ${p.career}</span>
                    </div>
                    <span class="inside-time">${timeDiff(p.since)}</span>
                  </li>
                `).join('')}
              </ul>`
          }
        </div>

        <div class="glass-panel">
          <h3 class="panel-title">⚡ Últimos movimientos</h3>
          ${records.length === 0
            ? `<div class="empty-state"><span class="empty-icon">📭</span><p>Sin registros aún</p></div>`
            : `<ul class="record-mini-list">
                ${records.map(r => {
                  const m = members.find(mb => mb.carnet === r.carnet);
                  const { time } = formatDateTime(r.timestamp);
                  return `
                    <li class="record-mini-item">
                      <span class="record-mini-name">${m ? m.name : r.carnet} 
                        ${r.outOfBounds ? '<span title="Fuera del rango permitido">🗺️</span>' : ''}
                      </span>
                      ${badge(r.action)}
                      <span class="record-mini-time">${time}</span>
                    </li>
                  `;
                }).join('')}
              </ul>`
          }
        </div>
      </div>
    </div>
  `;
}

// ─── Vista Marcación ──────────────────────────────────────────────────────────

export function renderMarcar(container) {
  container.innerHTML = `
    <div class="marcar-view">
      <div class="marcar-card glass-panel">
        <img src="assets/logo.jpg" alt="AESIA Logo" class="marcar-logo">
        <h2 class="marcar-title">Sistema de Marcación</h2>
        <p class="marcar-subtitle">Ingresa tu carnet para registrar asistencia</p>

        <form id="marcar-form" class="marcar-form" autocomplete="off">
          <div class="input-group">
            <label class="input-label" for="carnet-input">Número de Carnet</label>
            <div class="input-wrapper">
              <span class="input-icon">🪪</span>
              <input
                id="carnet-input"
                type="text"
                class="input-field"
                placeholder="Ej: AB12345"
                maxlength="20"
                required
                autofocus
              />
            </div>
          </div>
          <button type="submit" class="btn btn--primary btn--lg" id="marcar-btn" style="width: 100%; border-radius: 99px;">
            <span class="btn-text">Registrar con GPS 📍</span>
          </button>
        </form>

        <div id="marcar-result" class="marcar-result hidden"></div>
      </div>
    </div>
  `;
}

export function showMarcarResult(container, record, member, action) {
  const result = container.querySelector('#marcar-result');
  const isEntrada = action === 'entrada';
  const { time } = formatDateTime(record.timestamp);

  result.className = `marcar-result marcar-result--${isEntrada ? 'entrada' : 'salida'} animate-in`;
  result.innerHTML = `
    <div class="result-icon">${isEntrada ? '✅' : '👋'}</div>
    <div class="result-title">${isEntrada ? '¡Bienvenid@!' : '¡Hasta pronto!'}</div>
    <div class="result-name">${member ? member.name : record.carnet}</div>
    <div class="result-detail">
      ${isEntrada ? 'Entrada' : 'Salida'} registr. a las <strong>${time}</strong>
      ${record.outOfBounds ? '<br/><span style="color:var(--amber);">⚠️ Registrado fuera del rango</span>' : ''}
    </div>
  `;

  setTimeout(() => {
    result.classList.add('fade-out');
    setTimeout(() => {
      result.className = 'marcar-result hidden';
      container.querySelector('#carnet-input').value = '';
      container.querySelector('#carnet-input').focus();
    }, 600);
  }, 4000);
}

export function showMarcarError(container, message) {
  const result = container.querySelector('#marcar-result');
  result.className = 'marcar-result marcar-result--error animate-in';
  result.innerHTML = `
    <div class="result-icon">❌</div>
    <div class="result-title">Aviso</div>
    <div class="result-detail">${message}</div>
  `;
  setTimeout(() => {
    result.classList.add('fade-out');
    setTimeout(() => {
      result.className = 'marcar-result hidden';
    }, 600);
  }, 4000);
}

// ─── Vista Miembros (Admin) ───────────────────────────────────────────────────

export async function renderMembers(container) {
  container.innerHTML = `<div class="dash-loading"><span class="clock-time">Cargando...</span></div>`;
  const members = await getMembers();

  container.innerHTML = `
    <div class="admin-view">
      <div class="admin-header">
        <h2 class="section-title">👥 Gestión de Miembros</h2>
        <button class="btn btn--primary" id="add-member-btn">
          + Agregar Miembro
        </button>
      </div>

      <div id="member-form-container" class="hidden"></div>

      <div class="members-grid" id="members-grid">
        ${members.length === 0
          ? `<div class="empty-state full-width">
              <span class="empty-icon">👤</span>
              <p>No hay miembros registrados</p>
            </div>`
          : members.map(m => memberCard(m)).join('')
        }
      </div>
    </div>
  `;
}

function memberCard(m) {
  return `
    <div class="member-card glass-panel" data-carnet="${m.carnet}">
      <div class="member-avatar">${m.name.charAt(0).toUpperCase()}</div>
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-carnet">🪪 ${m.carnet}</div>
        <div class="member-career">🎓 ${m.career || '—'}</div>
      </div>
      <div class="member-actions">
        <button class="btn-icon btn-icon--edit" data-carnet="${m.carnet}" title="Editar">✏️</button>
        <button class="btn-icon btn-icon--delete" data-carnet="${m.carnet}" title="Eliminar">🗑️</button>
      </div>
    </div>
  `;
}

export function renderMemberForm(container, member = null) {
  const isEdit = !!member;
  container.innerHTML = `
    <div class="glass-panel member-form-panel">
      <h3>${isEdit ? '✏️ Editar Miembro' : '➕ Nuevo Miembro'}</h3>
      <form id="member-form">
        <div class="form-grid">
          <div class="input-group">
            <label class="input-label">Nombre completo *</label>
            <input type="text" id="f-name" class="input-field" placeholder="Nombre Apellido"
              value="${isEdit ? member.name : ''}" required>
          </div>
          <div class="input-group">
            <label class="input-label">Carnet *</label>
            <input type="text" id="f-carnet" class="input-field" placeholder="AB12345"
              value="${isEdit ? member.carnet : ''}" ${isEdit ? 'readonly' : ''} required>
          </div>
          <div class="input-group">
            <label class="input-label">Carrera</label>
            <select id="f-career" class="input-field select-field">
              <option value="">Seleccionar...</option>
              ${['Ingeniería en Sistemas', 'Ingeniería Civil', 'Ingeniería Industrial',
                  'Arquitectura', 'Ingeniería Mecánica', 'Ingeniería Eléctrica', 'Otra']
                .map(c => `<option value="${c}" ${isEdit && member.career === c ? 'selected' : ''}>${c}</option>`)
                .join('')}
            </select>
          </div>
          <div class="input-group">
            <label class="input-label">Ciclo / Año</label>
            <input type="text" id="f-cycle" class="input-field" placeholder="Ej: 5° Ciclo 2024"
              value="${isEdit && member.cycle ? member.cycle : ''}">
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" id="cancel-form-btn">Cancelar</button>
          <button type="submit" class="btn btn--primary">${isEdit ? 'Guardar Cambios' : 'Agregar Miembro'}</button>
        </div>
      </form>
    </div>
  `;
}

// ─── Vista Historial ──────────────────────────────────────────────────────────

export async function renderHistorial(container) {
  container.innerHTML = `<div class="dash-loading"><span class="clock-time">Cargando...</span></div>`;
  const today = new Date().toISOString().slice(0, 10);
  const members = await getMembers();

  container.innerHTML = `
    <div class="historial-view">
      <div class="admin-header">
        <h2 class="section-title">📋 Historial de Marcaciones</h2>
        <button class="btn btn--success" id="export-btn">⬇ Exportar CSV</button>
      </div>

      <div class="filter-bar glass-panel">
        <div class="input-group input-group--inline">
          <label class="input-label">Fecha</label>
          <input type="date" id="filter-date" class="input-field" value="${today}">
        </div>
        <div class="input-group input-group--inline">
          <label class="input-label">Buscar por Carnet</label>
          <input type="text" id="filter-carnet" class="input-field" placeholder="Buscar...">
        </div>
        <button class="btn btn--ghost" id="filter-btn">🔍 Filtrar</button>
        <button class="btn btn--ghost" id="clear-filter-btn">✕ Limpiar</button>
      </div>

      <div class="glass-panel table-container">
        <table class="records-table" id="records-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Carnet</th>
              <th>Nombre</th>
              <th>Ubicación</th>
              <th>Acción</th>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Eliminar</th>
            </tr>
          </thead>
          <tbody id="records-tbody"></tbody>
        </table>
        <div id="records-empty" class="empty-state hidden">
          <span class="empty-icon">📭</span>
          <p>No hay registros para mostrar</p>
        </div>
      </div>
    </div>
  `;

  renderRecordsTable(await filterRecords({ date: today }), members);
}

export function renderRecordsTable(records, members) {
  const tbody = document.getElementById('records-tbody');
  const empty = document.getElementById('records-empty');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = records.map((r, i) => {
    const m = members.find(mb => mb.carnet === r.carnet);
    const { date, time } = formatDateTime(r.timestamp);
    const locBadge = r.outOfBounds ? 
      `<span style="color:var(--red); font-size:0.75rem; font-weight:bold;">¡AFUERA! 📍</span>` : 
      `<span style="color:var(--green); font-size:0.75rem;">LOCAL ✓</span>`;

    return `
      <tr>
        <td class="td-num">${i + 1}</td>
        <td><code class="carnet-code">${r.carnet}</code></td>
        <td>${m ? m.name : '<em class="text-dim">Desconocido</em>'}</td>
        <td>${locBadge}</td>
        <td>${badge(r.action)}</td>
        <td class="text-dim">${date}</td>
        <td><strong>${time}</strong></td>
        <td>
          <button class="btn-icon btn-icon--delete delete-record-btn"
            data-id="${r.id}" title="Eliminar registro">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}
