// Backend basado en adb.exe (platform-tools). Cubre USB, hubs/OTG reconocidos por Windows y ADB por Wi-Fi.
import { execFile, spawn } from 'node:child_process';

export class AdbExe {
  constructor(getPath) {
    this.getPath = getPath; // función que devuelve la ruta actual de adb
  }

  get bin() {
    return this.getPath() || 'adb';
  }

  run(args, { timeout = 30000, encoding = 'utf8', maxBuffer = 64 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      execFile(this.bin, args, { timeout, encoding, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          err.message = `${err.message}\n${stderr || ''}`.trim();
          return reject(err);
        }
        resolve(stdout);
      });
    });
  }

  async version() {
    const out = await this.run(['version'], { timeout: 8000 });
    return out.split('\n')[0].trim();
  }

  async startServer() {
    await this.run(['start-server'], { timeout: 20000 }).catch(() => {});
  }

  async killServer() {
    await this.run(['kill-server'], { timeout: 10000 }).catch(() => {});
  }

  /** Devuelve [{serial, state, model, product, transport, usbPath}] */
  async devices() {
    const out = await this.run(['devices', '-l'], { timeout: 10000 });
    return parseDevicesOutput(out);
  }

  shell(serial, cmd, opts) {
    return this.run(['-s', serial, 'shell', cmd], opts);
  }

  execOut(serial, cmd, opts = {}) {
    return this.run(['-s', serial, 'exec-out', cmd], { ...opts, encoding: 'buffer' });
  }

  connect(address) {
    return this.run(['connect', address], { timeout: 15000 });
  }

  disconnect(address) {
    return this.run(address ? ['disconnect', address] : ['disconnect'], { timeout: 10000 });
  }

  pair(address, code) {
    return this.run(['pair', address, code], { timeout: 30000 });
  }

  tcpip(serial, port = 5555) {
    return this.run(['-s', serial, 'tcpip', String(port)], { timeout: 15000 });
  }

  install(serial, apk) {
    return this.run(['-s', serial, 'install', '-r', '-g', apk], { timeout: 300000 });
  }

  push(serial, local, remote) {
    return this.run(['-s', serial, 'push', local, remote], { timeout: 600000 });
  }

  reboot(serial, mode) {
    return this.run(['-s', serial, 'reboot', ...(mode ? [mode] : [])], { timeout: 15000 });
  }

  spawnRaw(args) {
    return spawn(this.bin, args, { windowsHide: true });
  }
}

export function parseDevicesOutput(out) {
  const list = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const [, serial, state, rest] = m;
    const props = {};
    for (const kv of rest.split(/\s+/)) {
      const i = kv.indexOf(':');
      if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const isNet = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial) || serial.includes('._adb-tls-connect.');
    list.push({
      serial,
      state, // device | unauthorized | offline | recovery ...
      model: (props.model || '').replace(/_/g, ' '),
      product: props.product || '',
      usbPath: props.usb || '',
      transport: isNet ? 'wifi' : 'usb',
    });
  }
  return list;
}
