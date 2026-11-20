// Herramientas de cuenta (perfil, privacidad, cambiar de cuenta, borrar) en un Instagram simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Engine } from '../src/main/automation/engine.js';
import { TEMPLATES } from '../src/renderer/templates.js';

const node = (a) => `<node ${Object.entries(a).map(([k, v]) => `${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join(' ')}/>`;
const btn = (text, y, extra = {}) => node({ class: 'android.widget.Button', text, bounds: `[80,${y}][1000,${y + 100}]`, ...extra });
const desc = (d, y) => node({ class: 'android.widget.ImageView', 'content-desc': d, bounds: `[900,${y}][1060,${y + 100}]` });

/** Instagram simulado: perfil, menú, privacidad, editar perfil, selector de cuentas y publicaciones. */
class IgPhone {
  constructor({ user = 'ana', accounts = ['ana', 'beto'], private: priv = false, name = 'Ana Vieja', bio = 'bio vieja', posts = 3 } = {}) {
    Object.assign(this, { user, accounts, priv, name, bio, posts, screen: 'off', field: null, text: '', cmds: [] });
  }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  async screencapPng() { return Buffer.from('89504e470d0a1a0a', 'hex'); }
  ui() {
    switch (this.screen) {
      case 'feed': return desc('Perfil', 2200);
      case 'perfil': return btn(this.user, 100) + desc('Opciones', 300) + btn('Editar perfil', 500) + desc('Perfil', 2200);
      case 'menu': return btn('Privacidad de la cuenta', 600);
      case 'privacidad': return node({ class: 'android.widget.LinearLayout', bounds: '[0,400][1080,560]' }) + btn('Cuenta privada', 420)
        + node({ class: 'android.widget.Switch', checkable: 'true', checked: String(this.priv), bounds: '[900,430][1050,510]' });
      case 'confirmar': return btn(this.priv ? 'Cambiar a pública' : 'Cambiar a privada', 1800);
      case 'editar': return btn('Nombre', 600) + btn('Presentación', 800);
      case 'campo': return node({ class: 'android.widget.EditText', text: this.text, bounds: '[80,300][1000,420]' }) + desc('Listo', 100);
      case 'selector': return this.accounts.map((a, i) => btn(a, 1200 + i * 150)).join('');
      case 'post': return desc('Más opciones', 200);
      case 'opciones': return btn('Eliminar', 1500);
      case 'borrar': return btn('Eliminar', 1300);
      default: return '';
    }
  }
  hitText(y) { const m = [...this.ui().matchAll(/(?:text|content-desc)="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].find((x) => y >= +x[3] && y <= +x[5]); return m?.[1]; }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.startsWith('dumpsys power')) return 'mWakefulness=Awake';
    if (cmd.includes('uiautomator dump')) return `UI hierchary dumped to: /sdcard/granja_ui.xml\n<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${this.ui()}</hierarchy>`;
    const res = cmd.match(/^cmd package resolve-activity .*LAUNCHER ([\w.]+)/);
    if (res) return `priority=0\n${res[1]}/.Main`;
    if (cmd.startsWith('am start -n')) { this.screen = 'feed'; return ''; }
    if (cmd.startsWith('input keyevent 123')) { this.text = ''; return ''; }
    if (cmd === 'input keyevent 4') { if (this.screen === 'campo') this.screen = 'editar'; return ''; }
    const b64 = cmd.match(/^am broadcast -a ADB_INPUT_B64 --es msg (\S+)$/);
    if (b64) { if (this.screen === 'campo') this.text += Buffer.from(b64[1], 'base64').toString('utf8'); return 'Broadcast completed: result=0'; }
    const txt = cmd.match(/^input text '(.*)'$/s);
    if (txt && this.screen === 'campo') { this.text += txt[1].replace(/%s/g, ' '); return ''; }
    const tap = cmd.match(/^input (?:tap|swipe) (\d+) (\d+)/);
    if (!tap) return '';
    const y = Number(tap[2]);
    const t = this.hitText(y);
    const s = this.screen;
    if (t === 'Perfil') this.screen = 'perfil';
    else if (s === 'perfil' && t === 'Opciones') this.screen = 'menu';
    else if (s === 'perfil' && t === 'Editar perfil') this.screen = 'editar';
    else if (s === 'perfil' && t === this.user) this.screen = 'selector';
    else if (s === 'perfil' && y > 1000 && y < 1800) this.screen = this.posts ? 'post' : 'perfil';
    else if (s === 'menu' && t === 'Privacidad de la cuenta') this.screen = 'privacidad';
    else if (s === 'privacidad' && y >= 420 && y <= 520) this.screen = 'confirmar';
    else if (s === 'confirmar' && /Cambiar a/.test(t || '')) { this.priv = !this.priv; this.screen = 'privacidad'; }
    else if (s === 'editar' && t === 'Nombre') { this.field = 'name'; this.text = this.name; this.screen = 'campo'; }
    else if (s === 'editar' && t === 'Presentación') { this.field = 'bio'; this.text = this.bio; this.screen = 'campo'; }
    else if (s === 'campo' && t === 'Listo') { this[this.field] = this.text; this.screen = 'editar'; }
    else if (s === 'selector' && this.accounts.includes(t)) { this.user = t; this.screen = 'perfil'; }
    else if (s === 'post' && t === 'Más opciones') this.screen = 'opciones';
    else if (s === 'opciones' && t === 'Eliminar') this.screen = 'borrar';
    else if (s === 'borrar' && t === 'Eliminar') { this.posts--; this.screen = 'feed'; }
    return '';
  }
}

function runTool(tool, phones, varsBySerial) {
  const t = TEMPLATES.find((x) => x.tool === tool && x.toolApp === 'instagram');
  const graph = t.build();
  for (const n of Object.values(graph.drawflow.Home.data)) if (n.name === 'random_wait') Object.assign(n.data, { min: 1, max: 2 });
  const data = { deviceMeta: {}, history: [] };
  const engine = new Engine({ devices: { get: (s) => phones[s] }, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } },
    notifier: { send: async () => {} }, screenshotsDir: os.tmpdir(), proxies: { assignments: () => ({}), apply: async () => '' } });
  const logs = [];
  engine.on('log', (l) => logs.push(`${l.serial}: ${l.message}`));
  const id = engine.start({ id: tool, name: t.name, graph }, Object.keys(phones), { varsBySerial });
  return new Promise((resolve) => {
    const check = () => {
      const r = engine.listRuns().find((x) => x.id === id);
      if (r.status !== 'running') resolve({ devices: r.devices, logs }); else setTimeout(check, 10);
    };
    check();
  });
}

test('privacidad: la pone privada o pública según se pida y no toca la que ya está así', async () => {
  const phones = { A: new IgPhone({ private: false }), B: new IgPhone({ private: true }), C: new IgPhone({ private: true }) };
  const r = await runTool('privacy', phones, { A: { privada: 'sí' }, B: { privada: 'sí' }, C: { privada: 'no' } });
  assert.deepEqual(Object.values(r.devices).map((d) => d.status), ['ok', 'ok', 'ok'], r.logs.filter((l) => /rror|motivo/.test(l)).join('\n'));
  assert.deepEqual([phones.A.priv, phones.B.priv, phones.C.priv], [true, true, false]);
  assert.ok(r.logs.some((l) => l.startsWith('B: ') && /ya estaba así/.test(l)));
});

test('cambiar de cuenta: elige la cuenta del selector; avisa si no está en el teléfono', async () => {
  const phones = { A: new IgPhone(), B: new IgPhone(), C: new IgPhone({ user: 'beto' }) };
  const v = (c) => ({ cuenta_destino: c, cuenta_arroba: `@${c}` });
  const r = await runTool('switch', phones, { A: v('beto'), B: v('carla'), C: v('beto') });
  assert.equal(phones.A.user, 'beto');
  assert.equal(r.devices.A.status, 'ok');
  assert.equal(r.devices.B.status, 'error');
  assert.match(r.devices.B.error, /carla no está en este teléfono/);
  assert.ok(r.logs.some((l) => l.startsWith('C: ') && /ya estaba en beto/.test(l)));
});

test('completar perfil: sustituye nombre y biografía; lo vacío no se toca', async () => {
  const phones = { A: new IgPhone(), B: new IgPhone() };
  const r = await runTool('profile', phones, { A: { nombre: 'Ana Recetas', bio: 'Cocina fácil', foto: '' }, B: { nombre: '', bio: 'Solo bio', foto: '' } });
  assert.deepEqual(Object.values(r.devices).map((d) => d.status), ['ok', 'ok'], r.logs.join('\n'));
  assert.deepEqual([phones.A.name, phones.A.bio], ['Ana Recetas', 'Cocina fácil']);
  assert.deepEqual([phones.B.name, phones.B.bio], ['Ana Vieja', 'Solo bio']);
});

test('borrar publicación: borra exactamente las indicadas, las más recientes', async () => {
  const phones = { A: new IgPhone({ posts: 3 }) };
  const r = await runTool('delete', phones, { A: { cuantas: '2' } });
  assert.equal(r.devices.A.status, 'ok', r.logs.join('\n'));
  assert.equal(phones.A.posts, 1);
  assert.ok(r.logs.some((l) => /2 publicación\(es\) borrada\(s\)/.test(l)));
});
