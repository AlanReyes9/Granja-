// Motor "USB directo / OTG": habla el protocolo ADB por USB (libusb) sin adb.exe ni servidor ADB.
// Útil con hubs OTG grandes donde el servidor adb se satura, o en PCs donde no se puede instalar platform-tools.
// Requisito en Windows: el dispositivo debe usar un driver WinUSB (el driver USB de Google lo es) y
// el servidor adb.exe no debe tener ese mismo dispositivo abierto.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let libs = null;
async function loadLibs() {
  if (libs) return libs;
  const [usb, adb, webusb, bin, streams] = await Promise.all([
    import('usb'),
    import('@yume-chan/adb'),
    import('@yume-chan/adb-daemon-webusb'),
    import('@yume-chan/android-bin'),
    import('@yume-chan/stream-extra'),
  ]);
  libs = { usb, adb, webusb, bin, streams };
  return libs;
}

class NodeCredentialStore {
  constructor(dir) {
    this.file = path.join(dir, 'granja_adbkey.pk8');
  }
  generateKey() {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 65537,
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      publicKeyEncoding: { type: 'spki', format: 'der' },
    });
    fs.writeFileSync(this.file, privateKey);
    return { buffer: new Uint8Array(privateKey), name: 'granja@pc' };
  }
  *iterateKeys() {
    if (fs.existsSync(this.file)) yield { buffer: new Uint8Array(fs.readFileSync(this.file)), name: 'granja@pc' };
  }
}

function fileToStream(ReadableStream, filePath) {
  const fd = fs.openSync(filePath, 'r');
  const chunk = 64 * 1024;
  return new ReadableStream({
    pull(controller) {
      const buf = Buffer.allocUnsafe(chunk);
      const read = fs.readSync(fd, buf, 0, chunk, null);
      if (read === 0) {
        fs.closeSync(fd);
        controller.close();
      } else {
        controller.enqueue(new Uint8Array(buf.subarray(0, read)));
      }
    },
    cancel() {
      try { fs.closeSync(fd); } catch {}
    },
  });
}

export class UsbDirectBackend {
  constructor(keyDir) {
    this.keyDir = keyDir;
    this.connections = new Map(); // serial -> Adb
    this.pending = new Map(); // serial -> estado ('authorizing', error)
    this.manager = null;
  }

  async init() {
    const { usb, webusb } = await loadLibs();
    if (!this.manager) {
      this.manager = new webusb.AdbDaemonWebUsbDeviceManager(new usb.WebUSB({ allowAllDevices: true }));
    }
    this.store ??= new NodeCredentialStore(this.keyDir);
  }

  /** Escanea el bus USB y conecta los dispositivos ADB nuevos. */
  async scan() {
    await this.init();
    const { adb } = libs;
    const found = await this.manager.getDevices();
    const result = [];
    for (const dev of found) {
      const serial = dev.serial;
      if (this.connections.has(serial)) {
        result.push({ serial, state: 'device', model: dev.name, transport: 'otg' });
        continue;
      }
      if (this.pending.get(serial) === 'authorizing') {
        result.push({ serial, state: 'unauthorized', model: dev.name, transport: 'otg' });
        continue;
      }
      this.pending.set(serial, 'authorizing');
      result.push({ serial, state: 'unauthorized', model: dev.name, transport: 'otg' });
      (async () => {
        try {
          const connection = await dev.connect();
          const transport = await adb.AdbDaemonTransport.authenticate({ serial, connection, credentialStore: this.store });
          const client = new adb.Adb(transport);
          this.connections.set(serial, client);
          this.pending.delete(serial);
          client.disconnected.then(() => this.connections.delete(serial));
        } catch (err) {
          this.pending.set(serial, `error: ${err.message}`);
          setTimeout(() => this.pending.delete(serial), 5000);
        }
      })();
    }
    for (const serial of this.connections.keys()) {
      if (!found.some((d) => d.serial === serial)) this.connections.delete(serial);
    }
    return result;
  }

  get(serial) {
    const c = this.connections.get(serial);
    if (!c) throw new Error(`Dispositivo OTG ${serial} no conectado`);
    return c;
  }

  async shell(serial, cmd) {
    const adb = this.get(serial);
    return adb.subprocess.noneProtocol.spawnWaitText(cmd);
  }

  async execOut(serial, cmd) {
    const adb = this.get(serial);
    return Buffer.from(await adb.subprocess.noneProtocol.spawnWait(cmd));
  }

  async install(serial, apk) {
    const adb = this.get(serial);
    const pm = new libs.bin.PackageManager(adb);
    const size = fs.statSync(apk).size;
    await pm.installStream(size, fileToStream(libs.streams.ReadableStream, apk), { grantRuntimePermissions: true });
    return 'Success';
  }

  async push(serial, local, remote) {
    const adb = this.get(serial);
    let target = remote;
    if (target.endsWith('/')) target += path.basename(local);
    const sync = await adb.sync();
    try {
      await sync.write({ filename: target, file: fileToStream(libs.streams.ReadableStream, local), permission: 0o666 });
    } finally {
      await sync.dispose();
    }
    return target;
  }

  async reboot(serial, mode) {
    await this.get(serial).power.reboot(mode || '');
  }

  async closeAll() {
    for (const c of this.connections.values()) await c.close().catch(() => {});
    this.connections.clear();
  }
}
