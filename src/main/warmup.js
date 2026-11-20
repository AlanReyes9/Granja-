// Calentamiento de cuentas: en cada teléfono abre las apps elegidas una tras otra, busca un tema y mira
// vídeos de ese tema, pasando al siguiente cada cierto tiempo. Solo mira: no da me gusta, no comenta ni sigue.
import { EventEmitter } from 'node:events';

/** Tema de cada teléfono en cada ronda. "orden": distinto por teléfono y rota en cada ronda; "aleatorio": al azar. */
export function pickTopics({ serials, topics, rounds = 1, mode = 'orden', random = Math.random }) {
  const list = topics.map((t) => String(t).trim()).filter(Boolean);
  if (!list.length) throw new Error('Escribe al menos un tema que buscar');
  if (!serials.length) throw new Error('Elige al menos un teléfono');
  return serials.map((serial, i) => ({
    serial,
    topics: Array.from({ length: rounds }, (_, r) => (mode === 'aleatorio' ? list[Math.floor(random() * list.length)] : list[(i + r) % list.length])),
  }));
}

/** Variables que recibe el flujo de calentamiento en cada teléfono. */
export function warmVars(topic, { videos, secMin, secMax }) {
  return {
    tema: topic,
    // Para enlaces de búsqueda (YouTube) dentro de comillas simples del shell.
    tema_url: encodeURIComponent(topic).replace(/'/g, '%27'),
    videos: String(videos),
    ms_min: String(Math.round(secMin * 1000)),
    ms_max: String(Math.round(Math.max(secMin, secMax) * 1000)),
  };
}

export class Warmup extends EventEmitter {
  constructor({ engine, store, getWorkflow, getSettings = () => ({}), now = Date.now }) {
    super();
    Object.assign(this, { engine, store, getWorkflow, getSettings, now });
    this.timer = null;
    engine.on('runs', (runs) => this.syncRuns(runs));
  }

  list() {
    return this.store.get('warmups') || [];
  }

  save(list) {
    this.store.set('warmups', list.slice(0, 100));
    this.emit('changed', this.list());
  }

  create({ name, workflowIds, serials, topics, topicMode = 'orden', rounds = 1, videos = 10, secMin = 15, secMax = 30, at = null }) {
    const flows = (workflowIds || []).map((id) => this.getWorkflow(id)).filter(Boolean);
    if (!flows.length) throw new Error('Elige al menos una red social (flujo de calentamiento)');
    rounds = Math.min(20, Math.max(1, Math.round(Number(rounds) || 1)));
    videos = Math.min(500, Math.max(1, Math.round(Number(videos) || 1)));
    secMin = Math.max(3, Number(secMin) || 15);
    secMax = Math.max(secMin, Number(secMax) || secMin);
    const plan = pickTopics({ serials, topics, rounds, mode: topicMode });
    const later = at && at > this.now();
    const job = {
      id: `cal${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: String(name || '').trim() || `${flows.map((f) => f.name.replace(/^Calentar:\s*/, '')).join(' + ')} · ${plan.length} teléfono(s)`,
      platforms: flows.map((f) => ({ id: f.id, name: f.name })),
      rounds, videos, secMin, secMax, topicMode, createdAt: this.now(),
      at: later ? at : null, status: later ? 'programado' : 'pendiente',
      round: 0, step: 0, runId: null,
      items: plan.map((p) => ({ ...p, results: {} })),
    };
    this.save([job, ...this.list()]);
    if (!later) this.advance(job.id);
    this.arm();
    return this.list().find((j) => j.id === job.id) || job;
  }

  /** Lanza la siguiente red social de la ronda actual (o termina). */
  advance(id) {
    const list = this.list();
    const job = list.find((j) => j.id === id);
    if (!job || ['terminado', 'cancelado', 'error'].includes(job.status)) return;
    if (job.step >= job.platforms.length) { job.round++; job.step = 0; }
    if (job.round >= job.rounds) {
      Object.assign(job, { status: 'terminado', finishedAt: this.now(), runId: null });
      this.save(list);
      return;
    }
    const platform = job.platforms[job.step];
    const wf = this.getWorkflow(platform.id);
    const key = `${job.round}:${job.step}`;
    if (!wf) {
      for (const it of job.items) it.results[key] = 'sin flujo';
      job.step++;
      this.save(list);
      this.advance(id);
      return;
    }
    const s = this.getSettings();
    try {
      job.runId = this.engine.start(wf, job.items.map((it) => it.serial), {
        source: 'calentamiento',
        concurrency: s.runConcurrency ?? 10,
        staggerMs: s.runStaggerMs ?? 0,
        varsBySerial: Object.fromEntries(job.items.map((it) => [it.serial, warmVars(it.topics[job.round], job)])),
      });
      job.status = 'calentando';
      job.startedAt ??= this.now();
      for (const it of job.items) it.results[key] = 'en cola';
    } catch (e) {
      Object.assign(job, { status: 'error', error: e.message });
    }
    this.save(list);
  }

  syncRuns(runs) {
    const list = this.list();
    const finished = [];
    let changed = false;
    for (const job of list) {
      // Uno detenido sigue escuchando su ejecución hasta que se para del todo (para mostrar "detenido").
      if (job.status !== 'calentando' && !(job.status === 'cancelado' && job.runId)) continue;
      const run = runs.find((r) => r.id === job.runId);
      if (!run) continue;
      const key = `${job.round}:${job.step}`;
      for (const it of job.items) {
        const st = run.devices[it.serial]?.status;
        if (st && it.results[key] !== st) { it.results[key] = st; changed = true; }
      }
      if (run.status !== 'running') {
        job.runId = null;
        if (run.status === 'detenido' || job.status === 'cancelado') Object.assign(job, { status: 'cancelado', finishedAt: job.finishedAt || this.now() });
        else { job.step++; finished.push(job.id); }
        changed = true;
      }
    }
    if (changed) this.save(list);
    for (const id of finished) this.advance(id);
  }

  cancel(id) {
    const list = this.list();
    const job = list.find((j) => j.id === id);
    if (!job) return;
    if (job.status === 'calentando' && job.runId) this.engine.stop(job.runId);
    if (['programado', 'pendiente', 'calentando'].includes(job.status)) Object.assign(job, { status: 'cancelado', finishedAt: this.now() });
    this.save(list);
  }

  remove(id) {
    this.cancel(id);
    this.save(this.list().filter((j) => j.id !== id));
  }

  arm() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 20000);
    this.timer.unref?.();
  }

  tick() {
    const list = this.list();
    let changed = false;
    for (const job of list) {
      // Al abrir la app, un calentamiento que estaba en marcha ya no tiene ejecución.
      if (job.status === 'calentando' && !this.engine.runs?.has(job.runId)) {
        Object.assign(job, { status: 'cancelado', error: 'Se cerró la app mientras calentaba', finishedAt: this.now() });
        changed = true;
      }
      // Lo que quedó a medias en uno ya parado se muestra como detenido.
      if (job.status === 'cancelado' && !this.engine.runs?.has(job.runId)) {
        job.runId = null;
        for (const it of job.items) {
          for (const [k, st] of Object.entries(it.results)) if (['ejecutando', 'en cola'].includes(st)) { it.results[k] = 'detenido'; changed = true; }
        }
      }
    }
    if (changed) this.save(list);
    for (const job of this.list()) if (job.status === 'programado' && job.at <= this.now()) this.advance(job.id);
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
