// API REST local para controlar la granja desde scripts, n8n, Zapier, bots, etc.
import http from 'node:http';

export class ApiServer {
  constructor({ store, devices, engine }) {
    this.store = store;
    this.devices = devices;
    this.engine = engine;
    this.server = null;
  }

  status() {
    return this.server ? { running: true, address: this.address } : { running: false };
  }

  restart() {
    this.close();
    const s = this.store.get('settings');
    if (!s.apiEnabled) return;
    const host = s.apiToken ? '0.0.0.0' : '127.0.0.1';
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => send(res, 500, { error: e.message })));
    this.server.on('error', () => { this.server = null; });
    this.server.listen(Number(s.apiPort) || 8787, host);
    this.address = `http://${host === '0.0.0.0' ? '<ip-del-pc>' : host}:${s.apiPort}`;
  }

  close() {
    this.server?.close();
    this.server = null;
  }

  async handle(req, res) {
    const s = this.store.get('settings');
    const url = new URL(req.url, 'http://x');
    if (s.apiToken) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${s.apiToken}` && url.searchParams.get('token') !== s.apiToken) return send(res, 401, { error: 'token inválido' });
    }
    const body = req.method === 'POST' ? await readJson(req) : {};
    const route = `${req.method} ${url.pathname}`;
    const meta = this.store.get('deviceMeta') || {};

    if (route === 'GET /api/devices') {
      return send(res, 200, this.devices.list().map((d) => ({ ...d, name: meta[d.serial]?.name || '', group: meta[d.serial]?.group || '' })));
    }
    if (route === 'GET /api/workflows') {
      return send(res, 200, (this.store.get('workflows') || []).map((w) => ({ id: w.id, name: w.name })));
    }
    if (route === 'GET /api/runs') return send(res, 200, this.engine.listRuns());
    if (route === 'POST /api/run') {
      const wf = (this.store.get('workflows') || []).find((w) => w.id === body.workflowId || w.name === body.workflow);
      if (!wf) return send(res, 404, { error: 'flujo no encontrado' });
      let serials = body.serials || this.devices.ready().map((d) => d.serial);
      if (body.group) serials = serials.filter((x) => meta[x]?.group === body.group);
      const id = this.engine.start(wf, serials, { concurrency: s.runConcurrency, staggerMs: s.runStaggerMs, source: 'api' });
      return send(res, 200, { runId: id, devices: serials.length });
    }
    if (route === 'POST /api/stop') {
      if (body.runId) this.engine.stop(body.runId); else this.engine.stopAll();
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/shell') {
      const serials = body.serials || this.devices.ready().map((d) => d.serial);
      const results = await Promise.all(serials.map(async (x) => {
        try { return [x, await this.devices.get(x).shell(String(body.command || ''))]; } catch (e) { return [x, `ERROR: ${e.message}`]; }
      }));
      return send(res, 200, Object.fromEntries(results));
    }
    const shot = url.pathname.match(/^\/api\/screenshot\/(.+)$/);
    if (req.method === 'GET' && shot) {
      const png = await this.devices.get(decodeURIComponent(shot[1])).screencapPng();
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png);
    }
    send(res, 404, { error: 'ruta no encontrada', rutas: ['GET /api/devices', 'GET /api/workflows', 'GET /api/runs', 'POST /api/run', 'POST /api/stop', 'POST /api/shell', 'GET /api/screenshot/:serial'] });
  }
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
