// Acciones de bajo nivel sobre un dispositivo: toques humanizados, texto, UI dump, etc.
import { shellQuote } from '../devices.js';

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Detenido'));
  const t = setTimeout(resolve, Math.max(0, ms));
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Detenido')); }, { once: true });
});

export const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

/** Reemplaza {var}, {rand:a-b}, {pick:x|y|z}, {timestamp} en un texto. */
export function renderTemplate(text, vars) {
  if (text == null) return '';
  return String(text).replace(/\{([^{}]+)\}/g, (whole, expr) => {
    expr = expr.trim();
    if (expr.startsWith('rand:')) {
      const [a, b] = expr.slice(5).split('-').map(Number);
      return Number.isFinite(a) && Number.isFinite(b) ? String(randInt(a, b)) : whole;
    }
    if (expr.startsWith('pick:')) {
      const opts = expr.slice(5).split('|');
      return opts[randInt(0, opts.length - 1)];
    }
    if (expr === 'timestamp') return String(Date.now());
    if (Object.prototype.hasOwnProperty.call(vars, expr)) return String(vars[expr]);
    return whole;
  });
}

/** Convierte "50%" o "540" a píxeles según el tamaño de pantalla. */
export function resolveCoord(value, total) {
  const v = String(value).trim();
  if (v.endsWith('%')) return Math.round((parseFloat(v) / 100) * total);
  const num = Number(v);
  if (!Number.isFinite(num)) throw new Error(`Coordenada inválida: ${value}`);
  return Math.round(num);
}

export async function resolvePoint(device, x, y) {
  const size = await device.getScreenSize();
  return [resolveCoord(x, size.width), resolveCoord(y, size.height)];
}

export async function tap(device, x, y, jitter = 0) {
  const j = () => (jitter ? randInt(-jitter, jitter) : 0);
  await device.shell(`input tap ${x + j()} ${y + j()}`);
}

/**
 * Deslizamiento. En modo humano varía ligeramente los extremos y la duración.
 * Se usa un único "input swipe": encadenar varios "input motionevent" tarda ~0,4 s por llamada en un
 * teléfono real, el gesto se vuelve lentísimo y Android lo interpreta como pulsación larga en vez de scroll.
 */
export async function swipe(device, x1, y1, x2, y2, ms, humanize) {
  if (humanize) {
    const size = await device.getScreenSize();
    const v = Math.round(Math.min(size.width, size.height) * 0.02);
    const clampX = (n) => Math.min(size.width - 1, Math.max(0, n));
    const clampY = (n) => Math.min(size.height - 1, Math.max(0, n));
    x1 = clampX(x1 + randInt(-v, v)); y1 = clampY(y1 + randInt(-v, v));
    x2 = clampX(x2 + randInt(-v, v)); y2 = clampY(y2 + randInt(-v, v));
    ms = Math.round(ms * (0.8 + Math.random() * 0.5));
  }
  await device.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${Math.max(50, ms)}`);
}

/**
 * Prepara texto para "input text". El texto va entre comillas simples (shellQuote), así que no hay
 * que escapar nada más: una barra invertida se escribiría literalmente en el teléfono.
 * Android convierte "%s" en espacio, por eso los espacios se envían así.
 */
export function escapeInputText(text) {
  return String(text).replace(/ /g, '%s');
}

export async function typeText(device, text, humanize, signal) {
  const ascii = /^[\x20-\x7e]*$/.test(text);
  if (!ascii) {
    // Texto con acentos/emojis: requiere ADBKeyBoard instalado y activo.
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    const out = await device.shell(`am broadcast -a ADB_INPUT_B64 --es msg ${b64}`);
    if (/result=0/.test(out) || /Broadcast completed/.test(out)) return;
    throw new Error('Para escribir texto no ASCII instala y activa ADBKeyBoard en el dispositivo');
  }
  if (!humanize) {
    await device.shell(`input text ${shellQuote(escapeInputText(text))}`);
    return;
  }
  for (const ch of text) {
    await device.shell(`input text ${shellQuote(escapeInputText(ch))}`);
    await sleep(randInt(60, 220), signal);
  }
}

// ---------- UI (uiautomator) ----------

const decodeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');

export function parseUiDump(xml) {
  const nodes = [];
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = decodeXml(v); });
    const b = (attrs.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({
      text: attrs.text || '', desc: attrs['content-desc'] || '', id: attrs['resource-id'] || '',
      cls: attrs.class || '', clickable: attrs.clickable === 'true',
      bounds: [x1, y1, x2, y2], cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2),
    });
  }
  return nodes;
}

/**
 * Lee los elementos de la pantalla. uiautomator falla a menudo mientras hay animaciones
 * ("could not get idle state"), así que se reintenta antes de dar error: devolver una lista vacía
 * haría que "Tocar texto" siguiera por "no encontrado" sin avisar del problema real.
 */
export async function dumpUi(device, signal) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await device.shell('rm -f /sdcard/granja_ui.xml; uiautomator dump /sdcard/granja_ui.xml 2>&1; cat /sdcard/granja_ui.xml 2>/dev/null', { timeout: 25000 });
    if (out.includes('<hierarchy')) return parseUiDump(out.slice(out.indexOf('<?xml') >= 0 ? out.indexOf('<?xml') : out.indexOf('<hierarchy')));
    last = out.trim().split('\n')[0];
    await sleep(600, signal);
  }
  throw new Error(`No se pudieron leer los elementos de la pantalla (uiautomator): ${last || 'sin respuesta'}`);
}

export function findNode(nodes, { text, exact, id }) {
  if (id) return nodes.find((n) => n.id === id || n.id.endsWith(`:id/${id}`));
  const needle = String(text).toLowerCase();
  const match = (s) => (exact ? s.toLowerCase() === needle : s.toLowerCase().includes(needle));
  return nodes.find((n) => n.text && match(n.text)) || nodes.find((n) => n.desc && match(n.desc));
}

/** Espera hasta que aparezca un elemento o venza el tiempo. */
export async function waitForNode(device, query, timeout, signal) {
  const end = Date.now() + Math.max(0, timeout);
  do {
    const node = findNode(await dumpUi(device, signal), query);
    if (node) return node;
    if (Date.now() >= end) break;
    await sleep(700, signal);
  } while (Date.now() < end);
  return null;
}

/** Estado de la pantalla: si está apagada y si hay pantalla de bloqueo. */
export async function screenState(device) {
  const out = await device.shell(
    "dumpsys power | grep -E 'mWakefulness=|Display Power: state='; dumpsys window | grep -i -E 'mDreamingLockscreen=true|mShowingLockscreen=true|isStatusBarKeyguard=true|mKeyguardShowing=true|keyguardShowing=true'",
  );
  return {
    asleep: /mWakefulness=(Asleep|Dozing)|Display Power: state=OFF/i.test(out),
    locked: /(Lockscreen|Keyguard|keyguardShowing)\w*=true/i.test(out),
  };
}

export async function foregroundPackage(device) {
  const out = await device.shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'");
  const m = out.match(/([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+/);
  return m ? m[1] : '';
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
