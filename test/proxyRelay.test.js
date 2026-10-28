import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { RelayServer, openTunnel } from '../src/main/proxyRelay.js';
import { ProxyManager, parseProxyLine } from '../src/main/proxies.js';

// Todos los servidores y conexiones de prueba se cierran al final (aunque falle una prueba).
const open = new Set();
const listen = (srv) => {
  srv.on('connection', (s) => { open.add(s); s.on('close', () => open.delete(s)); });
  open.add(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
};
after(() => { for (const x of open) (x.destroy || x.close).call(x); });
const AUTH = `Basic ${Buffer.from('alan:Secreta1').toString('base64')}`;

// Web de destino: responde con lo que recibe.
async function target() {
  const srv = http.createServer((req, res) => res.end(`hola ${req.method} ${req.url}`));
  return { srv, port: await listen(srv) };
}

// Proxy HTTP que exige usuario y clave (como el del proveedor).
async function authHttpProxy() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(['GET', req.headers['proxy-authorization']]);
    if (req.headers['proxy-authorization'] !== AUTH) { res.writeHead(407, { 'proxy-authenticate': 'Basic' }).end(); return; }
    const u = new URL(req.url);
    http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  });
  srv.on('connect', (req, client, head) => {
    seen.push(['CONNECT', req.headers['proxy-authorization']]);
    if (req.headers['proxy-authorization'] !== AUTH) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return; }
    const [h, p] = req.url.split(':');
    const up = net.connect(Number(p), h, () => { client.write('HTTP/1.1 200 OK\r\n\r\n'); up.write(head); up.pipe(client); client.pipe(up); });
    up.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });
  return { srv, seen, port: await listen(srv) };
}

// Proxy SOCKS5 con usuario y clave.
async function authSocksProxy() {
  const srv = net.createServer((c) => {
    c.once('data', () => {
      c.write(Buffer.from([5, 2]));
      c.once('data', (a) => {
        const ul = a[1]; const user = a.subarray(2, 2 + ul).toString(); const pass = a.subarray(3 + ul, 3 + ul + a[2 + ul]).toString();
        const ok = user === 'alan' && pass === 'Secreta1';
        c.write(Buffer.from([1, ok ? 0 : 1]));
        if (!ok) return c.end();
        c.once('data', (r) => {
          const host = r.subarray(5, 5 + r[4]).toString(); const port = r.readUInt16BE(5 + r[4]);
          const up = net.connect(port, host, () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); up.pipe(c); c.pipe(up); });
        });
      });
    });
  });
  return { srv, port: await listen(srv) };
}

// Lo que hace el teléfono: GET http://... con proxy, y CONNECT para https.
const viaProxyGet = (proxyPort, url) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: proxyPort, path: url, agent: false, headers: { host: new URL(url).host } }, (res) => {
    let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  }).on('error', reject);
});
const viaConnect = (proxyPort, hostPort) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: hostPort });
  req.on('connect', (res, sock) => {
    if (res.statusCode !== 200) { sock.destroy(); return resolve({ status: res.statusCode }); }
    sock.write(`GET /seguro HTTP/1.1\r\nHost: ${hostPort}\r\nConnection: close\r\n\r\n`);
    let b = ''; sock.on('data', (d) => (b += d)); sock.on('end', () => resolve({ status: 200, body: b }));
  });
  req.on('error', reject);
  req.end();
});

test('puente: el teléfono sin credenciales navega por un proxy HTTP con usuario y clave', async () => {
  const t = await target(); const px = await authHttpProxy();
  const relay = new RelayServer(parseProxyLine(`127.0.0.1:${px.port}:alan:Secreta1`));
  const port = await relay.listen();
  // Sin el puente, el proxy rechaza al teléfono (lo que le pasaba al usuario).
  assert.equal((await viaProxyGet(px.port, `http://127.0.0.1:${t.port}/x`)).status, 407);
  const r1 = await viaProxyGet(port, `http://127.0.0.1:${t.port}/pagina?a=1`);
  assert.deepEqual(r1, { status: 200, body: 'hola GET /pagina?a=1' });
  const r2 = await viaConnect(port, `127.0.0.1:${t.port}`);
  assert.equal(r2.status, 200);
  assert.match(r2.body, /hola GET \/seguro/);
  assert.ok(px.seen.slice(1).every(([, a]) => a === AUTH), 'cada petición del puente lleva la autenticación');
  await relay.close(); t.srv.close(); px.srv.close();
});

test('puente: clave incorrecta da 502 con el motivo; SOCKS5 con usuario y clave funciona', async () => {
  const t = await target(); const px = await authHttpProxy(); const sx = await authSocksProxy();
  const bad = new RelayServer(parseProxyLine(`127.0.0.1:${px.port}:alan:mala`));
  const bp = await bad.listen();
  assert.equal((await viaConnect(bp, `127.0.0.1:${t.port}`)).status, 502);
  const g = await viaProxyGet(bp, `http://127.0.0.1:${t.port}/`);
  assert.equal(g.status, 502);
  assert.match(g.body, /Usuario o clave del proxy incorrectos/);
  const socks = new RelayServer(parseProxyLine(`socks5://alan:Secreta1@127.0.0.1:${sx.port}`));
  const sp = await socks.listen();
  assert.match((await viaConnect(sp, `127.0.0.1:${t.port}`)).body, /hola GET \/seguro/);
  assert.deepEqual(await viaProxyGet(sp, `http://127.0.0.1:${t.port}/s`), { status: 200, body: 'hola GET /s' });
  await assert.rejects(openTunnel(parseProxyLine(`socks5://alan:x@127.0.0.1:${sx.port}`), '127.0.0.1', t.port), (e) => e.code === 'auth');
  await bad.close(); await socks.close(); t.srv.close(); px.srv.close(); sx.srv.close();
});

test('ProxyManager: con usuario y clave usa el puente (adb reverse + 127.0.0.1) y la prueba detecta la clave mala', async () => {
  const t = await target(); const px = await authHttpProxy();
  const data = { proxies: [], deviceMeta: { a: {} } };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const cmds = [];
  const dev = { shell: async (c) => { cmds.push(c); return ''; }, reverse: async (p) => cmds.push(`reverse ${p}`), reverseRemove: async (p) => cmds.push(`unreverse ${p}`) };
  const pm = new ProxyManager({ store, devices: { get: () => dev } });
  pm.setList(`127.0.0.1:${px.port}:alan:Secreta1`);
  pm.setAssignment('a', `127.0.0.1:${px.port}`);
  const out = await pm.apply('a');
  assert.match(out, /con usuario y clave/);
  const port = pm.relay.port('a');
  assert.deepEqual(cmds, [`reverse ${port}`, `settings put global http_proxy 127.0.0.1:${port}`]);
  assert.ok(pm.usesRelay('a'));
  // El teléfono (vía el puerto del puente) ya navega.
  assert.equal((await viaProxyGet(port, `http://127.0.0.1:${t.port}/ok`)).body, 'hola GET /ok');
  // Prueba de proxys: el bueno responde; uno con clave mala se marca como tal.
  pm.setList(`127.0.0.1:${px.port}:alan:Secreta1`);
  const wrong = { ...parseProxyLine(`127.0.0.1:${px.port}:alan:mala`), key: 'mala' };
  data.proxies.push(wrong);
  const list = await pm.test(null, null, { target: ['127.0.0.1', t.port] });
  assert.equal(list[0].status, 'ok');
  assert.equal(list[1].status, 'auth');
  // Quitar el proxy: se borra del teléfono y se cierra el puente.
  await pm.clearOnDevice('a');
  assert.deepEqual(cmds.slice(-2), ['settings put global http_proxy :0', `unreverse ${port}`]);
  assert.equal(pm.relay.port('a'), null);
  t.srv.close(); px.srv.close();
});
