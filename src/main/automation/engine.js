// Motor que ejecuta flujos de nodos (exportados desde Drawflow) en uno o varios dispositivos en paralelo.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { KEYCODES, NODE_MAP } from '../../shared/nodes.js';
import * as A from './actions.js';
import { parseProxyLine } from '../proxies.js';

const MAX_STEPS = 100000;

/** Convierte la exportación de Drawflow en {nodes: {id: {type, params, next: [[ids]]}}, startIds}. */
export function compileDrawflow(exported) {
  const data = exported?.drawflow?.Home?.data ?? {};
  const nodes = {};
  for (const [id, n] of Object.entries(data)) {
    const outs = Object.keys(n.outputs || {}).sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));
    nodes[id] = {
      id,
      type: n.name,
      params: n.data || {},
      next: outs.map((k) => (n.outputs[k].connections || []).map((c) => String(c.node))),
    };
  }
  const startIds = Object.values(nodes).filter((n) => n.type === 'start').map((n) => n.id);
  return { nodes, startIds };
}

/** Resumen corto de los parámetros de un paso para el registro, p. ej. ' (x: 50%, y: 80%)'. */
function stepSummary(def, params, vars) {
  if (!def?.params.length) return '';
  const parts = def.params.filter((p) => p.type !== 'checkbox')
    .map((p) => [p, String(A.renderTemplate(params[p.key] ?? p.default, vars))])
    .filter(([, v]) => v !== '').slice(0, 3)
    .map(([p, v]) => `${p.label.split(' (')[0].toLowerCase()}: ${v.slice(0, 40)}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export class Engine extends EventEmitter {
  constructor({ devices, store, notifier, screenshotsDir, proxies }) {
    super();
    this.proxies = proxies;
    this.devices = devices;
    this.store = store;
    this.notifier = notifier;
    this.screenshotsDir = screenshotsDir;
    this.runs = new Map();
    this.seqCounters = {};
    this.runCounter = 0;
  }

  listRuns() {
    return [...this.runs.values()].map((r) => ({
      id: r.id, workflowId: r.workflowId, workflow: r.workflowName, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status,
      devices: Object.fromEntries(Object.entries(r.devices).map(([s, d]) => [s, { status: d.status, step: d.step, nodeId: d.nodeId }])),
    }));
  }

  /** Lanza un flujo. Devuelve el id de la ejecución. */
  start(workflow, serials, { concurrency = 10, staggerMs = 0, source = 'manual' } = {}) {
    const graph = compileDrawflow(workflow.graph);
    if (!graph.startIds.length) throw new Error('El flujo necesita un nodo "Inicio"');
    if (graph.startIds.every((id) => !graph.nodes[id].next.flat().length)) {
      throw new Error('El nodo "Inicio" no está conectado a ningún otro nodo: arrastra desde su punto de salida hasta el siguiente nodo');
    }
    if (!serials.length) throw new Error('No hay dispositivos seleccionados');
    const id = `run-${Date.now().toString(36)}-${++this.runCounter}`;
    const controller = new AbortController();
    const run = {
      id, workflowId: workflow.id, workflowName: workflow.name, startedAt: Date.now(), finishedAt: null, status: 'running', source,
      controller, devices: Object.fromEntries(serials.map((s) => [s, { status: 'en cola', step: '' }])),
    };
    this.runs.set(id, run);
    this.emit('runs', this.listRuns());

    const queue = serials.map((s, index) => ({ serial: s, index }));
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const { serial, index } = queue.shift();
        if (staggerMs && index > 0) await A.sleep(staggerMs * Math.min(index, concurrency), controller.signal).catch(() => {});
        await this.runOnDevice(run, graph, serial, index);
      }
    };
    Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, serials.length)) }, worker)).then(() => {
      run.finishedAt = Date.now();
      run.status = controller.signal.aborted ? 'detenido' : 'completado';
      for (const d of Object.values(run.devices)) if (d.status === 'en cola') d.status = 'cancelado';
      this.emit('runs', this.listRuns());
      this.history({ id, workflow: workflow.name, source, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status,
        results: Object.fromEntries(Object.entries(run.devices).map(([s, d]) => [s, d.status])) });
      // Las ejecuciones terminadas se limpian de la vista activa tras un rato.
      setTimeout(() => { this.runs.delete(id); this.emit('runs', this.listRuns()); }, 10 * 60 * 1000).unref?.();
    });
    return id;
  }

  /** Avisa a la interfaz del progreso sin saturarla (como mucho cada 150 ms). */
  emitRunsSoon() {
    if (this.runsTimer) return;
    this.runsTimer = setTimeout(() => { this.runsTimer = null; this.emit('runs', this.listRuns()); }, 150);
    this.runsTimer.unref?.();
  }

  stop(runId) {
    const run = this.runs.get(runId);
    if (run) run.controller.abort();
  }

  stopAll() {
    for (const r of this.runs.values()) r.controller.abort();
  }

  history(entry) {
    const h = this.store.get('history') || [];
    h.unshift(entry);
    this.store.set('history', h.slice(0, 500));
  }

  log(runId, serial, level, message) {
    this.emit('log', { time: Date.now(), runId, serial, level, message });
  }

  async runOnDevice(run, graph, serial, index) {
    const state = run.devices[serial];
    const signal = run.controller.signal;
    const meta = (this.store.get('deviceMeta') || {})[serial] || {};
    const vars = {
      'device.serial': serial, 'device.name': meta.name || serial, 'device.group': meta.group || '',
      'device.index': index, 'device.proxy': meta.proxy || '', 'run.id': run.id,
    };
    const loopCounters = {};
    state.status = 'ejecutando';
    this.emit('runs', this.listRuns());
    this.log(run.id, serial, 'info', `Inicio de "${run.workflowName}"`);
    let device;
    try {
      device = this.devices.get(serial);
    } catch (e) {
      state.status = 'error';
      this.log(run.id, serial, 'error', e.message);
      return;
    }
    try {
      let steps = 0;
      const stack = [...graph.startIds];
      while (stack.length) {
        if (signal.aborted) throw new Error('Detenido');
        if (++steps > MAX_STEPS) throw new Error('Demasiados pasos (¿bucle infinito?)');
        const node = graph.nodes[stack.shift()];
        if (!node) continue;
        const def = NODE_MAP[node.type];
        const label = def?.label || node.type;
        state.step = label;
        state.nodeId = node.id;
        this.emitRunsSoon();
        if (node.type !== 'start' && node.type !== 'log') this.log(run.id, serial, 'step', `${label}${stepSummary(def, node.params, vars)}`);
        let outIndex;
        try {
          outIndex = await this.execNode(node, { device, vars, signal, run, serial, loopCounters, index });
        } catch (e) {
          if (signal.aborted) throw e;
          throw new Error(`Error en "${label}": ${e.message.split('\n')[0]}`);
        }
        if (outIndex == null || outIndex < 0) continue;
        const next = node.next[outIndex] || [];
        if (!next.length && def?.outputs.length > 1 && node.next.some((n) => n.length)) {
          this.log(run.id, serial, 'warn', `"${label}" salió por "${def.outputs[outIndex]}", que no está conectada: el flujo termina aquí`);
        }
        stack.unshift(...next);
      }
      state.status = 'ok';
      this.log(run.id, serial, 'info', 'Flujo completado');
    } catch (e) {
      state.status = signal.aborted ? 'detenido' : 'error';
      this.log(run.id, serial, signal.aborted ? 'warn' : 'error', e.message);
    }
    state.step = '';
    state.nodeId = null;
    this.emit('runs', this.listRuns());
  }

  /** Ejecuta un nodo y devuelve el índice de la salida a seguir (o null para terminar). */
  async execNode(node, ctx) {
    const { device, vars, signal } = ctx;
    const p = {};
    for (const [k, v] of Object.entries(node.params)) p[k] = typeof v === 'string' ? A.renderTemplate(v, vars) : v;
    const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : d);
    const log = (msg, level = 'info') => this.log(ctx.run.id, ctx.serial, level, msg);

    switch (node.type) {
      case 'start': return 0;
      case 'stop': return null;
      case 'wait': await A.sleep(num(p.ms, 1000), signal); return 0;
      case 'random_wait': await A.sleep(A.randInt(num(p.min, 500), Math.max(num(p.min, 500), num(p.max, 1500))), signal); return 0;
      case 'loop': {
        const count = (ctx.loopCounters[node.id] ?? 0) + 1;
        if (count > num(p.times, 1)) { delete ctx.loopCounters[node.id]; return 1; }
        ctx.loopCounters[node.id] = count;
        vars[`loop.${node.id}`] = count;
        vars.iteracion = count;
        return 0;
      }
      case 'random_branch': return Math.random() * 100 < num(p.percent, 50) ? 0 : 1;
      case 'set_var': vars[p.name] = p.value; return 0;
      case 'math_var': {
        const a = num(vars[p.name], 0); const b = num(p.value, 0);
        vars[p.name] = { '+': a + b, '-': a - b, '*': a * b, '/': b ? a / b : a }[p.op] ?? a;
        return 0;
      }
      case 'if_var': {
        const raw = vars[p.name]; const a = num(raw, NaN); const b = num(p.value, NaN);
        const numeric = Number.isFinite(a) && Number.isFinite(b);
        const ok = {
          '==': String(raw) === String(p.value), '!=': String(raw) !== String(p.value),
          '>': numeric && a > b, '<': numeric && a < b, '>=': numeric && a >= b, '<=': numeric && a <= b,
          contiene: String(raw ?? '').includes(p.value),
        }[p.op];
        return ok ? 0 : 1;
      }
      case 'log': log(p.message); return 0;

      case 'tap': {
        const [x, y] = await A.resolvePoint(device, p.x, p.y);
        await A.tap(device, x, y, num(p.jitter, 0));
        return 0;
      }
      case 'long_press': {
        const [x, y] = await A.resolvePoint(device, p.x, p.y);
        await device.shell(`input swipe ${x} ${y} ${x} ${y} ${num(p.ms, 800)}`);
        return 0;
      }
      case 'swipe': {
        const [x1, y1] = await A.resolvePoint(device, p.x1, p.y1);
        const [x2, y2] = await A.resolvePoint(device, p.x2, p.y2);
        await A.swipe(device, x1, y1, x2, y2, num(p.ms, 350), !!p.humanize);
        return 0;
      }
      case 'scroll': {
        const vec = { abajo: ['50%', '75%', '50%', '25%'], arriba: ['50%', '25%', '50%', '75%'],
          izquierda: ['80%', '50%', '20%', '50%'], derecha: ['20%', '50%', '80%', '50%'] }[p.direction] || ['50%', '75%', '50%', '25%'];
        const [x1, y1] = await A.resolvePoint(device, vec[0], vec[1]);
        const [x2, y2] = await A.resolvePoint(device, vec[2], vec[3]);
        const times = num(p.count, 1);
        for (let i = 0; i < times; i++) {
          await A.swipe(device, x1, y1, x2, y2, A.randInt(250, 450), true);
          if (i < times - 1) await A.sleep(num(p.pause, 1200) * (0.7 + Math.random() * 0.6), signal);
        }
        return 0;
      }
      case 'type_text': await A.typeText(device, p.text, !!p.humanize, signal); return 0;
      case 'key': await device.shell(`input keyevent ${KEYCODES[p.key] ?? p.key}`); return 0;

      case 'tap_text':
      case 'tap_id':
      case 'tap_xpath': {
        const query = node.type === 'tap_id' ? { id: p.id } : node.type === 'tap_xpath' ? { xpath: p.xpath, vars } : { text: p.text, exact: !!p.exact };
        const found = await A.waitForNode(device, query, num(p.timeout, 5000), signal);
        if (!found) { log(`No se encontró "${p.text || p.id || p.xpath}"`, 'warn'); return 1; }
        await A.tap(device, found.cx, found.cy, 3);
        return 0;
      }
      case 'if_text':
      case 'if_xpath': {
        const query = node.type === 'if_xpath' ? { xpath: p.xpath, vars } : { text: p.text, exact: !!p.exact };
        const found = await A.waitForNode(device, query, num(p.timeout, 3000), signal);
        return found ? 0 : 1;
      }
      case 'read_text': {
        // Breve espera tolerante: con vídeos en pantalla uiautomator falla a ratos.
        const found = await A.waitForNode(device, p.xpath ? { xpath: p.xpath, vars } : { id: p.id }, num(p.timeout, 2000), signal);
        if (!found) return 1;
        vars[p.var || 'texto'] = found.text || found.desc;
        return 0;
      }
      case 'if_color': {
        const [x, y] = await A.resolvePoint(device, p.x, p.y);
        const raw = await device.screencapRaw();
        const off = (y * raw.width + x) * 4;
        const px = [raw.data[off], raw.data[off + 1], raw.data[off + 2]];
        const target = A.hexToRgb(p.color);
        const tol = num(p.tolerance, 24);
        vars.color = `#${px.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        return px.every((c, i) => Math.abs(c - target[i]) <= tol) ? 0 : 1;
      }
      case 'screenshot': {
        const png = await device.screencapPng();
        fs.mkdirSync(this.screenshotsDir, { recursive: true });
        const file = path.join(this.screenshotsDir, `${p.name.replace(/[^\w.-]+/g, '_') || Date.now()}.png`);
        fs.writeFileSync(file, png);
        log(`Captura guardada: ${file}`);
        return 0;
      }

      case 'open_app': {
        const component = await A.launchApp(device, p.package);
        log(`App abierta: ${component}`);
        return 0;
      }
      case 'stop_app': await device.shell(`am force-stop ${p.package}`); return 0;
      case 'clear_app': await device.shell(`pm clear ${p.package}`); return 0;
      case 'if_app': return (await A.foregroundPackage(device)) === p.package ? 0 : 1;
      case 'open_url': await device.shell(`am start -a android.intent.action.VIEW -d '${p.url.replace(/'/g, '')}'`); return 0;
      case 'install_apk': {
        try {
          const out = await device.install(p.path);
          log(`Instalación: ${String(out).trim().split('\n').pop()}`);
          return 0;
        } catch (e) { log(`Error instalando: ${e.message}`, 'error'); return 1; }
      }
      case 'uninstall': await device.shell(`pm uninstall ${p.package}`).catch(() => {}); return 0;

      case 'shell': {
        const out = await device.shell(p.command);
        if (p.var) vars[p.var] = String(out).trim();
        log(`$ ${p.command}\n${String(out).trim().slice(0, 2000)}`);
        return 0;
      }
      case 'wake_unlock': {
        // Solo se desliza si hay pantalla de bloqueo: en un teléfono ya desbloqueado, deslizar hacia arriba
        // abre el cajón de apps y estropea el resto del flujo.
        let st = await A.screenState(device);
        if (st.asleep) {
          await device.shell('input keyevent 224');
          await A.sleep(700, signal);
          st = await A.screenState(device);
        }
        if (st.locked) {
          const [x, y1] = await A.resolvePoint(device, '50%', '85%');
          const [, y2] = await A.resolvePoint(device, '50%', '30%');
          await device.shell(`input swipe ${x} ${y1} ${x} ${y2} 250`);
          if (p.pin) {
            await A.sleep(700, signal);
            await device.shell(`input text ${p.pin.replace(/\D/g, '')}; input keyevent 66`);
          }
          await A.sleep(500, signal);
          log('Pantalla desbloqueada');
        }
        return 0;
      }
      case 'set_proxy': {
        // Con usuario y clave pasa por el puente de la app (Android no sabe autenticarse en el proxy).
        const px = p.proxy ? parseProxyLine(p.proxy) : null;
        if (p.proxy && !px) throw new Error(`Proxy no válido: ${p.proxy}`);
        if (this.proxies) await (px ? this.proxies.applyProxy(ctx.serial, px) : this.proxies.clearOnDevice(ctx.serial));
        else await device.shell(`settings put global http_proxy ${px ? `${px.host}:${px.port}` : ':0'}`);
        return 0;
      }
      case 'proxy_assigned': {
        if (!this.proxies.assignments()[ctx.serial]) { log('Sin proxy asignado', 'warn'); return 1; }
        log(`Proxy aplicado: ${await this.proxies.apply(ctx.serial)}`);
        return 0;
      }
      case 'proxy_rotate': {
        const key = this.proxies.rotate(ctx.serial);
        await this.proxies.apply(ctx.serial);
        vars.proxy = key;
        log(`Proxy rotado a ${key}`);
        return 0;
      }
      case 'airplane': {
        const on = 'settings put global airplane_mode_on 1; am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true; cmd connectivity airplane-mode enable';
        const off = 'settings put global airplane_mode_on 0; am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false; cmd connectivity airplane-mode disable';
        await device.shell(`${on} 2>/dev/null`).catch(() => {});
        await A.sleep(num(p.ms, 4000), signal);
        await device.shell(`${off} 2>/dev/null`).catch(() => {});
        return 0;
      }
      case 'wifi': await device.shell(`svc wifi ${p.state === 'apagar' ? 'disable' : 'enable'}`); return 0;
      case 'push_file': {
        let remote = p.remote || '/sdcard/Download/';
        await device.push(p.local, remote);
        if (remote.endsWith('/')) remote += path.basename(p.local.replace(/\\/g, '/'));
        if (p.scan) await device.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${remote}'`).catch(() => {});
        return 0;
      }

      case 'data_row': {
        const table = (this.store.get('tables') || []).find((x) => x.name === p.table);
        if (!table || !table.rows.length) { log(`Tabla "${p.table}" vacía o inexistente`, 'warn'); return 1; }
        let row;
        if (p.mode === 'aleatoria') row = table.rows[A.randInt(0, table.rows.length - 1)];
        else if (p.mode === 'secuencial') {
          const i = this.seqCounters[p.table] = (this.seqCounters[p.table] ?? -1) + 1;
          if (i >= table.rows.length) return 1;
          row = table.rows[i];
        } else {
          row = table.rows[ctx.index];
          if (!row) return 1;
        }
        table.columns.forEach((c, i) => { vars[c] = row[i] ?? ''; });
        return 0;
      }
      case 'http': {
        try {
          const res = await fetch(p.url, {
            method: p.method || 'GET',
            headers: p.body ? { 'content-type': 'application/json' } : undefined,
            body: p.body && p.method !== 'GET' ? p.body : undefined,
            signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
          });
          const text = await res.text();
          vars[p.var || 'respuesta'] = text;
          try {
            const json = JSON.parse(text);
            if (json && typeof json === 'object') for (const [k, v] of Object.entries(json)) if (typeof v !== 'object') vars[`${p.var || 'respuesta'}.${k}`] = v;
          } catch {}
          return res.ok ? 0 : 1;
        } catch (e) { log(`HTTP: ${e.message}`, 'warn'); return 1; }
      }
      case 'notify': await this.notifier.send(p.message).catch((e) => log(`Notificación: ${e.message}`, 'warn')); return 0;
      default:
        throw new Error(`Tipo de nodo desconocido: ${node.type}`);
    }
  }
}
