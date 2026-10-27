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
  constructor({ locked = false, asleep = false, uiFailures = 0, oldAndroid = false } = {}) {
    Object.assign(this, { locked, asleep, uiFailures, oldAndroid, cmds: [] });
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
    const resolve = cmd.match(/^cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ([\w.]+)/);
    if (resolve) return resolve[1] === 'com.noexiste' || this.oldAndroid ? 'No activity found' : `priority=0 preferredOrder=0\n${resolve[1]}/.MainActivity`;
    if (cmd.startsWith('pm path')) return cmd.includes('com.noexiste') ? '' : 'package:/data/app/base.apk';
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

test('abrir app: usa am start con la actividad de inicio, no monkey (salvo en Android antiguo)', async () => {
  const graph = buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'open_app', params: { package: 'com.instagram.android' }, x: 0, y: 0 }], [[0, 0, 1]]);
  const phone = new RealisticPhone();
  const res = await run(engineFor(phone).engine, graph);
  assert.equal(res.status, 'ok');
  assert.ok(phone.cmds.includes('am start -n com.instagram.android/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -f 0x10200000'));
  assert.ok(!phone.cmds.some((c) => c.startsWith('monkey')));

  const old = new RealisticPhone({ oldAndroid: true });
  assert.equal((await run(engineFor(old).engine, graph)).status, 'ok');
  assert.ok(old.cmds.some((c) => c.startsWith('monkey -p com.instagram.android')));

  const bad = await run(engineFor(new RealisticPhone()).engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'open_app', params: { package: 'com.x; reboot' }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.equal(bad.status, 'error');
});

test('el registro muestra cada paso', async () => {
  const phone = new RealisticPhone();
  const { engine } = engineFor(phone);
  const res = await run(engine, buildGraph([{ type: 'start', x: 0, y: 0 }, { type: 'tap', params: { x: '10%', y: '20%' }, x: 0, y: 0 }], [[0, 0, 1]]));
  assert.ok(res.logs.some((l) => l.level === 'step' && l.message.startsWith('Tocar (x: 10%, y: 20%')));
});

// Instagram simulado: pantallas de inicio, búsqueda, perfil y publicaciones, que cambian con los toques.
class InstagramPhone {
  constructor({ followed = false, likedPosts = [], searchWorks = true } = {}) {
    Object.assign(this, { followed, liked: new Set(likedPosts), searchWorks, screen: 'none', typed: '', post: 0, cmds: [] });
  }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  elements() {
    const IG = 'com.instagram.android:id';
    switch (this.screen) {
      case 'home': return this.searchWorks ? [{ id: `${IG}/search_tab`, desc: 'Buscar y explorar', b: [432, 2200, 648, 2340], go: () => { this.screen = 'search'; } }] : [];
      case 'search': return [
        { id: `${IG}/action_bar_search_edit_text`, text: this.typed || 'Buscar', cls: 'android.widget.EditText', b: [40, 100, 1040, 200], go: () => {} },
        ...(this.typed ? [{ id: `${IG}/row_search_user_username`, text: this.typed, b: [40, 300, 1040, 400], go: () => { this.screen = 'profile'; } }] : []),
      ];
      case 'profile': return [
        { id: `${IG}/profile_header_follow_button`, text: this.followed ? 'Siguiendo' : 'Seguir', cls: 'android.widget.Button', b: [40, 600, 520, 700], go: () => { this.followed = true; } },
        { desc: 'Foto de perfil de nasa', b: [40, 250, 240, 450], go: () => { this.screen = 'story'; } },
        { id: `${IG}/image_button`, desc: 'Foto de nasa en la fila 1, columna 1', b: [0, 1000, 360, 1360], go: () => { this.screen = 'post'; } },
      ];
      case 'post': return [0, 1].map((k) => {
        const i = this.post + k;
        const liked = this.liked.has(i);
        return { id: `${IG}/row_feed_button_like`, desc: liked ? 'Ya no me gusta' : 'Me gusta', selected: liked, b: [20, 900 + k * 1000, 120, 1000 + k * 1000], go: () => this.liked.add(i) };
      });
      default: return [];
    }
  }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.includes('uiautomator dump')) {
      const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const nodes = this.elements().map((e) => `<node text="${esc(e.text)}" resource-id="${esc(e.id)}" class="${e.cls || 'android.widget.ImageView'}" content-desc="${esc(e.desc)}" selected="${!!e.selected}" clickable="true" bounds="[${e.b[0]},${e.b[1]}][${e.b[2]},${e.b[3]}]" />`);
      return `<?xml version="1.0"?><hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">${nodes.join('')}</node></hierarchy>`;
    }
    if (cmd.startsWith('cmd package resolve-activity')) return 'com.instagram.android/com.instagram.mainactivity.LauncherActivity';
    if (cmd.startsWith('am start -n com.instagram.android')) { this.screen = 'home'; return 'Starting'; }
    if (cmd.startsWith("am start -a android.intent.action.VIEW -d 'https://www.instagram.com/")) { this.screen = 'profile'; this.viaLink = cmd; return 'Starting'; }
    const tap = cmd.match(/^input tap (\d+) (\d+)/);
    if (tap) {
      const [x, y] = [Number(tap[1]), Number(tap[2])];
      const hit = this.elements().find((e) => x >= e.b[0] && x <= e.b[2] && y >= e.b[1] && y <= e.b[3]);
      hit?.go();
      return '';
    }
    const text = cmd.match(/^input text '(.*)'$/);
    if (text && this.screen === 'search') { this.typed += text[1]; return ''; }
    if (cmd.startsWith('input swipe') && this.screen === 'post') { this.post++; return ''; }
    return '';
  }
}

function instagramFlow(perfil, likes) {
  const graph = fast(TEMPLATES.find((t) => t.name.startsWith('Instagram')).build());
  for (const n of Object.values(graph.drawflow.Home.data)) {
    if (n.name === 'set_var' && n.data.name === 'perfil') n.data.value = perfil;
    if (n.name === 'set_var' && n.data.name === 'likes') n.data.value = String(likes);
    if (n.name === 'loop') n.data.times = '{likes}';
  }
  return graph;
}

test('Instagram: busca el perfil de la variable, lo sigue y da me gusta solo a lo que no lo tiene', async () => {
  const phone = new InstagramPhone({ likedPosts: [1] });
  const { engine } = engineFor(phone);
  const res = await run(engine, instagramFlow('nasa', 4));
  assert.equal(res.status, 'ok', res.logs.filter((l) => l.level === 'error').map((l) => l.message).join(' | '));
  assert.equal(phone.typed, 'nasa');
  assert.equal(phone.followed, true);
  assert.ok(!phone.viaLink, 'con buscador no hace falta el enlace');
  // 4 vueltas con 4 me gusta nuevos: la 1 ya lo tenía, así que esa vuelta se lo da a la siguiente visible (la 2).
  assert.deepEqual([...phone.liked].sort(), [0, 1, 2, 3, 4]);
  assert.equal(phone.post, 4);
  const msgs = res.logs.map((l) => l.message).join('\n');
  assert.match(msgs, /ahora sigues a nasa/);
  assert.match(msgs, /4 me gusta en nasa/);
  assert.ok(phone.cmds.includes('input keyevent 3'), 'vuelve a Inicio');
});

test('Instagram: si ya lo sigue no toca Seguir, y sin buscador abre el perfil con el enlace', async () => {
  const phone = new InstagramPhone({ followed: true, searchWorks: false });
  const { engine } = engineFor(phone);
  const res = await run(engine, instagramFlow('otra.cuenta', 2));
  assert.equal(res.status, 'ok');
  assert.match(phone.viaLink, /instagram\.com\/otra\.cuenta\//);
  assert.equal(phone.followed, true);
  const msgs = res.logs.map((l) => l.message).join('\n');
  assert.match(msgs, /ya seguías a otra.cuenta/);
  assert.match(msgs, /2 me gusta en otra.cuenta/);
});
