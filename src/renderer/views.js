// Vistas secundarias: ejecuciones/registro, programador, tablas de datos y ajustes.
import { state, $, $$, esc, h, call, toast, modal, deviceName, reloadState, icon, hydrateIcons } from './core.js';
import { selectedSerials } from './devices.js';

// ---------- Ejecuciones ----------
const logs = [];
const MAX_LOGS = 3000;

export function renderRuns() {
  const box = $('#runsList');
  if (!state.runs.length) { box.innerHTML = '<p class="empty-line">No hay ejecuciones activas. Lanza un flujo desde Flujos o Dispositivos.</p>'; return; }
  box.innerHTML = '';
  for (const r of [...state.runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const entries = Object.entries(r.devices);
    const done = entries.filter(([, d]) => ['ok', 'error', 'detenido', 'cancelado'].includes(d.status)).length;
    const pct = entries.length ? Math.round((done / entries.length) * 100) : 0;
    const el = h(`<div class="run"><div class="top">
      <div><b>${esc(r.workflow)}</b> <span class="muted">· ${new Date(r.startedAt).toLocaleTimeString()} · ${done} de ${entries.length} · ${r.status === 'running' ? 'en curso' : esc(r.status)}</span></div>
      ${r.status === 'running' ? `<button class="danger sm stop">${icon('square', 13)}Detener</button>` : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="chips">${entries.map(([s, d]) => `<span class="chip ${esc(d.status)}" title="${esc(d.step || '')}">${esc(deviceName(s))}: ${esc(d.status)}${d.step ? ` · ${esc(d.step)}` : ''}</span>`).join('')}</div></div>`);
    el.querySelector('.stop')?.addEventListener('click', () => call('stopRun', r.id));
    box.appendChild(el);
  }
}

function logLine(e) {
  const t = new Date(e.time).toLocaleTimeString();
  return `<div class="${e.level}"><span class="t">[${t}] ${esc(deviceName(e.serial))}:</span> ${esc(e.message)}</div>`;
}

function logVisible(e) {
  const lvl = $('#logLevel').value;
  const q = $('#logFilter').value.trim().toLowerCase();
  if (lvl === 'error' && e.level !== 'error') return false;
  if (lvl === 'warn' && e.level === 'info') return false;
  return !q || `${deviceName(e.serial)} ${e.message}`.toLowerCase().includes(q);
}

function redrawLogs() {
  $('#logBox').innerHTML = logs.filter(logVisible).map(logLine).join('');
  $('#logBox').scrollTop = 1e9;
}

export function appendLog(e) {
  logs.push(e);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  if (!logVisible(e)) return;
  const box = $('#logBox');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.insertAdjacentHTML('beforeend', logLine(e));
  if (box.childElementCount > MAX_LOGS) box.firstElementChild.remove();
  if (atBottom) box.scrollTop = 1e9;
}

export async function renderHistory() {
  const hist = await call('getHistory');
  $('#historyBox').innerHTML = hist.length ? hist.slice(0, 200).map((x) => {
    const vals = Object.values(x.results || {});
    const ok = vals.filter((v) => v === 'ok').length;
    return `<div class="h"><span><b>${esc(x.workflow)}</b><br><span class="muted">${new Date(x.startedAt).toLocaleString()} · ${esc(x.source)}</span></span><span style="text-align:right"><span class="chip ${ok === vals.length ? 'ok' : 'error'}">${ok} de ${vals.length}</span><br><span class="muted">${esc(x.status)}</span></span></div>`;
  }).join('') : '<p class="empty-line">Sin historial todavía.</p>';
}

// ---------- Programador ----------
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function renderSchedules() {
  const box = $('#schedList');
  if (!state.schedules.length) { box.innerHTML = '<p class="empty-line">No hay tareas programadas. Crea una para ejecutar flujos automáticamente cada cierto tiempo o a una hora fija.</p>'; return; }
  box.innerHTML = '';
  for (const sc of state.schedules) {
    const wf = state.workflows.find((w) => w.id === sc.workflowId);
    const when = sc.mode === 'interval' ? `Cada ${sc.everyMinutes} min` : `${sc.time} · ${(sc.days?.length ? sc.days : [0, 1, 2, 3, 4, 5, 6]).map((d) => DAYS[d]).join(' ')}`;
    const target = sc.target === 'group' ? `Grupo "${sc.group}"` : sc.target === 'list' ? `${sc.serials.length} dispositivos fijos` : 'Todos los dispositivos';
    const el = h(`<div class="box"><div class="row"><b>${esc(sc.name)}</b><label class="toggle"><input type="checkbox" ${sc.enabled ? 'checked' : ''}/><span class="track"></span>Activa</label></div>
      <span class="line">${icon('workflow', 14)}${esc(wf?.name || '(flujo eliminado)')}</span><span class="line">${icon('clock', 14)}${esc(when)}</span><span class="line">${icon('phone', 14)}${esc(target)}</span>
      <div class="actions"><button class="ghost sm edit">Editar</button><button class="ghost sm danger del">${icon('trash', 13)}Eliminar</button></div></div>`);
    el.querySelector('input').onchange = async (e) => { state.schedules = await call('saveSchedule', { ...sc, enabled: e.target.checked }); };
    el.querySelector('.edit').onclick = () => editSchedule(sc);
    el.querySelector('.del').onclick = async () => { state.schedules = await call('deleteSchedule', sc.id); renderSchedules(); };
    box.appendChild(el);
  }
}

async function editSchedule(sc = {}) {
  if (!state.workflows.length) return toast('Primero crea un flujo', 'warn');
  const groups = [...new Set(Object.values(state.deviceMeta).map((m) => m.group).filter(Boolean))];
  const v = await modal({
    title: sc.id ? 'Editar tarea' : 'Nueva tarea programada',
    fields: [
      { key: 'name', label: 'Nombre', value: sc.name || 'Tarea diaria' },
      { key: 'workflowId', label: 'Flujo', type: 'select', options: state.workflows.map((w) => [w.id, w.name]), value: sc.workflowId },
      { key: 'mode', label: 'Cuándo', type: 'select', options: [['daily', 'A una hora fija'], ['interval', 'Cada X minutos']], value: sc.mode || 'daily' },
      { key: 'time', label: 'Hora (HH:MM) — modo hora fija', type: 'time', value: sc.time || '09:00' },
      { key: 'everyMinutes', label: 'Cada cuántos minutos — modo intervalo', type: 'number', value: sc.everyMinutes || 60 },
      { key: 'target', label: 'Dispositivos', type: 'select', value: sc.target || 'all',
        options: [['all', 'Todos los conectados'], ['group', 'Un grupo'], ['list', `Los seleccionados ahora (${selectedSerials().length})`]] },
      { key: 'group', label: 'Grupo (si eliges "Un grupo")', type: 'select', options: ['', ...groups], value: sc.group || '' },
      { key: 'enabled', label: 'Activa', type: 'checkbox', value: sc.enabled ?? true },
    ],
    html: `<label>Días (modo hora fija)<div class="days">${DAYS.map((d, i) => `<label class="chk"><input type="checkbox" data-k="day${i}" ${(sc.days?.length ? sc.days : [0, 1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''}/> ${d}</label>`).join('')}</div></label>`,
    okText: 'Guardar',
  });
  if (!v) return;
  const next = { ...sc, ...v, everyMinutes: Number(v.everyMinutes), days: DAYS.map((_, i) => i).filter((i) => v[`day${i}`]),
    serials: v.target === 'list' ? (sc.target === 'list' && !selectedSerials().length ? sc.serials : selectedSerials()) : [] };
  state.schedules = await call('saveSchedule', next);
  renderSchedules();
}

// ---------- Tablas de datos ----------
export function renderTables() {
  const box = $('#tblList');
  if (!state.tables.length) { box.innerHTML = '<p class="empty-line">Sin tablas. Importa un CSV con los nombres de columna en la primera fila.</p>'; return; }
  box.innerHTML = '';
  for (const t of state.tables) {
    const el = h(`<div class="box"><div class="row"><span class="line">${icon('table', 15)}<b>${esc(t.name)}</b></span><span class="chip">${t.count} filas</span></div>
      <span class="muted">Columnas: ${t.columns.map((c) => `<code>{${esc(c)}}</code>`).join(' ')}</span>
      <div class="actions"><button class="ghost sm view">${icon('eye', 13)}Ver</button><button class="ghost sm re">${icon('upload', 13)}Reemplazar</button><button class="ghost sm danger del">${icon('trash', 13)}Eliminar</button></div></div>`);
    el.querySelector('.view').onclick = async () => {
      const p = await call('previewTable', t.name);
      $('#tblPreview').innerHTML = `<table><tr>${p.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${p.rows.map((r) => `<tr>${p.columns.map((_, i) => `<td>${esc(r[i])}</td>`).join('')}</tr>`).join('')}</table>${p.count > 50 ? `<p class="muted">y ${p.count - 50} filas más</p>` : ''}`;
    };
    el.querySelector('.re').onclick = async () => { if (await call('importTable', t.name)) refreshTables(); };
    el.querySelector('.del').onclick = async () => { await call('deleteTable', t.name); $('#tblPreview').innerHTML = ''; refreshTables(); };
    box.appendChild(el);
  }
}

async function refreshTables() {
  await reloadState();
  renderTables();
}

// ---------- Ajustes ----------
const SETTINGS_SCHEMA = [
  { legend: 'ADB y conexión', fields: [
    { key: 'adbPath', label: 'Ruta de adb.exe (vacío = automática)', type: 'file' },
    { key: 'autoReconnectWifi', label: 'Reconectar automáticamente dispositivos Wi-Fi', type: 'checkbox' },
    { key: 'otgEnabled', label: 'Motor USB directo (OTG): sin adb.exe, mediante libusb y WinUSB', type: 'checkbox' },
    { key: 'autoApplyProxy', label: 'Volver a aplicar el proxy asignado al conectar un teléfono', type: 'checkbox' },
  ], extra: '<div class="inline"><button id="dlAdb"><i data-icon="download"></i>Descargar platform-tools</button><button id="rsAdb" class="ghost"><i data-icon="refresh"></i>Reiniciar ADB</button></div>' },
  { legend: 'Espejo en tiempo real (scrcpy)', fields: [
    { key: 'scrcpyPath', label: 'Ruta de scrcpy.exe (vacío = automática)', type: 'file' },
  ], extra: '<div class="inline"><button id="dlScrcpy"><i data-icon="download"></i>Descargar scrcpy</button><button id="openShots" class="ghost"><i data-icon="folder"></i>Carpeta de capturas</button></div>' },
  { legend: 'Rendimiento', fields: [
    { key: 'screenshotInterval', label: 'Intervalo de refresco de miniaturas (ms)', type: 'number' },
    { key: 'thumbnailConcurrency', label: 'Capturas simultáneas máximas', type: 'number' },
    { key: 'runConcurrency', label: 'Dispositivos en paralelo por ejecución', type: 'number' },
    { key: 'runStaggerMs', label: 'Retraso escalonado entre dispositivos (ms)', type: 'number' },
  ] },
  { legend: 'Alertas y notificaciones', fields: [
    { key: 'telegramToken', label: 'Token del bot de Telegram', type: 'password' },
    { key: 'telegramChatId', label: 'Chat ID de Telegram' },
    { key: 'webhookUrl', label: 'Webhook (Discord, Slack, n8n, Make…)' },
    { key: 'alertBatteryBelow', label: 'Avisar si la batería baja de (%)', type: 'number' },
    { key: 'alertTempAbove', label: 'Avisar si la temperatura supera (°C)', type: 'number' },
    { key: 'alertOnDisconnect', label: 'Avisar cuando un dispositivo se desconecte', type: 'checkbox' },
  ], extra: '<div class="inline"><button id="testNotify"><i data-icon="bell"></i>Enviar prueba</button></div>' },
  { legend: 'API REST local', fields: [
    { key: 'apiEnabled', label: 'Activar API REST', type: 'checkbox' },
    { key: 'apiPort', label: 'Puerto', type: 'number' },
    { key: 'apiToken', label: 'Token (si lo defines, la API escucha en toda la red local)', type: 'password' },
  ], extra: `<div class="muted" style="font-size:12px">Ejemplos:<br><code>GET /api/devices</code> · <code>GET /api/workflows</code><br>
    <code>POST /api/run {"workflow":"Nombre","group":"A"}</code><br><code>POST /api/shell {"command":"input keyevent 3"}</code><br>
    <code>GET /api/proxies</code> · <code>POST /api/proxies/assign</code><br><code>GET /api/screenshot/&lt;serie&gt;</code> · Cabecera <code>Authorization: Bearer &lt;token&gt;</code></div>` },
];

export function renderSettings() {
  const s = state.settings;
  $('#settingsForm').innerHTML = SETTINGS_SCHEMA.map((sec) => `<fieldset><legend>${esc(sec.legend)}</legend>${sec.fields.map((f) => {
    if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" data-s="${f.key}" ${s[f.key] ? 'checked' : ''}/> ${esc(f.label)}</label>`;
    if (f.type === 'file') return `<label>${esc(f.label)}<div class="inline"><input data-s="${f.key}" value="${esc(s[f.key])}"/><button class="ghost icon-only pick" data-for="${f.key}" title="Buscar archivo"><i data-icon="folder"></i></button></div></label>`;
    return `<label>${esc(f.label)}<input data-s="${f.key}" type="${f.type || 'text'}" value="${esc(s[f.key])}"/></label>`;
  }).join('')}${sec.extra || ''}</fieldset>`).join('') + `<fieldset><legend>Estado</legend><div class="kv">
    <span>ADB</span><span>${esc(state.adbVersion || 'no encontrado')}</span><span>Ruta ADB</span><span>${esc(state.adbPath)}</span>
    <span>scrcpy</span><span>${esc(state.scrcpy || 'no instalado')}</span><span>Capturas</span><span>${esc(state.screenshotsDir)}</span></div></fieldset>`;

  hydrateIcons($('#settingsForm'));
  $$('#settingsForm .pick').forEach((b) => (b.onclick = async () => {
    const [f] = await call('pickFiles', { filters: [{ name: 'Ejecutable', extensions: ['exe', '*'] }] });
    if (f) $(`[data-s="${b.dataset.for}"]`).value = f;
  }));
  $('#dlAdb').onclick = async () => { toast('Descargando platform-tools…'); const p = await call('downloadAdb'); toast(`ADB instalado: ${p}`); await reloadState(); renderSettings(); };
  $('#rsAdb').onclick = async () => { await call('restartAdb'); toast('ADB reiniciado'); };
  $('#dlScrcpy').onclick = async () => { toast('Descargando scrcpy…'); const p = await call('downloadScrcpy'); toast(`scrcpy instalado: ${p}`); await reloadState(); renderSettings(); };
  $('#openShots').onclick = () => call('openFolder');
  $('#testNotify').onclick = async () => { await saveSettings(); await call('testNotify'); toast('Notificación enviada'); };
}

async function saveSettings() {
  const out = {};
  $$('[data-s]').forEach((i) => {
    const k = i.dataset.s;
    out[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value.trim();
  });
  state.settings = await call('saveSettings', out);
  return state.settings;
}

export function initViews() {
  $('#btnStopAll').onclick = () => call('stopAll');
  $('#logLevel').onchange = redrawLogs;
  $('#logFilter').oninput = redrawLogs;
  $('#logClear').onclick = () => { logs.length = 0; redrawLogs(); };
  $('#histExport').onclick = async () => { if (await call('exportHistory')) toast('Historial exportado'); };
  $('#schNew').onclick = () => editSchedule();
  $('#tblImport').onclick = async () => {
    const v = await modal({ title: 'Importar CSV', fields: [{ key: 'name', label: 'Nombre de la tabla', value: 'cuentas' }] });
    if (v && (await call('importTable', v.name.trim()))) { refreshTables(); toast('Tabla importada'); }
  };
  $('#setSave').onclick = async () => { await saveSettings(); await reloadState(); renderSettings(); toast('Ajustes guardados'); };
  window.addEventListener('view', (e) => { if (e.detail === 'schedules') renderSchedules(); });
}
