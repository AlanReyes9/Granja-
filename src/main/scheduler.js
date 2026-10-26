// Programador de tareas: ejecuta flujos cada N minutos o a una hora diaria en días concretos.
export function isDue(schedule, now, lastRun) {
  if (!schedule.enabled) return false;
  if (schedule.mode === 'interval') {
    const every = Math.max(1, Number(schedule.everyMinutes) || 60) * 60000;
    return !lastRun || now - lastRun >= every;
  }
  // modo diario: "HH:MM" y días [0..6] (0 = domingo)
  const [hh, mm] = String(schedule.time || '09:00').split(':').map(Number);
  const d = new Date(now);
  const days = schedule.days?.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(d.getDay())) return false;
  if (d.getHours() !== hh || d.getMinutes() !== mm) return false;
  return !lastRun || now - lastRun > 61000;
}

export class Scheduler {
  constructor({ store, engine, devices, onEvent }) {
    this.store = store;
    this.engine = engine;
    this.devices = devices;
    this.onEvent = onEvent;
    this.lastRuns = {};
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 15000);
  }

  stop() {
    clearInterval(this.timer);
  }

  resolveTargets(schedule) {
    const ready = this.devices.ready().map((d) => d.serial);
    const meta = this.store.get('deviceMeta') || {};
    if (schedule.target === 'group') return ready.filter((s) => (meta[s]?.group || '') === schedule.group);
    if (schedule.target === 'list') return ready.filter((s) => (schedule.serials || []).includes(s));
    return ready;
  }

  tick() {
    const now = Date.now();
    for (const sc of this.store.get('schedules') || []) {
      if (!isDue(sc, now, this.lastRuns[sc.id])) continue;
      this.lastRuns[sc.id] = now;
      const wf = (this.store.get('workflows') || []).find((w) => w.id === sc.workflowId);
      if (!wf) continue;
      const targets = this.resolveTargets(sc);
      if (!targets.length) continue;
      try {
        const s = this.store.get('settings');
        this.engine.start(wf, targets, { concurrency: s.runConcurrency, staggerMs: s.runStaggerMs, source: `programado: ${sc.name}` });
        this.onEvent?.(`Programación "${sc.name}" lanzada en ${targets.length} dispositivo(s)`);
      } catch (e) {
        this.onEvent?.(`Programación "${sc.name}": ${e.message}`);
      }
    }
  }
}
