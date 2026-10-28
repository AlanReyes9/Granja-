// Vista de dispositivos: cuadrícula en vivo, control táctil (individual o sincronizado) y acciones masivas.
import { state, api, $, $$, esc, h, call, toast, modal, showResults, deviceName, icon, switchView } from './core.js';
import { openAssignModal } from './proxies.js';
import { attachCanvas, enableStream, isLive, liveSupported, onLiveEvent, resetStream } from './live.js';

const cards = new Map(); // serial -> elemento
const visible = new Set();
const lastShot = new Map(); // serial -> timestamp
let observer;
const NO_GROUP = '\u0000sin-grupo';
// Preferencias de visualización (por equipo): tamaño de miniaturas y vista grande, calidad y fotogramas.
const view = { thumb: 120, big: 680, quality: 70, fps: 1, video: true };
// Vídeo en tiempo real (H.264): ajustes para las miniaturas y para la vista grande.
const STREAM_THUMB = { maxSize: 480, bitRate: 1000000, maxFps: 20 };
const STREAM_BIG = { maxSize: 1080, bitRate: 4000000, maxFps: 30 };
const streaming = new Map(); // serial -> 'thumb' | 'big'
const streamFailed = new Map(); // serial -> momento del último fallo (se reintenta pasado un rato)
let bigSerial = null;

function loadViewPrefs() {
  try { Object.assign(view, JSON.parse(localStorage.getItem('granja.view') || '{}')); } catch {}
}
function saveViewPrefs() {
  try { localStorage.setItem('granja.view', JSON.stringify(view)); } catch {}
}
const shotInterval = () => Math.round(1000 / Math.max(1, Number(view.fps) || 1));

export function selectedSerials({ fallbackAll = false } = {}) {
  const ready = state.devices.filter((d) => d.state === 'device').map((d) => d.serial);
  const sel = ready.filter((s) => state.selected.has(s));
  return sel.length || !fallbackAll ? sel : ready;
}

/** Orden fijo de todos los teléfonos (por nombre) para numerarlos como en la granja física. */
function ordered() {
  return [...state.devices].sort((a, b) => deviceName(a.serial).localeCompare(deviceName(b.serial), undefined, { numeric: true }));
}

function inGroup(serial, g) {
  const grp = state.deviceMeta[serial]?.group || '';
  return g === NO_GROUP ? !grp : grp === g;
}

function filtered() {
  const q = $('#devSearch').value.trim().toLowerCase();
  return ordered().filter((d) => {
    const m = state.deviceMeta[d.serial] || {};
    if (state.groupFilter != null && !inGroup(d.serial, state.groupFilter)) return false;
    if (state.trFilter && d.transport !== state.trFilter) return false;
    if (!q) return true;
    return [d.serial, d.model, m.name, m.group, m.proxy].some((x) => String(x || '').toLowerCase().includes(q));
  });
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
    <div class="head" title="Clic para seleccionar · Doble clic para renombrar"><span class="idx"></span><span class="name"></span><input type="checkbox" class="sel" /></div>
    <div class="screen" title="Clic: tocar · Arrastrar: deslizar · Doble clic: abrir en grande · Clic derecho: atrás">
      <canvas class="live hidden"></canvas><img alt="" /><div class="msg"></div><div class="run-badge hidden"></div><div class="tags"></div>
    </div>
    <div class="navbar">
      <button data-k="4" title="Atrás">${icon('nav-back', 12)}</button>
      <button data-k="3" title="Inicio">${icon('nav-home', 12)}</button>
      <button data-k="187" title="Recientes">${icon('nav-recent', 12)}</button>
      <button class="open" title="Abrir en grande">${icon('maximize', 12)}</button>
    </div>
    <div class="meta"></div>
  </div>`);
  const serial = d.serial;
  const toggle = (on) => { (on ?? !state.selected.has(serial)) ? state.selected.add(serial) : state.selected.delete(serial); updateSelection(); };
  el.querySelector('.sel').onchange = (e) => toggle(e.target.checked);
  el.querySelector('.head').onclick = (e) => {
    if (e.target.classList.contains('sel') || e.detail > 1) return;
    if (state.devices.find((x) => x.serial === serial)?.state === 'device') toggle();
  };
  el.querySelector('.head').ondblclick = () => renameOne(serial);
  el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => call('key', targets(serial), b.dataset.k)));
  el.querySelector('.open').onclick = () => openDetails(serial);
  bindTouch(el.querySelector('.screen'), serial, { onDouble: () => openDetails(serial) });
  el._detachLive = attachCanvas(serial, el.querySelector('canvas.live'));
  observer.observe(el);
  return el;
}

function updateCard(el, d, num) {
  const meta = state.deviceMeta[d.serial] || {};
  const hl = state.health[d.serial] || {};
  const ready = d.state === 'device';
  const run = runningOn(d.serial);
  el.classList.toggle('selected', state.selected.has(d.serial));
  el.querySelector('.sel').checked = state.selected.has(d.serial);
  el.querySelector('.sel').disabled = !ready;
  const idx = el.querySelector('.idx');
  idx.textContent = String(num).padStart(2, '0');
  idx.className = `idx${!ready ? ' off' : run ? ' busy' : ''}`;
  el.querySelector('.name').textContent = meta.name || d.model || d.serial;
  el.querySelector('.head').title = `${d.serial}${meta.group ? `\nGrupo: ${meta.group}` : ''}${meta.proxy ? `\nProxy: ${meta.proxy}` : ''}\nClic para seleccionar · Doble clic para renombrar`;
  const badge = el.querySelector('.run-badge');
  badge.classList.toggle('hidden', !run);
  badge.textContent = run;
  const tr = d.transport === 'otg' ? 'OTG' : d.transport === 'wifi' ? 'Wi-Fi' : 'USB';
  el.querySelector('.tags').innerHTML = `<span>${tr}</span>${hl.battery != null
    ? `<span class="${hl.battery < 20 ? 'low' : ''}" title="${hl.temperature != null ? `${hl.temperature} °C` : ''}">${icon(hl.charging ? 'bolt' : 'battery', 9)}${hl.battery}%</span>` : ''}`;
  const metaText = meta.proxy || meta.group || '';
  el.querySelector('.meta').innerHTML = metaText
    ? `${meta.proxy ? icon('shield', 10) : icon('layers', 10)}<span class="t" title="${esc(metaText)}">${esc(metaText)}</span>` : '';
  const msg = el.querySelector('.msg');
  if (d.state === 'unauthorized') msg.textContent = 'Acepta "Permitir depuración USB" en el teléfono';
  else if (d.state === 'offline') msg.textContent = 'Sin conexión. Reconecta el cable o reinicia ADB.';
  else if (!ready) msg.textContent = `Estado: ${d.state}`;
  else if (!el.querySelector('img').src && !isLive(serialOf(el))) msg.textContent = $('#liveView').checked ? 'Cargando…' : 'Vista en vivo desactivada';
  else msg.textContent = '';
}

function renderGroups() {
  const all = state.devices;
  const sel = (list) => list.filter((d) => state.selected.has(d.serial)).length;
  const names = [...new Set(Object.entries(state.deviceMeta).filter(([s]) => all.some((d) => d.serial === s)).map(([, m]) => m.group).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = [{ key: null, label: 'Todos', list: all }];
  for (const g of names) rows.push({ key: g, label: g, list: all.filter((d) => inGroup(d.serial, g)) });
  const ungrouped = all.filter((d) => inGroup(d.serial, NO_GROUP));
  if (names.length && ungrouped.length) rows.push({ key: NO_GROUP, label: 'Sin grupo', list: ungrouped });
  const box = $('#groupList');
  box.innerHTML = '';
  for (const r of rows) {
    const row = h(`<div class="group-row ${state.groupFilter === r.key ? 'active' : ''}">
      ${icon('chevron-right', 14, 'chev')}<span class="gname">${esc(r.label)}</span><span class="gcount">(${sel(r.list)}/${r.list.length})</span>
      <button class="ghost icon-only sel-group" title="Seleccionar todos los de este grupo">${icon('select', 14)}</button></div>`);
    row.onclick = () => { state.groupFilter = state.groupFilter === r.key && r.key !== null ? null : r.key; renderDevices(); };
    row.querySelector('.sel-group').onclick = (e) => {
      e.stopPropagation();
      const ready = r.list.filter((d) => d.state === 'device').map((d) => d.serial);
      const allSel = ready.every((s) => state.selected.has(s));
      ready.forEach((s) => (allSel ? state.selected.delete(s) : state.selected.add(s)));
      updateSelection();
    };
    box.appendChild(row);
  }
  $$('#trFilter button').forEach((b) => b.classList.toggle('active', (b.dataset.tr || '') === (state.trFilter || '')));
}

export function renderDevices() {
  const list = filtered();
  const numbers = new Map(ordered().map((d, i) => [d.serial, i + 1]));
  const grid = $('#deviceGrid');
  const keep = new Set(list.map((d) => d.serial));
  for (const [serial, el] of cards) {
    if (!state.devices.some((d) => d.serial === serial)) { observer.unobserve(el); el._detachLive?.(); el.remove(); cards.delete(serial); visible.delete(serial); }
    else if (!keep.has(serial)) el.style.display = 'none';
  }
  list.forEach((d, i) => {
    let el = cards.get(d.serial);
    if (!el) { el = createCard(d); cards.set(d.serial, el); }
    el.style.display = '';
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    updateCard(el, d, numbers.get(d.serial));
  });
  $('#emptyDevices').classList.toggle('show', state.devices.length === 0);
  $('#adbHint').textContent = state.adbVersion ? `${state.adbVersion} · ${state.adbPath}` : 'ADB no está instalado: puedes descargarlo en Ajustes.';
  const ready = state.devices.filter((d) => d.state === 'device').length;
  $('#devSummary').textContent = list.length !== state.devices.length ? `Mostrando ${list.length} de ${state.devices.length}` : '';
  const sub = state.devices.length ? `${ready} de ${state.devices.length} dispositivos listos` : 'Sin dispositivos conectados';
  if (state.view === 'devices') $('#pageSub').textContent = sub;
  state.devicesSub = sub;
  renderGroups();
  renderOtg();
  updateSelection(false);
}

function renderOtg() {
  const otg = state.devices.filter((d) => d.transport === 'otg');
  $('#otgToggle').checked = !!state.settings.otgEnabled;
  $('#otgList').innerHTML = otg.length
    ? otg.map((d) => `<div class="item"><span>${esc(deviceName(d.serial))}</span><span class="muted">${esc(d.state)}</span></div>`).join('')
    : `<p class="muted small">${state.settings.otgEnabled ? 'No hay teléfonos detectados por el motor USB directo.' : 'Motor desactivado.'}</p>`;
}

function updateSelection(rerender = true) {
  const n = selectedSerials().length;
  const ready = state.devices.filter((d) => d.state === 'device').length;
  $('#selCount').textContent = n ? `${n} seleccionado${n === 1 ? '' : 's'}` : 'Seleccionar todo';
  const all = $('#selAll');
  all.checked = n > 0 && n === ready;
  all.indeterminate = n > 0 && n < ready;
  const wfLabel = $('#wfRun span');
  if (wfLabel) wfLabel.textContent = n ? `Ejecutar en ${n}` : 'Ejecutar en todos';
  if (rerender) {
    for (const [serial, el] of cards) {
      el.classList.toggle('selected', state.selected.has(serial));
      el.querySelector('.sel').checked = state.selected.has(serial);
    }
    renderGroups();
  }
}

/** Dispositivos destino de una acción táctil: el propio o todos los seleccionados en modo sincronizado. */
function targets(serial) {
  if (!$('#syncControl').checked) return [serial];
  return [...new Set([serial, ...selectedSerials()])];
}

/**
 * Toques sobre una pantalla. Con onDouble, el toque simple se retrasa un instante para poder
 * distinguir el doble clic (que abre la vista grande) y no enviar dos toques al teléfono.
 */
function bindTouch(screen, serial, { onDouble, live = () => refreshShot(serial, true) } = {}) {
  let start = null;
  let pendingTap = null;
  const pos = (e) => {
    const img = screen.querySelector('img');
    const canvas = screen.querySelector('canvas.live');
    const r = screen.getBoundingClientRect();
    // La imagen (o el vídeo) usa object-fit: contain, así que se calcula el área real que ocupa.
    const useCanvas = canvas && !canvas.classList.contains('hidden') && canvas.width > 0;
    const iw = (useCanvas ? canvas.width : img.naturalWidth) || 9; const ih = (useCanvas ? canvas.height : img.naturalHeight) || 19.5;
    const scale = Math.min(r.width / iw, r.height / ih);
    const w = iw * scale; const hh = ih * scale;
    const ox = r.left + (r.width - w) / 2; const oy = r.top + (r.height - hh) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - ox) / w)), y: Math.min(1, Math.max(0, (e.clientY - oy) / hh)), cx: e.clientX - r.left, cy: e.clientY - r.top };
  };
  const ripple = (p) => {
    const el = h('<span class="ripple"></span>');
    el.style.left = `${p.cx}px`; el.style.top = `${p.cy}px`;
    screen.appendChild(el); setTimeout(() => el.remove(), 450);
  };
  screen.addEventListener('mousedown', (e) => { if (e.button === 0) start = { ...pos(e), t: Date.now() }; });
  screen.addEventListener('mouseup', async (e) => {
    if (e.button !== 0 || !start) return;
    const end = pos(e);
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const dur = Math.min(2000, Math.max(120, Date.now() - start.t));
    const s0 = start; start = null;
    if (dist >= 0.02) {
      ripple(end);
      await call('swipe', targets(serial), s0.x, s0.y, end.x, end.y, dur);
    } else if (dur > 600) {
      ripple(end);
      await call('swipe', targets(serial), s0.x, s0.y, s0.x, s0.y, dur);
    } else if (onDouble) {
      if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; onDouble(); return; }
      pendingTap = setTimeout(async () => {
        pendingTap = null;
        ripple(end);
        await call('tap', targets(serial), s0.x, s0.y);
        setTimeout(live, 350);
      }, 260);
      return;
    } else {
      ripple(end);
      await call('tap', targets(serial), s0.x, s0.y);
    }
    setTimeout(live, 350);
  });
  screen.addEventListener('contextmenu', (e) => { e.preventDefault(); call('key', targets(serial), 4); });
  screen.addEventListener('wheel', (e) => {
    e.preventDefault();
    const down = e.deltaY > 0;
    call('swipe', targets(serial), 0.5, down ? 0.7 : 0.3, 0.5, down ? 0.3 : 0.7, 250);
  }, { passive: false });
}

const serialOf = (el) => el.dataset.serial;

/** Muestra el vídeo en vez de la captura cuando llegan fotogramas (y vuelve a la captura si se corta). */
function showLive(screen, on) {
  screen.querySelector('canvas.live')?.classList.toggle('hidden', !on);
  screen.querySelector('img').classList.toggle('hidden', on);
  if (on) screen.querySelector('.msg').textContent = '';
}

const videoWanted = () => view.video !== false && liveSupported() && $('#liveView').checked && !document.hidden;

/**
 * Arranca el vídeo de los teléfonos visibles y lo para en los que dejan de verse. El de la vista
 * grande va con más resolución. Si un teléfono no puede emitir vídeo, sigue con capturas.
 */
async function syncStreams() {
  const want = new Map();
  if (videoWanted()) {
    if (state.view === 'devices') for (const s of visible) want.set(s, 'thumb');
    if (bigSerial) want.set(bigSerial, 'big');
  }
  for (const [s, mode] of want) {
    const d = state.devices.find((x) => x.serial === s);
    if (!d || d.state !== 'device') continue;
    if (Date.now() - (streamFailed.get(s) || 0) < 60000) continue;
    if (streaming.get(s) === mode) continue;
    // Al pasar de miniatura a vista grande el servidor se reinicia: se espera su nueva configuración.
    if (streaming.has(s)) resetStream(s);
    streaming.set(s, mode);
    enableStream(s);
    const ok = await call('streamStart', s, mode === 'big' ? STREAM_BIG : STREAM_THUMB).catch(() => false);
    if (!ok) { streaming.delete(s); streamFailed.set(s, Date.now()); }
  }
  for (const s of [...streaming.keys()]) {
    if (want.has(s)) continue;
    streaming.delete(s);
    resetStream(s);
    call('streamStop', s).catch(() => {});
    const el = cards.get(s);
    if (el) showLive(el.querySelector('.screen'), false);
  }
  // Si un vídeo deja de dar fotogramas, la tarjeta vuelve a la última captura.
  for (const [s, el] of cards) if (!isLive(s, 6000)) showLive(el.querySelector('.screen'), false);
}

/** Estado del vídeo de un teléfono, desde el proceso principal. */
export function onStreamState({ serial, state: st }) {
  if (st === 'failed' && streaming.has(serial)) {
    streaming.delete(serial);
    streamFailed.set(serial, Date.now());
    resetStream(serial);
  }
}

async function refreshShot(serial, force = false) {
  const el = cards.get(serial);
  const d = state.devices.find((x) => x.serial === serial);
  if (!el || !d || d.state !== 'device') return;
  if (!force && isLive(serial)) return;
  if (!force && Date.now() - (lastShot.get(serial) || 0) < shotInterval()) return;
  lastShot.set(serial, Date.now());
  try {
    const shot = await api.call('screenshot', serial, Math.max(200, Math.round(view.thumb * 1.6)), view.quality);
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
    const queue = [...visible].filter((s) => !isLive(s) && Date.now() - (lastShot.get(s) || 0) >= shotInterval())
      .sort((a, b) => (lastShot.get(a) || 0) - (lastShot.get(b) || 0));
    while (busy < limit && queue.length) {
      const s = queue.shift();
      busy++;
      refreshShot(s).finally(() => busy--);
    }
  }, 250);
  setInterval(() => syncStreams().catch(() => {}), 1000);
  onLiveEvent((serial, ev) => {
    if (ev !== 'frame') return;
    const el = cards.get(serial);
    if (el) showLive(el.querySelector('.screen'), true);
  });
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

// ---------- Vista grande de un dispositivo ----------
export async function openDetails(serial) {
  let timer;
  const b = (id, ic, label, cls = '') => `<button id="${id}" class="${cls}">${icon(ic, 15)}${label}</button>`;
  const k = (code, ic, label) => `<button data-k="${code}">${icon(ic, 15)}${label}</button>`;
  const meta = state.deviceMeta[serial] || {};
  const proxyOpts = ['<option value="">Sin proxy</option>', ...state.proxies.map((p) =>
    `<option value="${esc(p.key)}" ${p.key === meta.proxy ? 'selected' : ''}>${esc(p.key)}${p.status === 'error' ? ' (falla)' : ''}</option>`)].join('');
  const html = `<div class="big-device">
    <div class="screen"><canvas class="live hidden"></canvas><img alt="" /><div class="msg">Cargando…</div></div>
    <div class="side">
      <div class="kv" id="dKv"><span>Serie</span><span class="mono">${esc(serial)}</span></div>
      <div class="section-title">Control</div>
      <div class="btn-grid">
        ${k(4, 'back', 'Atrás')}${k(3, 'home', 'Inicio')}${k(187, 'recent', 'Recientes')}
        ${k(24, 'volup', 'Volumen +')}${k(25, 'voldown', 'Volumen -')}${k(26, 'power', 'Encendido')}
        ${b('dText', 'keyboard', 'Escribir')}${b('dShot', 'camera', 'Captura')}${b('dRename', 'tag', 'Renombrar')}
      </div>
      <div class="section-title">Proxy</div>
      <div class="inline-row"><select id="dProxy">${proxyOpts}</select>${b('dProxyApply', 'check', 'Asignar y aplicar', 'primary')}</div>
      <div class="inline-row">${b('dProxyRead', 'eye', 'Ver proxy actual')}${b('dProxyClear', 'x', 'Quitar del teléfono')}</div>
      <div class="section-title">Espejo y grabación</div>
      <div class="btn-grid">${b('dMirror', 'monitor', 'Espejo')}${b('dMirrorView', 'eye', 'Solo ver')}${b('dRecord', 'record', 'Grabar')}</div>
      <div class="section-title">Conexión y energía</div>
      <div class="btn-grid">${b('dWifi', 'wifi', 'USB a Wi-Fi')}${b('dReboot', 'refresh', 'Reiniciar')}${b('dRecovery', 'wrench', 'Recovery')}</div>
      <div class="section-title">Apps instaladas</div>
      <div class="inline-row"><select id="dApps"></select><button id="dOpen">Abrir</button><button id="dStop">Cerrar</button><button id="dUninstall" class="danger">Desinstalar</button></div>
    </div></div>`;
  modal({ title: deviceName(serial), html, okText: '', cancelText: 'Cerrar', wide: true, onMount: async (el) => {
    el.style.setProperty('--big', `${view.big}px`);
    const screen = el.querySelector('.screen');
    let refresh;
    bindTouch(screen, serial, { live: () => { clearTimeout(timer); refresh(); } });
    // Vídeo en alta resolución mientras la vista grande está abierta; capturas si no hay vídeo.
    const detach = attachCanvas(serial, screen.querySelector('canvas.live'));
    bigSerial = serial;
    syncStreams().catch(() => {});
    refresh = async () => {
      if (!el.isConnected) { detach(); if (bigSerial === serial) bigSerial = null; syncStreams().catch(() => {}); return; }
      showLive(screen, isLive(serial, 3000));
      if (!isLive(serial, 3000)) {
        try {
          const shot = await api.call('screenshot', serial, Math.round(view.big * 0.75), Math.max(view.quality, 80));
          screen.querySelector('img').src = shot.data;
          screen.querySelector('.msg').textContent = '';
        } catch {}
      }
      timer = setTimeout(refresh, isLive(serial, 3000) ? 500 : 800);
    };
    refresh();
    const $m = (sel) => el.querySelector(sel);
    el.querySelectorAll('[data-k]').forEach((x) => (x.onclick = () => call('key', [serial], x.dataset.k)));
    $m('#dText').onclick = async () => { const v = await modal({ title: 'Escribir texto', fields: [{ key: 't', label: 'Texto' }] }); if (v?.t) call('text', [serial], v.t); };
    $m('#dShot').onclick = async () => toast(`Captura guardada en ${await call('saveScreenshot', serial)}`);
    $m('#dRename').onclick = () => renameOne(serial);
    $m('#dProxyApply').onclick = async () => {
      state.deviceMeta = await call('proxySetOne', serial, $m('#dProxy').value, true);
      toast($m('#dProxy').value ? `Proxy ${$m('#dProxy').value} aplicado` : 'Proxy quitado');
      renderDevices();
    };
    $m('#dProxyRead').onclick = async () => {
      const cur = await call('readDeviceProxy', serial);
      toast(cur && cur !== 'null' && cur !== ':0' ? `Proxy activo en el teléfono: ${cur}` : 'El teléfono no tiene proxy activo');
    };
    $m('#dProxyClear').onclick = async () => {
      const [r] = await call('setProxy', [serial], '');
      toast(r?.ok === false ? r.out : 'Proxy quitado del teléfono (la asignación se mantiene)', r?.ok === false ? 'error' : 'info');
    };
    $m('#dMirror').onclick = () => call('scrcpy', serial);
    $m('#dMirrorView').onclick = () => call('scrcpy', serial, { noControl: true });
    $m('#dRecord').onclick = () => { call('scrcpy', serial, { record: true }); toast('Grabando. Cierra la ventana de scrcpy para terminar; el vídeo se guarda en Imágenes/Nexus Farmer.'); };
    $m('#dWifi').onclick = async () => showResults('USB a Wi-Fi', await call('usbToWifi', [serial]));
    $m('#dReboot').onclick = () => call('reboot', [serial]);
    $m('#dRecovery').onclick = () => call('reboot', [serial], 'recovery');
    const pkg = () => $m('#dApps').value;
    $m('#dOpen').onclick = () => call('openApp', [serial], pkg());
    $m('#dStop').onclick = () => call('shellCmd', [serial], `am force-stop ${pkg()}`);
    $m('#dUninstall').onclick = async () => { await call('shellCmd', [serial], `pm uninstall ${pkg()}`); toast(`${pkg()} desinstalada`); };
    try {
      const info = await call('details', serial);
      const rows = [['Modelo', `${info.manufacturer || ''} ${info.model || ''}`.trim()], ['Android', `${info.android} (SDK ${info.sdk})`],
        ['Batería', info.battery != null ? `${info.battery}%${info.charging ? ', cargando' : ''}` : '-'], ['Temperatura', info.temperature != null ? `${info.temperature} °C` : '-'],
        ['IP Wi-Fi', info.ip || '-'], ['Almacenamiento', info.storageUse ? `${info.storageUse} usado` : '-']];
      $m('#dKv').insertAdjacentHTML('beforeend', rows.map(([kk, v]) => `<span>${kk}</span><span>${esc(v ?? '-')}</span>`).join(''));
      const apps = await call('listPackages', serial);
      $m('#dApps').innerHTML = apps.map((a) => `<option>${esc(a)}</option>`).join('');
    } catch {}
  } }).then(() => clearTimeout(timer));
}

// ---------- Conexión ----------
async function openConnect() {
  const html = `
    <div class="section-title">ADB por Wi-Fi</div>
    <div class="inline-row"><input id="cAddr" placeholder="192.168.1.50:5555"/><button id="cConnect" class="primary">${icon('plug')}Conectar</button></div>
    <div class="section-title">Emparejar (Android 11 o superior, depuración inalámbrica)</div>
    <div class="inline-row"><input id="pAddr" placeholder="IP:puerto de emparejamiento"/><input id="pCode" placeholder="Código" style="max-width:110px"/><button id="pPair">Emparejar</button></div>
    <div class="section-title">Automático</div>
    <div class="btn-grid">
      <button id="cScan">${icon('search')}Escanear red</button><button id="cUsbWifi">${icon('wifi')}Seleccionados a Wi-Fi</button><button id="cRestart">${icon('refresh')}Reiniciar ADB</button>
    </div>
    <div class="section-title">USB y OTG</div>
    <p>Los teléfonos conectados por cable o por hubs y adaptadores OTG aparecen solos. Activa <b>Motor USB directo</b> en Ajustes para manejarlos sin adb.exe, recomendable con hubs de muchos puertos. En ese modo cierra el servidor ADB para que libere los dispositivos.</p>
    <div id="cOut" class="results"></div>`;
  modal({ title: 'Conectar dispositivos', html, okText: '', cancelText: 'Cerrar', onMount: (el) => {
    const out = (t, ok = true) => el.querySelector('#cOut').prepend(h(`<div class="${ok ? '' : 'fail'}">${esc(t)}</div>`));
    el.querySelector('#cConnect').onclick = async () => out(await call('connectWifi', el.querySelector('#cAddr').value.trim()));
    el.querySelector('#pPair').onclick = async () => out(await call('pair', el.querySelector('#pAddr').value.trim(), el.querySelector('#pCode').value.trim()));
    el.querySelector('#cScan').onclick = async () => {
      out('Escaneando la red local, puede tardar unos 20 segundos');
      const found = await call('scanNetwork');
      out(found.length ? `Encontrados: ${found.map((f) => f.addr).join(', ')}` : 'No se encontraron dispositivos con ADB por TCP (puerto 5555).', found.length > 0);
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
  toast('Selecciona al menos un dispositivo con su casilla o con "Todos"', 'warn');
  return null;
}

const actions = {
  async apk() {
    const sel = await needSelection(); if (!sel) return;
    const files = await call('pickFiles', { multi: true, filters: [{ name: 'APK', extensions: ['apk'] }] });
    if (!files.length) return;
    toast(`Instalando ${files.length} APK en ${sel.length} dispositivo(s)`);
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
    if (!state.workflows.length) return toast('Crea primero un flujo en Flujos', 'warn');
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
    if (!state.proxies.length) {
      toast('Añade primero tu lista de proxys en la sección Proxys', 'warn');
      return;
    }
    openAssignModal(selectedSerials({ fallbackAll: true }));
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
    showResults('USB a Wi-Fi', await call('usbToWifi', sel));
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

  loadViewPrefs();
  $('#devSearch').oninput = () => renderDevices();
  $('#selAll').onchange = (e) => {
    if (e.target.checked) filtered().filter((d) => d.state === 'device').forEach((d) => state.selected.add(d.serial));
    else state.selected.clear();
    updateSelection();
  };
  $('#btnConnect').onclick = openConnect;
  $('#btnCcSettings').onclick = () => switchView('settings');
  $('#liveView').onchange = () => renderDevices();
  $('#videoView').checked = view.video !== false;
  $('#videoView').onchange = (e) => { view.video = e.target.checked; saveViewPrefs(); syncStreams().catch(() => {}); };
  $$('#ccTabs [data-tab]').forEach((b) => (b.onclick = () => {
    $$('#ccTabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $$('.cc-tab').forEach((t) => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab));
  }));
  const setPanelCollapsed = (on) => {
    $('.cc').classList.toggle('collapsed', on);
    $('#ccCollapse').title = on ? 'Expandir panel' : 'Contraer panel';
    try { localStorage.setItem('nexus.panelCollapsed', on ? '1' : '0'); } catch {}
  };
  let panelCollapsed = false;
  try { panelCollapsed = localStorage.getItem('nexus.panelCollapsed') === '1'; } catch {}
  setPanelCollapsed(panelCollapsed);
  $('#ccCollapse').onclick = () => setPanelCollapsed(!$('.cc').classList.contains('collapsed'));
  // Iconos del panel contraído: lo expanden directamente en la sección elegida.
  $$('.cc-rail [data-open]').forEach((b) => (b.onclick = () => {
    setPanelCollapsed(false);
    const tab = b.dataset.open === 'groups' ? 'screen' : b.dataset.open;
    $(`#ccTabs [data-tab="${tab}"]`).click();
    if (b.dataset.open === 'groups') $('#groupList').scrollIntoView({ block: 'nearest' });
  }));
  $$('#trFilter button').forEach((b) => (b.onclick = () => { state.trFilter = b.dataset.tr || null; renderDevices(); }));
  $('#btnNewGroup').onclick = async () => {
    const sel = selectedSerials();
    if (!sel.length) return toast('Selecciona los teléfonos que formarán el grupo', 'warn');
    const v = await modal({ title: `Nuevo grupo con ${sel.length} dispositivo(s)`, fields: [{ key: 'g', label: 'Nombre del grupo', placeholder: 'Granja A' }], okText: 'Crear grupo' });
    if (!v?.g?.trim()) return;
    state.deviceMeta = await call('batchMeta', sel, { group: v.g.trim() });
    renderDevices();
  };
  initOtgNetwork();
  $('#otgToggle').onchange = async (e) => {
    state.settings = await call('saveSettings', { otgEnabled: e.target.checked });
    toast(e.target.checked ? 'Motor USB directo activado' : 'Motor USB directo desactivado');
    renderDevices();
  };
  // Deslizadores de pantalla
  const sliders = { thumbSize: 'thumb', bigSize: 'big', quality: 'quality', fps: 'fps' };
  for (const [id, key] of Object.entries(sliders)) {
    const input = $(`#${id}`);
    input.value = view[key];
    input.oninput = () => {
      view[key] = Number(input.value);
      if (key === 'thumb') document.documentElement.style.setProperty('--thumb', `${view.thumb}px`);
    };
    input.onchange = () => { saveViewPrefs(); if (key === 'quality') lastShot.clear(); };
    input.title = { thumb: 'Ancho de cada pantalla en la cuadrícula', big: 'Alto de la pantalla al abrir un teléfono en grande', quality: 'Calidad de imagen de las capturas', fps: 'Capturas por segundo de cada teléfono' }[key];
  }
  document.documentElement.style.setProperty('--thumb', `${view.thumb}px`);
  $$('.cc-toolbar [data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act]()));

  // Arrastrar y soltar: los APK se instalan y el resto se envía a /sdcard/Download.
  const area = $('#view-devices');
  let depth = 0;
  area.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#dropHint').classList.add('show'); });
  area.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#dropHint').classList.remove('show'); } });
  area.addEventListener('dragover', (e) => e.preventDefault());
  area.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; $('#dropHint').classList.remove('show');
    const sel = await needSelection(); if (!sel) return;
    const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    const apks = files.filter((f) => f.toLowerCase().endsWith('.apk'));
    const others = files.filter((f) => !f.toLowerCase().endsWith('.apk'));
    if (apks.length) { toast(`Instalando ${apks.length} APK`); showResults('Instalar APK', await call('installApks', sel, apks)); }
    if (others.length) showResults('Enviar archivos', await call('pushFiles', sel, others, '/sdcard/Download/'));
  });

  startLiveLoop();
}

// ---------- Pestaña OTG: puerto y escaneo de redes (como GenFarmer) ----------
function initOtgNetwork() {
  const port = () => Number($('#otgPort').value) || 5555;
  const octs = $$('#otgFrom input');
  const last = $('#otgToLast');
  const mirror = $$('#otgTo input[disabled]');
  const syncTo = () => mirror.forEach((m, i) => (m.value = octs[i].value));
  const range = () => {
    const from = octs.map((o) => o.value.trim()).join('.');
    const to = [...octs.slice(0, 3).map((o) => o.value.trim()), last.value.trim()].join('.');
    return { from, to };
  };
  try {
    const saved = JSON.parse(localStorage.getItem('nexus.otgForm') || 'null');
    if (saved) { $('#otgPort').value = saved.port; saved.from.split('.').forEach((v, i) => (octs[i].value = v)); last.value = saved.last; }
  } catch {}
  const remember = () => { try { localStorage.setItem('nexus.otgForm', JSON.stringify({ port: port(), from: range().from, last: last.value })); } catch {} };
  syncTo();
  octs.forEach((o, i) => (o.oninput = () => {
    o.value = o.value.replace(/\D/g, '').slice(0, 3);
    if (o.value.length === 3 && i < 3) octs[i + 1].focus();
    syncTo(); remember();
  }));
  last.oninput = () => { last.value = last.value.replace(/\D/g, '').slice(0, 3); remember(); };
  $('#otgPort').oninput = remember;

  const countNet = () => { $('#otgCount').textContent = state.devices.filter((d) => d.transport === 'wifi' && d.state === 'device').length; };
  const renderNets = async (list) => {
    list = list || await call('otgNetworks');
    const box = $('#otgNets');
    box.innerHTML = list.length ? '' : '<p class="muted small">Sin redes guardadas. Escribe un rango y pulsa Añadir.</p>';
    list.forEach((n, i) => {
      const row = h(`<div class="net-row"><span class="mono">${esc(n.from)} – ${esc(n.to.split('.').pop())}</span><span class="muted">:${n.port}</span>
        <button class="ghost icon-only" title="Escanear">${icon('search', 13)}</button><button class="ghost icon-only danger" title="Quitar">${icon('x', 13)}</button></div>`);
      const [scanBtn, delBtn] = row.querySelectorAll('button');
      scanBtn.onclick = () => scan([n]);
      delBtn.onclick = async () => renderNets(await call('otgDeleteNetwork', i));
      box.appendChild(row);
    });
  };
  const scan = async (nets) => {
    let found = 0;
    for (const n of nets) {
      try {
        const res = await call('otgScan', n.from, n.to, n.port);
        found += res.filter((r) => /connected/i.test(r.out)).length;
      } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, ''), 'error'); return; }
    }
    toast(found ? `${found} teléfono(s) conectados por red` : 'No se encontró ningún teléfono con ese puerto abierto', found ? 'info' : 'warn');
    countNet();
  };

  $('#otgActivate').onclick = async () => {
    const res = await call('otgActivate', port(), selectedSerials());
    const n = Object.keys(res).length;
    if (!n) return toast('No hay teléfonos conectados por USB para activar', 'warn');
    showResults(`Puerto ${port()} activado`, Object.entries(res).map(([serial, out]) => ({ serial, ok: !/^Error/.test(out), out })));
  };
  $('#otgAdd').onclick = async () => {
    const { from, to } = range();
    try { renderNets(await call('otgSaveNetwork', { from, to, port: port() })); toast(`Red ${from} – ${to.split('.').pop()} guardada`); } catch (e) { toast(e.message, 'error'); }
  };
  $('#otgScanRange').onclick = () => { const { from, to } = range(); scan([{ from, to, port: port() }]); };
  $('#otgScanSaved').onclick = async () => {
    const list = await call('otgNetworks');
    if (!list.length) return toast('No hay redes guardadas', 'warn');
    scan(list);
  };
  renderNets();
  countNet();
  setInterval(countNet, 3000);
}
