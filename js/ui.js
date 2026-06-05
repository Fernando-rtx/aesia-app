/**
 * ui.js — Funciones de renderizado de vistas para App Marcación AESIA
 */
import {
  getMembers, getCurrentlyInside, filterRecords,
  exportToCSV, getRecords, getDashboardMetrics
} from './db.js';

// ─── Sanitización XSS ────────────────────────────────────────────────────────
// Escapa caracteres peligrosos para prevenir inyección de HTML/scripts.
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  
  const [inside, records, members, metrics] = await Promise.all([
    getCurrentlyInside(),
    getRecords(5),
    getMembers(),
    getDashboardMetrics()
  ]);

  container.innerHTML = `
    <div class="dashboard">
      <div class="dash-stats grid-4">
        <div class="stat-card stat-card--primary stat-card--glow">
          <div class="stat-card__icon" style="background: rgba(255,255,255,0.2);">👥</div>
          <div class="stat-card__value">${inside.length}</div>
          <div class="stat-card__label">Personas dentro ahora</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon" style="color: var(--accent);">📅</div>
          <div class="stat-card__value">${metrics.today}</div>
          <div class="stat-card__label">Visitas hoy</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon" style="color: var(--accent);">📈</div>
          <div class="stat-card__value">${metrics.month}</div>
          <div class="stat-card__label">Visitas este mes</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon" style="color: var(--accent);">⚡</div>
          <div class="stat-card__value" style="font-size: 1.5rem;">${metrics.peakHour}</div>
          <div class="stat-card__label">Hora Pico</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon" style="color: var(--accent);">🏆</div>
          <div class="stat-card__value">${metrics.activeUsers} <span style="font-size: 1rem; color: var(--text-dim);">/ ${members.length}</span></div>
          <div class="stat-card__label">Miembros activos</div>
        </div>
      </div>

      <div class="dash-panels">
        <div class="glass-panel panel-premium">
          <h3 class="panel-title">📈 Visitas de los últimos 7 días</h3>
          <div class="chart-container" style="position: relative; height: 250px; width: 100%;">
            <canvas id="chart-visits"></canvas>
          </div>
        </div>
        <div class="glass-panel panel-premium">
          <h3 class="panel-title">⏰ Afluencia por hora</h3>
          <div class="chart-container" style="position: relative; height: 250px; width: 100%;">
            <canvas id="chart-hours"></canvas>
          </div>
        </div>
      </div>

      <div class="dash-panels">
        <div class="glass-panel panel-premium">
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
                    <div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div>
                    <div class="inside-info">
                      <span class="inside-name">${esc(p.name)}</span>
                      <span class="inside-meta">${esc(p.carnet)}</span>
                    </div>
                    <span class="inside-time">${timeDiff(p.since)}</span>
                  </li>
                `).join('')}
              </ul>`
          }
        </div>

        <div class="glass-panel panel-premium">
          <h3 class="panel-title">⚡ Últimos movimientos</h3>
          ${records.length === 0
            ? `<div class="empty-state"><span class="empty-icon">📭</span><p>Sin registros aún</p></div>`
            : `<ul class="record-mini-list">
                ${records.map(r => {
                  const m = members.find(mb => mb.carnet === r.carnet);
                  const { time } = formatDateTime(r.timestamp);
                  return `
                    <li class="record-mini-item">
                      <span class="record-mini-name">${esc(m ? m.name : r.carnet)} 
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

  // Inicializar Gráficos (si Chart está disponible globalmente)
  if (window.Chart) {
    const ctxVisits = document.getElementById('chart-visits')?.getContext('2d');
    if (ctxVisits) {
      new Chart(ctxVisits, {
        type: 'line',
        data: {
          labels: metrics.chartVisits.labels.map(l => l.slice(5)), // MM-DD
          datasets: [{
            label: 'Visitas',
            data: metrics.chartVisits.data,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#3b82f6',
            pointBorderWidth: 2,
            pointRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { stepSize: 1 } }
          }
        }
      });
    }

    const ctxHours = document.getElementById('chart-hours')?.getContext('2d');
    if (ctxHours) {
      const hLabels = metrics.chartHours.data.map((_, i) => \`\${i}:00\`);
      new Chart(ctxHours, {
        type: 'bar',
        data: {
          labels: hLabels,
          datasets: [{
            label: 'Afluencia',
            data: metrics.chartHours.data,
            backgroundColor: '#10b981',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
            y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }
}

// ─── Vista Marcación ──────────────────────────────────────────────────────────

/**
 * renderMarcar — Vista de marcación con un solo clic.
 * @param {HTMLElement} container
 * @param {object|null} member   - Datos del miembro vinculado al usuario logueado (null si no tiene perfil)
 * @param {'entrada'|'salida'} nextAction
 */
export function renderMarcar(container, member = null, nextAction = 'entrada') {
  if (!member) {
    container.innerHTML = `
      <div class="marcar-view">
        <div class="marcar-card glass-panel">
          <img src="assets/logo.jpg" alt="AESIA Logo" class="marcar-logo">
          <h2 class="marcar-title">¡Bienvenid@!</h2>
          <p class="marcar-subtitle" style="color:var(--amber);">
            ⚠️ Tu cuenta no está vinculada a un perfil de miembro.<br/>
            Contacta al administrador de AESIA o regresa al inicio de sesión<br/>
            y <strong>regístrate con tu carnet</strong>.
          </p>
        </div>
      </div>`;
    return;
  }

  const isEntrada    = nextAction === 'entrada';
  const firstName    = esc(member.name.split(' ')[0]);
  const initial      = esc(member.name.charAt(0).toUpperCase());

  container.innerHTML = `
    <div class="marcar-view">
      <div class="marcar-card glass-panel">
        <img src="assets/logo.jpg" alt="AESIA Logo" class="marcar-logo">

        <div class="marcar-user-info">
          <div class="marcar-avatar">${initial}</div>
          <div class="marcar-user-details">
            <h2 class="marcar-name">¡Hola, ${firstName}!</h2>
            <p class="marcar-carnet">🆔 ${esc(member.carnet)}</p>
          </div>
        </div>

        <div class="marcar-status ${isEntrada ? 'marcar-status--out' : 'marcar-status--in'}">
          <span class="marcar-status__dot"></span>
          ${isEntrada ? 'Actualmente fuera del local' : 'Actualmente dentro del local'}
        </div>

        <button type="button" class="btn btn--primary btn--xl" id="marcar-btn" style="width:100%;border-radius:99px;">
          <span class="btn-text">${isEntrada ? '✅ Registrar Entrada' : '🚪 Registrar Salida'}</span>
        </button>

        <p class="marcar-gps-note">📍 Se verificará tu ubicación GPS al marcar</p>

        <div id="marcar-result" class="marcar-result hidden"></div>
      </div>
    </div>`;
}


export function showMarcarResult(container, record, member, action) {
  const result    = container.querySelector('#marcar-result');
  if (!result) return;
  const isEntrada = action === 'entrada';
  const { time }  = formatDateTime(record.timestamp);

  result.className = `marcar-result marcar-result--${isEntrada ? 'entrada' : 'salida'} animate-in`;
  result.innerHTML = `
    <div class="result-icon">${isEntrada ? '✅' : '👋'}</div>
    <div class="result-title">${isEntrada ? '¡Bienvenid@!' : '¡Hasta pronto!'}</div>
    <div class="result-name">${esc(member ? member.name : record.carnet)}</div>
    <div class="result-detail">
      ${isEntrada ? 'Entrada' : 'Salida'} registrada a las <strong>${time}</strong>
      ${record.outOfBounds ? '<br/><span style="color:var(--amber);">⚠️ Registrado fuera del rango</span>' : ''}
    </div>
  `;

  setTimeout(() => {
    result.classList.add('fade-out');
    setTimeout(() => { result.className = 'marcar-result hidden'; }, 600);
  }, 4000);
}

export function showMarcarError(container, message) {
  const result = container.querySelector('#marcar-result');
  result.className = 'marcar-result marcar-result--error animate-in';
  result.innerHTML = `
    <div class="result-icon">❌</div>
    <div class="result-title">Aviso</div>
    <div class="result-detail">${esc(message)}</div>
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
    <div class="member-card glass-panel" data-carnet="${esc(m.carnet)}">
      <div class="member-avatar">${esc(m.name.charAt(0).toUpperCase())}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name)}</div>
        <div class="member-carnet">🪪 ${esc(m.carnet)}</div>
      </div>
      <div class="member-actions">
        <button class="btn-icon btn-icon--edit" data-carnet="${esc(m.carnet)}" title="Editar">✏️</button>
        <button class="btn-icon btn-icon--delete" data-carnet="${esc(m.carnet)}" title="Eliminar">🗑️</button>
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
              value="${isEdit ? esc(member.name) : ''}" required>
          </div>
          <div class="input-group">
            <label class="input-label">Carnet *</label>
            <input type="text" id="f-carnet" class="input-field" placeholder="AB12345"
              value="${isEdit ? esc(member.carnet) : ''}" ${isEdit ? 'readonly' : ''} required>
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
        <div class="input-group">
          <label class="input-label">Fecha</label>
          <input type="date" id="filter-date" class="input-field" value="${today}">
        </div>
        <div class="input-group">
          <label class="input-label">Buscar Nombre o Carnet</label>
          <input type="text" id="filter-search" class="input-field" placeholder="Buscar...">
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
        <td><code class="carnet-code">${esc(r.carnet)}</code></td>
        <td>${m ? esc(m.name) : '<em class="text-dim">Desconocido</em>'}</td>
        <td>${locBadge}</td>
        <td>${badge(r.action)}</td>
        <td class="text-dim">${date}</td>
        <td><strong>${time}</strong></td>
        <td>
          <button class="btn-icon btn-icon--delete delete-record-btn"
            data-id="${esc(r.id)}" title="Eliminar registro">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');
}
