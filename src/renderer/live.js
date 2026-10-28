// Vídeo en tiempo real: decodifica el H.264 que envía cada teléfono (scrcpy-server) con WebCodecs
// y lo pinta en uno o varios <canvas> (miniatura de la cuadrícula y vista grande).
import { api } from './core.js';

const streams = new Map(); // serial -> { decoder, canvases, config, waitingKey, lastFrame }
const listeners = new Set();

/** Perfil y nivel del SPS para la cadena de códec (avc1.PPCCLL). */
export function codecFromConfig(data) {
  for (let i = 0; i + 4 < data.length; i++) {
    const start3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1;
    if (!start3) continue;
    const nal = data[i + 3];
    if ((nal & 0x1f) === 7 && i + 6 < data.length) {
      const hex = (b) => b.toString(16).padStart(2, '0');
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return 'avc1.42e01f';
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function entry(serial) {
  let s = streams.get(serial);
  if (!s) {
    s = { decoder: null, canvases: new Set(), config: null, codec: null, waitingKey: true, lastFrame: 0, size: null, enabled: false };
    streams.set(serial, s);
  }
  return s;
}

function createDecoder(serial, s) {
  s.decoder?.state !== 'closed' && s.decoder?.close();
  s.decoder = new VideoDecoder({
    output: (frame) => {
      s.lastFrame = Date.now();
      const w = frame.displayWidth; const h = frame.displayHeight;
      const first = !s.size;
      s.size = { width: w, height: h };
      for (const c of s.canvases) {
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        c.getContext('2d').drawImage(frame, 0, 0);
      }
      frame.close();
      if (first) for (const fn of listeners) fn(serial, 'frame');
    },
    // Si el decodificador falla se crea otro y se espera al siguiente fotograma clave.
    error: () => { s.waitingKey = true; s.decoder = null; },
  });
  s.decoder.configure({ codec: s.codec, optimizeForLatency: true, hardwareAcceleration: 'no-preference' });
  s.waitingKey = true;
}

function onPacket({ serial, config, key, pts, data }) {
  const s = streams.get(serial);
  // Los paquetes que llegan después de parar el vídeo (ya iban de camino) se ignoran.
  if (!s || !s.enabled || !s.canvases.size) return;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (config) {
    // SPS/PPS: se guardan para anteponerlos al siguiente fotograma clave (formato Annex B).
    s.config = bytes;
    const codec = codecFromConfig(bytes);
    if (!s.decoder || codec !== s.codec) { s.codec = codec; createDecoder(serial, s); }
    s.waitingKey = true;
    return;
  }
  if (!s.codec) return;
  if (!s.decoder) createDecoder(serial, s);
  if (s.waitingKey && !key) return;
  // Si el decodificador se atasca (PC lento), se descartan fotogramas hasta el siguiente clave para no acumular retraso.
  if (!key && s.decoder.decodeQueueSize > 8) { s.waitingKey = true; return; }
  try {
    s.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: pts, data: key && s.config ? concat(s.config, bytes) : bytes }));
    s.waitingKey = false;
  } catch {
    s.waitingKey = true;
  }
}

api.onStream?.(onPacket);

export const liveSupported = () => typeof VideoDecoder === 'function' && typeof api.onStream === 'function';

/** Pinta el vídeo de un teléfono en este canvas. Devuelve la función para dejar de hacerlo. */
export function attachCanvas(serial, canvas) {
  const s = entry(serial);
  s.canvases.add(canvas);
  return () => {
    s.canvases.delete(canvas);
  };
}

/** Hay fotogramas recientes de este teléfono (en los últimos ms). */
export function isLive(serial, ms = 4000) {
  const s = streams.get(serial);
  return !!s && Date.now() - s.lastFrame < ms;
}

/** Empieza a aceptar el vídeo de un teléfono (justo antes de pedirlo). */
export function enableStream(serial) {
  entry(serial).enabled = true;
}

/** Deja de aceptar el vídeo de un teléfono y olvida su estado de decodificación. */
export function resetStream(serial) {
  const s = streams.get(serial);
  if (!s) return;
  try { s.decoder?.state !== 'closed' && s.decoder?.close(); } catch {}
  Object.assign(s, { decoder: null, config: null, codec: null, waitingKey: true, lastFrame: 0, size: null, enabled: false });
}

export function onLiveEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
