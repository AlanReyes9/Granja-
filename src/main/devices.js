// Gestor unificado de dispositivos: combina adb.exe (USB/Wi-Fi) y el motor USB directo (OTG).
import { EventEmitter } from 'node:events';
import net from 'node:net';
import os from 'node:os';

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export class Device {
  constructor(manager, info) {
    this.manager = manager;
    this.serial = info.serial;
    this.update(info);
    this.screenSize = null;
  }

  update(info) {
    Object.assign(this, { state: info.state, model: info.model || this.model || '', transport: info.transport, usbPath: info.usbPath || '' });
  }

  get backend() {
    return this.transport === 'otg' ? this.manager.usb : null;
  }

  shell(cmd, opts) {
    return this.backend ? this.backend.shell(this.serial, cmd) : this.manager.adb.shell(this.serial, cmd, opts);
  }

  execOut(cmd, opts) {
    return this.backend ? this.backend.execOut(this.serial, cmd) : this.manager.adb.execOut(this.serial, cmd, opts);
  }

  install(apk) {
    return this.backend ? this.backend.install(this.serial, apk) : this.manager.adb.install(this.serial, apk);
  }

  push(local, remote) {
    return this.backend ? this.backend.push(this.serial, local, remote) : this.manager.adb.push(this.serial, local, remote);
  }

  reboot(mode) {
    return this.backend ? this.backend.reboot(this.serial, mode) : this.manager.adb.reboot(this.serial, mode);
  }

  async screencapPng() {
    return this.execOut('screencap -p', { timeout: 15000 });
  }

  /** Captura RAW (RGBA) para leer píxeles sin decodificar PNG. */
  async screencapRaw() {
    const buf = await this.execOut('screencap', { timeout: 15000 });
    const w = buf.readUInt32LE(0);
    const h = buf.readUInt32LE(4);
    const header = buf.length - w * h * 4;
    return { width: w, height: h, data: buf.subarray(header >= 12 ? header : 12) };
  }

  async getScreenSize() {
    if (this.screenSize) return this.screenSize;
    const out = await this.shell('wm size');
    const m = out.match(/Override size:\s*(\d+)x(\d+)/) || out.match(/Physical size:\s*(\d+)x(\d+)/);
    if (!m) throw new Error(`No se pudo leer el tamaño de pantalla: ${out}`);
    this.screenSize = { width: +m[1], height: +m[2] };
    return this.screenSize;
  }

  async details() {
    const script = [
      'getprop ro.product.manufacturer', 'getprop ro.product.model', 'getprop ro.build.version.release',
      'getprop ro.build.version.sdk', 'dumpsys battery | grep -E "level|temperature|status|AC powered|USB powered"',
      "ip -f inet addr show wlan0 | grep inet | awk '{print $2}'", 'df /data | tail -1',
    ].join('; echo "@@"; ');
    const out = await this.shell(script, { timeout: 10000 });
    const parts = out.split('@@').map((x) => x.trim());
    const bat = parts[4] || '';
    const num = (re) => { const m = bat.match(re); return m ? +m[1] : null; };
    const temp = num(/temperature:\s*(\d+)/);
    const df = (parts[6] || '').split(/\s+/);
    return {
      manufacturer: parts[0], model: parts[1], android: parts[2], sdk: +parts[3] || null,
      battery: num(/level:\s*(\d+)/),
      temperature: temp != null ? temp / 10 : null,
      charging: /(AC|USB) powered:\s*true/.test(bat),
      ip: (parts[5] || '').split('/')[0] || null,
      storageUse: df[4] || null,
    };
  }
}

export class DeviceManager extends EventEmitter {
  constructor({ adb, usb, getSettings }) {
    super();
    this.adb = adb;
    this.usb = usb;
    this.getSettings = getSettings;
    this.devices = new Map();
    this.timer = null;
    this.lastError = null;
    this.wifiKnown = new Set(); // direcciones Wi-Fi para reconexión automática
  }

  start() {
    const loop = async () => {
      await this.refresh().catch((e) => { this.lastError = e.message; });
      this.timer = setTimeout(loop, 2000);
    };
    loop();
  }

  stop() {
    clearTimeout(this.timer);
  }

  async refresh() {
    const settings = this.getSettings();
    let list = [];
    try {
      list = await this.adb.devices();
      this.lastError = null;
    } catch (e) {
      this.lastError = `adb no disponible: ${e.message.split('\n')[0]}`;
    }
    if (settings.otgEnabled) {
      try {
        const otg = await this.usb.scan();
        for (const d of otg) if (!list.some((x) => x.serial === d.serial)) list.push(d);
      } catch (e) {
        this.lastError = `Motor OTG: ${e.message}`;
      }
    }

    const seen = new Set();
    let changed = false;
    for (const info of list) {
      seen.add(info.serial);
      const existing = this.devices.get(info.serial);
      if (!existing) {
        this.devices.set(info.serial, new Device(this, info));
        if (info.transport === 'wifi') this.wifiKnown.add(info.serial);
        changed = true;
        this.emit('connected', info.serial);
      } else if (existing.state !== info.state || existing.transport !== info.transport) {
        existing.update(info);
        changed = true;
      }
    }
    for (const serial of [...this.devices.keys()]) {
      if (!seen.has(serial)) {
        this.devices.delete(serial);
        changed = true;
        this.emit('disconnected', serial);
      }
    }

    if (settings.autoReconnectWifi) {
      for (const addr of this.wifiKnown) {
        if (!this.devices.has(addr)) this.adb.connect(addr).catch(() => {});
      }
    }
    if (changed) this.emit('changed', this.list());
  }

  list() {
    return [...this.devices.values()].map((d) => ({
      serial: d.serial, state: d.state, model: d.model, transport: d.transport, usbPath: d.usbPath,
    }));
  }

  get(serial) {
    const d = this.devices.get(serial);
    if (!d) throw new Error(`Dispositivo ${serial} no encontrado`);
    if (d.state !== 'device') throw new Error(`Dispositivo ${serial} en estado "${d.state}"`);
    return d;
  }

  ready() {
    return [...this.devices.values()].filter((d) => d.state === 'device');
  }

  forgetWifi(addr) {
    this.wifiKnown.delete(addr);
  }

  /** Pasa un dispositivo USB a ADB Wi-Fi y se conecta automáticamente a su IP. */
  async usbToWifi(serial, port = 5555) {
    const d = this.get(serial);
    const info = await d.details();
    if (!info.ip) throw new Error('El dispositivo no tiene IP Wi-Fi (¿está conectado a una red?)');
    await this.adb.tcpip(serial, port);
    await new Promise((r) => setTimeout(r, 2500));
    const addr = `${info.ip}:${port}`;
    const out = await this.adb.connect(addr);
    this.wifiKnown.add(addr);
    return `${addr}: ${out.trim()}`;
  }

  async connectWifi(addr) {
    if (!addr.includes(':')) addr += ':5555';
    const out = await this.adb.connect(addr);
    if (/connected/.test(out)) this.wifiKnown.add(addr);
    return out.trim();
  }

  /** Escanea la subred local buscando dispositivos con ADB por TCP abierto. */
  async scanNetwork(port = 5555, onProgress) {
    const bases = new Set();
    for (const ifs of Object.values(os.networkInterfaces())) {
      for (const i of ifs || []) {
        if (i.family === 'IPv4' && !i.internal) bases.add(i.address.split('.').slice(0, 3).join('.'));
      }
    }
    const hosts = [];
    for (const base of bases) for (let i = 1; i < 255; i++) hosts.push(`${base}.${i}`);
    const open = [];
    let done = 0;
    const probe = (host) => new Promise((resolve) => {
      const sock = net.connect({ host, port });
      const finish = (ok) => { sock.destroy(); if (ok) open.push(`${host}:${port}`); resolve(); };
      sock.setTimeout(400, () => finish(false));
      sock.on('connect', () => finish(true));
      sock.on('error', () => finish(false));
    });
    const queue = [...hosts];
    await Promise.all(Array.from({ length: 64 }, async () => {
      while (queue.length) {
        await probe(queue.shift());
        done++;
        if (done % 32 === 0) onProgress?.(done, hosts.length);
      }
    }));
    for (const addr of open) await this.connectWifi(addr).catch(() => {});
    return open;
  }
}
