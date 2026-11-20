// Calentamiento: buscar un tema y mirar vídeos, en teléfonos simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Engine } from '../src/main/automation/engine.js';
import { Warmup, pickTopics, warmVars } from '../src/main/warmup.js';
import { TEMPLATES } from '../src/renderer/templates.js';

const node = (a) => `<node ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;

/** TikTok y YouTube simulados: inicio -> buscador -> resultados (pestaña Vídeos) -> vídeo a pantalla completa. */
class WarmPhone {
  constructor({ noSearch = false } = {}) {
    Object.assign(this, { noSearch, app: null, screen: 'apagado', typed: '', searched: [], swipes: 0, tapsOnVideo: 0, cmds: [], opened: [] });
  }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  async screencapPng() { return Buffer.from('89504e470d0a1a0a', 'hex'); }
  ui() {
    if (this.screen === 'home') return this.noSearch ? '' : node({ class: 'android.widget.ImageView', 'content-desc': 'Buscar', bounds: '[950,80][1060,180]' });
    if (this.screen === 'search') return node({ class: 'android.widget.EditText', text: this.typed || 'Buscar', bounds: '[100,80][900,180]' });
    if (this.screen === 'results') return node({ class: 'android.widget.TextView', text: this.app === 'yt' ? 'Shorts' : 'Vídeos', bounds: '[300,250][500,330]' });
    return '';
  }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.startsWith('dumpsys power')) return 'mWakefulness=Awake';
    if (cmd.includes('uiautomator dump')) return `UI hierchary dumped to: /sdcard/granja_ui.xml\n<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${this.ui()}</hierarchy>`;
    const res = cmd.match(/^cmd package resolve-activity .*LAUNCHER ([\w.]+)/);
    if (res) return `priority=0\n${res[1]}/.Main`;
    if (cmd.startsWith('pm path')) return 'package:/data/app/base.apk';
    if (/^am start -n com\.zhiliaoapp\.musically/.test(cmd)) { this.app = 'tt'; this.screen = 'home'; this.opened.push('tiktok'); return ''; }
    const yt = cmd.match(/^am start -a android\.intent\.action\.VIEW -d '(https:\/\/www\.youtube\.com\/results\?search_query=[^']+)' -p com\.google\.android\.youtube$/);
    if (yt) { this.app = 'yt'; this.screen = 'results'; this.opened.push('youtube'); this.searched.push(decodeURIComponent(yt[1].split('=')[1])); return ''; }
    const b64 = cmd.match(/^am broadcast -a ADB_INPUT_B64 --es msg (\S+)$/);
    if (b64) { this.typed += Buffer.from(b64[1], 'base64').toString('utf8'); return 'Broadcast completed: result=0'; }
    const txt = cmd.match(/^input text '(.*)'$/s);
    if (txt) { this.typed += txt[1].replace(/%s/g, ' '); return ''; }
    if (cmd === 'input keyevent 66' && this.screen === 'search') { this.searched.push(this.typed); this.typed = ''; this.screen = 'results'; return ''; }
    const tap = cmd.match(/^input (?:tap|swipe) (\d+) (\d+)(?: (\d+) (\d+))?/);
    if (tap) {
      const [x, y, x2, y2] = tap.slice(1).map(Number);
      if (x2 != null && !Number.isNaN(x2) && y - y2 > 800) { if (this.screen === 'video') this.swipes++; return ''; }
      if (this.screen === 'video') this.tapsOnVideo++;
      if (this.screen === 'home' && y < 200 && x > 900) this.screen = 'search';
      else if (this.screen === 'results' && y > 600) this.screen = 'video';
    }
    return '';
  }
}

function setup(phones) {
  const data = { deviceMeta: Object.fromEntries(Object.keys(phones).map((s, i) => [s, { name: `Tel-0${i + 1}` }])), history: [] };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const engine = new Engine({ devices: { get: (s) => phones[s] }, store, notifier: { send: async () => {} }, screenshotsDir: os.tmpdir(),
    proxies: { assignments: () => ({}), apply: async () => '' } });
  return { engine, store };
}

function flow(key) {
  const t = TEMPLATES.find((x) => x.warm === key);
  const g = t.build();
  for (const n of Object.values(g.drawflow.Home.data)) if (n.name === 'random_wait' && !String(n.data.min).includes('{')) Object.assign(n.data, { min: 1, max: 2 });
  return { id: key, name: t.name, graph: g };
}

const until = async (fn, ms = 120000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 10)); } };

test('temas: uno distinto por teléfono que rota en cada ronda, o al azar; variables del flujo', () => {
  const p = pickTopics({ serials: ['a', 'b', 'c'], topics: ['uno', ' ', 'dos'], rounds: 2 });
  assert.deepEqual(p.map((x) => x.topics), [['uno', 'dos'], ['dos', 'uno'], ['uno', 'dos']]);
  assert.deepEqual(pickTopics({ serials: ['a'], topics: ['x', 'y'], mode: 'aleatorio', rounds: 3, random: () => 0.99 })[0].topics, ['y', 'y', 'y']);
  assert.throws(() => pickTopics({ serials: ['a'], topics: [''] }), /tema/);
  assert.deepEqual(warmVars("recetas l'ama", { videos: 5, secMin: 10, secMax: 4 }), { tema: "recetas l'ama", tema_url: 'recetas%20l%27ama', videos: '5', ms_min: '10000', ms_max: '10000' });
});

test('calentamiento: en cada teléfono busca su tema en TikTok y YouTube y mira N vídeos; en la ronda 2 cambia de tema', async () => {
  const phones = { S1: new WarmPhone(), S2: new WarmPhone() };
  const { engine, store } = setup(phones);
  const flows = { tiktok: flow('tiktok'), youtube: flow('youtube') };
  const w = new Warmup({ engine, store, getWorkflow: (id) => flows[id] });
  const job = w.create({ workflowIds: ['tiktok', 'youtube'], serials: ['S1', 'S2'], topics: ['recetas fáciles', 'fútbol'], rounds: 2, videos: 3, secMin: 0.001, secMax: 0.002 });
  assert.equal(job.status, 'calentando');
  await until(() => w.list()[0].status === 'terminado');
  const done = w.list()[0];
  assert.deepEqual(done.items.map((i) => Object.values(i.results)), [['ok', 'ok', 'ok', 'ok'], ['ok', 'ok', 'ok', 'ok']]);
  assert.deepEqual(phones.S1.opened, ['tiktok', 'youtube', 'tiktok', 'youtube'], 'las redes una tras otra, en cada ronda');
  assert.deepEqual(phones.S1.searched, ['recetas fáciles', 'recetas fáciles', 'fútbol', 'fútbol']);
  assert.deepEqual(phones.S2.searched, ['fútbol', 'fútbol', 'recetas fáciles', 'recetas fáciles']);
  assert.equal(phones.S1.swipes, 12, '3 vídeos por red y ronda: pasa al siguiente 3 veces');
  // Solo mira: en el vídeo únicamente desliza para pasar al siguiente (ni me gusta, ni seguir, ni comentar).
  assert.equal(phones.S1.tapsOnVideo, 0);
  w.stop();
});

test('calentamiento: sin buscador en una red, ese teléfono queda en error y sigue con la siguiente; se puede detener', async () => {
  const phones = { S1: new WarmPhone(), S2: new WarmPhone({ noSearch: true }) };
  const { engine, store } = setup(phones);
  const flows = { tiktok: flow('tiktok'), youtube: flow('youtube') };
  const w = new Warmup({ engine, store, getWorkflow: (id) => flows[id] });
  w.create({ workflowIds: ['tiktok', 'youtube'], serials: ['S1', 'S2'], topics: ['gatos'], videos: 2, secMin: 0.001, secMax: 0.002 });
  await until(() => w.list()[0].status === 'terminado');
  assert.deepEqual(w.list()[0].items.map((i) => [i.results['0:0'], i.results['0:1']]), [['ok', 'ok'], ['error', 'ok']]);
  // Detener uno largo.
  const long = w.create({ workflowIds: ['tiktok'], serials: ['S1'], topics: ['gatos'], videos: 400, secMin: 3, secMax: 3 });
  await until(() => w.list()[0].status === 'calentando');
  w.cancel(long.id);
  await until(() => w.list()[0].status === 'cancelado' && !w.list()[0].runId);
  assert.equal(w.list()[0].items[0].results['0:0'], 'detenido');
  w.stop();
});
