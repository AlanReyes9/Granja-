// Gestor de licencias de la app: activación en línea (serial) o sin conexión (clave firmada para este equipo).
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { verifyToken } from './token.js';
import { getMachineId, normalizeMachineId } from './machine.js';
import * as defaults from './config.js';

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

export class LicenseError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export class LicenseManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.dir carpeta de datos de la app
   * @param {string} [opts.publicKey] clave pública (por defecto, la de config.js)
   * @param {string} [opts.serverUrl] servidor de activación (por defecto, el de config.js)
   * @param {() => string} [opts.machineId]
   * @param {() => number} [opts.now]
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({ dir, publicKey = defaults.PUBLIC_KEY, serverUrl = defaults.SERVER_URL, machineId = getMachineId,
    now = Date.now, fetch: fetchImpl = globalThis.fetch, graceDays = defaults.GRACE_DAYS, appVersion = '',
    allowOffline = defaults.OFFLINE_KEYS }) {
    super();
    this.file = path.join(dir, 'licencia.json');
    Object.assign(this, { publicKey, serverUrl, machineId, now, fetchImpl, graceDays, appVersion, allowOffline });
    this.saved = this.load();
    this.timer = null;
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.saved, null, 2));
  }

  /** Comprueba una licencia (texto firmado) contra este equipo y la fecha actual. */
  check(token) {
    if (!this.publicKey) throw new LicenseError('Esta copia de Nexus Farmer no tiene configurada la clave pública de licencias', 'no-key');
    const p = verifyToken(token, this.publicKey);
    const now = this.now();
    if (p.v !== 1) throw new LicenseError('Versión de licencia no compatible', 'version');
    if (p.k === 'offline' && !this.allowOffline) throw new LicenseError('Las claves sin conexión no están permitidas: activa la app con tu serial', 'offline-disabled');
    if (p.m !== this.machineId()) throw new LicenseError('Esta licencia es de otro equipo', 'machine');
    // Si el reloj está por detrás de la última fecha vista (o de la emisión), alguien lo ha atrasado.
    const maxSeen = Math.max(this.saved.maxSeen || 0, p.i || 0, p.chk || 0);
    if (now < maxSeen - DAY) throw new LicenseError('La fecha y hora del equipo no son correctas. Corrígelas para usar la app.', 'clock');
    if (p.e != null && now > p.e) throw new LicenseError(`La licencia caducó el ${new Date(p.e).toLocaleDateString('es-ES')}`, 'expired');
    if (p.k === 'online' && now - p.chk > this.graceDays * DAY) {
      throw new LicenseError(`Hace más de ${this.graceDays} días que no se puede comprobar la licencia con el servidor. Conéctate a internet.`, 'grace');
    }
    return p;
  }

  /**
   * Recuerda la fecha más reciente en la que se abrió la app (con licencia válida o no), para detectar
   * que alguien atrase el reloj del equipo para "revivir" una licencia caducada.
   */
  touch() {
    const now = this.now();
    if (now > (this.saved.maxSeen || 0) + HOUR) {
      this.saved.maxSeen = now;
      try { this.save(); } catch {}
    }
  }

  /** Estado para la interfaz: activa o no, y por qué. */
  status() {
    this.touch();
    const base = { machineId: this.machineId(), onlineAvailable: !!this.serverUrl, offlineAvailable: !!this.allowOffline, configured: !!this.publicKey };
    if (!this.saved.token) return { ...base, active: false, reason: this.allowOffline ? 'Introduce tu serial o tu clave de licencia' : 'Introduce el serial que te ha dado Nexus Dev' };
    try {
      const p = this.check(this.saved.token);
      const daysLeft = p.e == null ? null : Math.max(0, Math.ceil((p.e - this.now()) / DAY));
      return { ...base, active: true, mode: p.k, serial: p.s, client: p.c || '', plan: p.p || '', expires: p.e, daysLeft,
        lastCheck: p.chk || null };
    } catch (e) {
      return { ...base, active: false, reason: e.message, code: e.code, serial: this.saved.serial || '' };
    }
  }

  isActive() {
    return this.status().active;
  }

  store(token, extra = {}) {
    this.check(token);
    this.saved = { ...this.saved, ...extra, token, maxSeen: Math.max(this.saved.maxSeen || 0, this.now()) };
    this.save();
    this.emit('changed', this.status());
    return this.status();
  }

  /** Clave sin conexión generada por el vendedor para el ID de este equipo. */
  activateOffline(text) {
    if (!this.allowOffline) throw new LicenseError('Las claves sin conexión no están permitidas: activa la app con tu serial', 'offline-disabled');
    const token = String(text || '').trim();
    const p = verifyToken(token, this.publicKey);
    if (p.k !== 'offline') throw new LicenseError('Esa clave no es una licencia sin conexión', 'kind');
    return this.store(token, { serial: p.s, mode: 'offline' });
  }

  async request(action, serial) {
    if (!this.serverUrl) throw new LicenseError('Esta copia no tiene configurado el servidor de licencias', 'no-server');
    let res;
    try {
      res = await this.fetchImpl(this.serverUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, serial, machineId: this.machineId(), appVersion: this.appVersion }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new LicenseError('No se pudo conectar con el servidor de licencias', 'network');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new LicenseError(body.error || `El servidor respondió con un error (${res.status})`, body.code || 'server');
    return body.token;
  }

  /** Serial en línea: el servidor lo ata a este equipo y devuelve una licencia firmada. */
  async activateOnline(serial) {
    const clean = String(serial || '').trim().toUpperCase();
    if (!/^NXF(-[0-9A-Z]{5}){4}$/.test(clean)) throw new LicenseError('El serial tiene el formato NXF-XXXXX-XXXXX-XXXXX-XXXXX', 'format');
    const token = await this.request('activate', clean);
    return this.store(token, { serial: clean, mode: 'online' });
  }

  /**
   * Revalida una licencia en línea. Sin conexión no pasa nada (hay periodo de gracia); si el servidor
   * dice que el serial está revocado, caducado o liberado, la licencia se desactiva en el acto.
   */
  async revalidate() {
    if (this.saved.mode !== 'online' || !this.saved.serial) return this.status();
    try {
      const token = await this.request('validate', this.saved.serial);
      return this.store(token);
    } catch (e) {
      if (e.code === 'network' || e.code === 'no-server' || e.code === 'server') return this.status();
      this.saved.token = null;
      this.saved.revokedReason = e.message;
      this.save();
      this.emit('changed', this.status());
      return { ...this.status(), reason: e.message };
    }
  }

  deactivate() {
    this.saved = { maxSeen: this.saved.maxSeen };
    this.save();
    this.emit('changed', this.status());
  }

  startAutoRevalidate(hours = defaults.REVALIDATE_HOURS) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.revalidate().catch(() => {}), hours * HOUR);
    this.timer.unref?.();
  }
}

export { normalizeMachineId };
