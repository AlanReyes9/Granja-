import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiTestRun, describeElements, reportHtml, AI_MODEL, makeProvider } from '../src/main/ai/tester.js';
import { providerErrorText } from '../src/main/ai/providers.js';

// App de prueba: login -> inicio con "Comprar", que se cierra (crash) al pulsarlo.
class DemoAppPhone {
  constructor() { Object.assign(this, { screen: 'login', focused: null, user: '', pass: '', crashLog: '', cmds: [] }); }
  async getScreenSize() { return { width: 1080, height: 2340 }; }
  elements() {
    if (this.screen === 'login') return [
      { text: this.user || 'Usuario', cls: 'android.widget.EditText', id: 'com.demo.app:id/user', b: [100, 600, 980, 720], go: () => (this.focused = 'user') },
      { text: this.pass ? '••••' : 'Contraseña', cls: 'android.widget.EditText', id: 'com.demo.app:id/pass', b: [100, 760, 980, 880], go: () => (this.focused = 'pass') },
      { text: 'Entrar', cls: 'android.widget.Button', id: 'com.demo.app:id/login', b: [100, 960, 980, 1080], go: () => { if (this.user && this.pass) this.screen = 'home'; } },
    ];
    return [
      { text: `Hola ${this.user}`, cls: 'android.widget.TextView', b: [100, 300, 980, 380] },
      { text: 'Comprar', cls: 'android.widget.Button', id: 'com.demo.app:id/buy', b: [100, 1200, 980, 1320], go: () => {
        this.crashLog += '--------- beginning of crash\nE/AndroidRuntime( 4242): FATAL EXCEPTION: main\nE/AndroidRuntime( 4242): Process: com.demo.app, PID: 4242\nE/AndroidRuntime( 4242): java.lang.NullPointerException: carrito\n';
        this.screen = 'launcher';
      } },
    ];
  }
  async shell(cmd) {
    this.cmds.push(cmd);
    if (cmd.includes('uiautomator dump')) {
      const els = this.screen === 'launcher' ? [] : this.elements();
      const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<?xml version="1.0"?><hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2340]">${els.map((e) =>
        `<node text="${esc(e.text)}" resource-id="${esc(e.id)}" class="${e.cls}" content-desc="" clickable="${!!e.go}" bounds="[${e.b[0]},${e.b[1]}][${e.b[2]},${e.b[3]}]" />`).join('')}</node></hierarchy>`;
    }
    if (cmd.startsWith('dumpsys window')) return `mCurrentFocus=Window{1 u0 ${this.screen === 'launcher' ? 'com.android.launcher3/.Launcher' : 'com.demo.app/.MainActivity'}}`;
    if (cmd.startsWith('cmd package resolve-activity')) return 'com.demo.app/.MainActivity';
    if (cmd.startsWith('am start -n com.demo.app')) { this.screen = 'login'; this.user = ''; this.pass = ''; return 'Starting'; }
    if (cmd.startsWith('logcat -d -b crash')) return this.crashLog;
    const tap = cmd.match(/^input tap (\d+) (\d+)/);
    if (tap) { const [x, y] = [+tap[1], +tap[2]]; this.elements().find((e) => e.go && x >= e.b[0] && x <= e.b[2] && y >= e.b[1] && y <= e.b[3])?.go(); return ''; }
    const t = cmd.match(/^input text '(.*)'$/);
    if (t && this.focused) { this[this.focused] += t[1]; return ''; }
    return '';
  }
}

// Cliente de Claude simulado: decide la siguiente acción leyendo la lista de elementos que le llega.
function fakeClient(script, seen) {
  let call = 0;
  return { beta: { messages: { create: async (params) => {
    seen.push(JSON.parse(JSON.stringify(params)));
    const last = params.messages.at(-1);
    const blocks = Array.isArray(last.content) ? last.content.flatMap((c) => (c.type === 'tool_result' ? c.content : [c])) : [];
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
    const find = (label) => Number((text.match(new RegExp(`\\[(\\d+)\\][^\\n]*"${label}`)) || [])[1]);
    const uses = script[call++]({ text, find });
    return { id: `m${call}`, role: 'assistant', stop_reason: 'tool_use', usage: { input_tokens: 1000, output_tokens: 100 },
      content: [{ type: 'thinking', thinking: '', signature: 'x' }, ...uses.map((u, i) => ({ type: 'tool_use', id: `t${call}_${i}`, name: u[0], input: u[1] }))] };
  } } } };
}

test('describeElements: numera campos, botones y textos con su centro en 0-1000', () => {
  const nodes = [
    { text: 'Entrar', desc: '', id: 'a:id/x', cls: 'android.widget.Button', clickable: true, bounds: [0, 0, 540, 234], cx: 270, cy: 117 },
    { text: '', desc: '', id: '', cls: 'android.view.View', clickable: false, bounds: [0, 0, 100, 100], cx: 50, cy: 50 },
    { text: '', desc: '', id: '', cls: 'android.widget.EditText', clickable: true, bounds: [0, 300, 1080, 400], cx: 540, cy: 350 },
  ];
  const els = describeElements(nodes, { width: 1080, height: 2340 });
  assert.equal(els.length, 2);
  assert.equal(els[0].line, '[1] Button "Entrar" id=x (pulsable) @250,50');
  assert.match(els[1].line, /^\[2\] campo/);
});

test('agente de pruebas: usa la app, detecta el cierre inesperado, reporta el fallo y termina con informe', async () => {
  const phone = new DemoAppPhone();
  const seen = [];
  const script = [
    ({ find }) => [['tap', { element: find('Usuario'), reason: 'Abrir el campo usuario' }]],
    () => [['type_text', { text: 'prueba', reason: 'Escribir usuario' }]],
    ({ find }) => [['type_text', { text: 'Clave123', element: find('Contraseña'), reason: 'Escribir clave' }]],
    ({ find }) => [['tap', { element: find('Entrar'), reason: 'Iniciar sesión' }]],
    ({ text, find }) => { assert.match(text, /Hola prueba/); return [['tap', { element: find('Comprar'), reason: 'Comprar' }]]; },
    ({ text }) => {
      assert.match(text, /CIERRE INESPERADO/);
      assert.match(text, /NullPointerException/);
      return [['report_bug', { title: 'La app se cierra al pulsar Comprar', severity: 'crítico', steps: 'Login y pulsar Comprar', expected: 'Ir al carrito', actual: 'Cierre inesperado' }],
        ['finish', { passed: false, summary: 'El login funciona; Comprar cierra la app.' }]];
    },
  ];
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxf-ai-'));
  const run = new AiTestRun({ id: 't1', serial: 'S1', device: phone, client: fakeClient(script, seen), pkg: 'com.demo.app', goal: 'Inicia sesión y compra',
    maxSteps: 10, outDir, screenshot: async () => ({ base64: Buffer.from('jpeg').toString('base64'), width: 540, height: 1170 }) });
  const r = await run.run();
  assert.equal(r.status, 'con fallos');
  assert.equal(r.passed, false);
  assert.equal(r.steps.length, 5);
  assert.equal(r.bugs.length, 1);
  assert.equal(r.bugs[0].severity, 'crítico');
  assert.equal(r.summary, 'El login funciona; Comprar cierra la app.');
  assert.deepEqual(r.usage, { input: 6000, output: 600, cacheRead: 0 });
  assert.equal(fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg')).length, 6, 'captura inicial + una por paso');
  // La app se relanzó tras el cierre.
  assert.ok(phone.cmds.filter((c) => c.startsWith('am start -n com.demo.app')).length >= 2);
  // Petición a la API: modelo, betas, fallbacks, herramientas, edición de contexto y la captura en el resultado de la herramienta.
  const p = seen[0];
  assert.equal(p.model, AI_MODEL);
  assert.deepEqual(p.betas, ['context-management-2025-06-27', 'server-side-fallback-2026-07-01']);
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.tools.map((t) => t.name), ['tap', 'type_text', 'swipe', 'press_key', 'wait', 'report_bug', 'finish']);
  assert.equal(p.context_management.edits[0].type, 'clear_tool_uses_20250919');
  assert.equal(p.messages[0].content[0].type, 'image');
  const later = seen[1].messages.at(-1).content[0];
  assert.equal(later.type, 'tool_result');
  assert.equal(later.content[0].type, 'image', 'la nueva pantalla viaja dentro del resultado de la acción');
  // La conversación solo crece (no se editan turnos anteriores): el bloque de thinking se devuelve tal cual.
  assert.equal(seen[1].messages[1].content[0].type, 'thinking');
  const html = reportHtml(r);
  assert.match(html, /La app se cierra al pulsar Comprar/);
  assert.match(html, /data:image\/jpeg;base64/);
});

test('agente de pruebas: un elemento inexistente vuelve como error y el límite de pasos pide terminar', async () => {
  const phone = new DemoAppPhone();
  const seen = [];
  const script = [
    () => [['tap', { element: 99, reason: 'Elemento que no existe' }]],
    ({ text }) => { assert.match(text, /No se pudo: No existe el elemento 99/); return [['swipe', { direction: 'up', reason: 'Bajar' }]]; },
    () => [['press_key', { key: 'back', reason: 'Atrás' }]],
    ({ text }) => { assert.match(text, /Pasos usados: 3 de 3/); return [['tap', { element: 1, reason: 'Otro' }]]; },
    () => [['finish', { passed: true, summary: 'Hecho' }]],
  ];
  const run = new AiTestRun({ id: 't2', serial: 'S1', device: phone, client: fakeClient(script, seen), pkg: 'com.demo.app', goal: 'Explora',
    maxSteps: 3, outDir: null, screenshot: async () => ({ base64: 'eA==', width: 540, height: 1170 }) });
  const r = await run.run();
  assert.equal(r.steps.length, 3);
  assert.equal(r.status, 'superada');
  const over = seen[4].messages.at(-1).content[0];
  assert.equal(over.is_error, true);
  assert.match(over.content, /Se acabaron los pasos/);
});

// API de Gemini simulada: responde con las llamadas del guion y anota cada petición.
function fakeGeminiFetch(script, seen, failures = []) {
  let turn = 0;
  return async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    const fail = failures.shift();
    if (fail) return { ok: false, status: fail, json: async () => ({ error: { code: fail, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }) };
    const calls = script[turn++](body);
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'pensando', thought: true, thoughtSignature: `sig${turn}` },
        ...calls.map(([name, args]) => ({ functionCall: { name, args } }))] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
    }) };
  };
}

test('agente de pruebas con Gemini: function calling, capturas recientes, firmas conservadas y reintentos', async () => {
  const phone = new DemoAppPhone();
  const seen = [];
  const find = (body, label) => {
    const last = body.contents.at(-1).parts;
    const text = last.map((p) => p.text || p.functionResponse?.response?.result || '').join('\n');
    return Number(text.match(new RegExp(`\\[(\\d+)\\][^\\n]*${label}`))[1]);
  };
  const script = [
    (b) => [['type_text', { text: 'prueba', element: find(b, 'Usuario'), reason: 'Usuario' }]],
    (b) => [['type_text', { text: 'Clave123', element: find(b, 'Contraseña'), reason: 'Clave' }]],
    (b) => [['tap', { element: find(b, 'Entrar'), reason: 'Entrar' }]],
    (b) => [['tap', { element: find(b, 'Comprar'), reason: 'Comprar' }]],
    (b) => {
      assert.match(JSON.stringify(b.contents.at(-1)), /CIERRE INESPERADO/);
      return [['report_bug', { title: 'Cierre al comprar', severity: 'crítico', steps: 'Login y Comprar', expected: 'Carrito', actual: 'Se cierra' }],
        ['finish', { passed: false, summary: 'Comprar cierra la app.' }]];
    },
  ];
  // Primera petición: modelo saturado (503) dos veces; se reintenta y sigue con el mismo modelo.
  const provider = makeProvider('gemini', { apiKey: 'k', model: 'gemini-x', fetchImpl: fakeGeminiFetch(script, seen, [503, 503]), retryDelay: 1, fallbacks: [] });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxf-ai-'));
  const run = new AiTestRun({ id: 'g1', serial: 'S1', device: phone, provider, pkg: 'com.demo.app', goal: 'Inicia sesión y compra', maxSteps: 10, outDir,
    screenshot: async () => ({ base64: Buffer.from('jpeg').toString('base64'), width: 540, height: 1170 }) });
  const r = await run.run();
  assert.equal(r.status, 'con fallos');
  assert.equal(r.provider, 'Gemini');
  assert.equal(r.model, 'gemini-x');
  assert.equal(r.bugs[0].title, 'Cierre al comprar');
  assert.deepEqual(r.usage, { input: 500, output: 75, cacheRead: 0 });
  assert.equal(seen.length, 7, '2 errores 503 reintentados + 5 turnos');
  const req = seen.at(-1);
  assert.match(req.url, /models\/gemini-x:generateContent$/);
  assert.equal(req.headers['x-goog-api-key'], 'k');
  assert.equal(req.body.toolConfig.functionCallingConfig.mode, 'ANY');
  const decls = req.body.tools[0].functionDeclarations;
  assert.deepEqual(decls.map((d) => d.name), ['tap', 'type_text', 'swipe', 'press_key', 'wait', 'report_bug', 'finish']);
  assert.ok(!JSON.stringify(decls).includes('additionalProperties'), 'esquemas en el subconjunto que acepta Gemini');
  // Turnos del modelo tal cual (con firmas de razonamiento) y respuestas de función con la captura nueva.
  const models = req.body.contents.filter((c) => c.role === 'model');
  assert.deepEqual(models.map((c) => c.parts[0].thoughtSignature), ['sig1', 'sig2', 'sig3', 'sig4']);
  assert.equal(req.body.contents.at(-1).parts[0].functionResponse.name, 'tap');
  // Solo viajan las 3 capturas más recientes.
  const withImage = req.body.contents.filter((c) => c.parts.some((p) => p.inlineData)).length;
  assert.equal(withImage, 3);
  assert.match(JSON.stringify(req.body.contents[0]), /captura anterior omitida/);
});

test('Gemini: si el modelo elegido está saturado al empezar, cambia a otro; los errores se explican claro', async () => {
  const seen = [];
  const p = makeProvider('gemini', { apiKey: 'k', model: 'gemini-a', fetchImpl: fakeGeminiFetch([() => [['wait', { seconds: 1, reason: 'x' }]]], seen, [503, 503]),
    retries: 1, retryDelay: 1, fallbacks: ['gemini-b'] });
  p.start({ image: 'AA==', text: 'pantalla' });
  const res = await p.next();
  assert.equal(res.calls[0].name, 'wait');
  assert.equal(p.model, 'gemini-b');
  assert.match(seen.at(-1).url, /gemini-b:generateContent/);
  // Después del primer turno no se cambia de modelo: el error llega al usuario.
  const p2 = makeProvider('gemini', { apiKey: 'k', model: 'gemini-a', fetchImpl: fakeGeminiFetch([], [], [400]), retries: 0, fallbacks: [] });
  p2.start({ image: 'AA==', text: 'x' });
  await assert.rejects(p2.next(), (e) => e.status === 400);
  const bad = makeProvider('gemini', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }) }), fallbacks: [] });
  bad.start({ image: 'AA==', text: 'x' });
  await assert.rejects(bad.next(), (e) => /clave de Gemini no es válida/.test(providerErrorText(e)));
});
