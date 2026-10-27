// Acciones de bajo nivel sobre un dispositivo: toques humanizados, texto, UI dump, etc.
import { shellQuote } from '../devices.js';
import { queryXpath, bestXpath, absoluteXpath } from './xpath.js';

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

/**
 * Elementos de la pantalla con su árbol: cada uno lleva sus atributos tal cual (attrs), su posición
 * y el índice de su padre y de sus hijos (para el XPath).
 */
export function parseUiDump(xml) {
  const nodes = [];
  const stack = [];
  const re = /<node\b([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</node>') { stack.pop(); continue; }
    const attrs = {};
    m[1].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = decodeXml(v); });
    const b = (attrs.bounds || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    const [x1, y1, x2, y2] = b ? b.slice(1).map(Number) : [0, 0, 0, 0];
    const parent = stack.length ? stack[stack.length - 1] : null;
    const node = {
      index: nodes.length, parent, children: [], attrs,
      text: attrs.text || '', desc: attrs['content-desc'] || '', id: attrs['resource-id'] || '',
      cls: attrs.class || '', clickable: attrs.clickable === 'true',
      bounds: [x1, y1, x2, y2], cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2),
    };
    nodes.push(node);
    if (parent != null) nodes[parent].children.push(node.index);
    if (!m[2]) stack.push(node.index);
  }
  return nodes;
}

/** Añade a cada elemento su XPath corto y su XPath absoluto (para el inspector). */
export function addXpaths(nodes) {
  for (const n of nodes) {
    n.xpath = bestXpath(nodes, n);
    n.xpathAbs = absoluteXpath(nodes, n);
  }
  return nodes;
}

/**
 * Lee los elementos de la pantalla. uiautomator falla a menudo mientras hay animaciones
 * ("could not get idle state"), así que se reintenta antes de dar error: devolver una lista vacía
 * haría que "Tocar texto" siguiera por "no encontrado" sin avisar del problema real.
 */
export async function dumpUiXml(device, signal) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await device.shell('rm -f /sdcard/granja_ui.xml; uiautomator dump /sdcard/granja_ui.xml 2>&1; cat /sdcard/granja_ui.xml 2>/dev/null', { timeout: 25000 });
    if (out.includes('<hierarchy')) return out.slice(out.indexOf('<?xml') >= 0 ? out.indexOf('<?xml') : out.indexOf('<hierarchy'));
    last = out.trim().split('\n')[0];
    await sleep(600, signal);
  }
  throw new Error(`No se pudieron leer los elementos de la pantalla (uiautomator): ${last || 'sin respuesta'}`);
}

export async function dumpUi(device, signal) {
  return parseUiDump(await dumpUiXml(device, signal));
}

export function findNode(nodes, { text, exact, id, xpath, vars }) {
  if (xpath) return queryXpath(nodes, xpath, vars)[0];
  if (id) return nodes.find((n) => n.id === id || n.id.endsWith(`:id/${id}`));
  const needle = String(text).toLowerCase();
  const match = (s) => (exact ? s.toLowerCase() === needle : s.toLowerCase().includes(needle));
  return nodes.find((n) => n.text && match(n.text)) || nodes.find((n) => n.desc && match(n.desc));
}

/** Espera hasta que aparezca un elemento o venza el tiempo. */
export async function waitForNode(device, query, timeout, signal) {
  const end = Date.now() + Math.max(0, timeout);
  let readOk = false;
  let lastError;
  do {
    let nodes;
    try {
      nodes = await dumpUi(device, signal);
      readOk = true;
    } catch (e) {
      // Con vídeo o animaciones uiautomator falla a ratos: se sigue intentando hasta que venza el tiempo.
      if (signal?.aborted) throw e;
      lastError = e;
    }
    const node = nodes && findNode(nodes, query);
    if (node) return node;
    if (Date.now() >= end) break;
    await sleep(700, signal);
  } while (Date.now() < end);
  // Si no se pudo leer la pantalla ni una vez, es un problema real y se avisa en vez de decir "no encontrado".
  if (!readOk && lastError) throw lastError;
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

/**
 * Abre una app como lo haría el launcher: busca su actividad de inicio y la lanza con "am start".
 * No se usa "monkey": en varias capas de Android (MIUI, One UI…) se queda colgado mientras el teléfono
 * sigue conectado y la app no se abre hasta que se corta la conexión.
 */
export async function launchApp(device, pkg) {
  const name = String(pkg || '').trim();
  if (!/^[A-Za-z][\w]*(\.[A-Za-z0-9_]+)+$/.test(name)) throw new Error(`Paquete no válido: "${name}"`);
  const resolved = await device.shell(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${name} 2>/dev/null`, { timeout: 10000 }).catch(() => '');
  const component = resolved.trim().split('\n').pop().trim();
  if (/^[\w.]+\/[\w.$]+$/.test(component)) {
    // NEW_TASK | RESET_TASK_IF_NEEDED: si la app ya estaba abierta, la trae al frente como el icono.
    const out = await device.shell(`am start -n ${component} -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -f 0x10200000`, { timeout: 15000 });
    if (/Error:|Exception/.test(out)) throw new Error(`No se pudo abrir ${name}: ${out.trim().split('\n').pop()}`);
    return component;
  }
  const installed = await device.shell(`pm path ${name}`, { timeout: 10000 }).catch(() => '');
  if (!installed.includes('package:')) throw new Error(`La app ${name} no está instalada`);
  // Android antiguos sin "cmd package resolve-activity" (6 o anterior).
  const out = await device.shell(`monkey -p ${name} -c android.intent.category.LAUNCHER 1 2>&1`, { timeout: 15000 });
  if (/No activities found|monkey aborted/i.test(out)) throw new Error(`La app ${name} no tiene pantalla de inicio que abrir`);
  return name;
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
