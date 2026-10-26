// Plantillas de flujos listas para usar y utilidades para construir grafos Drawflow.
import { NODE_MAP, defaultParams } from '../shared/nodes.js';

/** nodes: [{type, params, x, y}], links: [[desde, salida(0..), hasta]] (índices base 0). */
export function buildGraph(nodes, links) {
  const data = {};
  nodes.forEach((n, i) => {
    const id = String(i + 1);
    const def = NODE_MAP[n.type];
    data[id] = {
      id: i + 1, name: n.type, class: n.type, html: '', typenode: false,
      data: { ...defaultParams(n.type), ...(n.params || {}) },
      inputs: def.inputs === 0 ? {} : { input_1: { connections: [] } },
      outputs: Object.fromEntries(def.outputs.map((_, k) => [`output_${k + 1}`, { connections: [] }])),
      pos_x: Math.round(n.x * 1.3), pos_y: Math.round(n.y * 1.3),
    };
  });
  for (const [from, out, to] of links) {
    data[from + 1].outputs[`output_${out + 1}`].connections.push({ node: String(to + 1), output: 'input_1' });
    data[to + 1].inputs.input_1.connections.push({ node: String(from + 1), input: `output_${out + 1}` });
  }
  return { drawflow: { Home: { data } } };
}

export const TEMPLATES = [
  {
    name: 'Navegar y hacer scroll natural',
    description: 'Abre una URL, hace scroll con pausas aleatorias N veces y vuelve al inicio.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 200 },
      { type: 'wake_unlock', x: 300, y: 180 },
      { type: 'open_url', params: { url: 'https://news.google.com' }, x: 570, y: 180 },
      { type: 'random_wait', params: { min: 3000, max: 6000 }, x: 840, y: 180 },
      { type: 'loop', params: { times: '{rand:8-15}' }, x: 1110, y: 180 },
      { type: 'scroll', params: { direction: 'abajo', count: '1' }, x: 1110, y: 420 },
      { type: 'random_wait', params: { min: 2000, max: 7000 }, x: 840, y: 440 },
      { type: 'key', params: { key: 'HOME' }, x: 1380, y: 180 },
      { type: 'log', params: { message: 'Sesión terminada en {device.name}' }, x: 1640, y: 180 },
    ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [4, 0, 5], [5, 0, 6], [6, 0, 4], [4, 1, 7], [7, 0, 8]]),
  },
  {
    name: 'Instalar APK y abrir la app',
    description: 'Instala un APK desde el PC, abre la app y avisa si falla.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 200 },
      { type: 'install_apk', params: { path: 'C:\\apks\\app.apk' }, x: 300, y: 180 },
      { type: 'open_app', params: { package: 'com.ejemplo.app' }, x: 580, y: 100 },
      { type: 'notify', params: { message: '❌ {device.name}: falló la instalación' }, x: 580, y: 330 },
      { type: 'wait', params: { ms: 4000 }, x: 850, y: 100 },
      { type: 'screenshot', x: 1110, y: 100 },
    ], [[0, 0, 1], [1, 0, 2], [1, 1, 3], [2, 0, 4], [4, 0, 5]]),
  },
  {
    name: 'Rotar IP con modo avión',
    description: 'Activa y desactiva modo avión, espera la red y comprueba la IP pública.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 200 },
      { type: 'airplane', params: { ms: 5000 }, x: 300, y: 180 },
      { type: 'wait', params: { ms: 8000 }, x: 560, y: 180 },
      { type: 'shell', params: { command: 'curl -s https://api.ipify.org || toybox wget -qO- https://api.ipify.org', var: 'ip' }, x: 820, y: 180 },
      { type: 'log', params: { message: 'Nueva IP de {device.name}: {ip}' }, x: 1090, y: 180 },
    ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4]]),
  },
  {
    name: 'Login con cuentas desde tabla',
    description: 'Lee usuario/clave de la tabla "cuentas" (una fila por dispositivo) y los escribe en la app.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 220 },
      { type: 'data_row', params: { table: 'cuentas', mode: 'por dispositivo' }, x: 300, y: 200 },
      { type: 'open_app', params: { package: 'com.ejemplo.app' }, x: 570, y: 120 },
      { type: 'tap_text', params: { text: 'Iniciar sesión', timeout: 10000 }, x: 840, y: 120 },
      { type: 'tap_text', params: { text: 'Usuario', timeout: 5000 }, x: 1110, y: 60 },
      { type: 'type_text', params: { text: '{usuario}', humanize: true }, x: 1380, y: 60 },
      { type: 'tap_text', params: { text: 'Contraseña', timeout: 5000 }, x: 1650, y: 60 },
      { type: 'type_text', params: { text: '{clave}', humanize: true }, x: 1920, y: 60 },
      { type: 'key', params: { key: 'ENTER' }, x: 2190, y: 60 },
      { type: 'log', params: { message: 'Sin fila de datos para {device.name}' }, x: 570, y: 380 },
    ], [[0, 0, 1], [1, 0, 2], [1, 1, 9], [2, 0, 3], [3, 0, 4], [4, 0, 5], [5, 0, 6], [6, 0, 7], [7, 0, 8]]),
  },
  {
    name: 'Mantenimiento de la granja',
    description: 'Limpia apps en segundo plano, ajusta brillo mínimo y avisa si la batería está baja.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 200 },
      { type: 'shell', params: { command: 'am kill-all; settings put system screen_brightness_mode 0; settings put system screen_brightness 10', var: '' }, x: 300, y: 180 },
      { type: 'shell', params: { command: "dumpsys battery | grep level | awk '{print $2}'", var: 'bateria' }, x: 570, y: 180 },
      { type: 'if_var', params: { name: 'bateria', op: '<', value: '20' }, x: 840, y: 180 },
      { type: 'notify', params: { message: '🔋 {device.name} batería {bateria}%' }, x: 1110, y: 100 },
      { type: 'log', params: { message: '{device.name} OK ({bateria}%)' }, x: 1110, y: 320 },
    ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [3, 1, 5]]),
  },
];
