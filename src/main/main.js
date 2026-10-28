import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AdbExe } from './adb/exe.js';
import { UsbDirectBackend } from './adb/usbDirect.js';
import { DeviceManager } from './devices.js';
import { Engine } from './automation/engine.js';
import { Store, DEFAULT_SETTINGS } from './store.js';
import { Notifier } from './notifier.js';
import { Scheduler } from './scheduler.js';
import { ApiServer } from './api.js';
import { Tools } from './tools.js';
import { parseCsv, toCsv } from './csv.js';
import { ProxyManager, parseProxyLine } from './proxies.js';
import { LicenseManager } from './licensing/license.js';
import { ScreenStreamer } from './stream.js';
import Anthropic from '@anthropic-ai/sdk';
import { AiTestRun, AI_MODEL, reportHtml, makeProvider } from './ai/tester.js';
import { GEMINI_MODEL, listGeminiModels, providerErrorText } from './ai/providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) app.quit();
// La interfaz está en español: fechas, horas y campos de hora siguen ese formato sea cual sea el idioma del sistema.
app.commandLine.appendSwitch('lang', 'es-ES');

const userData = app.getPath('userData');
migrateFromOldName(userData);
const store = new Store(userData);

/**
 * La app se llamaba "Granja Farm Manager" y Windows guardaba sus datos en otra carpeta. La primera vez
 * que se abre Nexus Farmer se copian flujos, ajustes, proxys, la clave ADB del motor OTG y las herramientas.
 */
function migrateFromOldName(dir) {
  const oldDir = path.join(app.getPath('appData'), 'Granja Farm Manager');
  if (fs.existsSync(path.join(dir, 'granja-data.json')) || !fs.existsSync(path.join(oldDir, 'granja-data.json'))) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['granja-data.json', 'granja_adbkey.pk8', 'tools']) {
      const from = path.join(oldDir, name);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), { recursive: true });
    }
    // Las rutas a adb/scrcpy descargados apuntaban a la carpeta antigua.
    const file = path.join(dir, 'granja-data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['adbPath', 'scrcpyPath']) {
      if (data.settings?.[key]?.startsWith(oldDir)) data.settings[key] = dir + data.settings[key].slice(oldDir.length);
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('No se pudieron migrar los datos de Granja Farm Manager:', e);
  }
}
const tools = new Tools(path.join(userData, 'tools'));
const settings = () => store.get('settings');
const adbPath = () => settings().adbPath || tools.localAdb() || 'adb';
const adb = new AdbExe(adbPath);
const usb = new UsbDirectBackend(userData);
const devices = new DeviceManager({ adb, usb, getSettings: settings });
const notifier = new Notifier(settings);
const screenshotsDir = path.join(app.getPath('pictures'), 'Nexus Farmer');
const proxies = new ProxyManager({ store, devices });
const engine = new Engine({ devices, store, notifier, screenshotsDir, proxies });
const scheduler = new Scheduler({ store, engine, devices, onEvent: (m) => toast(m) });
const api = new ApiServer({ store, devices, engine, proxies });
const health = {}; // serial -> details

// Licencia. Solo en desarrollo (app sin empaquetar) se pueden usar otra clave pública y otro servidor
// mediante variables de entorno, para pruebas; en el .exe siempre se usan las de licensing/config.js.
const devOverride = !app.isPackaged ? {
  ...(process.env.NEXUS_LICENSE_PUBLIC_KEY ? { publicKey: process.env.NEXUS_LICENSE_PUBLIC_KEY } : {}),
  ...(process.env.NEXUS_LICENSE_SERVER ? { serverUrl: process.env.NEXUS_LICENSE_SERVER } : {}),
} : {};
const license = new LicenseManager({ dir: userData, appVersion: app.getVersion(), ...devOverride });
let servicesRunning = false;
const alerted = new Set();

let win;
const emit = (type, payload) => win?.webContents.send('event', { type, payload });
const toast = (message, level = 'info') => emit('toast', { message, level });

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0f1117',
    title: 'Nexus Farmer',
    icon: path.join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

// ---------- Monitor de salud y alertas ----------
async function healthTick() {
  const s = settings();
  for (const d of devices.ready()) {
    try {
      const info = await d.details();
      health[d.serial] = { ...info, updatedAt: Date.now() };
      const name = store.get('deviceMeta')[d.serial]?.name || d.serial;
      const key = (k) => `${d.serial}:${k}`;
      if (info.battery != null && info.battery < s.alertBatteryBelow && !info.charging) {
        if (!alerted.has(key('bat'))) { alerted.add(key('bat')); alert(`${name}: batería al ${info.battery}%`); }
      } else alerted.delete(key('bat'));
      if (info.temperature != null && info.temperature > s.alertTempAbove) {
        if (!alerted.has(key('temp'))) { alerted.add(key('temp')); alert(`${name}: temperatura ${info.temperature} °C`); }
      } else alerted.delete(key('temp'));
    } catch {}
  }
  emit('health', health);
}

function alert(message) {
  toast(message, 'warn');
  notifier.send(message).catch(() => {});
}

// Pruebas con IA en curso y las claves de Claude y Gemini (cifradas; si no hay, las de las variables de entorno).
const aiRuns = new Map();
const AI_KEY_STORE = { claude: 'aiKey', gemini: 'geminiKey' };
const AI_KEY_ENV = { claude: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };
const aiStoredKey = (provider = 'claude') => {
  const k = store.get(AI_KEY_STORE[provider]);
  if (!k) return '';
  try { return k.enc ? safeStorage.decryptString(Buffer.from(k.enc, 'base64')) : k.plain || ''; } catch { return ''; }
};
const aiKey = (provider = 'claude') => aiStoredKey(provider) || process.env[AI_KEY_ENV[provider]] || '';
const aiProvider = () => (store.get('aiProvider') === 'gemini' ? 'gemini' : 'claude');

// Vídeo en tiempo real: los paquetes H.264 van por un canal propio (sin pasar por el de eventos).
const streamer = new ScreenStreamer({ adb });
streamer.on('packet', (serial, p) => win?.webContents.send('stream', { serial, config: p.config, key: p.key, pts: p.pts, data: p.data }));
streamer.on('meta', (serial, meta) => emit('streamMeta', { serial, ...meta }));
streamer.on('state', (serial, stateName, message) => emit('streamState', { serial, state: stateName, message: message || '' }));

devices.on('changed', (list) => emit('devices', list));
devices.on('connected', (serial) => {
  // Al conectar un teléfono con proxy asignado se le vuelve a aplicar (tras un reinicio se pierde a veces).
  // Con usuario y clave siempre: el teléfono apunta al puente de la app y sin "adb reverse" no tendría internet.
  if (!proxies.assignments()[serial] || (!settings().autoApplyProxy && !proxies.usesRelay(serial))) return;
  setTimeout(() => proxies.apply(serial).catch(() => {}), 3000);
});
devices.on('disconnected', (serial) => {
  delete health[serial];
  streamer.stop(serial);
  if (settings().alertOnDisconnect) {
    const name = store.get('deviceMeta')[serial]?.name || serial;
    alert(`${name} se desconectó`);
  }
});
engine.on('runs', (runs) => emit('runs', runs));
engine.on('log', (entry) => emit('log', entry));

// ---------- Utilidades ----------
async function forEachSerial(serials, fn) {
  const results = await Promise.all(serials.map(async (s) => {
    try { return { serial: s, ok: true, out: String((await fn(devices.get(s), s)) ?? '').trim() }; } catch (e) { return { serial: s, ok: false, out: e.message }; }
  }));
  return results;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

async function pctToPx(d, xp, yp) {
  const size = await d.getScreenSize();
  return [Math.round(xp * size.width), Math.round(yp * size.height)];
}

// ---------- API para el renderer ----------
const handlers = {
  getState: async () => {
    let adbVersion = null;
    try { adbVersion = await adb.version(); } catch {}
    return {
      devices: devices.list(), settings: settings(), defaults: DEFAULT_SETTINGS, workflows: store.get('workflows'), proxies: proxies.list(),
      schedules: store.get('schedules'), deviceMeta: store.get('deviceMeta'), tables: store.get('tables').map(({ rows, ...t }) => ({ ...t, count: rows.length })),
      runs: engine.listRuns(), adbVersion, adbPath: adbPath(), lastError: devices.lastError, api: api.status(), health,
      scrcpy: settings().scrcpyPath || tools.localScrcpy(), screenshotsDir, version: app.getVersion(),
    };
  },

  // Dispositivos
  refreshDevices: () => devices.refresh(),
  restartAdb: async () => { await adb.killServer(); await adb.startServer(); await devices.refresh(); },
  screenshot: async (serial, width = 360, quality = 72) => {
    const png = await devices.get(serial).screencapPng();
    const img = nativeImage.createFromBuffer(png);
    // Una captura cortada (cable flojo, teléfono ocupado) no se puede decodificar: se descarta.
    if (img.isEmpty()) throw new Error('Captura de pantalla incompleta');
    const size = img.getSize();
    const out = width && size.width > width ? img.resize({ width, quality: 'good' }) : img;
    return { data: `data:image/jpeg;base64,${out.toJPEG(Math.min(95, Math.max(20, Number(quality) || 72))).toString('base64')}`, width: size.width, height: size.height };
  },
  // Inspector: captura + elementos de la pantalla (uiautomator) para construir flujos.
  inspect: async (serial) => {
    const { dumpUiXml, parseUiDump, addXpaths } = await import('./automation/actions.js');
    const d = devices.get(serial);
    const [shot, xml, size] = await Promise.all([handlers.screenshot(serial, 720, 85), dumpUiXml(d), d.getScreenSize()]);
    return { shot, xml, nodes: addXpaths(parseUiDump(xml)), size };
  },
  // Guarda el volcado de la pantalla (XML de uiautomator) para poder revisar sus XPath fuera de la app.
  saveUiXml: (serial, xml) => {
    const name = (store.get('deviceMeta')[serial]?.name || serial).replace(/[^\w.-]+/g, '_');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const file = path.join(screenshotsDir, `${name}_pantalla_${Date.now()}.xml`);
    fs.writeFileSync(file, String(xml));
    shell.showItemInFolder(file);
    return file;
  },
  // El vídeo en tiempo real necesita adb.exe (el motor USB directo sigue con capturas).
  streamStart: (serial, opts) => {
    const d = devices.get(serial);
    if (!d || d.backend || d.state !== 'device') return false;
    streamer.start(serial, opts);
    return true;
  },
  streamStop: (serial) => streamer.stop(serial),
  openApp: (serials, pkg) => forEachSerial(serials, async (d) => {
    const { launchApp } = await import('./automation/actions.js');
    return launchApp(d, pkg);
  }),
  saveScreenshot: async (serial) => {
    const name = (store.get('deviceMeta')[serial]?.name || serial).replace(/[^\w.-]+/g, '_');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const file = path.join(screenshotsDir, `${name}_${Date.now()}.png`);
    fs.writeFileSync(file, await devices.get(serial).screencapPng());
    return file;
  },
  details: async (serial) => (health[serial] = { ...(await devices.get(serial).details()), updatedAt: Date.now() }),
  tap: (serials, xp, yp) => forEachSerial(serials, async (d) => d.shell(`input tap ${(await pctToPx(d, xp, yp)).join(' ')}`)),
  swipe: (serials, x1, y1, x2, y2, ms = 300) => forEachSerial(serials, async (d) => {
    const a = await pctToPx(d, x1, y1); const b = await pctToPx(d, x2, y2);
    return d.shell(`input swipe ${a.join(' ')} ${b.join(' ')} ${ms}`);
  }),
  key: (serials, code) => forEachSerial(serials, (d) => d.shell(`input keyevent ${code}`)),
  text: async (serials, text) => {
    const { typeText } = await import('./automation/actions.js');
    return forEachSerial(serials, (d) => typeText(d, text, false));
  },
  shellCmd: (serials, cmd) => forEachSerial(serials, (d) => d.shell(cmd, { timeout: 60000 })),
  installApks: (serials, files) => forEachSerial(serials, async (d) => {
    const outs = [];
    for (const f of files) outs.push(`${path.basename(f)}: ${String(await d.install(f)).trim().split('\n').pop()}`);
    return outs.join('\n');
  }),
  pushFiles: (serials, files, remote = '/sdcard/Download/') => forEachSerial(serials, async (d) => {
    for (const f of files) {
      await d.push(f, remote.endsWith('/') ? remote : `${remote}/`);
      await d.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${remote.replace(/\/?$/, '/')}${path.basename(f)}'`).catch(() => {});
    }
    return `${files.length} archivo(s) enviados`;
  }),
  openUrl: (serials, url) => forEachSerial(serials, (d) => d.shell(`am start -a android.intent.action.VIEW -d '${url.replace(/'/g, '')}'`)),
  reboot: (serials, mode) => forEachSerial(serials, (d) => d.reboot(mode)),
  setProxy: (serials, proxy) => forEachSerial(serials, async (d) => {
    const p = proxy ? parseProxyLine(proxy) : null;
    if (proxy && !p) throw new Error(`Proxy no válido: ${proxy}`);
    return p ? proxies.applyProxy(d.serial, p) : proxies.clearOnDevice(d.serial);
  }),
  // ---------- Pruebas de apps con IA (Claude o Gemini) ----------
  aiKeyStatus: () => {
    const info = (p) => ({ configured: !!aiKey(p), fromEnv: !aiStoredKey(p) && !!process.env[AI_KEY_ENV[p]] });
    const provider = aiProvider();
    const geminiModel = store.get('geminiModel') || GEMINI_MODEL;
    return { provider, configured: !!aiKey(provider), claude: info('claude'), gemini: info('gemini'), geminiModel,
      model: provider === 'gemini' ? geminiModel : AI_MODEL };
  },
  /** Guarda la clave de un proveedor ('claude' o 'gemini'); vacía la borra. */
  aiSetKey: (key, provider = 'claude') => {
    if (!AI_KEY_STORE[provider]) throw new Error('Proveedor de IA desconocido');
    key = String(key || '').trim();
    if (!key) store.set(AI_KEY_STORE[provider], null);
    // La clave se guarda cifrada con el almacén seguro del sistema (DPAPI en Windows).
    else store.set(AI_KEY_STORE[provider], safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(key).toString('base64') } : { plain: key });
    return handlers.aiKeyStatus();
  },
  aiSetProvider: ({ provider, geminiModel } = {}) => {
    if (provider) store.set('aiProvider', provider === 'gemini' ? 'gemini' : 'claude');
    if (geminiModel !== undefined) store.set('geminiModel', /^[\w.-]+$/.test(geminiModel) ? geminiModel : null);
    return handlers.aiKeyStatus();
  },
  /** Modelos de Gemini disponibles para la clave guardada (o la que se está probando). */
  aiGeminiModels: async (key) => {
    const k = String(key || '').trim() || aiKey('gemini');
    if (!k) throw new Error('Pon primero la clave de Gemini');
    try { return await listGeminiModels(k); } catch (e) { throw new Error(providerErrorText(e)); }
  },
  aiTestStart: ({ serials, pkg, goal, maxSteps = 30, clearData = false, effort = 'medium', provider = aiProvider() }) => {
    provider = provider === 'gemini' ? 'gemini' : 'claude';
    const key = aiKey(provider);
    if (!key) throw new Error(`Configura primero la clave de ${provider === 'gemini' ? 'Gemini' : 'Claude'} (botón "Proveedor de IA")`);
    if (!/^[A-Za-z][\w]*(\.[A-Za-z0-9_]+)+$/.test(String(pkg || ''))) throw new Error('Elige la app (paquete) que quieres probar');
    if (!String(goal || '').trim()) throw new Error('Describe qué debe probar la IA');
    effort = ['low', 'medium', 'high'].includes(effort) ? effort : 'medium';
    const client = provider === 'claude' ? new Anthropic({ apiKey: key }) : null;
    // Un proveedor por prueba: cada uno guarda su propia conversación.
    const newProvider = () => (provider === 'gemini'
      ? makeProvider('gemini', { apiKey: key, model: store.get('geminiModel') || GEMINI_MODEL })
      : makeProvider('claude', { client, effort }));
    const ids = [];
    for (const serial of serials) {
      const device = devices.get(serial);
      if (!device || device.state !== 'device') continue;
      const id = `ai${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const outDir = path.join(screenshotsDir, 'Pruebas IA', `${pkg.replace(/[^\w.-]+/g, '_')}_${id}`);
      const run = new AiTestRun({ id, serial, device, provider: newProvider(), pkg, goal, maxSteps: Math.min(100, Math.max(3, Number(maxSteps) || 30)), clearData, outDir, effort,
        screenshot: async (s) => { const shot = await handlers.screenshot(s, 720, 75); return { base64: shot.data.split(',')[1], width: shot.width, height: shot.height }; } });
      aiRuns.set(id, run);
      const send = (kind, payload) => emit('aiTest', { id, serial, kind, payload, report: kind === 'done' ? payload : undefined });
      run.on('log', (l) => send('log', l));
      run.on('step', (st) => send('step', st));
      run.on('bug', (b) => send('bug', b));
      run.on('done', (r) => {
        const list = [r, ...(store.get('aiTests') || []).filter((x) => x.id !== r.id)].slice(0, 50);
        store.set('aiTests', list);
        aiRuns.delete(id);
        send('done', r);
      });
      run.run();
      ids.push(id);
    }
    if (!ids.length) throw new Error('Selecciona al menos un teléfono conectado');
    return ids;
  },
  aiTestStop: (id) => aiRuns.get(id)?.stop(),
  aiTests: () => [...[...aiRuns.values()].map((r) => r.report()), ...(store.get('aiTests') || [])],
  aiTestShot: (file) => {
    // Solo capturas de las pruebas con IA.
    const root = path.join(screenshotsDir, 'Pruebas IA');
    const full = path.resolve(String(file || ''));
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(full).toString('base64')}`;
  },
  aiTestExport: async (id) => {
    const r = (store.get('aiTests') || []).find((x) => x.id === id) || aiRuns.get(id)?.report();
    if (!r) throw new Error('No se encontró la prueba');
    const res = await dialog.showSaveDialog(win, { defaultPath: `Prueba ${r.pkg} ${new Date(r.startedAt).toISOString().slice(0, 10)}.html`, filters: [{ name: 'Informe HTML', extensions: ['html'] }] });
    if (res.canceled) return null;
    fs.writeFileSync(res.filePath, reportHtml(r));
    shell.openPath(res.filePath);
    return res.filePath;
  },
  aiTestDelete: (id) => {
    store.set('aiTests', (store.get('aiTests') || []).filter((x) => x.id !== id));
    return true;
  },
  listPackages: async (serial) => (await devices.get(serial).shell('pm list packages -3')).split('\n').map((l) => l.replace('package:', '').trim()).filter(Boolean).sort(),
  connectWifi: (addr) => devices.connectWifi(addr),
  pair: async (addr, code) => (await adb.pair(addr, code)).trim(),
  disconnect: (addr) => { devices.forgetWifi(addr); return adb.disconnect(addr); },
  usbToWifi: (serials) => forEachSerial(serials, (d) => devices.usbToWifi(d.serial)),
  // Modo OTG/red (como GenFarmer): abrir el puerto en los USB y escanear rangos de IP guardados.
  otgActivate: (port = 5555, serials) => devices.activatePort(Number(port) || 5555, serials),
  otgScan: (from, to, port = 5555) => devices.scanRange(from, to, Number(port) || 5555, (done, total) => emit('progress', { label: `Escaneando ${from} – ${to}`, pct: Math.round((done / total) * 100) })),
  otgNetworks: () => store.get('otgNetworks') || [],
  otgSaveNetwork: (net) => {
    const list = (store.get('otgNetworks') || []).filter((n) => !(n.from === net.from && n.to === net.to && n.port === net.port));
    list.push({ from: net.from, to: net.to, port: Number(net.port) || 5555 });
    store.set('otgNetworks', list);
    return list;
  },
  otgDeleteNetwork: (i) => {
    const list = store.get('otgNetworks') || [];
    list.splice(i, 1);
    store.set('otgNetworks', list);
    return list;
  },
  scanNetwork: (port = 5555) => devices.scanNetwork(port, (done, total) => emit('progress', { label: 'Escaneando red', pct: Math.round((done / total) * 100) })),
  scrcpy: (serial, opts = {}) => {
    const exe = settings().scrcpyPath || tools.localScrcpy();
    if (!exe) throw new Error('scrcpy no está instalado. Descárgalo en Ajustes.');
    const name = store.get('deviceMeta')[serial]?.name || serial;
    const args = ['-s', serial, '--window-title', name, '--max-size', String(opts.maxSize || 1024), '--stay-awake'];
    if (opts.record) args.push('--record', path.join(screenshotsDir, `${name.replace(/[^\w.-]+/g, '_')}_${Date.now()}.mp4`));
    if (opts.noControl) args.push('--no-control');
    fs.mkdirSync(screenshotsDir, { recursive: true });
    const child = spawn(exe, args, { env: { ...process.env, ADB: adbPath() }, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return true;
  },
  setMeta: (serial, meta) => {
    const all = store.get('deviceMeta');
    all[serial] = { ...(all[serial] || {}), ...meta };
    store.set('deviceMeta', all);
    return all;
  },
  batchMeta: (serials, { namePattern, group, startAt = 1 }) => {
    const all = store.get('deviceMeta');
    serials.forEach((s, i) => {
      const m = { ...(all[s] || {}) };
      if (namePattern) m.name = namePattern.replace(/#+/g, (h) => String(i + Number(startAt)).padStart(h.length, '0'));
      if (group != null) m.group = group;
      all[s] = m;
    });
    store.set('deviceMeta', all);
    return all;
  },

  // Proxys
  proxiesSet: (text, append) => proxies.setList(text, { append }),
  proxiesRemove: (keys) => proxies.remove(keys),
  proxiesAssign: async (serials, opts = {}) => {
    const result = proxies.assign(serials, opts);
    if (opts.apply) await forEachSerial(serials, (d) => proxies.apply(d.serial));
    return result;
  },
  proxiesUnassign: async (serials, clearDevice) => {
    // Un teléfono que usa el puente (proxy con clave) se quedaría sin internet: se le quita siempre.
    const viaRelay = new Set(serials.filter((s) => proxies.usesRelay(s) || proxies.relay.port(s)));
    proxies.unassign(serials);
    const toClear = clearDevice ? serials : serials.filter((s) => viaRelay.has(s));
    if (toClear.length) await forEachSerial(toClear, (d) => proxies.clearOnDevice(d.serial));
    return store.get('deviceMeta');
  },
  proxySetOne: async (serial, key, apply) => {
    proxies.setAssignment(serial, key || null);
    if (apply) await proxies.apply(serial);
    return store.get('deviceMeta');
  },
  proxiesApply: (serials) => forEachSerial(serials, (d) => proxies.apply(d.serial)),
  proxiesTest: (keys) => proxies.test(keys, (done, total) => emit('progress', { label: 'Probando proxys', pct: Math.round((done / total) * 100) })),
  readDeviceProxy: async (serial) => (await devices.get(serial).shell('settings get global http_proxy')).trim(),

  // Flujos
  saveWorkflow: (wf) => {
    const list = store.get('workflows');
    if (!wf.id) wf.id = uid();
    wf.updatedAt = Date.now();
    const i = list.findIndex((w) => w.id === wf.id);
    if (i >= 0) list[i] = wf; else list.push(wf);
    store.set('workflows', list);
    return wf;
  },
  deleteWorkflow: (id) => store.set('workflows', store.get('workflows').filter((w) => w.id !== id)),
  runWorkflow: (id, serials, opts = {}) => {
    const wf = store.get('workflows').find((w) => w.id === id);
    if (!wf) throw new Error('Flujo no encontrado');
    const s = settings();
    return engine.start(wf, serials, { concurrency: opts.concurrency ?? s.runConcurrency, staggerMs: opts.staggerMs ?? s.runStaggerMs });
  },
  stopRun: (id) => engine.stop(id),
  stopAll: () => engine.stopAll(),
  exportWorkflow: async (id) => {
    const wf = store.get('workflows').find((w) => w.id === id);
    const res = await dialog.showSaveDialog(win, { defaultPath: `${wf.name}.nexus.json`, filters: [{ name: 'Flujo de Nexus Farmer', extensions: ['json'] }] });
    if (res.canceled) return false;
    fs.writeFileSync(res.filePath, JSON.stringify({ format: 'nexus-farmer-workflow', version: 1, ...wf, id: undefined }, null, 2));
    return true;
  },
  importWorkflow: async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Flujo de Nexus Farmer', extensions: ['json'] }] });
    if (res.canceled) return [];
    return res.filePaths.map((f) => {
      const wf = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!wf.graph) throw new Error(`${path.basename(f)} no es un flujo válido`);
      return handlers.saveWorkflow({ name: wf.name || path.basename(f), graph: wf.graph, description: wf.description || '' });
    });
  },

  // Programaciones
  saveSchedule: (sc) => {
    const list = store.get('schedules');
    if (!sc.id) sc.id = uid();
    const i = list.findIndex((x) => x.id === sc.id);
    if (i >= 0) list[i] = sc; else list.push(sc);
    store.set('schedules', list);
    return list;
  },
  deleteSchedule: (id) => { store.set('schedules', store.get('schedules').filter((x) => x.id !== id)); return store.get('schedules'); },

  // Tablas de datos
  importTable: async (name) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
    if (res.canceled) return null;
    const rows = parseCsv(fs.readFileSync(res.filePaths[0], 'utf8'));
    if (rows.length < 1) throw new Error('El CSV está vacío');
    const [columns, ...data] = rows;
    const tables = store.get('tables').filter((t) => t.name !== name);
    tables.push({ name: name || path.basename(res.filePaths[0], '.csv'), columns: columns.map((c) => c.trim()), rows: data });
    store.set('tables', tables);
    return true;
  },
  deleteTable: (name) => store.set('tables', store.get('tables').filter((t) => t.name !== name)),
  previewTable: (name) => {
    const t = store.get('tables').find((x) => x.name === name);
    return t ? { columns: t.columns, rows: t.rows.slice(0, 50), count: t.rows.length } : null;
  },

  // Historial
  getHistory: () => store.get('history'),
  exportHistory: async () => {
    const res = await dialog.showSaveDialog(win, { defaultPath: 'historial-nexus-farmer.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (res.canceled) return false;
    const rows = [['id', 'flujo', 'origen', 'inicio', 'fin', 'estado', 'ok', 'errores']];
    for (const h of store.get('history')) {
      const vals = Object.values(h.results || {});
      rows.push([h.id, h.workflow, h.source, new Date(h.startedAt).toISOString(), new Date(h.finishedAt).toISOString(), h.status,
        vals.filter((v) => v === 'ok').length, vals.filter((v) => v === 'error').length]);
    }
    fs.writeFileSync(res.filePath, toCsv(rows));
    return true;
  },

  // Ajustes y herramientas
  saveSettings: (s) => {
    store.set('settings', { ...settings(), ...s });
    api.restart();
    return settings();
  },
  pickFiles: async (opts = {}) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])], filters: opts.filters });
    return res.canceled ? [] : res.filePaths;
  },
  downloadAdb: async () => {
    await adb.killServer().catch(() => {});
    const p = await tools.installPlatformTools((pct) => emit('progress', { label: 'Descargando platform-tools', pct }));
    store.set('settings', { ...settings(), adbPath: p });
    await adb.startServer();
    return p;
  },
  downloadScrcpy: async () => {
    const p = await tools.installScrcpy((pct) => emit('progress', { label: 'Descargando scrcpy', pct }));
    store.set('settings', { ...settings(), scrcpyPath: p });
    return p;
  },
  testNotify: () => notifier.send('Prueba de notificación'),
  openFolder: (p) => shell.openPath(p || screenshotsDir),
  openExternal: (url) => shell.openExternal(url),
};

// Funciones disponibles sin licencia: solo las de la pantalla de activación.
const licenseHandlers = {
  licenseStatus: () => license.status(),
  licenseActivateOnline: (serial) => license.activateOnline(serial),
  licenseActivateOffline: (key) => license.activateOffline(key),
  licenseRevalidate: () => license.revalidate(),
  licenseDeactivate: () => license.deactivate(),
  openExternal: (url) => shell.openExternal(url),
};

ipcMain.handle('call', async (_e, method, args) => {
  if (licenseHandlers[method]) return licenseHandlers[method](...(args || []));
  const fn = handlers[method];
  if (!fn) throw new Error(`Método desconocido: ${method}`);
  if (!license.isActive()) throw new Error('Nexus Farmer no está activado');
  return fn(...(args || []));
});

let healthTimer;
async function startServices() {
  if (servicesRunning) return;
  servicesRunning = true;
  await adb.startServer();
  devices.start();
  scheduler.start();
  api.restart();
  healthTimer = setInterval(healthTick, 60000);
  setTimeout(healthTick, 5000);
}

function stopServices() {
  if (!servicesRunning) return;
  servicesRunning = false;
  engine.stopAll();
  streamer.stopAll();
  devices.stop();
  scheduler.stop();
  api.close();
  clearInterval(healthTimer);
}

license.on('changed', (st) => {
  emit('license', st);
  if (st.active) startServices(); else stopServices();
});

app.whenReady().then(async () => {
  createWindow();
  // Una licencia en línea se revalida al abrir (sin conexión sigue valiendo durante el periodo de gracia).
  await license.revalidate().catch(() => {});
  license.startAutoRevalidate();
  if (license.isActive()) await startServices();
  // Comprobación periódica de caducidad mientras la app está abierta.
  setInterval(() => {
    const st = license.status();
    if (!st.active && servicesRunning) { stopServices(); emit('license', st); }
  }, 10 * 60 * 1000);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  proxies.relay.stopAll().catch(() => {});
  for (const r of aiRuns.values()) r.stop();
  engine.stopAll();
  streamer.stopAll();
  devices.stop();
  scheduler.stop();
  api.close();
  usb.closeAll();
  store.flush();
});
