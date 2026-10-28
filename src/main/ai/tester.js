// Pruebas de apps con IA: Claude mira la pantalla del teléfono (captura + lista de elementos), decide
// qué tocar o escribir para cumplir un objetivo, detecta cierres inesperados y ANR y deja un informe.
// Pensado para probar las apps propias antes de publicarlas en Play Store.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import Anthropic from '@anthropic-ai/sdk';
import * as A from '../automation/actions.js';

export const AI_MODEL = 'claude-opus-5-5';
const BETAS = ['context-management-2025-06-27', 'server-side-fallback-2026-07-01'];

const SYSTEM = `Eres un probador de apps Android (QA). Pruebas la app de su desarrollador antes de publicarla en Play Store.
En cada paso recibes una captura de la pantalla, la lista numerada de elementos visibles y avisos del sistema (cierres inesperados, ANR, app en segundo plano).

Cómo trabajar:
- Usa siempre una herramienta en cada respuesta: una acción, report_bug o finish.
- Prefiere tocar elementos por su número ("element"); usa coordenadas (0-1000) solo si el elemento no está en la lista.
- Antes de cada acción explica brevemente en "reason" qué esperas que pase.
- Comprueba el resultado de cada acción en la siguiente captura. Si algo no responde, se ve mal, el texto está cortado, hay errores de ortografía visibles, un botón no hace nada o la app se cierra, repórtalo con report_bug (un fallo por llamada) y sigue probando.
- Usa datos de prueba inventados (nombres, correos tipo prueba@ejemplo.com). No compres nada real ni envíes datos reales.
- Si la app se cierra, se volverá a abrir sola: continúa desde donde estés.
- Cuando hayas cumplido el objetivo, ya no puedas avanzar, o te queden pocos pasos, llama a finish con un resumen claro de lo probado, lo que funciona y lo que falla.`;

const TOOLS = [
  { name: 'tap', description: 'Toca un elemento de la lista por su número, o un punto de la pantalla en coordenadas 0-1000 (x de izquierda a derecha, y de arriba abajo).',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      element: { type: 'integer', description: 'Número del elemento en la lista' },
      x: { type: 'integer', minimum: 0, maximum: 1000 }, y: { type: 'integer', minimum: 0, maximum: 1000 },
      long_press: { type: 'boolean', description: 'Mantener pulsado' },
      reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'type_text', description: 'Escribe texto en el campo con el foco (tócalo antes) o en el elemento indicado. Solo letras sin acentos, números y símbolos básicos.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      text: { type: 'string' }, element: { type: 'integer' }, submit: { type: 'boolean', description: 'Pulsar Enter al terminar' },
      reason: { type: 'string' } }, required: ['text', 'reason'] } },
  { name: 'swipe', description: 'Desliza la pantalla (scroll). "up" sube el contenido para ver lo de abajo.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, reason: { type: 'string' } }, required: ['direction', 'reason'] } },
  { name: 'press_key', description: 'Pulsa una tecla del sistema.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      key: { type: 'string', enum: ['back', 'home', 'enter', 'recent_apps'] }, reason: { type: 'string' } }, required: ['key', 'reason'] } },
  { name: 'wait', description: 'Espera a que cargue algo (1-10 s) y vuelve a mirar la pantalla.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      seconds: { type: 'integer', minimum: 1, maximum: 10 }, reason: { type: 'string' } }, required: ['seconds', 'reason'] } },
  { name: 'report_bug', description: 'Registra un fallo encontrado en la app. Uno por llamada.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      title: { type: 'string' }, severity: { type: 'string', enum: ['crítico', 'alto', 'medio', 'bajo'] },
      steps: { type: 'string', description: 'Pasos para reproducirlo' }, expected: { type: 'string' }, actual: { type: 'string' } },
    required: ['title', 'severity', 'steps', 'expected', 'actual'] } },
  { name: 'finish', description: 'Termina la prueba con la conclusión.',
    input_schema: { type: 'object', additionalProperties: false, properties: {
      passed: { type: 'boolean', description: 'true si el objetivo se cumplió sin fallos graves' },
      summary: { type: 'string', description: 'Qué se probó, qué funciona y qué falla' } }, required: ['passed', 'summary'] } },
];

const KEYS = { back: 4, home: 3, enter: 66, recent_apps: 187 };

/** Elementos útiles de la pantalla, numerados, con su centro en coordenadas 0-1000. */
export function describeElements(nodes, size) {
  const list = [];
  for (const n of nodes) {
    const [x1, y1, x2, y2] = n.bounds;
    if (x2 - x1 < 4 || y2 - y1 < 4) continue;
    const label = n.text || n.desc;
    const editable = n.cls.endsWith('EditText');
    if (!label && !n.clickable && !editable) continue;
    if (!label && n.clickable && (x2 - x1) * (y2 - y1) > size.width * size.height * 0.6) continue; // contenedores enormes
    list.push({ n, label, editable });
  }
  return list.slice(0, 80).map(({ n, label, editable }, i) => {
    const cx = Math.round(n.cx / size.width * 1000); const cy = Math.round(n.cy / size.height * 1000);
    const kind = editable ? 'campo' : n.cls.split('.').pop();
    const id = n.id ? ` id=${n.id.split('/').pop()}` : '';
    return { index: i + 1, node: n, line: `[${i + 1}] ${kind}${label ? ` "${label.slice(0, 80)}"` : ''}${id}${n.clickable ? ' (pulsable)' : ''} @${cx},${cy}` };
  });
}

/**
 * Una prueba en un teléfono. Eventos: 'step' (paso), 'bug' (fallo), 'log' (mensaje), 'done' (informe).
 * deps: { device, client (Anthropic), screenshot(serial) => { base64, width, height }, outDir, model, effort }
 */
export class AiTestRun extends EventEmitter {
  constructor({ id, serial, device, client, screenshot, pkg, goal, maxSteps = 30, clearData = false, outDir, model = AI_MODEL, effort = 'medium' }) {
    super();
    Object.assign(this, { id, serial, device, client, screenshot, pkg, goal, maxSteps, clearData, outDir, model, effort });
    this.steps = [];
    this.bugs = [];
    this.status = 'ejecutando';
    this.summary = '';
    this.usage = { input: 0, output: 0, cacheRead: 0 };
    this.startedAt = Date.now();
    this.abort = new AbortController();
    this.lastCrash = '';
    this.overLimit = 0;
  }

  stop() {
    this.abort.abort();
  }

  log(message, level = 'info') {
    this.emit('log', { message, level });
  }

  /** Captura + elementos + avisos del sistema, como contenido para el modelo. */
  async observe(note = '') {
    const signal = this.abort.signal;
    const [shot, nodes, size, fg] = await Promise.all([
      this.screenshot(this.serial),
      A.dumpUi(this.device, signal).catch(() => []),
      this.device.getScreenSize(),
      A.foregroundPackage(this.device).catch(() => ''),
    ]);
    this.elements = describeElements(nodes, size);
    this.size = size;
    const notices = [];
    const crash = await this.readCrash();
    if (crash) {
      notices.push(`CIERRE INESPERADO de la app detectado:\n${crash.slice(0, 1500)}`);
      await A.launchApp(this.device, this.pkg).catch(() => {});
      await A.sleep(2500, signal);
      notices.push('La app se ha vuelto a abrir.');
    } else if (fg && fg !== this.pkg) {
      notices.push(`La app en primer plano es ${fg}, no ${this.pkg}. Si no lo esperabas, vuelve a la app (por ejemplo con back) o repórtalo.`);
    }
    const text = [
      note,
      notices.length ? `AVISOS:\n${notices.join('\n')}` : '',
      `Pasos usados: ${this.steps.length} de ${this.maxSteps}.`,
      `Elementos en pantalla:\n${this.elements.map((e) => e.line).join('\n') || '(no se pudieron leer: usa coordenadas de la captura)'}`,
    ].filter(Boolean).join('\n\n');
    return { shot, content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.base64 } },
      { type: 'text', text },
    ] };
  }

  /** Nuevas líneas del registro de cierres (FATAL EXCEPTION) y de ANR desde la última lectura. */
  async readCrash() {
    const out = await this.device.shell('logcat -d -b crash -v brief 2>/dev/null | tail -n 60; logcat -d -s ActivityManager:E -v brief 2>/dev/null | grep -i "ANR in" | tail -n 5', { timeout: 10000 }).catch(() => '');
    const relevant = String(out).trim();
    if (!relevant || relevant === this.lastCrash) return '';
    const fresh = relevant.startsWith(this.lastCrash) ? relevant.slice(this.lastCrash.length) : relevant;
    this.lastCrash = relevant;
    return /FATAL EXCEPTION|ANR in|Process: /.test(fresh) && fresh.includes(this.pkg) ? fresh.trim() : '';
  }

  saveShot(shot, n) {
    if (!this.outDir) return '';
    fs.mkdirSync(this.outDir, { recursive: true });
    const file = path.join(this.outDir, `paso-${String(n).padStart(3, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(shot.base64, 'base64'));
    return file;
  }

  point(input) {
    if (input.element != null) {
      const el = this.elements?.find((e) => e.index === input.element);
      if (!el) throw new Error(`No existe el elemento ${input.element} en la pantalla actual`);
      return [el.node.cx, el.node.cy];
    }
    if (input.x == null || input.y == null) throw new Error('Indica "element" o las coordenadas x e y');
    return [Math.round(input.x / 1000 * this.size.width), Math.round(input.y / 1000 * this.size.height)];
  }

  /** Ejecuta una acción del modelo en el teléfono. Devuelve un texto con lo que pasó. */
  async act(name, input) {
    const d = this.device;
    const signal = this.abort.signal;
    switch (name) {
      case 'tap': {
        const [x, y] = this.point(input);
        if (input.long_press) await d.shell(`input swipe ${x} ${y} ${x} ${y} 900`);
        else await A.tap(d, x, y, 2);
        await A.sleep(1500, signal);
        return `Tocado en ${x},${y}`;
      }
      case 'type_text': {
        if (input.element != null) { const [x, y] = this.point(input); await A.tap(d, x, y); await A.sleep(600, signal); }
        await A.typeText(d, input.text, false, signal);
        if (input.submit) await d.shell('input keyevent 66');
        await A.sleep(1000, signal);
        return `Escrito "${input.text}"`;
      }
      case 'swipe': {
        const v = { up: ['50%', '75%', '50%', '30%'], down: ['50%', '30%', '50%', '75%'], left: ['85%', '50%', '15%', '50%'], right: ['15%', '50%', '85%', '50%'] }[input.direction];
        const [x1, y1] = await A.resolvePoint(d, v[0], v[1]);
        const [x2, y2] = await A.resolvePoint(d, v[2], v[3]);
        await d.shell(`input swipe ${x1} ${y1} ${x2} ${y2} 400`);
        await A.sleep(1200, signal);
        return `Deslizado hacia ${input.direction}`;
      }
      case 'press_key':
        await d.shell(`input keyevent ${KEYS[input.key]}`);
        await A.sleep(1200, signal);
        return `Tecla ${input.key}`;
      case 'wait':
        await A.sleep(Math.min(10, Math.max(1, input.seconds)) * 1000, signal);
        return `Esperados ${input.seconds} s`;
      default:
        throw new Error(`Acción desconocida: ${name}`);
    }
  }

  async run() {
    const signal = this.abort.signal;
    try {
      this.log(`Preparando ${this.pkg}`);
      if (this.clearData) await this.device.shell(`pm clear ${this.pkg}`);
      await this.device.shell('logcat -b crash -c; logcat -c').catch(() => {});
      await A.launchApp(this.device, this.pkg);
      await A.sleep(3000, signal);
      const first = await this.observe(`Objetivo de la prueba: ${this.goal}\nApp: ${this.pkg}\nEmpieza.`);
      this.saveShot(first.shot, 0);
      const messages = [{ role: 'user', content: first.content }];

      for (let turn = 0; turn < this.maxSteps * 2 + 10 && !signal.aborted; turn++) {
        const res = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: 16000,
          betas: BETAS,
          fallbacks: 'default',
          system: SYSTEM,
          tools: TOOLS,
          output_config: { effort: this.effort },
          // Las capturas antiguas se retiran del contexto en el servidor: el coste no crece sin control.
          context_management: { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 30000 },
            keep: { type: 'tool_uses', value: 4 }, exclude_tools: ['report_bug'] }] },
          messages,
        }, { signal });
        this.usage.input += res.usage?.input_tokens || 0;
        this.usage.output += res.usage?.output_tokens || 0;
        this.usage.cacheRead += res.usage?.cache_read_input_tokens || 0;
        messages.push({ role: 'assistant', content: res.content });

        if (res.stop_reason === 'refusal') throw new Error('La IA no ha podido continuar con esta prueba (rechazo de seguridad)');
        if (res.stop_reason === 'pause_turn') continue;
        const uses = res.content.filter((b) => b.type === 'tool_use');
        if (!uses.length) {
          // Respondió sin herramienta: se toma como conclusión.
          const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          this.finish(false, text || 'La IA terminó sin conclusión');
          break;
        }

        const results = [];
        let finished = false;
        let acted = false;
        for (const use of uses) {
          const input = use.input || {};
          if (use.name === 'report_bug') {
            const bug = { ...input, step: this.steps.length };
            this.bugs.push(bug);
            this.emit('bug', bug);
            this.log(`Fallo (${input.severity}): ${input.title}`, 'warn');
            results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Fallo registrado.' });
          } else if (use.name === 'finish') {
            this.finish(!!input.passed, input.summary || '');
            results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Prueba terminada.' });
            finished = true;
          } else if (this.steps.length >= this.maxSteps) {
            results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Se acabaron los pasos: llama a finish con la conclusión.' });
          } else {
            let outcome;
            let isError = false;
            try { outcome = await this.act(use.name, input); } catch (e) { if (signal.aborted) throw e; outcome = `No se pudo: ${e.message}`; isError = true; }
            const step = { n: this.steps.length + 1, action: use.name, input, reason: input.reason || '', outcome, at: Date.now() };
            this.steps.push(step);
            acted = true;
            this.log(`Paso ${step.n}: ${use.name} — ${step.reason}`);
            // La nueva pantalla viaja dentro del resultado de la acción (así se puede retirar del contexto).
            const obs = await this.observe(outcome);
            step.screenshot = this.saveShot(obs.shot, step.n);
            this.emit('step', step);
            results.push({ type: 'tool_result', tool_use_id: use.id, is_error: isError, content: obs.content });
          }
        }
        messages.push({ role: 'user', content: results });
        if (finished) break;
        // Sin pasos libres se le dan dos turnos para escribir la conclusión con finish.
        if (!acted && this.steps.length >= this.maxSteps && ++this.overLimit >= 2) { this.finish(false, 'Se alcanzó el límite de pasos sin conclusión'); break; }
      }
      if (this.status === 'ejecutando') this.finish(false, signal.aborted ? 'Prueba detenida' : 'Se alcanzó el límite de pasos');
    } catch (e) {
      if (signal.aborted) this.finish(false, 'Prueba detenida', 'detenida');
      else {
        this.log(errorText(e), 'error');
        this.finish(false, errorText(e), 'error');
      }
    }
    return this.report();
  }

  finish(passed, summary, status) {
    if (this.status !== 'ejecutando') return;
    this.passed = passed;
    this.summary = summary;
    this.status = status || (passed ? 'superada' : 'con fallos');
    this.finishedAt = Date.now();
    this.emit('done', this.report());
  }

  report() {
    return {
      id: this.id, serial: this.serial, pkg: this.pkg, goal: this.goal, status: this.status, passed: !!this.passed,
      summary: this.summary, steps: this.steps, bugs: this.bugs, usage: this.usage, model: this.model,
      startedAt: this.startedAt, finishedAt: this.finishedAt || null, outDir: this.outDir,
    };
  }
}

export function errorText(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'La clave de la API de Claude no es válida (botón "Clave de la API" en Pruebas con IA)';
  if (e instanceof Anthropic.RateLimitError) return 'Límite de uso de la API de Claude alcanzado: espera un poco y vuelve a intentarlo';
  if (e instanceof Anthropic.APIConnectionError) return 'No se pudo conectar con la API de Claude (revisa la conexión a internet)';
  if (e instanceof Anthropic.APIError) return `Error de la API de Claude (${e.status}): ${e.message}`;
  return e?.message || String(e);
}

/** Informe HTML autocontenido (capturas incrustadas) para compartir. */
export function reportHtml(r) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const img = (file) => { try { return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`; } catch { return ''; } };
  const sev = { crítico: '#c92a2a', alto: '#e8590c', medio: '#f08c00', bajo: '#5c7cfa' };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba de ${esc(r.pkg)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1b1e26}h1{margin-bottom:4px}
.muted{color:#6b7280}.ok{color:#2b8a3e}.ko{color:#c92a2a}.bug{border-left:4px solid;padding:8px 12px;margin:8px 0;background:#f8f9fa}
.steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.step{border:1px solid #e5e7eb;border-radius:10px;padding:8px;font-size:12px}
.step img{width:100%;border-radius:6px}pre{white-space:pre-wrap}</style></head><body>
<h1>Prueba de ${esc(r.pkg)}</h1>
<p class="muted">${new Date(r.startedAt).toLocaleString('es-ES')} · ${esc(r.serial)} · ${r.steps.length} pasos · modelo ${esc(r.model)}</p>
<p><b>Objetivo:</b> ${esc(r.goal)}</p>
<p><b>Resultado:</b> <span class="${r.passed ? 'ok' : 'ko'}">${esc(r.status)}</span></p>
<pre>${esc(r.summary)}</pre>
<h2>Fallos (${r.bugs.length})</h2>
${r.bugs.map((b) => `<div class="bug" style="border-color:${sev[b.severity] || '#999'}"><b>[${esc(b.severity)}] ${esc(b.title)}</b> <span class="muted">(paso ${b.step})</span>
<pre>Pasos: ${esc(b.steps)}\nEsperado: ${esc(b.expected)}\nObtenido: ${esc(b.actual)}</pre></div>`).join('') || '<p class="muted">Ninguno.</p>'}
<h2>Pasos</h2><div class="steps">${r.steps.map((s) => `<div class="step">${s.screenshot ? `<img src="${img(s.screenshot)}" alt="">` : ''}
<b>${s.n}. ${esc(s.action)}</b><br>${esc(s.reason)}<br><span class="muted">${esc(s.outcome)}</span></div>`).join('')}</div>
</body></html>`;
}
