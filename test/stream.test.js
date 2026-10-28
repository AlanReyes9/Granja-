import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ScrcpyVideoParser, serverJarPath, SCRCPY_VERSION } from '../src/main/stream.js';

const header = (config, key, pts, size) => {
  const b = Buffer.alloc(12);
  b.writeUInt32BE((Math.floor(pts / 2 ** 32) | (config ? 0x80000000 : 0) | (key ? 0x40000000 : 0)) >>> 0, 0);
  b.writeUInt32BE(pts % 2 ** 32, 4);
  b.writeUInt32BE(size, 8);
  return b;
};

test('protocolo scrcpy: byte de prueba, códec y paquetes, aunque lleguen troceados', () => {
  const meta = Buffer.alloc(12);
  meta.write('h264', 0, 'latin1');
  meta.writeUInt32BE(720, 4);
  meta.writeUInt32BE(1500, 8);
  const cfg = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f, 0, 0, 0, 1, 0x68, 0xce]);
  const k = Buffer.from([0, 0, 0, 1, 0x65, 1, 2, 3]);
  const d = Buffer.from([0, 0, 0, 1, 0x41, 9]);
  const all = Buffer.concat([Buffer.from([0]), meta, header(true, false, 0, cfg.length), cfg,
    header(false, true, 2 ** 33 + 5, k.length), k, header(false, false, 50000, d.length), d]);
  for (const step of [1, 3, 7, 13, all.length]) {
    const p = new ScrcpyVideoParser();
    const got = [];
    let m;
    p.on('meta', (x) => (m = x));
    p.on('packet', (x) => got.push(x));
    for (let i = 0; i < all.length; i += step) p.push(all.subarray(i, i + step));
    assert.deepEqual(m, { codec: 'h264', width: 720, height: 1500 });
    assert.deepEqual(got.map((x) => [x.config, x.key, x.pts, x.data.length]), [[true, false, 0, cfg.length], [false, true, 2 ** 33 + 5, k.length], [false, false, 50000, d.length]]);
    assert.deepEqual([...got[1].data], [...k]);
  }
});

test('el servidor de vídeo va dentro de la app y es el oficial de scrcpy', async () => {
  const file = serverJarPath();
  assert.ok(fs.existsSync(file), file);
  const { createHash } = await import('node:crypto');
  // SHA-256 publicado por Genymobile para scrcpy-server v3.1.
  assert.equal(SCRCPY_VERSION, '3.1');
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), '958f0944a62f23b1f33a16e9eb14844c1a04b882ca175a738c16d23cb22b86c0');
});

test('ScreenStreamer: conecta por adb forward, reinicia con otros ajustes sin "parar" y para de verdad', async () => {
  const net = await import('node:net');
  const { EventEmitter } = await import('node:events');
  const { ScreenStreamer } = await import('../src/main/stream.js');
  const servers = [];
  const calls = [];
  const adb = {
    push: async () => {},
    run: async (args) => {
      calls.push(args.join(' '));
      if (args[2] === 'forward' && args[3] !== '--remove') {
        // Servidor scrcpy simulado en el puerto del forward.
        const port = Number(args[3].split(':')[1]);
        const srv = net.createServer((sock) => {
          const meta = Buffer.alloc(12); meta.write('h264', 0, 'latin1'); meta.writeUInt32BE(720, 4); meta.writeUInt32BE(1500, 8);
          const cfg = Buffer.from([0, 0, 0, 1, 0x67, 0x42]);
          const head = Buffer.alloc(12); head.writeUInt32BE(0x80000000, 0); head.writeUInt32BE(cfg.length, 8);
          sock.write(Buffer.concat([Buffer.from([0]), meta, head, cfg]));
          sock.on('error', () => {});
        });
        await new Promise((r) => srv.listen(port, '127.0.0.1', r));
        servers.push(srv);
      }
      return '';
    },
    spawnRaw: () => Object.assign(new EventEmitter(), { kill() {}, stdout: null, stderr: null }),
  };
  const { fileURLToPath } = await import('node:url');
  // Cualquier archivo que exista sirve (el push está simulado); fileURLToPath da una ruta válida también en Windows.
  const st = new ScreenStreamer({ adb, jar: fileURLToPath(import.meta.url) });
  const states = [];
  const packets = [];
  st.on('state', (s, name) => states.push(name));
  st.on('packet', (s, p) => packets.push(p));
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); };
  await st.start('S1', { maxSize: 480 });
  await until(() => packets.length === 1);
  assert.equal(packets[0].config, true);
  assert.ok(calls.some((c) => /^-s S1 forward tcp:\d+ localabstract:scrcpy_[0-9a-f]{8}$/.test(c)));
  await st.start('S1', { maxSize: 1080 });
  await until(() => packets.length === 2);
  assert.equal(packets.length, 2, 'tras reiniciar llega la configuración del nuevo servidor');
  assert.ok(!states.includes('stopped'), 'reiniciar con otros ajustes no es una parada');
  st.stop('S1');
  assert.equal(states.at(-1), 'stopped');
  assert.ok(calls.some((c) => /forward --remove tcp:\d+/.test(c)));
  assert.equal(st.isActive('S1'), false);
  for (const s of servers) s.close();
});
