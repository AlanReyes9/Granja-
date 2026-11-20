// Publicaciones en lote: reparto de clips y flujos de publicación en teléfonos simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../src/main/automation/engine.js';
import { Publisher, planPosts, mediaInFolder } from '../src/main/publisher.js';
import { TEMPLATES } from '../src/renderer/templates.js';

const node = (attrs) => `<node ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`;

/** Teléfono con TikTok (en el idioma indicado): Compartir -> editor (Siguiente) -> publicar (descripción + Publicar). */
class ClipPhone {
  constructor({ lang = 'es', noPostButton = false, notInstalled = false, pkg = 'com.zhiliaoapp.musically', noNext = false } = {}) {
    Object.assign(this, { lang, noPostButton, notInstalled, pkg, noNext, screen: 'home', cmds: [], pushed: [], typed: '', gallery: new Map(), nextId: 40 });
  }
  t(es, en) { return this.lang === 'es' ? es : en; }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  async push(local, remote) { this.pushed.push([local, remote]); this.gallery.set(remote.replace('/sdcard', '/storage/emulated/0'), null); }
  async screencapPng() { return Buffer.from('89504e470d0a1a0a', 'hex'); }
  ui() {
    if (this.screen === 'editor') return node({ text: this.t('Siguiente', 'Next'), class: 'android.widget.Button', bounds: '[800,2100][1050,2250]' });
    if (this.screen === 'post') {
      return node({ text: this.typed || this.t('Añade una descripción...', 'Add description...'), class: 'android.widget.EditText', bounds: '[50,300][1030,600]' })
        + (this.noPostButton ? '' : node({ text: this.t('Publicar', 'Post'), class: 'android.widget.Button', bounds: '[560,2100][1050,2250]' }));
    }
    return node({ text: 'Inicio', bounds: '[0,0][1080,200]' });
  }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.startsWith('dumpsys power')) return 'mWakefulness=Awake';
    if (cmd.includes('uiautomator dump')) return `UI hierchary dumped to: /sdcard/granja_ui.xml\n<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${this.ui()}</hierarchy>`;
    if (cmd.includes('MEDIA_SCANNER_SCAN_FILE')) {
      const f = cmd.match(/file:\/\/([^']+)/)[1].replace('/sdcard', '/storage/emulated/0');
      if (this.gallery.has(f)) this.gallery.set(f, this.nextId++);
      return 'Broadcast completed: result=0';
    }
    const q = cmd.match(/^content query --uri content:\/\/media\/external\/video\/media --projection _id --where "_data LIKE '%(.+)'"$/);
    if (q) {
      const hit = [...this.gallery].find(([f, id]) => id && f.endsWith(q[1]));
      return hit ? `Row: 0 _id=${hit[1]}` : 'No result found.';
    }
    if (cmd.startsWith('am start -a android.intent.action.SEND')) {
      if (this.notInstalled) return 'Error: Activity not started, unable to resolve Intent';
      assert.match(cmd, /--eu android\.intent\.extra\.STREAM content:\/\/media\/external\/video\/media\/\d+ --grant-read-uri-permission -p ([\w.]+)$/);
      assert.ok(cmd.endsWith(`-p ${this.pkg}`), cmd);
      this.screen = this.noNext ? 'post' : 'editor';
      return 'Starting: Intent { act=android.intent.action.SEND }';
    }
    const tap = cmd.match(/^input (?:tap|swipe) (\d+) (\d+)/);
    if (tap) {
      const [x, y] = [+tap[1], +tap[2]];
      if (this.screen === 'editor' && y > 2000) this.screen = 'post';
      else if (this.screen === 'post' && y > 2000 && !this.noPostButton) this.screen = 'publicado';
      return '';
    }
    // ADBKeyBoard (necesario para emojis y acentos, como en el resto de la app).
    const b64 = cmd.match(/^am broadcast -a ADB_INPUT_B64 --es msg (\S+)$/);
    if (b64) { if (this.screen === 'post') this.typed += Buffer.from(b64[1], 'base64').toString('utf8'); return 'Broadcasting: Intent\nBroadcast completed: result=0'; }
    const txt = cmd.match(/^input text '(.*)'$/s);
    if (txt && this.screen === 'post') this.typed += txt[1].replace(/%s/g, ' ').replace(/\\(.)/g, '$1');
    return '';
  }
}

function setup(phones, store = {}) {
  const data = { deviceMeta: Object.fromEntries(Object.keys(phones).map((s, i) => [s, { name: `Tel-0${i + 1}` }])), history: [], ...store };
  const st = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const engine = new Engine({ devices: { get: (s) => phones[s] }, store: st, notifier: { send: async () => {} }, screenshotsDir: os.tmpdir(),
    proxies: { assignments: () => ({}), apply: async () => '' } });
  return { engine, data, st };
}

function tiktok(key = 'tiktok') {
  const g = TEMPLATES.find((t) => t.publish === key).build();
  for (const n of Object.values(g.drawflow.Home.data)) if (n.name === 'random_wait') Object.assign(n.data, { min: 1, max: 2 });
  return { id: 'tt', name: `Publicar clip: ${key}`, graph: g };
}

const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 10)); } };

function clipsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
  for (const f of ['clip 2.mp4', 'clip 10.mp4', 'clip 1.mp4', 'notas.txt']) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('reparto: un clip distinto por teléfono (en ciclo) o el mismo en todos; descripciones igual', () => {
  const p = planPosts({ serials: ['a', 'b', 'c'], clips: ['1.mp4', '2.mp4'], captions: ['uno #a', '', 'dos #b'] });
  assert.deepEqual(p.map((x) => [x.serial, x.clip, x.caption]), [['a', '1.mp4', 'uno #a'], ['b', '2.mp4', 'dos #b'], ['c', '1.mp4', 'uno #a']]);
  assert.deepEqual(planPosts({ serials: ['a', 'b'], clips: ['1.mp4', '2.mp4'], mode: 'mismo' }).map((x) => x.clip), ['1.mp4', '1.mp4']);
  assert.throws(() => planPosts({ serials: [], clips: ['1.mp4'] }), /teléfono/);
  assert.throws(() => planPosts({ serials: ['a'], clips: [] }), /clip/);
  const dir = clipsDir();
  assert.deepEqual(mediaInFolder(dir).map((f) => path.basename(f)), ['clip 1.mp4', 'clip 2.mp4', 'clip 10.mp4']);
});

test('publicación en lote: cada teléfono sube su clip a TikTok con su descripción (español e inglés)', async () => {
  const phones = { S1: new ClipPhone({ lang: 'es' }), S2: new ClipPhone({ lang: 'en' }), S3: new ClipPhone({ lang: 'es' }) };
  const { engine, data } = setup(phones);
  const wf = tiktok();
  const pub = new Publisher({ engine, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, getWorkflow: (id) => (id === 'tt' ? wf : null) });
  const clips = mediaInFolder(clipsDir());
  const post = pub.create({ workflowId: 'tt', serials: ['S1', 'S2', 'S3'], clips, captions: ['Mira esto 🔥 #clips', 'Second clip #viral', 'Tercero con acentos: canción'] });
  await until(() => pub.list()[0].status === 'terminada');
  const done = pub.list()[0];
  assert.equal(done.id, post.id);
  assert.deepEqual(done.items.map((i) => i.status), ['ok', 'ok', 'ok']);
  assert.deepEqual(Object.values(phones).map((p) => p.screen), ['publicado', 'publicado', 'publicado']);
  // Cada teléfono recibió su clip en la galería y escribió su descripción.
  assert.deepEqual(Object.values(phones).map((p) => path.basename(p.pushed[0][0])), ['clip 1.mp4', 'clip 2.mp4', 'clip 10.mp4']);
  assert.equal(phones.S1.pushed[0][1], '/sdcard/DCIM/NexusFarmer/clip_1.mp4');
  assert.deepEqual(Object.values(phones).map((p) => p.typed), ['Mira esto 🔥 #clips', 'Second clip #viral', 'Tercero con acentos: canción']);
  pub.stop();
});

test('publicación: si no aparece Publicar o la app no está, ese teléfono queda en error y se puede reintentar solo ese', async () => {
  const phones = { S1: new ClipPhone(), S2: new ClipPhone({ noPostButton: true }), S3: new ClipPhone({ notInstalled: true }) };
  const { engine, data } = setup(phones);
  const wf = tiktok();
  const pub = new Publisher({ engine, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, getWorkflow: () => wf });
  const logs = [];
  engine.on('log', (l) => logs.push(l));
  pub.create({ workflowId: 'tt', serials: ['S1', 'S2', 'S3'], clips: mediaInFolder(clipsDir()).slice(0, 1), mode: 'mismo' });
  await until(() => pub.list()[0].status === 'terminada');
  assert.deepEqual(pub.list()[0].items.map((i) => i.status), ['ok', 'error', 'error']);
  assert.ok(logs.some((l) => l.serial === 'S2' && /No se pudo publicar clip 1\.mp4 en Tel-02/.test(l.message)));
  assert.ok(logs.some((l) => l.serial === 'S3' && /no aceptó el archivo/.test(l.message)));
  phones.S2.noPostButton = false; phones.S2.screen = 'home';
  phones.S3.notInstalled = false;
  const retry = pub.retryFailed(pub.list()[0].id);
  assert.deepEqual(retry.items.map((i) => i.serial), ['S2', 'S3']);
  await until(() => pub.list()[0].status === 'terminada');
  assert.deepEqual(pub.list()[0].items.map((i) => i.status), ['ok', 'ok']);
  pub.stop();
});

test('publicación programada: espera a su hora y se puede cancelar', async () => {
  let now = 1_000_000;
  const phones = { S1: new ClipPhone() };
  const { engine, data } = setup(phones);
  const wf = tiktok();
  const pub = new Publisher({ engine, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, getWorkflow: () => wf, now: () => now });
  const clips = mediaInFolder(clipsDir());
  const a = pub.create({ workflowId: 'tt', serials: ['S1'], clips, at: now + 60_000 });
  const b = pub.create({ workflowId: 'tt', serials: ['S1'], clips, at: now + 60_000 });
  assert.equal(a.status, 'programada');
  pub.tick();
  assert.equal(phones.S1.pushed.length, 0, 'todavía no es la hora');
  pub.cancel(b.id);
  now += 61_000;
  pub.tick();
  await until(() => pub.list().find((p) => p.id === a.id).status === 'terminada');
  assert.equal(pub.list().find((p) => p.id === b.id).status, 'cancelada');
  assert.equal(phones.S1.pushed.length, 1);
  pub.stop();
});

test('Facebook: comparte el clip, sin botón Siguiente pasa directo a la descripción y publica', async () => {
  const phones = { S1: new ClipPhone({ pkg: 'com.facebook.katana', noNext: true }), S2: new ClipPhone({ pkg: 'com.facebook.katana', noNext: true, lang: 'en' }) };
  const { engine, data } = setup(phones);
  const wf = tiktok('facebook');
  const pub = new Publisher({ engine, store: { get: (k) => data[k], set: (k, v) => { data[k] = v; } }, getWorkflow: () => wf });
  pub.create({ workflowId: 'tt', serials: ['S1', 'S2'], clips: mediaInFolder(clipsDir()), captions: ['Clip para Facebook #reels'] });
  await until(() => pub.list()[0].status === 'terminada', 60000);
  assert.deepEqual(pub.list()[0].items.map((i) => i.status), ['ok', 'ok']);
  assert.deepEqual(Object.values(phones).map((p) => [p.screen, p.typed]), [['publicado', 'Clip para Facebook #reels'], ['publicado', 'Clip para Facebook #reels']]);
  pub.stop();
});
