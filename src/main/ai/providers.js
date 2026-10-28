// Proveedores de IA para las pruebas de apps: Claude (Anthropic) y Gemini (Google AI Studio).
// Los dos exponen lo mismo al agente: start(observación), next() -> llamadas a herramientas, addResults(resultados).
// Una observación es { image (JPEG en base64), text }.
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = 'claude-opus-5-5';
export const GEMINI_MODEL = 'gemini-flash-latest';
// Si el modelo elegido está saturado o no existe para la clave antes de empezar, se prueba con estos.
export const GEMINI_FALLBACKS = ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-pro-latest'];
const CLAUDE_BETAS = ['context-management-2025-06-27', 'server-side-fallback-2026-07-01'];
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

const claudeObs = (obs) => [
  { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: obs.image } },
  { type: 'text', text: obs.text },
];

export class ClaudeProvider {
  constructor({ client, model = CLAUDE_MODEL, effort = 'medium', system, tools }) {
    Object.assign(this, { client, model, effort, system, tools, name: 'Claude' });
    this.messages = [];
  }

  start(obs) {
    this.messages = [{ role: 'user', content: claudeObs(obs) }];
  }

  async next(signal) {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: CLAUDE_BETAS,
      fallbacks: 'default',
      system: this.system,
      tools: this.tools,
      output_config: { effort: this.effort },
      // Las capturas antiguas se retiran del contexto en el servidor: el coste no crece sin control.
      context_management: { edits: [{ type: 'clear_tool_uses_20250919', trigger: { type: 'input_tokens', value: 30000 },
        keep: { type: 'tool_uses', value: 4 }, exclude_tools: ['report_bug'] }] },
      messages: this.messages,
    }, { signal });
    this.messages.push({ role: 'assistant', content: res.content });
    return {
      refusal: res.stop_reason === 'refusal',
      paused: res.stop_reason === 'pause_turn',
      calls: res.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input || {} })),
      text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
      usage: { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0, cacheRead: res.usage?.cache_read_input_tokens || 0 },
    };
  }

  /** results: [{ id, name, text, obs?, isError? }] */
  addResults(results) {
    this.messages.push({ role: 'user', content: results.map((r) => ({
      type: 'tool_result', tool_use_id: r.id, ...(r.isError ? { is_error: true } : {}), content: r.obs ? claudeObs(r.obs) : r.text,
    })) });
  }
}

/** Esquema de herramienta en el subconjunto OpenAPI que acepta Gemini. */
function geminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['additionalProperties', 'minimum', 'maximum'].includes(k)) continue;
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else out[k] = v;
  }
  return out;
}

export class GeminiError extends Error {
  constructor(status, message, reason) {
    super(message);
    Object.assign(this, { status, reason });
  }
}

export class GeminiProvider {
  constructor({ apiKey, model = GEMINI_MODEL, system, tools, fetchImpl = globalThis.fetch, keepImages = 3, retries = 3, retryDelay = 3000, fallbacks = GEMINI_FALLBACKS }) {
    Object.assign(this, { apiKey, model, system, fetchImpl, keepImages, retries, retryDelay, name: 'Gemini' });
    this.fallbacks = fallbacks.filter((m) => m !== model);
    this.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.input_schema) })) }];
    this.contents = [];
    this.turn = 0;
  }

  start(obs) {
    this.contents = [{ role: 'user', parts: [{ text: obs.text }, { inlineData: { mimeType: 'image/jpeg', data: obs.image } }] }];
  }

  async next(signal) {
    // Los errores temporales de Google (demanda alta, cuota por minuto) se reintentan con espera creciente.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(signal);
      } catch (e) {
        const retryable = e instanceof GeminiError && [429, 500, 502, 503, 504].includes(e.status);
        if (signal?.aborted) throw e;
        // Cambiar de modelo solo antes del primer turno: las firmas de razonamiento son de cada modelo.
        const switchable = e instanceof GeminiError && [404, 500, 503].includes(e.status) && this.turn === 0 && this.fallbacks.length;
        if ((!retryable || attempt >= this.retries) && switchable) { this.model = this.fallbacks.shift(); attempt = -1; continue; }
        if (!retryable || attempt >= this.retries) throw e;
        await new Promise((r) => setTimeout(r, this.retryDelay * 2 ** attempt));
      }
    }
  }

  async request(signal) {
    const res = await this.fetchImpl(`${GEMINI_API}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: this.system }] },
        contents: this.contents,
        tools: this.tools,
        // ANY: en cada respuesta llama a una herramienta (acción, report_bug o finish).
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error || {};
      const reason = err.details?.find((d) => d.reason)?.reason || err.status || '';
      throw new GeminiError(res.status, err.message || `HTTP ${res.status}`, reason);
    }
    this.turn++;
    const cand = data.candidates?.[0];
    const blocked = !cand || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(cand.finishReason) || data.promptFeedback?.blockReason;
    const parts = cand?.content?.parts || [];
    // El turno del modelo se guarda tal cual (incluidas las firmas de razonamiento de Gemini 3).
    if (cand?.content) this.contents.push({ ...cand.content, role: 'model' });
    const u = data.usageMetadata || {};
    return {
      refusal: !!blocked && !parts.some((p) => p.functionCall),
      paused: false,
      calls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `g${this.turn}_${i}`, name: p.functionCall.name, input: p.functionCall.args || {} })),
      text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('\n').trim(),
      usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cacheRead: u.cachedContentTokenCount || 0 },
    };
  }

  addResults(results) {
    const parts = results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.obs ? r.obs.text : r.text, error: !!r.isError } } }));
    // La pantalla nueva va como imagen junto a las respuestas (la de la última acción).
    const lastObs = [...results].reverse().find((r) => r.obs)?.obs;
    if (lastObs) parts.push({ inlineData: { mimeType: 'image/jpeg', data: lastObs.image } });
    this.contents.push({ role: 'user', parts });
    this.trimImages();
  }

  /** Solo se mandan las últimas capturas; las anteriores se sustituyen por una nota (el coste no crece sin control). */
  trimImages() {
    let seen = 0;
    for (let i = this.contents.length - 1; i >= 0; i--) {
      const c = this.contents[i];
      if (c.role !== 'user') continue;
      if (!c.parts.some((p) => p.inlineData)) continue;
      if (++seen <= this.keepImages) continue;
      c.parts = c.parts.map((p) => (p.inlineData ? { text: '[captura anterior omitida]' } : p));
    }
  }
}

/** Modelos de Gemini que sirven para esto (generan contenido y no son de imagen, voz ni música). */
export async function listGeminiModels(apiKey, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${GEMINI_API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(res.status, data.error?.message || `HTTP ${res.status}`, data.error?.status);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter((m) => /^gemini/.test(m.id) && !/(tts|image|banana|transcribe|robotics|computer-use|embedding|live|audio)/i.test(m.id));
}

/** Mensaje claro para los errores de cualquiera de los dos proveedores. */
export function providerErrorText(e) {
  if (e instanceof GeminiError) {
    if (e.status === 400 && /API_KEY_INVALID/.test(e.reason || e.message)) return 'La clave de Gemini no es válida (botón "Proveedor de IA")';
    if (e.status === 403) return `Gemini rechazó la clave o el modelo: ${e.message}`;
    if (e.status === 404) return `Ese modelo de Gemini no existe o no está disponible para tu clave: ${e.message}`;
    if (e.status === 429) return 'Límite de uso de Gemini alcanzado (cuota de Google AI Studio): espera un poco o revisa tu plan';
    if (e.status === 503) return 'Gemini está saturado ahora mismo (demanda alta). Vuelve a intentarlo en unos minutos o elige otro modelo';
    return `Error de Gemini (${e.status}): ${e.message}`;
  }
  if (e instanceof Anthropic.AuthenticationError) return 'La clave de la API de Claude no es válida (botón "Proveedor de IA")';
  if (e instanceof Anthropic.RateLimitError) return 'Límite de uso de la API de Claude alcanzado: espera un poco y vuelve a intentarlo';
  if (e instanceof Anthropic.APIConnectionError) return 'No se pudo conectar con la API de Claude (revisa la conexión a internet)';
  if (e instanceof Anthropic.APIError) return `Error de la API de Claude (${e.status}): ${e.message}`;
  if (e?.name === 'TypeError' && /fetch/i.test(e.message)) return 'No se pudo conectar con la IA (revisa la conexión a internet)';
  return e?.message || String(e);
}
