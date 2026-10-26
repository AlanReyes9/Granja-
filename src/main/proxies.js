// Lista de proxys y asignación de un proxy por teléfono.
import net from 'node:net';

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
export function distribute(serials, proxies, { strategy = 'sequential', current = {}, onlyHealthy = false } = {}) {
  const pool = proxies.filter((p) => !onlyHealthy || p.status !== 'error').map((p) => p.key);
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
  constructor({ store, devices }) {
    this.store = store;
    this.devices = devices;
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
    const d = this.devices.get(serial);
    await d.shell(`settings put global http_proxy ${key || ':0'}`);
    return key || 'sin proxy';
  }

  async clearOnDevice(serial) {
    await this.devices.get(serial).shell('settings put global http_proxy :0');
  }

  /** Asigna el siguiente proxy libre de la lista a un teléfono (rotación). */
  rotate(serial) {
    const list = this.list().filter((p) => p.status !== 'error');
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

  /** Comprueba conexión TCP con cada proxy desde el PC y mide la latencia. */
  async test(keys, onProgress) {
    const list = this.list();
    const targets = keys?.length ? list.filter((p) => keys.includes(p.key)) : list;
    let done = 0;
    const probe = (p) => new Promise((resolve) => {
      const t0 = Date.now();
      const sock = net.connect({ host: p.host, port: p.port });
      const finish = (ok) => {
        sock.destroy();
        p.status = ok ? 'ok' : 'error';
        p.latency = ok ? Date.now() - t0 : null;
        p.testedAt = Date.now();
        resolve();
      };
      sock.setTimeout(5000, () => finish(false));
      sock.on('connect', () => finish(true));
      sock.on('error', () => finish(false));
    });
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
