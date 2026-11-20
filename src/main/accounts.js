// Cuentas de cada plataforma (usuario y contraseña) asignadas a teléfonos, e inicio de sesión en lote.
// Las contraseñas se guardan cifradas (almacén seguro del sistema) y nunca se envían a la interfaz.
import { EventEmitter } from 'node:events';

export const PLATFORMS = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  google: 'Google (YouTube)',
};

/** "usuario:clave", "usuario;clave", "usuario,clave" o separado por tabulador; la clave puede llevar ":" */
export function parseAccounts(text) {
  const out = [];
  const invalid = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([^\t;,:\s][^\t;,:]*?)\s*[\t;,:]\s*(.+)$/);
    if (!m || !m[2]) { invalid.push(line); continue; }
    out.push({ user: m[1].trim(), pass: m[2] });
  }
  return { list: out, invalid };
}

export class AccountManager extends EventEmitter {
  /** encrypt/decrypt: cifrado de las contraseñas (safeStorage en la app). */
  constructor({ engine, store, getWorkflows, encrypt, decrypt, getSettings = () => ({}), now = Date.now }) {
    super();
    Object.assign(this, { engine, store, getWorkflows, encrypt, decrypt, getSettings, now });
    this.queue = []; // inicios de sesión pendientes: [{ platform, ids }]
    this.current = null; // { platform, runId, ids }
    engine.on('runs', (runs) => this.syncRuns(runs));
  }

  raw() {
    return this.store.get('accounts') || [];
  }

  /** Para la interfaz: sin contraseñas. */
  list() {
    return this.raw().map(({ secret, ...a }) => ({ ...a, hasPass: !!secret }));
  }

  save(list) {
    this.store.set('accounts', list);
    this.emit('changed', this.list());
  }

  /** Añade cuentas de una plataforma desde texto. Si el usuario ya existe, se actualiza su contraseña. */
  import(text, platform) {
    if (!PLATFORMS[platform]) throw new Error('Elige la plataforma de las cuentas');
    const { list, invalid } = parseAccounts(text);
    if (!list.length) throw new Error('No hay cuentas válidas: una por línea, como usuario:contraseña');
    const all = this.raw();
    let added = 0;
    let updated = 0;
    for (const { user, pass } of list) {
      const cur = all.find((a) => a.platform === platform && a.user.toLowerCase() === user.toLowerCase());
      if (cur) { cur.secret = this.encrypt(pass); cur.status = 'sin probar'; updated++; continue; }
      all.push({ id: `acc${this.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, platform, user, secret: this.encrypt(pass),
        serial: null, status: 'sin probar', message: '', createdAt: this.now() });
      added++;
    }
    this.save(all);
    return { added, updated, invalid };
  }

  update(id, { user, pass, serial } = {}) {
    const all = this.raw();
    const a = all.find((x) => x.id === id);
    if (!a) throw new Error('Cuenta no encontrada');
    if (user !== undefined && String(user).trim()) a.user = String(user).trim();
    if (pass) { a.secret = this.encrypt(pass); a.status = 'sin probar'; }
    if (serial !== undefined) {
      // Un teléfono tiene una sola cuenta por plataforma: la que lo tenía queda libre.
      if (serial) for (const o of all) if (o !== a && o.platform === a.platform && o.serial === serial) o.serial = null;
      a.serial = serial || null;
    }
    this.save(all);
    return this.list().find((x) => x.id === id);
  }

  remove(ids) {
    const set = new Set(ids);
    this.save(this.raw().filter((a) => !set.has(a.id)));
  }

  /**
   * Reparte las cuentas libres entre los teléfonos que aún no tienen cuenta de esa plataforma,
   * en orden. Devuelve cuántas se asignaron.
   */
  autoAssign(serials, platform = null) {
    const all = this.raw();
    let n = 0;
    for (const p of Object.keys(PLATFORMS)) {
      if (platform && p !== platform) continue;
      const taken = new Set(all.filter((a) => a.platform === p && a.serial).map((a) => a.serial));
      const free = all.filter((a) => a.platform === p && !a.serial);
      for (const s of serials) {
        if (taken.has(s)) continue;
        const a = free.shift();
        if (!a) break;
        a.serial = s;
        taken.add(s);
        n++;
      }
    }
    this.save(all);
    return n;
  }

  /** Flujo de inicio de sesión de cada plataforma (el primero que lo sea). */
  flowFor(platform) {
    return this.getWorkflows().find((w) => JSON.stringify(w.graph || {}).includes(`"name":"login_plataforma","value":"${platform}"`));
  }

  /** Inicia sesión en las cuentas elegidas (las que tienen teléfono), una plataforma tras otra. */
  login(ids) {
    const all = this.raw();
    const chosen = all.filter((a) => ids.includes(a.id));
    const withPhone = chosen.filter((a) => a.serial);
    if (!withPhone.length) throw new Error('Asigna un teléfono a las cuentas antes de iniciar sesión');
    const platforms = [...new Set(withPhone.map((a) => a.platform))];
    const missing = platforms.filter((p) => !this.flowFor(p));
    if (missing.length) throw new Error(`Falta el flujo de inicio de sesión de ${missing.map((p) => PLATFORMS[p]).join(', ')}: pulsa "Crear flujos de inicio de sesión"`);
    for (const a of withPhone) Object.assign(a, { status: 'en cola', message: '' });
    this.save(all);
    for (const p of platforms) this.queue.push({ platform: p, ids: withPhone.filter((a) => a.platform === p).map((a) => a.id) });
    this.next();
    return { queued: withPhone.length, skipped: chosen.length - withPhone.length };
  }

  next() {
    if (this.current || !this.queue.length) return;
    const job = this.queue.shift();
    const all = this.raw();
    const accounts = all.filter((a) => job.ids.includes(a.id) && a.serial);
    const wf = this.flowFor(job.platform);
    if (!wf || !accounts.length) { this.next(); return; }
    const s = this.getSettings();
    try {
      const runId = this.engine.start(wf, accounts.map((a) => a.serial), {
        source: 'inicio de sesión',
        concurrency: s.runConcurrency ?? 10,
        staggerMs: s.runStaggerMs ?? 0,
        secretVars: ['clave'],
        varsBySerial: Object.fromEntries(accounts.map((a) => [a.serial, { usuario: a.user, clave: this.decrypt(a.secret), plataforma: job.platform }])),
      });
      this.current = { ...job, runId, serials: Object.fromEntries(accounts.map((a) => [a.serial, a.id])) };
      for (const a of accounts) a.status = 'iniciando';
    } catch (e) {
      for (const a of accounts) Object.assign(a, { status: 'error', message: e.message });
    }
    this.save(all);
    if (!this.current) this.next();
  }

  syncRuns(runs) {
    const cur = this.current;
    if (!cur) return;
    const run = runs.find((r) => r.id === cur.runId);
    if (!run) return;
    const all = this.raw();
    let changed = false;
    for (const [serial, id] of Object.entries(cur.serials)) {
      const a = all.find((x) => x.id === id);
      const d = run.devices[serial];
      if (!a || !d) continue;
      const status = { ok: 'sesión iniciada', error: 'error', detenido: 'detenido', cancelado: 'detenido', ejecutando: 'iniciando' }[d.status] || a.status;
      const message = d.status === 'error' ? (d.error || '').replace(/^Error en "[^"]+": /, '') : '';
      if (a.status !== status || a.message !== message) {
        Object.assign(a, { status, message });
        if (status === 'sesión iniciada') a.lastLogin = this.now();
        changed = true;
      }
    }
    if (changed) this.save(all);
    if (run.status !== 'running') { this.current = null; this.next(); }
  }

  stop() {
    this.queue = [];
    if (this.current) this.engine.stop(this.current.runId);
  }
}
