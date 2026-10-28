// Lista de proxys y asignación de un proxy por teléfono.
import { ProxyRelay, openTunnel } from './proxyRelay.js';

/** Android solo sabe usar proxys HTTP sin clave: los demás pasan por el puente de la app. */
export const needsRelay = (p) => !!p.user || /^socks/.test(p.scheme);

/** Acepta host:puerto, host:puerto:usuario:clave, usuario:clave@host:puerto y http://usuario:clave@host:puerto */
export function parseProxyLine(line) {
  let s = String(line).trim();
  if (!s || s.startsWith('#')) return null;
  let scheme = 'http';
  const sm = s.match(/^(\w+):\/\//);
  if (sm) { scheme = sm[1].toLowerCase(); s = s.slice(sm[0].length); }
  let user = '';
  let pass = '';
  let host;
  let port;
  const at = s.lastIndexOf('@');
  if (at >= 0) {
    const cred = s.slice(0, at);
    const i = cred.indexOf(':');
    user = i >= 0 ? cred.slice(0, i) : cred;
    pass = i >= 0 ? cred.slice(i + 1) : '';
    [host, port] = s.slice(at + 1).split(':');
  } else {
    const parts = s.split(':');
    [host, port] = parts;
    if (parts.length >= 4) { user = parts[2]; pass = parts.slice(3).join(':'); }
  }
  port = Number(port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { scheme, host, port, user, pass, key: `${host}:${port}` };
}

export function parseProxyList(text) {
  const seen = new Set();
  const list = [];
  const invalid = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const p = parseProxyLine(line);
    if (!p) { invalid.push(line.trim()); continue; }
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    list.push(p);
  }
  return { list, invalid };
}

/**
 * Reparte proxys entre teléfonos. Los que ya están en uso por otros teléfonos no se repiten
 * mientras queden libres; si hay más teléfonos que proxys, se reparten en ciclo.
 */
const isBad = (p) => p.status === 'error' || p.status === 'auth';

export function distribute(serials, proxies, { strategy = 'sequential', current = {}, onlyHealthy = false } = {}) {
  const pool = proxies.filter((p) => !onlyHealthy || !isBad(p)).map((p) => p.key);
  if (!pool.length) throw new Error('No hay proxys disponibles en la lista');
  const targets = new Set(serials);
  const busy = new Set(Object.entries(current).filter(([s, k]) => k && !targets.has(s)).map(([, k]) => k));
  let free = pool.filter((k) => !busy.has(k));
  if (strategy === 'random') free = free.sort(() => Math.random() - 0.5);
  const order = free.length ? free : pool;
  const out = {};
  serials.forEach((s, i) => { out[s] = order[i % order.length]; });
  return out;
}

export class ProxyManager {
  constructor({ store, devices, relay = new ProxyRelay() }) {
    this.store = store;
    this.devices = devices;
    this.relay = relay;
  }

  list() {
    return this.store.get('proxies') || [];
  }

  assignments() {
    const meta = this.store.get('deviceMeta') || {};
    return Object.fromEntries(Object.entries(meta).filter(([, m]) => m.proxy).map(([s, m]) => [s, m.proxy]));
  }

  /** Reemplaza (o añade a) la lista. Conserva estado de prueba de los que ya existían. */
  setList(text, { append = false } = {}) {
    const { list, invalid } = parseProxyList(text);
    const old = new Map(this.list().map((p) => [p.key, p]));
    const merged = append ? [...this.list()] : [];
    for (const p of list) {
      if (append && old.has(p.key)) continue;
      const prev = old.get(p.key);
      merged.push({ ...p, status: prev?.status || 'sin probar', latency: prev?.latency ?? null });
    }
    this.store.set('proxies', merged);
    return { proxies: merged, invalid };
  }

  remove(keys) {
    const set = new Set(keys);
    this.store.set('proxies', this.list().filter((p) => !set.has(p.key)));
    const meta = this.store.get('deviceMeta');
    for (const m of Object.values(meta)) if (set.has(m.proxy)) delete m.proxy;
    this.store.set('deviceMeta', meta);
    return this.list();
  }

  setAssignment(serial, key) {
    const meta = this.store.get('deviceMeta');
    meta[serial] = { ...(meta[serial] || {}) };
    if (key) meta[serial].proxy = key; else delete meta[serial].proxy;
    this.store.set('deviceMeta', meta);
  }

  assign(serials, opts = {}) {
    const result = distribute(serials, this.list(), { ...opts, current: this.assignments() });
    for (const [s, k] of Object.entries(result)) this.setAssignment(s, k);
    return result;
  }

  unassign(serials) {
    for (const s of serials) this.setAssignment(s, null);
  }

  /** Aplica en el teléfono el proxy asignado (o lo quita si no tiene). */
  async apply(serial) {
    const key = this.assignments()[serial];
    const p = key && this.list().find((x) => x.key === key);
    if (!p) { await this.clearOnDevice(serial); return 'sin proxy'; }
    return this.applyProxy(serial, p);
  }

  /**
   * Pone un proxy en el teléfono. Si lleva usuario y clave (o es SOCKS), el teléfono usa el puente
   * local de la app (127.0.0.1:puerto por adb reverse), que añade la autenticación.
   */
  async applyProxy(serial, p) {
    const d = this.devices.get(serial);
    if (!needsRelay(p)) {
      await this.dropRelay(serial, d);
      await d.shell(`settings put global http_proxy ${p.host}:${p.port}`);
      return p.key;
    }
    const port = await this.relay.ensure(serial, p);
    try {
      await d.reverse(port);
    } catch (e) {
      throw new Error(`No se pudo preparar el puente del proxy en el teléfono (adb reverse): ${e.message}`);
    }
    await d.shell(`settings put global http_proxy 127.0.0.1:${port}`);
    return `${p.key} (con usuario y clave, a través de la app)`;
  }

  async dropRelay(serial, d = this.devices.get(serial)) {
    const port = this.relay.port(serial);
    if (!port) return;
    await d?.reverseRemove(port).catch(() => {});
    await this.relay.stop(serial);
  }

  async clearOnDevice(serial) {
    const d = this.devices.get(serial);
    await d.shell('settings put global http_proxy :0');
    await this.dropRelay(serial, d);
  }

  /** El teléfono tiene un proxy que pasa por el puente (y por tanto necesita la app abierta). */
  usesRelay(serial) {
    const p = this.list().find((x) => x.key === this.assignments()[serial]);
    return !!p && needsRelay(p);
  }

  /** Asigna el siguiente proxy libre de la lista a un teléfono (rotación). */
  rotate(serial) {
    const list = this.list().filter((p) => !isBad(p));
    if (!list.length) throw new Error('No hay proxys disponibles');
    const current = this.assignments();
    const busy = new Set(Object.entries(current).filter(([s]) => s !== serial).map(([, k]) => k));
    const idx = list.findIndex((p) => p.key === current[serial]);
    for (let i = 1; i <= list.length; i++) {
      const cand = list[(idx + i + list.length) % list.length];
      if (!busy.has(cand.key) || i === list.length) {
        this.setAssignment(serial, cand.key);
        return cand.key;
      }
    }
    return current[serial];
  }

  /**
   * Prueba cada proxy desde el PC abriendo un túnel real (con su usuario y clave) y mide la latencia.
   * Distingue "sin respuesta" de "usuario o clave incorrectos".
   */
  async test(keys, onProgress, { target = ['www.google.com', 443], timeout = 10000 } = {}) {
    const list = this.list();
    const targets = keys?.length ? list.filter((p) => keys.includes(p.key)) : list;
    let done = 0;
    const probe = async (p) => {
      const t0 = Date.now();
      try {
        const { socket } = await openTunnel(p, target[0], target[1], { timeout });
        socket.destroy();
        Object.assign(p, { status: 'ok', latency: Date.now() - t0, message: '' });
      } catch (e) {
        Object.assign(p, { status: e.code === 'auth' ? 'auth' : 'error', latency: null, message: e.message });
      }
      p.testedAt = Date.now();
    };
    const queue = [...targets];
    await Promise.all(Array.from({ length: Math.min(32, queue.length || 1) }, async () => {
      while (queue.length) {
        await probe(queue.shift());
        onProgress?.(++done, targets.length);
      }
    }));
    this.store.set('proxies', list);
    return list;
  }
}
