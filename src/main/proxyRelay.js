// Puente para proxys con usuario y clave. Android (settings global http_proxy) solo admite host:puerto
// y no envía credenciales, así que el proxy responde 407 y el teléfono se queda sin internet.
// Por cada teléfono se abre en el PC un proxy HTTP local que reenvía al proxy real añadiendo la
// autenticación (HTTP: Proxy-Authorization; SOCKS5: usuario/clave). El teléfono llega a él con
// "adb reverse" (USB, Wi-Fi u OTG) y usa 127.0.0.1:<puerto> como proxy.
import http from 'node:http';
import net from 'node:net';

const HOP_HEADERS = ['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade'];

/** Lee de un socket hasta el final de la cabecera HTTP (\r\n\r\n). Devuelve { head, rest }. */
function readHead(sock, limit = 16384) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const i = buf.indexOf('\r\n\r\n');
      if (i >= 0) { done(); resolve({ head: buf.subarray(0, i).toString('latin1'), rest: buf.subarray(i + 4) }); }
      else if (buf.length > limit) { done(); reject(new Error('Respuesta del proxy demasiado larga')); }
    };
    const onEnd = () => { done(); reject(new Error('El proxy cerró la conexión')); };
    const onError = (e) => { done(); reject(e); };
    const done = () => { sock.pause(); sock.off('data', onData); sock.off('end', onEnd); sock.off('error', onError); };
    sock.on('data', onData);
    sock.once('end', onEnd);
    sock.once('error', onError);
    sock.resume();
  });
}

function readBytes(sock, n) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= n) {
        done();
        if (buf.length > n) sock.unshift(buf.subarray(n));
        resolve(buf.subarray(0, n));
      }
    };
    const onEnd = () => { done(); reject(new Error('El proxy SOCKS cerró la conexión')); };
    const onError = (e) => { done(); reject(e); };
    // Pausado entre lecturas: lo que sobra (unshift) espera a la siguiente en vez de perderse.
    const done = () => { sock.pause(); sock.off('data', onData); sock.off('end', onEnd); sock.off('error', onError); };
    sock.on('data', onData);
    sock.once('end', onEnd);
    sock.once('error', onError);
    sock.resume();
  });
}

function connectTcp(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setTimeout(timeout, () => s.destroy(new Error(`El proxy ${host}:${port} no responde`)));
    s.once('connect', () => { s.setTimeout(0); resolve(s); });
    s.once('error', reject);
  });
}

export class ProxyAuthError extends Error {
  constructor(message) {
    super(message);
    this.code = 'auth';
  }
}

/**
 * Abre un túnel TCP hasta destHost:destPort a través del proxy (HTTP CONNECT o SOCKS5).
 * Devuelve { socket, rest } o lanza un error con status (código HTTP del proxy) si lo rechaza.
 */
export async function openTunnel(upstream, destHost, destPort, { timeout = 15000 } = {}) {
  const sock = await connectTcp(upstream.host, upstream.port, timeout);
  try {
    if (/^socks/.test(upstream.scheme)) {
      const auth = !!upstream.user;
      sock.write(Buffer.from([5, 1, auth ? 2 : 0]));
      const [ver, method] = await readBytes(sock, 2);
      if (ver !== 5 || method === 0xff) throw new ProxyAuthError('El proxy SOCKS no acepta este método de autenticación');
      if (method === 2) {
        const u = Buffer.from(upstream.user || '');
        const p = Buffer.from(upstream.pass || '');
        sock.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p]));
        const [, status] = await readBytes(sock, 2);
        if (status !== 0) throw new ProxyAuthError('Usuario o clave del proxy incorrectos');
      }
      const host = Buffer.from(destHost);
      const port = Buffer.alloc(2);
      port.writeUInt16BE(destPort);
      sock.write(Buffer.concat([Buffer.from([5, 1, 0, 3, host.length]), host, port]));
      const [, rep, , atyp] = await readBytes(sock, 4);
      const addrLen = atyp === 1 ? 4 : atyp === 4 ? 16 : (await readBytes(sock, 1))[0];
      await readBytes(sock, addrLen + 2);
      if (rep !== 0) { const e = new Error(`El proxy SOCKS no pudo conectar con ${destHost} (código ${rep})`); e.status = 502; throw e; }
      return { socket: sock, rest: Buffer.alloc(0) };
    }
    const target = `${destHost}:${destPort}`;
    const authHeader = upstream.user ? `Proxy-Authorization: Basic ${Buffer.from(`${upstream.user}:${upstream.pass || ''}`).toString('base64')}\r\n` : '';
    sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authHeader}\r\n`);
    const { head, rest } = await readHead(sock);
    const status = Number(head.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1] || 0);
    if (status === 407) throw new ProxyAuthError('Usuario o clave del proxy incorrectos (407)');
    if (status < 200 || status > 299) { const e = new Error(`El proxy rechazó la conexión (${status || 'respuesta no válida'})`); e.status = status || 502; throw e; }
    return { socket: sock, rest };
  } catch (e) {
    sock.destroy();
    throw e;
  }
}

/** Proxy HTTP local que reenvía al proxy real con autenticación. */
export class RelayServer {
  constructor(upstream) {
    this.upstream = upstream;
    this.sockets = new Set();
    this.server = http.createServer((req, res) => this.onRequest(req, res));
    this.server.on('connect', (req, client, head) => this.onConnect(req, client, head));
    this.server.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    this.server.on('clientError', (_e, s) => s.destroy());
  }

  listen(port = 0) {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => { this.server.off('error', reject); this.port = this.server.address().port; resolve(this.port); });
    });
  }

  close() {
    for (const s of this.sockets) s.destroy();
    return new Promise((r) => this.server.close(() => r()));
  }

  /** Túneles HTTPS (y cualquier TCP) del teléfono. */
  async onConnect(req, client, head) {
    client.on('error', () => {});
    const [host, port] = splitHostPort(req.url, 443);
    let tunnel;
    try {
      tunnel = await openTunnel(this.upstream, host, port);
    } catch (e) {
      // Al teléfono se le devuelve el error como 502 (con 407 Android pediría credenciales que no sabe dar).
      client.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${e.message}`);
      return;
    }
    const up = tunnel.socket;
    this.sockets.add(up);
    up.on('close', () => this.sockets.delete(up));
    up.on('error', () => client.destroy());
    client.on('close', () => up.destroy());
    client.write('HTTP/1.1 200 Connection established\r\n\r\n');
    if (tunnel.rest.length) client.write(tunnel.rest);
    if (head?.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
  }

  /** Peticiones HTTP normales (http://...). */
  onRequest(req, res) {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400).end('Petición no válida para un proxy'); return; }
    const headers = { ...req.headers };
    for (const h of HOP_HEADERS) delete headers[h];
    const up = this.upstream;
    let opts;
    if (/^socks/.test(up.scheme)) {
      // SOCKS: túnel hasta el servidor y la petición va en forma normal (ruta relativa).
      const port = Number(url.port) || 80;
      opts = { host: url.hostname, port, method: req.method, path: url.pathname + url.search, headers,
        createConnection: (_o, cb) => {
          // El túnel queda pausado tras el saludo SOCKS; el cliente HTTP lo lee desde aquí.
          openTunnel(up, url.hostname, port).then(({ socket }) => { socket.resume(); cb(null, socket); }, (e) => cb(e));
        } };
    } else {
      if (up.user) headers['proxy-authorization'] = `Basic ${Buffer.from(`${up.user}:${up.pass || ''}`).toString('base64')}`;
      opts = { host: up.host, port: up.port, method: req.method, path: req.url, headers, agent: false };
    }
    const preq = http.request(opts, (pres) => {
      // 407 del proxy real: credenciales mal. Al teléfono se le da 502 con el motivo.
      if (pres.statusCode === 407) { pres.resume(); res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('Usuario o clave del proxy incorrectos (407)'); return; }
      const out = { ...pres.headers };
      for (const h of HOP_HEADERS) delete out[h];
      res.writeHead(pres.statusCode, pres.statusMessage, out);
      pres.pipe(res);
    });
    preq.setTimeout(30000, () => preq.destroy(new Error('El proxy no responde')));
    preq.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(e.message); });
    req.pipe(preq);
  }
}

function splitHostPort(s, def) {
  const m = String(s).match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  return [m?.[1] || s, Number(m?.[2]) || def];
}

/** Un puente por teléfono. Se reutiliza el puerto mientras la app esté abierta. */
export class ProxyRelay {
  constructor() {
    this.relays = new Map(); // serial -> { key, server, port }
  }

  async ensure(serial, upstream) {
    const id = `${upstream.scheme}://${upstream.user}:${upstream.pass}@${upstream.host}:${upstream.port}`;
    const cur = this.relays.get(serial);
    if (cur && cur.id === id) return cur.port;
    // Mismo teléfono con otro proxy: se intenta conservar el puerto (el que ya tiene configurado el teléfono).
    const keepPort = cur?.port || 0;
    if (cur) await cur.server.close();
    const server = new RelayServer(upstream);
    let port;
    try { port = await server.listen(keepPort); } catch { port = await server.listen(0); }
    this.relays.set(serial, { id, server, port });
    return port;
  }

  port(serial) {
    return this.relays.get(serial)?.port || null;
  }

  async stop(serial) {
    const cur = this.relays.get(serial);
    if (!cur) return;
    this.relays.delete(serial);
    await cur.server.close();
  }

  async stopAll() {
    await Promise.all([...this.relays.keys()].map((s) => this.stop(s)));
  }
}
