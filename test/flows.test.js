// Ejecuta las plantillas en un teléfono simulado que se comporta como uno real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/main/automation/engine.js';
import { TEMPLATES, buildGraph } from '../src/renderer/templates.js';

const UI = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Iniciar sesión" resource-id="app:id/login" bounds="[100,900][980,1000]"/>
<node text="Usuario" resource-id="app:id/user" bounds="[100,1100][980,1200]"/>
<node text="Contraseña" resource-id="app:id/pass" bounds="[100,1300][980,1400]"/></hierarchy>`;

class RealisticPhone {
  constructor({ locked = false, asleep = false, uiFailures = 0 } = {}) {
    Object.assign(this, { locked, asleep, uiFailures, cmds: [] });
  }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.startsWith('dumpsys power')) {
      return `mWakefulness=${this.asleep ? 'Asleep' : 'Awake'}\n${this.locked ? 'mShowingLockscreen=true' : ''}`;
    }
    if (cmd === 'input keyevent 224') { this.asleep = false; return ''; }
    if (cmd.startsWith('input swipe') && this.locked) { this.locked = false; return ''; }
    if (cmd.includes('uiautomator dump')) {
      if (this.uiFailures-- > 0) return 'ERROR: could not get idle state.';
      return `UI hierchary dumped to: /sdcard/granja_ui.xml\n${UI}`;
    }
    if (cmd.startsWith('monkey -p com.noexiste')) return '** No activities found to run, monkey aborted.';
    if (cmd.startsWith('pm install') || cmd.includes('ipify')) return '203.0.113.7';
    if (cmd.includes('dumpsys battery | grep level')) return '12';
    return '';
  }
  async install() { return 'Success'; }
  async screencapPng() { return Buffer.from('89504e470d0a1a0a', 'hex'); }
}

function engineFor(phone, tables = []) {
  const data = { deviceMeta: { S1: { name: 'Tel-01' } }, history: [], tables };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const notifier = { sent: [], send: async (m) => notifier.sent.push(m) };
  const proxies = { assignments: () => ({}), apply: async () => '' };
  const engine = new Engine({ devices: { get: () => phone }, store, notifier, screenshotsDir: '/tmp', proxies });
  return { engine, notifier };
}

function run(engine, graph) {
  return new Promise((resolve) => {
    const logs = [];
    engine.on('log', (l) => logs.push(l));
    const id = engine.start({ id: 'w', name: 'prueba', graph }, ['S1']);
    const check = () => {
      const r = engine.listRuns().find((x) => x.id === id);
      if (r.status !== 'running') resolve({ status: r.devices.S1.status, logs }); else setTimeout(check, 5);
    };
    check();
  });
}

// Las esperas reales harían las pruebas lentísimas: se acortan.
function fast(graph) {
  for (const n of Object.values(graph.drawflow.Home.data)) {
    if (n.name === 'random_wait') Object.assign(n.data, { min: 1, max: 2 });
    if (n.name === 'wait' || n.name === 'airplane') n.data.ms = 1;
    if (n.name === 'scroll') n.data.pause = 1;
    if (n.name === 'loop') n.data.times = '2';
  }
  return graph;
}

test('todas las plantillas terminan sin error en un teléfono realista', async () => {
  const tables = [{ name: 'cuentas', columns: ['usuario', 'clave'], rows: [['ana', 'Clave1000!']] }];
  for (const t of TEMPLATES) {
    const phone = new RealisticPhone({ locked: true });
    const { engine } = engineFor(phone, tables);
    const res = await run(engine, fast(t.build()));
    const errors = res.logs.filter((l) => l.level === 'error').map((l) => l.message);
    assert.equal(res.status, 'ok', `${t.name}: ${errors.join(' | ')}`);
  }
});

test('login: escribe usuario y clave exactos y toca los campos', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone, [{ name: 'cuentas', columns: ['usuario', 'clave'], rows: [['ana', 'Clave1000!']] }]);
  await run(engine, fast(TEMPLATES.find((t) => t.name.startsWith('Login')).build()));
  const typed = phone.cmds.filter((c) => c.startsWith('input text')).map((c) => c.slice(11).replace(/^'|'$/g, '')).join('');
  assert.equal(typed, 'anaClave1000!');
  assert.ok(phone.cmds.some((c) => /^input tap \d+ (9[4-6]\d)$/.test(c)), 'toca "Iniciar sesión"');
});

test('scroll usa un único input swipe, no motionevent', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone);
  await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'scroll', params: { count: '2', pause: 1 }, x: 0, y: 0 }], [[0, 0, 1]]));
  const swipes = phone.cmds.filter((c) => c.startsWith('input'));
  assert.equal(swipes.length, 2);
  assert.ok(swipes.every((c) => /^input swipe \d+ \d+ \d+ \d+ \d+$/.test(c)));
});

test('despertar: no desliza si el teléfono ya está desbloqueado', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone);
  await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'wake_unlock', x: 0, y: 0 }], [[0, 0, 1]]));
  assert.ok(!phone.cmds.some((c) => c.startsWith('input')));
  const locked = new RealisticPhone({ asleep: true, locked: true });
  const r2 = engineFor(locked);
  await run(r2.engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'wake_unlock', params: { pin: '1234' }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.ok(locked.cmds.includes('input keyevent 224'));
  assert.ok(locked.cmds.some((c) => c.startsWith('input swipe')));
  assert.ok(locked.cmds.includes('input text 1234; input keyevent 66'));
});

test('uiautomator que falla al principio se reintenta', async () => {
  const phone = new RealisticPhone({ uiFailures: 2 });
  const { engine } = engineFor(phone);
  const res = await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'tap_text', params: { text: 'Usuario', timeout: 0 }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.equal(res.status, 'ok');
  assert.ok(phone.cmds.some((c) => /^input tap \d+ 11[4-6]\d$/.test(c)));
});

test('errores claros: app no instalada e Inicio sin conectar', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone);
  const res = await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'open_app', params: { package: 'com.noexiste' }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.equal(res.status, 'error');
  assert.ok(res.logs.some((l) => l.message.includes('Error en "Abrir app"') && l.message.includes('no está instalada')));
  assert.throws(() => engine.start({ name: 'x', graph: buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'tap', x: 0, y: 0 }], []) }, ['S1']), /no está conectado/);
});

test('el registro muestra cada paso', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone);
  const res = await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'tap', params: { x: '10%', y: '20%' }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.ok(res.logs.some((l) => l.level === 'step' && l.message.startsWith('Tocar (x: 10%, y: 20%')));
});
