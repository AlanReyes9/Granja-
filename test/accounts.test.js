// Cuentas por plataforma: importar, cifrar, asignar a teléfonos e iniciar sesión en teléfonos simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Engine } from '../src/main/automation/engine.js';
import { AccountManager, parseAccounts } from '../src/main/accounts.js';
import { TEMPLATES } from '../src/renderer/templates.js';

const node = (a) => `<node ${Object.entries(a).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ')}/>`;
const field = (text, y, password = false) => node({ class: 'android.widget.EditText', text, password, bounds: `[80,${y}][1000,${y + 120}]` });
const button = (text, y) => node({ class: 'android.widget.Button', text, bounds: `[80,${y}][1000,${y + 120}]` });

/**
 * Instagram o TikTok simulados. accounts: usuario -> clave correcta. challenge: pide código.
 * TikTok: Perfil -> Iniciar sesión -> Usar teléfono/correo/nombre de usuario -> formulario.
 */
class LoginPhone {
  constructor({ app, accounts, loggedIn = null, challenge = false }) {
    Object.assign(this, { app, accounts, loggedIn, challenge, screen: 'apagado', fields: ['', ''], focus: -1, cmds: [] });
  }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  async screencapPng() { return Buffer.from('89504e470d0a1a0a', 'hex'); }
  ui() {
    const s = this.screen;
    if (s === 'feed') return node({ class: 'android.widget.FrameLayout', 'content-desc': this.app === 'instagram' ? 'Inicio' : 'Perfil', bounds: '[0,2200][200,2340]' });
    if (s === 'perfil') return this.loggedIn ? button('Editar perfil', 600) : button('Iniciar sesión', 600);
    if (s === 'opciones') return button('Usar teléfono/correo/nombre de usuario', 900);
    if (s === 'codigo') return node({ class: 'android.widget.TextView', text: 'Introduce el código que te enviamos', bounds: '[80,400][1000,500]' });
    if (s === 'login') return field(this.fields[0] || 'Usuario', 700) + field(this.fields[1] ? '•'.repeat(this.fields[1].length) : 'Contraseña', 900, true) + button('Iniciar sesión', 1100);
    return '';
  }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.startsWith('dumpsys power')) return 'mWakefulness=Awake';
    if (cmd.includes('uiautomator dump')) return `UI hierchary dumped to: /sdcard/granja_ui.xml\n<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${this.ui()}</hierarchy>`;
    const res = cmd.match(/^cmd package resolve-activity .*LAUNCHER ([\w.]+)/);
    if (res) return `priority=0\n${res[1]}/.Main`;
    if (cmd.startsWith('am start -n')) {
      this.fields = ['', ''];
      this.screen = this.app === 'instagram' ? (this.loggedIn ? 'feed' : 'login') : 'feed';
      return '';
    }
    const txt = cmd.match(/^input text '(.*)'$/s);
    if (txt && this.focus >= 0) { this.fields[this.focus] += txt[1].replace(/'\\''/g, "'").replace(/%s/g, ' '); return ''; }
    const tap = cmd.match(/^input (?:tap|swipe) (\d+) (\d+)/);
    if (tap) {
      const y = Number(tap[2]);
      const s = this.screen;
      if (s === 'feed' && y > 2200 && this.app === 'tiktok') this.screen = 'perfil';
      else if (s === 'perfil' && y >= 600 && y <= 720 && !this.loggedIn) this.screen = 'opciones';
      else if (s === 'opciones' && y >= 900 && y <= 1020) this.screen = 'login';
      else if (s === 'login' && y >= 700 && y <= 820) this.focus = 0;
      else if (s === 'login' && y >= 900 && y <= 1020) this.focus = 1;
      else if (s === 'login' && y >= 1100 && y <= 1220) {
        const [u, p] = this.fields;
        if (this.accounts[u] === p) {
          if (this.challenge) this.screen = 'codigo';
          else { this.loggedIn = u; this.screen = this.app === 'instagram' ? 'feed' : 'perfil'; }
        } else this.fields[1] = '';
      }
    }
    return '';
  }
}

function setup(phones) {
  const data = { deviceMeta: Object.fromEntries(Object.keys(phones).map((s, i) => [s, { name: `Tel-0${i + 1}` }])), history: [], accounts: [] };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const engine = new Engine({ devices: { get: (s) => phones[s] }, store, notifier: { send: async () => {} }, screenshotsDir: os.tmpdir(),
    proxies: { assignments: () => ({}), apply: async () => '' } });
  const flows = TEMPLATES.filter((t) => t.login).map((t) => {
    const graph = t.build();
    for (const n of Object.values(graph.drawflow.Home.data)) if (n.name === 'random_wait') Object.assign(n.data, { min: 1, max: 2 });
    return { id: t.login, name: t.name, graph };
  });
  // Cifrado de prueba: reversible, pero el texto guardado no es la contraseña.
  const accounts = new AccountManager({ engine, store, getWorkflows: () => flows,
    encrypt: (v) => ({ enc: Buffer.from(v).toString('base64') }), decrypt: (k) => Buffer.from(k.enc, 'base64').toString() });
  return { engine, data, accounts };
}

const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 10)); } };

test('formatos de cuentas: usuario:clave, ; , y tabulador; la clave puede llevar ":"', () => {
  const { list, invalid } = parseAccounts('ana:Cl@ve:1\nbeto;x y\ncarla,p,q\ndani\tz\n# comentario\nsinclave\n\n');
  assert.deepEqual(list, [{ user: 'ana', pass: 'Cl@ve:1' }, { user: 'beto', pass: 'x y' }, { user: 'carla', pass: 'p,q' }, { user: 'dani', pass: 'z' }]);
  assert.deepEqual(invalid, ['sinclave']);
});

test('cuentas: se guardan cifradas, la interfaz no ve la contraseña, una por plataforma y teléfono', () => {
  const { data, accounts } = setup({});
  const r = accounts.import('ana:Secreta1\nbeto:Secreta2\ncarla:Secreta3', 'instagram');
  assert.deepEqual([r.added, r.updated], [3, 0]);
  assert.equal(accounts.import('ANA:Nueva', 'instagram').updated, 1);
  accounts.import('ana:Otra', 'tiktok');
  assert.ok(!JSON.stringify(data.accounts).includes('Secreta'), 'en el almacén no hay contraseñas en claro');
  assert.ok(!JSON.stringify(accounts.list()).includes('enc'), 'la interfaz no recibe ni el cifrado');
  assert.ok(accounts.list().every((a) => a.hasPass));
  assert.equal(accounts.autoAssign(['S1', 'S2']), 3, '2 de Instagram + 1 de TikTok');
  const ig = accounts.list().filter((a) => a.platform === 'instagram');
  assert.deepEqual(ig.map((a) => a.serial), ['S1', 'S2', null]);
  // Dar el teléfono S1 a carla deja libre a ana en Instagram (no a la de TikTok).
  accounts.update(ig[2].id, { serial: 'S1' });
  assert.deepEqual(accounts.list().filter((a) => a.platform === 'instagram').map((a) => a.serial), [null, 'S2', 'S1']);
  assert.equal(accounts.list().find((a) => a.platform === 'tiktok').serial, 'S1');
  assert.throws(() => accounts.import('nada', 'instagram'), /usuario:contraseña/);
});

test('inicio de sesión en Instagram: correcta, incorrecta, con código y ya iniciada; la contraseña no sale en el registro', async () => {
  const phones = {
    S1: new LoginPhone({ app: 'instagram', accounts: { ana: "P4ss'w0rd $1" } }),
    S2: new LoginPhone({ app: 'instagram', accounts: { beto: 'buena' } }),
    S3: new LoginPhone({ app: 'instagram', accounts: { carla: 'Clave3' }, challenge: true }),
    S4: new LoginPhone({ app: 'instagram', accounts: {}, loggedIn: 'dani' }),
  };
  const { engine, accounts } = setup(phones);
  const logs = [];
  engine.on('log', (l) => logs.push(l.message));
  accounts.import("ana:P4ss'w0rd $1\nbeto:mala\ncarla:Clave3\ndani:loquesea", 'instagram');
  accounts.autoAssign(['S1', 'S2', 'S3', 'S4']);
  const r = accounts.login(accounts.list().map((a) => a.id));
  assert.equal(r.queued, 4);
  await until(() => accounts.list().every((a) => !['en cola', 'iniciando'].includes(a.status)));
  const by = Object.fromEntries(accounts.list().map((a) => [a.user, [a.status, a.message]]));
  assert.equal(by.ana[0], 'sesión iniciada');
  assert.deepEqual(by.beto, ['error', 'Usuario o contraseña incorrectos, o la app pidió algo más (mira la captura)']);
  assert.match(by.carla[1], /código o una verificación/);
  assert.equal(by.dani[0], 'sesión iniciada');
  assert.equal(phones.S1.loggedIn, 'ana');
  assert.ok(logs.some((m) => /ya tenía la sesión iniciada/.test(m)));
  for (const secret of ["P4ss'w0rd", 'mala', 'Clave3']) assert.ok(!logs.some((m) => m.includes(secret)), `"${secret}" no aparece en el registro`);
  assert.ok(logs.some((m) => /Escribir texto.*••••••/.test(m)));
  assert.ok(accounts.list().find((a) => a.user === 'ana').lastLogin);
});

test('inicio de sesión en TikTok: Perfil -> Iniciar sesión -> usuario -> formulario; varias plataformas una tras otra', async () => {
  const tt = new LoginPhone({ app: 'tiktok', accounts: { 'ana.tt': 'Tik1' } });
  const phones = { S1: tt };
  const { accounts } = setup(phones);
  accounts.import('ana.tt:Tik1', 'tiktok');
  accounts.autoAssign(['S1']);
  accounts.login(accounts.list().map((a) => a.id));
  await until(() => !['en cola', 'iniciando'].includes(accounts.list()[0].status));
  assert.equal(accounts.list()[0].status, 'sesión iniciada', accounts.list()[0].message);
  assert.equal(tt.loggedIn, 'ana.tt');
  // Sin teléfono no se puede; sin flujo, se avisa.
  accounts.import('sinmovil:x', 'facebook');
  assert.throws(() => accounts.login(accounts.list().filter((a) => a.platform === 'facebook').map((a) => a.id)), /Asigna un teléfono/);
});
