// Vídeo en tiempo real de cada teléfono con scrcpy-server (H.264), en lugar de capturas periódicas.
// El servidor oficial de scrcpy v3.1 va dentro de la app (build/vendor) y se copia al teléfono la
// primera vez. El vídeo llega por un "adb forward" y se reenvía tal cual a la interfaz, que lo decodifica.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

export const SCRCPY_VERSION = '3.1';
const REMOTE_JAR = `/data/local/tmp/nexus-scrcpy-${SCRCPY_VERSION}.jar`;

/** Ruta del servidor dentro de la app (fuera del .asar, porque adb.exe tiene que poder leerlo). */
export function serverJarPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'build', 'vendor', `scrcpy-server-v${SCRCPY_VERSION}`).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

/**
 * Lee el socket de vídeo de scrcpy (forward): 1 byte de prueba, 12 bytes de códec y ancho/alto,
 * y después paquetes con cabecera de 12 bytes (flags + PTS de 8 bytes, tamaño de 4 bytes).
 */
export class ScrcpyVideoParser extends EventEmitter {
  constructor() {
    super();
    this.buf = Buffer.alloc(0);
    this.stage = 'dummy';
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.stage === 'dummy') {
        if (this.buf.length < 1) return;
        this.buf = this.buf.subarray(1);
        this.stage = 'meta';
      } else if (this.stage === 'meta') {
        if (this.buf.length < 12) return;
        const codec = this.buf.subarray(0, 4).toString('latin1');
        this.emit('meta', { codec, width: this.buf.readUInt32BE(4), height: this.buf.readUInt32BE(8) });
        this.buf = this.buf.subarray(12);
        this.stage = 'frames';
      } else {
        if (this.buf.length < 12) return;
        const size = this.buf.readUInt32BE(8);
        if (this.buf.length < 12 + size) return;
        const hi = this.buf.readUInt32BE(0);
        const lo = this.buf.readUInt32BE(4);
        const config = (hi & 0x80000000) !== 0;
        const key = (hi & 0x40000000) !== 0;
        const pts = (hi & 0x3fffffff) * 2 ** 32 + lo;
        // Copia: el búfer de entrada se reutiliza y el paquete viaja a otro proceso.
        const data = Buffer.from(this.buf.subarray(12, 12 + size));
        this.buf = this.buf.subarray(12 + size);
        this.emit('packet', { config, key, pts, data });
      }
    }
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.unref();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

/**
 * Gestiona un stream por teléfono. Eventos: 'meta' (serial, info), 'packet' (serial, paquete),
 * 'state' (serial, 'connecting' | 'live' | 'error' | 'failed' | 'stopped', mensaje).
 */
export class ScreenStreamer extends EventEmitter {
  /** @param {{ adb: import('./adb/exe.js').AdbExe, jar?: string }} opts */
  constructor({ adb, jar = serverJarPath(), connectTimeout = 10000 }) {
    super();
    Object.assign(this, { adb, jar, connectTimeout });
    this.streams = new Map();
    this.pushed = new Set();
  }

  isActive(serial) {
    return this.streams.has(serial);
  }

  /** Arranca (o reinicia con otros ajustes) el vídeo de un teléfono. */
  async start(serial, { maxSize = 480, bitRate = 1500000, maxFps = 24 } = {}) {
    const opts = { maxSize, bitRate, maxFps };
    const cur = this.streams.get(serial);
    if (cur && JSON.stringify(cur.opts) === JSON.stringify(opts) && !cur.closed) return;
    // Reinicio con otros ajustes (p. ej. de miniatura a vista grande): no es una parada.
    if (cur) { cur.closed = true; this.cleanup(serial, cur); }
    const st = { opts, closed: false, retries: 0 };
    this.streams.set(serial, st);
    this.run(serial, st);
  }

  stop(serial) {
    const st = this.streams.get(serial);
    if (!st) return;
    st.closed = true;
    this.cleanup(serial, st);
    this.streams.delete(serial);
    this.emit('state', serial, 'stopped');
  }

  stopAll() {
    for (const serial of [...this.streams.keys()]) this.stop(serial);
  }

  cleanup(serial, st) {
    clearTimeout(st.retryTimer);
    st.socket?.destroy();
    st.proc?.kill();
    if (st.port) this.adb.run(['-s', serial, 'forward', '--remove', `tcp:${st.port}`], { timeout: 5000 }).catch(() => {});
    Object.assign(st, { socket: null, proc: null, port: null });
  }

  async run(serial, st) {
    this.emit('state', serial, 'connecting');
    try {
      if (!this.pushed.has(serial)) {
        if (!fs.existsSync(this.jar)) throw new Error('Falta el servidor de vídeo (scrcpy-server) en la instalación');
        await this.adb.push(serial, this.jar, REMOTE_JAR);
        this.pushed.add(serial);
      }
      if (st.closed) return;
      const scid = (Math.floor(Math.random() * 0x7fffffff)).toString(16).padStart(8, '0');
      st.port = await freePort();
      await this.adb.run(['-s', serial, 'forward', `tcp:${st.port}`, `localabstract:scrcpy_${scid}`], { timeout: 10000 });
      const { maxSize, bitRate, maxFps } = st.opts;
      const args = [`CLASSPATH=${REMOTE_JAR}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
        `scid=${scid}`, 'log_level=warn', 'tunnel_forward=true', 'audio=false', 'control=false', 'cleanup=true',
        'send_device_meta=false', `max_size=${maxSize}`, `video_bit_rate=${bitRate}`, `max_fps=${maxFps}`];
      st.proc = this.adb.spawnRaw(['-s', serial, 'shell', ...args]);
      let stderr = '';
      st.proc.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-500); });
      st.proc.stdout?.on('data', (d) => { stderr = (stderr + d).slice(-500); });
      st.proc.on('exit', () => { if (!st.closed && !st.socket) st.lastError = stderr.trim(); });
      st.socket = await this.connect(st);
      if (st.closed) return;
      st.retries = 0;
      const parser = new ScrcpyVideoParser();
      parser.on('meta', (m) => { this.emit('meta', serial, m); this.emit('state', serial, 'live'); });
      parser.on('packet', (p) => this.emit('packet', serial, p));
      st.socket.on('data', (d) => parser.push(d));
      st.socket.on('close', () => this.retry(serial, st, 'Se cortó el vídeo'));
      st.socket.on('error', () => {});
    } catch (e) {
      this.retry(serial, st, st.lastError || e.message);
    }
  }

  /**
   * Con "adb forward" la conexión se acepta aunque el servidor del teléfono aún no escuche; entonces
   * se cierra sin datos. Se reintenta hasta recibir el primer byte o agotar el tiempo.
   */
  async connect(st) {
    const end = Date.now() + this.connectTimeout;
    while (!st.closed && Date.now() < end) {
      const sock = await new Promise((resolve) => {
        const s = net.connect({ host: '127.0.0.1', port: st.port });
        let timer;
        const fail = () => { clearTimeout(timer); s.destroy(); resolve(null); };
        s.once('error', fail);
        s.once('close', fail);
        s.once('readable', () => {
          const first = s.read();
          if (!first) return fail();
          clearTimeout(timer);
          s.removeListener('close', fail);
          s.removeListener('error', fail);
          // Se devuelve lo ya recibido al flujo para que lo lea el parser.
          s.unshift(first);
          resolve(s);
        });
        timer = setTimeout(fail, 1500);
      });
      if (sock) return sock;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('El servidor de vídeo del teléfono no respondió');
  }

  retry(serial, st, message) {
    if (st.closed || this.streams.get(serial) !== st) return;
    this.cleanup(serial, st);
    st.retries++;
    this.emit('state', serial, 'error', message);
    // Si falla muchas veces seguidas se deja de intentar: la interfaz vuelve a las capturas.
    if (st.retries > 4) { this.streams.delete(serial); this.emit('state', serial, 'failed', message); return; }
    st.retryTimer = setTimeout(() => this.run(serial, st), Math.min(10000, 800 * 2 ** st.retries));
  }
}
