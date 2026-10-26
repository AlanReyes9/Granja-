// Vista de dispositivos: cuadrícula en vivo, control táctil (individual o sincronizado) y acciones masivas.
import { state, api, $, $$, esc, h, call, toast, modal, showResults, deviceName } from './core.js';

const cards = new Map(); // serial -> elemento
const visible = new Set();
const lastShot = new Map(); // serial -> timestamp
let observer;

export function selectedSerials({ fallbackAll = false } = {}) {
  const ready = state.devices.filter((d) => d.state === 'device').map((d) => d.serial);
  const sel = ready.filter((s) => state.selected.has(s));
  return sel.length || !fallbackAll ? sel : ready;
}

function filtered() {
  const q = $('#devSearch').value.trim().toLowerCase();
  const g = $('#devGroupFilter').value;
  return state.devices.filter((d) => {
    const m = state.deviceMeta[d.serial] || {};
    if (g && (m.group || '') !== g) return false;
    if (!q) return true;
    return [d.serial, d.model, m.name, m.group].some((x) => String(x || '').toLowerCase().includes(q));
  }).sort((a, b) => deviceName(a.serial).localeCompare(deviceName(b.serial), undefined, { numeric: true }));
}

function runningOn(serial) {
  for (const r of state.runs) {
    const d = r.devices[serial];
    if (r.status === 'running' && d && d.status === 'ejecutando') return `${r.workflow}: ${d.step || '…'}`;
  }
  return '';
}

function createCard(d) {
  const el = h(`<div class="card" data-serial="${esc(d.serial)}">
    <div class="head"><input type="checkbox" class="sel" /><span class="name"></span><span class="badge tr"></span></div>
    <div class="screen"><img alt="" /><div class="msg"></div></div>
    <div class="meta"><span class="info"></span><span class="bat"></span></div>
    <div class="ctrl">
      <button data-k="4" title="Atrás">↩</button><button data-k="3" title="Inicio">⌂</button><button data-k="187" title="Recientes">▢</button>
      <button class="mirror" title="Espejo en tiempo real (scrcpy)">🖥</button><button class="more" title="Detalles">⋯</button>
    </div></div>`);
  const serial = d.serial;
  el.querySelector('.sel').onchange = (e) => { e.target.checked ? state.selected.add(serial) : state.selected.delete(serial); updateSelection(); };
  el.querySelector('.head .name').ondblclick = () => renameOne(serial);
  el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => call('key', targets(serial), b.dataset.k)));
  el.querySelector('.mirror').onclick = () => call('scrcpy', serial);
  el.querySelector('.more').onclick = () => openDetails(serial);
  bindTouch(el.querySelector('.screen'), serial);
  observer.observe(el);
  return el;
}

function updateCard(el, d) {
  const meta = state.deviceMeta[d.serial] || {};
  const hl = state.health[d.serial] || {};
  el.classList.toggle('selected', state.selected.has(d.serial));
  el.querySelector('.sel').checked = state.selected.has(d.serial);
  el.querySelector('.sel').disabled = d.state !== 'device';
  el.querySelector('.name').textContent = meta.name || d.model || d.serial;
  el.querySelector('.name').title = `${d.serial}${meta.group ? ` · grupo: ${meta.group}` : ''}\nDoble clic para renombrar`;
  const tr = el.querySelector('.tr');
  tr.className = `badge tr ${d.transport}`;
  tr.textContent = d.transport;
  const run = runningOn(d.serial);
  el.querySelector('.info').innerHTML = run ? `<span class="badge run">▶ ${esc(run)}</span>` : esc(meta.group || d.model || '');
  const bat = el.querySelector('.bat');
  bat.innerHTML = hl.battery != null ? `<span class="${hl.battery < 20 ? 'low' : ''}">🔋${hl.battery}%${hl.charging ? '⚡' : ''}</span>${hl.temperature != null ? ` · ${hl.temperature}°` : ''}` : '';
  const msg = el.querySelector('.msg');
  if (d.state === 'unauthorized') msg.textContent = 'Acepta "Permitir depuración USB" en la pantalla del teléfono';
  else if (d.state === 'offline') msg.textContent = 'Sin conexión (offline). Reconecta el cable o reinicia ADB.';
  else if (d.state !== 'device') msg.textContent = `Estado: ${d.state}`;
  else if (!el.querySelector('img').src) msg.textContent = $('#liveView').checked ? 'Cargando pantalla…' : 'Vista en vivo desactivada';
  else msg.textContent = '';
}

export function renderDevices() {
  const list = filtered();
  const grid = $('#deviceGrid');
  const keep = new Set(list.map((d) => d.serial));
  for (const [serial, el] of cards) {
    if (!state.devices.some((d) => d.serial === serial)) { observer.unobserve(el); el.remove(); cards.delete(serial); visible.delete(serial); }
    else if (!keep.has(serial)) el.style.display = 'none';
  }
  list.forEach((d, i) => {
    let el = cards.get(d.serial);
    if (!el) { el = createCard(d); cards.set(d.serial, el); }
    el.style.display = '';
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    updateCard(el, d);
  });
  $('#emptyDevices').classList.toggle('show', state.devices.length === 0);
  $('#adbHint').textContent = state.adbVersion ? `${state.adbVersion} · ${state.adbPath}` : 'ADB no está instalado: ve a Ajustes → Descargar platform-tools.';
  const groups = [...new Set(Object.values(state.deviceMeta).map((m) => m.group).filter(Boolean))].sort();
  const gf = $('#devGroupFilter');
  const cur = gf.value;
  gf.innerHTML = `<option value="">Todos los grupos</option>${groups.map((g) => `<option ${g === cur ? 'selected' : ''}>${esc(g)}</option>`).join('')}`;
  updateSelection(false);
}

function updateSelection(rerender = true) {
  const n = selectedSerials().length;
  $('#selCount').textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
  $('#wfRun') && ($('#wfRun').textContent = n ? `▶ Ejecutar en ${n} seleccionado${n === 1 ? '' : 's'}` : '▶ Ejecutar en todos');
  if (rerender) for (const [serial, el] of cards) {
    el.classList.toggle('selected', state.selected.has(serial));
    el.querySelector('.sel').checked = state.selected.has(serial);
  }
}

/** Dispositivos destino de una acción táctil: el propio o todos los seleccionados en modo sincronizado. */
function targets(serial) {
  if (!$('#syncControl').checked) return [serial];
  return [...new Set([serial, ...selectedSerials()])];
}

function bindTouch(screen, serial) {
  let start = null;
  const pos = (e) => {
    const img = screen.querySelector('img');
    const r = screen.getBoundingClientRect();
    // La imagen usa object-fit: contain → calcular el área real de la imagen.
    const iw = img.naturalWidth || 9; const ih = img.naturalHeight || 19.5;
    const scale = Math.min(r.width / iw, r.height / ih);
    const w = iw * scale; const hh = ih * scale;
    const ox = r.left + (r.width - w) / 2; const oy = r.top + (r.height - hh) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - ox) / w)), y: Math.min(1, Math.max(0, (e.clientY - oy) / hh)), cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  screen.addEventListener('mousedown', (e) => { if (e.button === 0) start = { ...pos(e), t: Date.now() }; });
  screen.addEventListener('mouseup', async (e) => {
    if (e.button !== 0 || !start) return;
    const end = pos(e);
    const ripple = h('<span class="ripple"></span>');
    ripple.style.left = `${end.cx}px`; ripple.style.top = `${end.cy}px`;
    screen.appendChild(ripple); setTimeout(() => ripple.remove(), 500);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const dur = Math.min(2000, Math.max(120, Date.now() - start.t));
    const s0 = start; start = null;
    if (dist < 0.02) {
      if (dur > 600) await call('swipe', targets(serial), s0.x, s0.y, s0.x, s0.y, dur);
      else await call('tap', targets(serial), s0.x, s0.y);
    } else await call('swipe', targets(serial), s0.x, s0.y, end.x, end.y, dur);
    setTimeout(() => refreshShot(serial, true), 350);
  });
  screen.addEventListener('contextmenu', (e) => { e.preventDefault(); call('key', targets(serial), 4); });
  screen.addEventListener('wheel', (e) => {
    e.preventDefault();
    const down = e.deltaY > 0;
    call('swipe', targets(serial), 0.5, down ? 0.7 : 0.3, 0.5, down ? 0.3 : 0.7, 250);
  }, { passive: false });
}

async function refreshShot(serial, force = false) {
  const el = cards.get(serial);
  const d = state.devices.find((x) => x.serial === serial);
  if (!el || !d || d.state !== 'device') return;
  if (!force && Date.now() - (lastShot.get(serial) || 0) < (state.settings.screenshotInterval || 3000)) return;
  lastShot.set(serial, Date.now());
  try {
    const shot = await api.call('screenshot', serial, Math.max(240, Number($('#thumbSize').value) * 1.5));
    el.querySelector('img').src = shot.data;
    el.querySelector('.msg').textContent = '';
  } catch {
    el.querySelector('.msg').textContent = 'No se pudo capturar la pantalla';
  }
}

function startLiveLoop() {
  let busy = 0;
  setInterval(() => {
    if (!$('#liveView').checked || state.view !== 'devices' || document.hidden) return;
    const limit = state.settings.thumbnailConcurrency || 6;
    const queue = [...visible].filter((s) => Date.now() - (lastShot.get(s) || 0) >= (state.settings.screenshotInterval || 3000))
      .sort((a, b) => (lastShot.get(a) || 0) - (lastShot.get(b) || 0));
    while (busy < limit && queue.length) {
      const s = queue.shift();
      busy++;
      refreshShot(s).finally(() => busy--);
    }
  }, 250);
}

async function renameOne(serial) {
  const m = state.deviceMeta[serial] || {};
  const v = await modal({ title: `Dispositivo ${serial}`, fields: [
    { key: 'name', label: 'Nombre', value: m.name || '' },
    { key: 'group', label: 'Grupo', value: m.group || '', placeholder: 'p. ej. TikTok-A' },
    { key: 'notes', label: 'Notas', type: 'textarea', value: m.notes || '' },
  ] });
  if (!v) return;
  state.deviceMeta = await call('setMeta', serial, v);
  renderDevices();
}

// ---------- Detalles de un dispositivo ----------
async function openDetails(serial) {
  let timer;
  const html = `<div class="big-device">
    <div class="screen"><img alt="" /><div class="msg">Cargando…</div></div>
    <div>
      <div class="kv" id="dKv"><span>Serie</span><span>${esc(serial)}</span></div>
      <div class="section-title">Control</div>
      <div class="btn-grid">
        <button data-k="4">↩ Atrás</button><button data-k="3">⌂ Inicio</button><button data-k="187">▢ Recientes</button>
        <button data-k="24">🔊 Vol +</button><button data-k="25">🔉 Vol −</button><button data-k="26">⏻ Encendido</button>
        <button id="dText">⌨ Escribir</button><button id="dShot">📸 Guardar captura</button><button id="dRename">🏷 Renombrar</button>
      </div>
      <div class="section-title">Espejo y grabación (scrcpy)</div>
      <div class="btn-grid">
        <button id="dMirror">🖥 Espejo</button><button id="dMirrorView">👁 Solo ver</button><button id="dRecord">⏺ Grabar</button>
      </div>
      <div class="section-title">Conexión y energía</div>
      <div class="btn-grid">
        <button id="dWifi">📶 USB → Wi-Fi</button><button id="dReboot">⟲ Reiniciar</button><button id="dRecovery">🛠 Recovery</button>
      </div>
      <div class="section-title">Apps instaladas</div>
      <div class="inline" style="display:flex;gap:6px"><select id="dApps" style="flex:1"></select><button id="dOpen">Abrir</button><button id="dStop">Cerrar</button><button id="dUninstall" class="danger">Desinstalar</button></div>
    </div></div>`;
  modal({ title: deviceName(serial), html, okText: '', cancelText: 'Cerrar', wide: true, onMount: async (el) => {
    const screen = el.querySelector('.screen');
    bindTouch(screen, serial);
    const refresh = async () => {
      try {
        const shot = await api.call('screenshot', serial, 720);
        screen.querySelector('img').src = shot.data;
        screen.querySelector('.msg').textContent = '';
      } catch {}
      if (el.isConnected) timer = setTimeout(refresh, 900);
    };
    refresh();
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => call('key', [serial], b.dataset.k)));
    el.querySelector('#dText').onclick = async () => { const v = await modal({ title: 'Escribir texto', fields: [{ key: 't', label: 'Texto' }] }); if (v?.t) call('text', [serial], v.t); };
    el.querySelector('#dShot').onclick = async () => toast(`Captura guardada en ${await call('saveScreenshot', serial)}`);
    el.querySelector('#dRename').onclick = () => renameOne(serial);
    el.querySelector('#dMirror').onclick = () => call('scrcpy', serial);
    el.querySelector('#dMirrorView').onclick = () => call('scrcpy', serial, { noControl: true });
    el.querySelector('#dRecord').onclick = () => { call('scrcpy', serial, { record: true }); toast('Grabando: cierra la ventana de scrcpy para terminar. El vídeo se guarda en Imágenes/Granja.'); };
    el.querySelector('#dWifi').onclick = async () => showResults('USB → Wi-Fi', await call('usbToWifi', [serial]));
    el.querySelector('#dReboot').onclick = () => call('reboot', [serial]);
    el.querySelector('#dRecovery').onclick = () => call('reboot', [serial], 'recovery');
    const pkg = () => el.querySelector('#dApps').value;
    el.querySelector('#dOpen').onclick = () => call('shellCmd', [serial], `monkey -p ${pkg()} -c android.intent.category.LAUNCHER 1`);
    el.querySelector('#dStop').onclick = () => call('shellCmd', [serial], `am force-stop ${pkg()}`);
    el.querySelector('#dUninstall').onclick = async () => { await call('shellCmd', [serial], `pm uninstall ${pkg()}`); toast(`${pkg()} desinstalada`); };
    try {
      const info = await call('details', serial);
      const rows = [['Fabricante', info.manufacturer], ['Modelo', info.model], ['Android', `${info.android} (SDK ${info.sdk})`],
        ['Batería', info.battery != null ? `${info.battery}%${info.charging ? ' cargando' : ''}` : '—'], ['Temperatura', info.temperature != null ? `${info.temperature} °C` : '—'],
        ['IP Wi-Fi', info.ip || '—'], ['Almacenamiento', info.storageUse || '—']];
      el.querySelector('#dKv').insertAdjacentHTML('beforeend', rows.map(([k, v]) => `<span>${k}</span><span>${esc(v ?? '—')}</span>`).join(''));
      const apps = await call('listPackages', serial);
      el.querySelector('#dApps').innerHTML = apps.map((a) => `<option>${esc(a)}</option>`).join('');
    } catch {}
  } }).then(() => clearTimeout(timer));
}

// ---------- Conexión ----------
async function openConnect() {
  const html = `
    <div class="section-title">ADB por Wi-Fi</div>
    <div style="display:flex;gap:6px"><input id="cAddr" placeholder="192.168.1.50:5555" style="flex:1"/><button id="cConnect" class="primary">Conectar</button></div>
    <div class="section-title">Emparejar (Android 11+ · Depuración inalámbrica)</div>
    <div style="display:flex;gap:6px"><input id="pAddr" placeholder="IP:puerto de emparejamiento" style="flex:1"/><input id="pCode" placeholder="Código" style="width:110px"/><button id="pPair">Emparejar</button></div>
    <div class="section-title">Automático</div>
    <div class="btn-grid">
      <button id="cScan">🔍 Escanear red local</button><button id="cUsbWifi">📶 Seleccionados USB → Wi-Fi</button><button id="cRestart">⟲ Reiniciar ADB</button>
    </div>
    <div class="section-title">USB / OTG</div>
    <p class="muted" style="margin:0">Los teléfonos conectados por cable o por hubs/adaptadores OTG aparecen solos. Activa <b>Ajustes → Motor USB directo (OTG)</b> para manejarlos sin adb.exe (ideal para hubs con muchos puertos). Con el motor OTG cierra el servidor ADB para que libere los dispositivos.</p>
    <div id="cOut" class="results"></div>`;
  modal({ title: 'Conectar dispositivos', html, okText: '', cancelText: 'Cerrar', onMount: (el) => {
    const out = (t, ok = true) => el.querySelector('#cOut').prepend(h(`<div class="${ok ? '' : 'fail'}">${esc(t)}</div>`));
    el.querySelector('#cConnect').onclick = async () => out(await call('connectWifi', el.querySelector('#cAddr').value.trim()));
    el.querySelector('#pPair').onclick = async () => out(await call('pair', el.querySelector('#pAddr').value.trim(), el.querySelector('#pCode').value.trim()));
    el.querySelector('#cScan').onclick = async () => {
      out('Escaneando la red… (puede tardar ~20 s)');
      const found = await call('scanNetwork');
      out(found.length ? `Encontrados: ${found.join(', ')}` : 'No se encontraron dispositivos con ADB por TCP (puerto 5555).', found.length > 0);
    };
    el.querySelector('#cUsbWifi').onclick = async () => {
      const sel = selectedSerials().filter((s) => state.devices.find((d) => d.serial === s)?.transport === 'usb');
      if (!sel.length) return out('Selecciona dispositivos conectados por USB', false);
      for (const r of await call('usbToWifi', sel)) out(`${deviceName(r.serial)}: ${r.out}`, r.ok);
    };
    el.querySelector('#cRestart').onclick = async () => { await call('restartAdb'); out('Servidor ADB reiniciado'); };
  } });
}

// ---------- Acciones masivas ----------
async function needSelection() {
  const sel = selectedSerials();
  if (sel.length) return sel;
  toast('Selecciona al menos un dispositivo (casilla de cada tarjeta o "Seleccionar todo")', 'warn');
  return null;
}

const actions = {
  async apk() {
    const sel = await needSelection(); if (!sel) return;
    const files = await call('pickFiles', { multi: true, filters: [{ name: 'APK', extensions: ['apk'] }] });
    if (!files.length) return;
    toast(`Instalando ${files.length} APK en ${sel.length} dispositivo(s)…`);
    showResults('Instalar APK', await call('installApks', sel, files));
  },
  async push() {
    const sel = await needSelection(); if (!sel) return;
    const files = await call('pickFiles', { multi: true });
    if (!files.length) return;
    const v = await modal({ title: 'Enviar archivos', fields: [{ key: 'remote', label: 'Carpeta destino en el teléfono', value: '/sdcard/Download/' }] });
    if (!v) return;
    showResults('Enviar archivos', await call('pushFiles', sel, files, v.remote));
  },
  async shell() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: `Comando shell en ${sel.length} dispositivo(s)`, fields: [{ key: 'cmd', label: 'Comando', type: 'textarea', placeholder: 'getprop ro.product.model' }] });
    if (v?.cmd) showResults('Shell', await call('shellCmd', sel, v.cmd));
  },
  async text() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: 'Escribir texto en el campo activo', fields: [{ key: 't', label: 'Texto' }] });
    if (v?.t) showResults('Texto', await call('text', sel, v.t));
  },
  async url() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: 'Abrir URL', fields: [{ key: 'url', label: 'URL', value: 'https://' }] });
    if (v?.url) await call('openUrl', sel, v.url);
  },
  async run() {
    const sel = await needSelection(); if (!sel) return;
    if (!state.workflows.length) return toast('Crea primero un flujo en Automatización', 'warn');
    const v = await modal({ title: `Ejecutar flujo en ${sel.length} dispositivo(s)`, fields: [
      { key: 'id', label: 'Flujo', type: 'select', options: state.workflows.map((w) => [w.id, w.name]) },
      { key: 'concurrency', label: 'Dispositivos en paralelo', type: 'number', value: state.settings.runConcurrency },
      { key: 'staggerMs', label: 'Retraso escalonado entre dispositivos (ms)', type: 'number', value: state.settings.runStaggerMs },
    ] });
    if (!v) return;
    await call('runWorkflow', v.id, sel, { concurrency: Number(v.concurrency), staggerMs: Number(v.staggerMs) });
    toast('Flujo lanzado. Sigue el progreso en Ejecuciones.');
  },
  async proxy() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: 'Proxy HTTP global', fields: [{ key: 'p', label: 'host:puerto (vacío para quitar el proxy)', placeholder: '192.168.1.10:8080' }] });
    if (v) showResults('Proxy', await call('setProxy', sel, v.p.trim()));
  },
  async rename() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: `Nombrar / agrupar ${sel.length} dispositivo(s)`, fields: [
      { key: 'namePattern', label: 'Patrón de nombre (# = número). Vacío = no cambiar', placeholder: 'Teléfono-##' },
      { key: 'startAt', label: 'Empezar en', type: 'number', value: 1 },
      { key: 'group', label: 'Grupo (vacío = no cambiar)' },
    ] });
    if (!v) return;
    state.deviceMeta = await call('batchMeta', sel, { namePattern: v.namePattern, startAt: Number(v.startAt) || 1, group: v.group || null });
    renderDevices();
  },
  async wifi() {
    const sel = await needSelection(); if (!sel) return;
    showResults('USB → Wi-Fi', await call('usbToWifi', sel));
  },
  async home() { const sel = await needSelection(); if (sel) call('key', sel, 3); },
  async back() { const sel = await needSelection(); if (sel) call('key', sel, 4); },
  async wake() { const sel = await needSelection(); if (sel) call('shellCmd', sel, 'input keyevent 224; sleep 0.4; input swipe 500 1500 500 400 250'); },
  async reboot() {
    const sel = await needSelection(); if (!sel) return;
    const v = await modal({ title: `¿Reiniciar ${sel.length} dispositivo(s)?`, fields: [{ key: 'mode', label: 'Modo', type: 'select', options: [['', 'Normal'], ['recovery', 'Recovery'], ['bootloader', 'Bootloader']] }], okText: 'Reiniciar' });
    if (v) showResults('Reiniciar', await call('reboot', sel, v.mode));
  },
};

export function initDevices() {
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = e.target.dataset.serial;
      if (e.isIntersecting) visible.add(s); else visible.delete(s);
    }
  }, { root: $('#deviceGrid') });

  $('#devSearch').oninput = () => renderDevices();
  $('#devGroupFilter').onchange = () => renderDevices();
  $('#btnSelectAll').onclick = () => { filtered().filter((d) => d.state === 'device').forEach((d) => state.selected.add(d.serial)); updateSelection(); };
  $('#btnSelectNone').onclick = () => { state.selected.clear(); updateSelection(); };
  $('#btnConnect').onclick = openConnect;
  $('#liveView').onchange = () => renderDevices();
  const applySize = () => document.documentElement.style.setProperty('--thumb', `${$('#thumbSize').value}px`);
  $('#thumbSize').oninput = applySize;
  try { $('#thumbSize').value = localStorage.getItem('thumb') || 200; } catch {}
  $('#thumbSize').onchange = () => { try { localStorage.setItem('thumb', $('#thumbSize').value); } catch {} };
  applySize();
  $$('.actionbar [data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act]()));

  // Arrastrar y soltar: APK → instalar, otros → enviar a /sdcard/Download.
  const view = $('#view-devices');
  let depth = 0;
  view.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#dropHint').classList.add('show'); });
  view.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropHint').classList.remove('show'); } });
  view.addEventListener('dragover', (e) => e.preventDefault());
  view.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; $('#dropHint').classList.remove('show');
    const sel = await needSelection(); if (!sel) return;
    const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    const apks = files.filter((f) => f.toLowerCase().endsWith('.apk'));
    const others = files.filter((f) => !f.toLowerCase().endsWith('.apk'));
    if (apks.length) { toast(`Instalando ${apks.length} APK…`); showResults('Instalar APK', await call('installApks', sel, apks)); }
    if (others.length) showResults('Enviar archivos', await call('pushFiles', sel, others, '/sdcard/Download/'));
  });

  startLiveLoop();
}
