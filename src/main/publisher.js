// Publicaciones en lote: reparte clips y descripciones entre los teléfonos (una cuenta por teléfono)
// y lanza en todos a la vez el flujo de publicación de la app elegida, ahora o a una hora.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const MEDIA_EXT = ['mp4', 'mov', 'm4v', '3gp', 'webm', 'mkv', 'jpg', 'jpeg', 'png', 'webp'];

/**
 * Qué publica cada teléfono. mode "distinto": un clip diferente por teléfono (en orden, y en ciclo si hay
 * más teléfonos que clips); "mismo": el primer clip en todos. Las descripciones se reparten igual.
 */
export function planPosts({ serials, clips, captions = [], mode = 'distinto', offset = 0 }) {
  if (!serials.length) throw new Error('Elige al menos un teléfono');
  if (!clips.length) throw new Error('Añade al menos un clip');
  const caps = captions.map((c) => String(c).trim()).filter(Boolean);
  return serials.map((serial, i) => {
    const k = mode === 'mismo' ? 0 : (i + offset) % clips.length;
    const clip = clips[k];
    return {
      serial,
      clip,
      caption: caps.length ? caps[(i + offset) % caps.length] : '',
    };
  });
}

export class Publisher extends EventEmitter {
  /** engine: motor de flujos; store: almacén; getWorkflow(id) */
  constructor({ engine, store, getWorkflow, getSettings = () => ({}), now = Date.now }) {
    super();
    Object.assign(this, { engine, store, getWorkflow, getSettings, now });
    this.timer = null;
    // El estado de cada teléfono se copia de la ejecución mientras dura.
    engine.on('runs', (runs) => this.syncRuns(runs));
  }

  list() {
    return this.store.get('posts') || [];
  }

  save(list) {
    this.store.set('posts', list.slice(0, 200));
    this.emit('changed', this.list());
  }

  /**
   * Crea una publicación en lote. at: fecha/hora (ms) para programarla; sin at se lanza ya.
   * clips: rutas de vídeo/foto en el PC.
   */
  create({ name, workflowId, serials, clips, captions = [], mode = 'distinto', at = null }) {
    const wf = this.getWorkflow(workflowId);
    if (!wf) throw new Error('Elige el flujo de publicación (TikTok, Shorts, Reels o uno tuyo)');
    const missing = clips.filter((c) => !fs.existsSync(c));
    if (missing.length) throw new Error(`No se encuentran estos archivos: ${missing.map((m) => path.basename(m)).join(', ')}`);
    const plan = planPosts({ serials, clips, captions, mode });
    const post = {
      id: `pub${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: String(name || '').trim() || `${wf.name} · ${plan.length} teléfono(s)`,
      workflowId, workflowName: wf.name, mode, createdAt: this.now(),
      at: at && at > this.now() ? at : null,
      status: at && at > this.now() ? 'programada' : 'pendiente',
      items: plan.map((p) => ({ ...p, status: 'pendiente' })),
      runId: null,
    };
    this.save([post, ...this.list()]);
    if (post.status === 'pendiente') this.launch(post.id);
    this.arm();
    return post;
  }

  /** Variables que recibe el flujo en cada teléfono. */
  static varsFor(item, index) {
    return {
      clip: item.clip,
      clip_nombre: path.basename(item.clip.replace(/\\/g, '/')),
      descripcion: item.caption,
      publicacion: index + 1,
    };
  }

  launch(id) {
    const list = this.list();
    const post = list.find((p) => p.id === id);
    if (!post || ['publicando', 'terminada'].includes(post.status)) return null;
    const wf = this.getWorkflow(post.workflowId);
    if (!wf) {
      Object.assign(post, { status: 'error', error: 'El flujo de publicación ya no existe' });
      this.save(list);
      return null;
    }
    const s = this.getSettings();
    try {
      post.runId = this.engine.start(wf, post.items.map((it) => it.serial), {
        source: 'publicación',
        concurrency: s.runConcurrency ?? 10,
        staggerMs: s.runStaggerMs ?? 0,
        varsBySerial: Object.fromEntries(post.items.map((it, i) => [it.serial, Publisher.varsFor(it, i)])),
      });
      post.status = 'publicando';
      post.startedAt = this.now();
    } catch (e) {
      Object.assign(post, { status: 'error', error: e.message });
    }
    this.save(list);
    return post.runId;
  }

  cancel(id) {
    const list = this.list();
    const post = list.find((p) => p.id === id);
    if (!post) return;
    if (post.status === 'publicando' && post.runId) this.engine.stop(post.runId);
    if (post.status === 'programada') post.status = 'cancelada';
    this.save(list);
  }

  remove(id) {
    const post = this.list().find((p) => p.id === id);
    if (post?.status === 'publicando' && post.runId) this.engine.stop(post.runId);
    this.save(this.list().filter((p) => p.id !== id));
  }

  /** Vuelve a publicar solo en los teléfonos que fallaron. */
  retryFailed(id) {
    const post = this.list().find((p) => p.id === id);
    if (!post) throw new Error('Publicación no encontrada');
    const failed = post.items.filter((it) => it.status !== 'ok');
    if (!failed.length) throw new Error('No hay teléfonos con fallos en esta publicación');
    const copy = {
      ...post, id: `${post.id}r${Math.random().toString(36).slice(2, 5)}`, name: `${post.name} (reintento)`, createdAt: this.now(),
      at: null, status: 'pendiente', runId: null, error: '', items: failed.map((it) => ({ ...it, status: 'pendiente' })),
    };
    this.save([copy, ...this.list()]);
    this.launch(copy.id);
    return copy;
  }

  syncRuns(runs) {
    const list = this.list();
    let changed = false;
    for (const post of list) {
      if (post.status !== 'publicando') continue;
      const run = runs.find((r) => r.id === post.runId);
      if (!run) continue;
      for (const it of post.items) {
        const st = run.devices[it.serial]?.status;
        if (st && st !== it.status) { it.status = st; changed = true; }
      }
      if (run.status !== 'running') {
        post.status = 'terminada';
        post.finishedAt = run.finishedAt || this.now();
        changed = true;
      }
    }
    if (changed) this.save(list);
  }

  /** Comprueba cada 20 s si toca lanzar alguna programada. */
  arm() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 20000);
    this.timer.unref?.();
  }

  tick() {
    for (const post of this.list()) {
      if (post.status === 'programada' && post.at <= this.now()) this.launch(post.id);
    }
    // Al arrancar la app, una publicación que estaba en marcha ya no tiene ejecución.
    const list = this.list();
    let changed = false;
    for (const post of list) {
      if (post.status === 'publicando' && !this.engine.runs?.has(post.runId)) {
        post.status = 'terminada';
        for (const it of post.items) if (['pendiente', 'en cola', 'ejecutando'].includes(it.status)) it.status = 'interrumpido';
        changed = true;
      }
    }
    if (changed) this.save(list);
  }

  start() {
    this.tick();
    this.arm();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

/** Archivos de vídeo/foto de una carpeta (sin subcarpetas), en orden alfabético. */
export function mediaInFolder(dir) {
  return fs.readdirSync(dir)
    .filter((f) => MEDIA_EXT.includes(path.extname(f).slice(1).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((f) => path.join(dir, f));
}
