// Vista de dispositivos: cuadrícula en vivo, control táctil (individual o sincronizado) y acciones masivas.
import { state, api, $, $$, esc, h, call, toast, modal, showResults, deviceName, icon } from './core.js';
import { openAssignModal } from './proxies.js';

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
    <div class="head"><input type="checkbox" class="sel" /><span class="name"></span><span class="chip tr"></span></div>
    <div class="screen" title="Clic: tocar · Arrastrar: deslizar · Doble clic: abrir en grande · Clic derecho: atrás">
      <img alt="" /><div class="msg"></div><div class="run-badge hidden"></div>
      <div class="hover-ctrl">
        <button data-k="4" title="Atrás">${icon('back', 13)}</button>
        <button data-k="3" title="Inicio">${icon('home', 13)}</button>
        <button data-k="187" title="Recientes">${icon('recent', 13)}</button>
        <button class="open" title="Abrir en grande">${icon('maximize', 13)}</button>
      </div>
    </div>
    <div class="meta"><span class="info"></span><span class="bat"></span></div>
  </div>`);
  const serial = d.serial;
  el.querySelector('.sel').onchange = (e) => { e.target.checked ? state.selected.add(serial) : state.selected.delete(serial); updateSelection(); };
  el.querySelector('.head .name').ondblclick = () => renameOne(serial);
  el.querySelectorAll('.hover-ctrl button').forEach((b) => b.addEventListener('mousedown', (e) => e.stopPropagation()));
  el.querySelectorAll('.hover-ctrl button').forEach((b) => b.addEventListener('mouseup', (e) => e.stopPropagation()));
  el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => call('key', targets(serial), b.dataset.k)));
  el.querySelector('.open').onclick = () => openDetails(serial);
  bindTouch(el.querySelector('.screen'), serial, { onDouble: () => openDetails(serial) });
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
  el.querySelector('.name').title = `${d.serial}${meta.group ? `\nGrupo: ${meta.group}` : ''}${meta.proxy ? `\nProxy: ${meta.proxy}` : ''}\nDoble clic para renombrar`;
  const tr = el.querySelector('.tr');
  tr.className = `chip tr ${d.transport}`;
  tr.textContent = d.transport === 'otg' ? 'OTG' : d.transport === 'wifi' ? 'Wi-Fi' : 'USB';
  const run = runningOn(d.serial);
  const badge = el.querySelector('.run-badge');
  badge.classList.toggle('hidden', !run);
  badge.textContent = run;
  el.querySelector('.info').innerHTML = meta.proxy
    ? `<span class="px" title="Proxy asignado: ${esc(meta.proxy)}">${icon('shield', 11)}<span class="t">${esc(meta.proxy)}</span></span>`
    : `<span class="t">${esc(meta.group || d.model || '')}</span>`;
  const bat = el.querySelector('.bat');
  bat.innerHTML = hl.battery != null
    ? `<span class="${hl.battery < 20 ? 'low' : ''}" title="${hl.temperature != null ? `${hl.temperature} °C` : ''}">${icon(hl.charging ? 'bolt' : 'battery', 11)}${hl.battery}%</span>`
    : '';
  const msg = el.querySelector('.msg');
  if (d.state === 'unauthorized') msg.textContent = 'Acepta "Permitir depuración USB" en el teléfono';
  else if (d.state === 'offline') msg.textContent = 'Sin conexión. Reconecta el cable o reinicia ADB.';
  else if (d.state !== 'device') msg.textContent = `Estado: ${d.state}`;
  else if (!el.querySelector('img').src) msg.textContent = $('#liveView').checked ? 'Cargando…' : 'Vista en vivo desactivada';
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
  $('#adbHint').textContent = state.adbVersion ? `${state.adbVersion} · ${state.adbPath}` : 'ADB no está instalado: puedes descargarlo en Ajustes.';
  const groups = [...new Set(Object.values(state.deviceMeta).map((m) => m.group).filter(Boolean))].sort();
  const gf = $('#devGroupFilter');
  const cur = gf.value;
  gf.innerHTML = `<option value="">Todos los grupos</option>${groups.map((g) => `<option ${g === cur ? 'selected' : ''}>${esc(g)}</option>`).join('')}`;
  const ready = state.devices.filter((d) => d.state === 'device').length;
  const byTr = (t) => state.devices.filter((d) => d.transport === t).length;
  $('#devSummary').textContent = state.devices.length
    ? `${ready} de ${state.devices.length} listos · ${byTr('usb')} USB · ${byTr('wifi')} Wi-Fi${byTr('otg') ? ` · ${byTr('otg')} OTG` : ''}`
    : 'Sin dispositivos';
  updateSelection(false);
}

function updateSelection(rerender = true) {
  const n = selectedSerials().length;
  $('#selCount').textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
  const wfLabel = $('#wfRun span');
  if (wfLabel) wfLabel.textContent = n ? `Ejecutar en ${n}` : 'Ejecutar en todos';
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

/**
 * Toques sobre una pantalla. Con onDouble, el toque simple se retrasa un instante para poder
 * distinguir el doble clic (que abre la vista grande) y no enviar dos toques al teléfono.
 */
function bindTouch(screen, serial, { onDouble, live = () => refreshShot(serial, true) } = {}) {
  let start = null;
  let pendingTap = null;
  const pos = (e) => {
    const img = screen.querySelector('img');
    const r = screen.getBoundingClientRect();
    // La imagen usa object-fit: contain, así que se calcula el área real que ocupa.
    const iw = img.naturalWidth || 9; const ih = img.naturalHeight || 19.5;
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

// ---------- Vista grande de un dispositivo ----------
export async function openDetails(serial) {
  let timer;
  const b = (id, ic, label, cls = '') => `<button id="${id}" class="${cls}">${icon(ic, 15)}${label}</button>`;
  const k = (code, ic, label) => `<button data-k="${code}">${icon(ic, 15)}${label}</button>`;
  const meta = state.deviceMeta[serial] || {};
  const proxyOpts = ['<option value="">Sin proxy</option>', ...state.proxies.map((p) =>
    `<option value="${esc(p.key)}" ${p.key === meta.proxy ? 'selected' : ''}>${esc(p.key)}${p.status === 'error' ? ' (falla)' : ''}</option>`)].join('');
  const html = `<div class="big-device">
    <div class="screen"><img alt="" /><div class="msg">Cargando…</div></div>
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
    const screen = el.querySelector('.screen');
    let refresh;
    bindTouch(screen, serial, { live: () => { clearTimeout(timer); refresh(); } });
    refresh = async () => {
      try {
        const shot = await api.call('screenshot', serial, 900);
        screen.querySelector('img').src = shot.data;
        screen.querySelector('.msg').textContent = '';
      } catch {}
      if (el.isConnected) timer = setTimeout(refresh, 800);
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
    $m('#dProxyClear').onclick = async () => { await call('setProxy', [serial], ''); toast('Proxy quitado del teléfono (la asignación se mantiene)'); };
    $m('#dMirror').onclick = () => call('scrcpy', serial);
    $m('#dMirrorView').onclick = () => call('scrcpy', serial, { noControl: true });
    $m('#dRecord').onclick = () => { call('scrcpy', serial, { record: true }); toast('Grabando. Cierra la ventana de scrcpy para terminar; el vídeo se guarda en Imágenes/Granja.'); };
    $m('#dWifi').onclick = async () => showResults('USB a Wi-Fi', await call('usbToWifi', [serial]));
    $m('#dReboot').onclick = () => call('reboot', [serial]);
    $m('#dRecovery').onclick = () => call('reboot', [serial], 'recovery');
    const pkg = () => $m('#dApps').value;
    $m('#dOpen').onclick = () => call('shellCmd', [serial], `monkey -p ${pkg()} -c android.intent.category.LAUNCHER 1`);
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

  $('#devSearch').oninput = () => renderDevices();
  $('#devGroupFilter').onchange = () => renderDevices();
  $('#btnSelectAll').onclick = () => { filtered().filter((d) => d.state === 'device').forEach((d) => state.selected.add(d.serial)); updateSelection(); };
  $('#btnSelectNone').onclick = () => { state.selected.clear(); updateSelection(); };
  $('#btnConnect').onclick = openConnect;
  $('#liveView').onchange = () => renderDevices();
  const applySize = () => document.documentElement.style.setProperty('--thumb', `${$('#thumbSize').value}px`);
  $('#thumbSize').oninput = applySize;
  try { $('#thumbSize').value = localStorage.getItem('thumb2') || 120; } catch {}
  $('#thumbSize').onchange = () => { try { localStorage.setItem('thumb2', $('#thumbSize').value); } catch {} };
  applySize();
  $$('.actionbar [data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act]()));

  // Arrastrar y soltar: los APK se instalan y el resto se envía a /sdcard/Download.
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
    if (apks.length) { toast(`Instalando ${apks.length} APK`); showResults('Instalar APK', await call('installApks', sel, apks)); }
    if (others.length) showResults('Enviar archivos', await call('pushFiles', sel, others, '/sdcard/Download/'));
  });

  startLiveLoop();
}
