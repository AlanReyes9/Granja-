import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, compileDrawflow } from '../src/main/automation/engine.js';
import { renderTemplate, resolveCoord, parseUiDump, findNode, escapeInputText } from '../src/main/automation/actions.js';
import { parseDevicesOutput } from '../src/main/adb/exe.js';
import { parseCsv, toCsv } from '../src/main/csv.js';
import { isDue } from '../src/main/scheduler.js';
import { NODE_TYPES } from '../src/shared/nodes.js';
import { TEMPLATES, buildGraph } from '../src/renderer/templates.js';

class FakeDevice {
  constructor() { this.cmds = []; this.ui = ''; }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd === 'wm size') return 'Physical size: 1080x2400\n';
    if (cmd.startsWith('uiautomator')) return this.ui;
    if (cmd.startsWith('getprop')) return 'Pixel 7\n';
    return '';
  }
  async getScreenSize() { return { width: 1080, height: 2400 }; }
}

function makeEngine(device, extra = {}) {
  const data = { deviceMeta: { S1: { name: 'Tel-01' } }, history: [], tables: [], ...extra };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const devices = { get: () => device };
  const notifier = { sent: [], send: async (m) => notifier.sent.push(m) };
  return { engine: new Engine({ devices, store, notifier, screenshotsDir: '/tmp' }), store, notifier };
}

function runToEnd(engine, wf, serials = ['S1']) {
  return new Promise((resolve) => {
    const logs = [];
    engine.on('log', (l) => logs.push(l));
    const id = engine.start(wf, serials, { concurrency: 2 });
    const check = () => {
      const r = engine.listRuns().find((x) => x.id === id);
      if (r.status !== 'running') resolve({ run: r, logs }); else setTimeout(check, 5);
    };
    check();
  });
}

test('templates', () => {
  const vars = { 'device.name': 'Tel-01', n: 3 };
  assert.equal(renderTemplate('Hola {device.name} #{n}', vars), 'Hola Tel-01 #3');
  const r = Number(renderTemplate('{rand:5-7}', vars));
  assert.ok(r >= 5 && r <= 7);
  assert.ok(['a', 'b'].includes(renderTemplate('{pick:a|b}', vars)));
  assert.equal(renderTemplate('{desconocida}', vars), '{desconocida}');
});

test('coordenadas en % y px', () => {
  assert.equal(resolveCoord('50%', 1080), 540);
  assert.equal(resolveCoord('300', 1080), 300);
  assert.throws(() => resolveCoord('abc', 1080));
});

test('escape de input text', () => {
  assert.equal(escapeInputText('hola mundo'), 'hola%smundo');
  assert.equal(escapeInputText('a&b'), 'a\\&b');
});

test('parse adb devices -l', () => {
  const out = `List of devices attached
R58M123ABC             device usb:1-1.2 product:a51 model:SM_A515F device:a51 transport_id:3
192.168.1.40:5555      device product:x model:Pixel_7 device:p transport_id:4
ZY22XYZ                unauthorized usb:1-1.3 transport_id:5
`;
  const list = parseDevicesOutput(out);
  assert.equal(list.length, 3);
  assert.deepEqual([list[0].transport, list[0].model, list[0].state], ['usb', 'SM A515F', 'device']);
  assert.equal(list[1].transport, 'wifi');
  assert.equal(list[2].state, 'unauthorized');
});

test('parse UI dump', () => {
  const xml = `<?xml version='1.0'?><hierarchy><node index="0" text="Iniciar sesión" resource-id="com.app:id/login" class="android.widget.Button" content-desc="" clickable="true" bounds="[100,200][300,260]" /><node text="" content-desc="Perfil &amp; ajustes" resource-id="" bounds="[0,0][50,50]"/></hierarchy>`;
  const nodes = parseUiDump(xml);
  assert.equal(nodes.length, 2);
  assert.deepEqual([nodes[0].cx, nodes[0].cy], [200, 230]);
  assert.equal(findNode(nodes, { text: 'iniciar' }).id, 'com.app:id/login');
  assert.equal(findNode(nodes, { text: 'iniciar', exact: true }), undefined);
  assert.equal(findNode(nodes, { text: 'perfil & ajustes', exact: true }).cx, 25);
  assert.equal(findNode(nodes, { id: 'login' }).text, 'Iniciar sesión');
});

test('CSV', () => {
  const rows = parseCsv('usuario,clave\n"ana, la",x1\r\nbob,"y""2"\n');
  assert.deepEqual(rows, [['usuario', 'clave'], ['ana, la', 'x1'], ['bob', 'y"2']]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.equal(toCsv([['a,b', 'c']]), '"a,b",c');
});

test('scheduler isDue', () => {
  const d = new Date(2026, 0, 5, 9, 0, 10).getTime(); // lunes 09:00
  assert.ok(isDue({ enabled: true, mode: 'daily', time: '09:00', days: [1] }, d, 0));
  assert.ok(!isDue({ enabled: true, mode: 'daily', time: '09:00', days: [2] }, d, 0));
  assert.ok(!isDue({ enabled: true, mode: 'daily', time: '09:00' }, d, d - 5000));
  assert.ok(isDue({ enabled: true, mode: 'interval', everyMinutes: 10 }, d, d - 11 * 60000));
  assert.ok(!isDue({ enabled: true, mode: 'interval', everyMinutes: 10 }, d, d - 60000));
  assert.ok(!isDue({ enabled: false, mode: 'interval', everyMinutes: 1 }, d, 0));
});

test('todas las plantillas compilan y usan nodos conocidos', () => {
  const types = new Set(NODE_TYPES.map((n) => n.type));
  for (const t of TEMPLATES) {
    const g = compileDrawflow(t.build());
    assert.equal(g.startIds.length, 1, t.name);
    for (const n of Object.values(g.nodes)) assert.ok(types.has(n.type), `${t.name}: ${n.type}`);
  }
});

test('motor: bucle, variables, condición y toques', async () => {
  const dev = new FakeDevice();
  const { engine } = makeEngine(dev);
  const graph = buildGraph([
    { type: 'start', x: 0, y: 0 },
    { type: 'set_var', params: { name: 'c', value: '0' }, x: 0, y: 0 },
    { type: 'loop', params: { times: '3' }, x: 0, y: 0 },
    { type: 'math_var', params: { name: 'c', op: '+', value: '2' }, x: 0, y: 0 },
    { type: 'if_var', params: { name: 'c', op: '==', value: '6' }, x: 0, y: 0 },
    { type: 'tap', params: { x: '50%', y: '10%', jitter: 0 }, x: 0, y: 0 },
    { type: 'log', params: { message: 'c={c} en {device.name}' }, x: 0, y: 0 },
  ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 2], [2, 1, 4], [4, 0, 5], [5, 0, 6]]);
  const { run, logs } = await runToEnd(engine, { id: 'w', name: 'test', graph });
  assert.equal(run.devices.S1.status, 'ok');
  assert.ok(dev.cmds.includes('input tap 540 240'));
  assert.ok(logs.some((l) => l.message === 'c=6 en Tel-01'));
});

test('motor: tocar texto con rama de no encontrado', async () => {
  const dev = new FakeDevice();
  dev.ui = '<node text="Aceptar" bounds="[0,0][100,100]"/>';
  const { engine } = makeEngine(dev);
  const graph = buildGraph([
    { type: 'start', x: 0, y: 0 },
    { type: 'tap_text', params: { text: 'Aceptar', timeout: 0 }, x: 0, y: 0 },
    { type: 'tap_text', params: { text: 'Inexistente', timeout: 0 }, x: 0, y: 0 },
    { type: 'log', params: { message: 'no estaba' }, x: 0, y: 0 },
  ], [[0, 0, 1], [1, 0, 2], [2, 1, 3]]);
  const { run, logs } = await runToEnd(engine, { id: 'w', name: 't', graph });
  assert.equal(run.devices.S1.status, 'ok');
  assert.ok(dev.cmds.some((c) => /^input tap \d+ \d+$/.test(c)));
  assert.ok(logs.some((l) => l.message === 'no estaba'));
});

test('motor: tabla de datos por dispositivo y notificación', async () => {
  const dev = new FakeDevice();
  const { engine, notifier } = makeEngine(dev, { tables: [{ name: 'cuentas', columns: ['usuario'], rows: [['ana'], ['bob']] }] });
  const graph = buildGraph([
    { type: 'start', x: 0, y: 0 },
    { type: 'data_row', params: { table: 'cuentas', mode: 'por dispositivo' }, x: 0, y: 0 },
    { type: 'notify', params: { message: 'hola {usuario}' }, x: 0, y: 0 },
  ], [[0, 0, 1], [1, 0, 2]]);
  await runToEnd(engine, { id: 'w', name: 't', graph }, ['S1', 'S2']);
  assert.deepEqual(notifier.sent.sort(), ['hola ana', 'hola bob']);
});

test('motor: se puede detener', async () => {
  const dev = new FakeDevice();
  const { engine } = makeEngine(dev);
  const graph = buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'wait', params: { ms: 60000 }, x: 0, y: 0 }], [[0, 0, 1]]);
  const id = engine.start({ id: 'w', name: 't', graph }, ['S1']);
  setTimeout(() => engine.stop(id), 30);
  const r = await new Promise((resolve) => {
    const check = () => { const x = engine.listRuns().find((y) => y.id === id); x.status !== 'running' ? resolve(x) : setTimeout(check, 5); };
    check();
  });
  assert.equal(r.status, 'detenido');
  assert.equal(r.devices.S1.status, 'detenido');
});

test('motor: rechaza flujos sin inicio', () => {
  const { engine } = makeEngine(new FakeDevice());
  assert.throws(() => engine.start({ name: 'x', graph: buildGraph([{ type: 'log', x: 0, y: 0 }], []) }, ['S1']), /Inicio/);
});
