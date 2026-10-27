// Plantillas de flujos listas para usar y utilidades para construir grafos Drawflow.
import { NODE_MAP, defaultParams } from '../shared/nodes.js';

/** nodes: [{type, params, x, y}], links: [[desde, salida(0..), hasta]] (índices base 0). */
export function buildGraph(nodes, links) {
  const data = {};
  nodes.forEach((n, i) => {
    const id = String(i + 1);
    const def = NODE_MAP[n.type];
    data[id] = {
      id: i + 1, name: n.type, class: `n-${n.type}`, html: '', typenode: false,
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
      { type: 'start', x: 0, y: 30 },
      { type: 'wake_unlock', x: 215, y: 0 },
      { type: 'open_url', params: { url: 'https://news.google.com' }, x: 430, y: 0 },
      { type: 'random_wait', params: { min: 3000, max: 6000 }, x: 645, y: 0 },
      { type: 'loop', params: { times: '{rand:8-15}' }, x: 860, y: 0 },
      { type: 'scroll', params: { direction: 'abajo', count: '1' }, x: 860, y: 230 },
      { type: 'random_wait', params: { min: 2000, max: 7000 }, x: 860, y: 470 },
      { type: 'key', params: { key: 'HOME' }, x: 1075, y: 0 },
      { type: 'log', params: { message: 'Sesión terminada en {device.name}' }, x: 1075, y: 200 },
    ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [4, 0, 5], [5, 0, 6], [6, 0, 4], [4, 1, 7], [7, 0, 8]]),
  },
  {
    name: 'Instalar APK y abrir la app',
    description: 'Instala un APK desde el PC, abre la app y avisa si falla.',
    build: () => buildGraph([
      { type: 'start', x: 40, y: 200 },
      { type: 'install_apk', params: { path: 'C:\\apks\\app.apk' }, x: 300, y: 180 },
      { type: 'open_app', params: { package: 'com.ejemplo.app' }, x: 580, y: 100 },
      { type: 'notify', params: { message: '{device.name}: falló la instalación' }, x: 580, y: 330 },
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
      { type: 'start', x: 0, y: 30 },
      { type: 'data_row', params: { table: 'cuentas', mode: 'por dispositivo' }, x: 215, y: 0 },
      { type: 'open_app', params: { package: 'com.ejemplo.app' }, x: 430, y: 0 },
      { type: 'tap_text', params: { text: 'Iniciar sesión', timeout: 10000 }, x: 645, y: 0 },
      { type: 'tap_text', params: { text: 'Usuario', timeout: 5000 }, x: 0, y: 280 },
      { type: 'type_text', params: { text: '{usuario}', humanize: true }, x: 215, y: 280 },
      { type: 'tap_text', params: { text: 'Contraseña', timeout: 5000 }, x: 430, y: 280 },
      { type: 'type_text', params: { text: '{clave}', humanize: true }, x: 645, y: 280 },
      { type: 'key', params: { key: 'ENTER' }, x: 860, y: 280 },
      { type: 'log', params: { message: 'Sin fila de datos para {device.name}' }, x: 860, y: 0 },
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
      { type: 'notify', params: { message: '{device.name}: batería al {bateria}%' }, x: 1110, y: 100 },
      { type: 'log', params: { message: '{device.name} OK ({bateria}%)' }, x: 1110, y: 320 },
    ], [[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [3, 1, 5]]),
  },
  {
    name: 'Instagram: seguir perfil y dar me gusta',
    description: 'Abre Instagram, busca el perfil de la variable "perfil", lo sigue si no lo sigues y da me gusta a sus publicaciones haciendo scroll con pausas aleatorias. Edita "perfil" y "likes" en los dos primeros nodos.',
    build: () => {
      const IG = 'com.instagram.android:id';
      const likeBtn = `//*[(@resource-id="${IG}/row_feed_button_like" or @resource-id="${IG}/like_button") and (@content-desc="Me gusta" or @content-desc="Like") and not(@selected="true")]`;
      const followBtn = `//*[(@resource-id="${IG}/profile_header_follow_button" or @class="android.widget.Button") and (@text="Seguir" or @text="Follow" or @text="Seguir también" or @text="Follow back")]`;
      return buildGraph([
        /* 0 */ { type: 'start', x: 0, y: 30 },
        /* 1 */ { type: 'set_var', params: { name: 'perfil', value: 'nasa' }, x: 215, y: 0 },
        /* 2 */ { type: 'set_var', params: { name: 'likes', value: '{rand:8-15}' }, x: 430, y: 0 },
        /* 3 */ { type: 'set_var', params: { name: 'likes_dados', value: '0' }, x: 645, y: 0 },
        /* 4 */ { type: 'open_app', params: { package: 'com.instagram.android' }, x: 860, y: 0 },
        /* 5 */ { type: 'random_wait', params: { min: 3000, max: 5000 }, x: 1075, y: 0 },
        // Buscar el perfil.
        /* 6 */ { type: 'tap_xpath', params: { xpath: `//*[@resource-id="${IG}/search_tab" or @content-desc="Buscar y explorar" or @content-desc="Search and explore"]`, timeout: 8000 }, x: 0, y: 280 },
        /* 7 */ { type: 'random_wait', params: { min: 1000, max: 2000 }, x: 215, y: 280 },
        /* 8 */ { type: 'tap_xpath', params: { xpath: `//*[@resource-id="${IG}/action_bar_search_edit_text" or (@class="android.widget.EditText" and (@text="Buscar" or @text="Search"))]`, timeout: 5000 }, x: 430, y: 280 },
        /* 9 */ { type: 'type_text', params: { text: '{perfil}', humanize: true }, x: 645, y: 280 },
        /* 10 */ { type: 'random_wait', params: { min: 2500, max: 4000 }, x: 860, y: 280 },
        /* 11 */ { type: 'tap_xpath', params: { xpath: `//*[@resource-id="${IG}/row_search_user_username" and @text="{perfil}"]`, timeout: 8000 }, x: 1075, y: 280 },
        // Si la búsqueda falla, el perfil se abre directamente con su enlace.
        /* 12 */ { type: 'shell', params: { command: "am start -a android.intent.action.VIEW -d 'https://www.instagram.com/{perfil}/' -p com.instagram.android", var: '' }, x: 0, y: 560 },
        /* 13 */ { type: 'random_wait', params: { min: 3000, max: 5000 }, x: 215, y: 560 },
        // Seguir solo si el botón dice "Seguir".
        /* 14 */ { type: 'if_xpath', params: { xpath: followBtn, timeout: 4000 }, x: 430, y: 560 },
        /* 15 */ { type: 'tap_xpath', params: { xpath: followBtn, timeout: 3000 }, x: 645, y: 480 },
        /* 16 */ { type: 'log', params: { message: '{device.name}: ahora sigues a {perfil}' }, x: 860, y: 480 },
        /* 17 */ { type: 'log', params: { message: '{device.name}: ya seguías a {perfil}' }, x: 645, y: 720 },
        /* 18 */ { type: 'random_wait', params: { min: 1500, max: 3000 }, x: 1075, y: 560 },
        // Abrir la primera publicación del perfil.
        /* 19 */ { type: 'tap_xpath', params: { xpath: `(//*[@resource-id="${IG}/image_button" or contains(@content-desc,"fila 1, columna 1") or contains(@content-desc,"row 1, column 1")])[1]`, timeout: 8000 }, x: 0, y: 860 },
        /* 20 */ { type: 'log', params: { message: '{device.name}: {perfil} no tiene publicaciones visibles (¿cuenta privada?)' }, x: 0, y: 1120 },
        /* 21 */ { type: 'random_wait', params: { min: 2500, max: 4500 }, x: 215, y: 860 },
        // Bucle: me gusta (si aún no lo tiene), scroll y pausa aleatoria.
        /* 22 */ { type: 'loop', params: { times: '{likes}' }, x: 430, y: 860 },
        /* 23 */ { type: 'if_xpath', params: { xpath: likeBtn, timeout: 3000 }, x: 645, y: 860 },
        /* 24 */ { type: 'random_wait', params: { min: 800, max: 2000 }, x: 860, y: 860 },
        /* 25 */ { type: 'tap_xpath', params: { xpath: likeBtn, timeout: 2000 }, x: 1075, y: 860 },
        /* 26 */ { type: 'math_var', params: { name: 'likes_dados', op: '+', value: '1' }, x: 1075, y: 1120 },
        /* 27 */ { type: 'random_wait', params: { min: 1000, max: 2500 }, x: 860, y: 1120 },
        /* 28 */ { type: 'scroll', params: { direction: 'abajo', count: '1' }, x: 645, y: 1120 },
        /* 29 */ { type: 'random_wait', params: { min: 3000, max: 8000 }, x: 430, y: 1120 },
        /* 30 */ { type: 'log', params: { message: '{device.name}: {likes_dados} me gusta en {perfil}' }, x: 215, y: 1380 },
        /* 31 */ { type: 'key', params: { key: 'HOME' }, x: 430, y: 1380 },
      ], [
        [0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [4, 0, 5], [5, 0, 6],
        [6, 0, 7], [6, 1, 12], [7, 0, 8], [8, 0, 9], [8, 1, 12], [9, 0, 10], [10, 0, 11], [11, 0, 13], [11, 1, 12],
        [12, 0, 13], [13, 0, 14], [14, 0, 15], [14, 1, 17], [15, 0, 16], [15, 1, 17], [16, 0, 18], [17, 0, 18],
        [18, 0, 19], [19, 0, 21], [19, 1, 20], [21, 0, 22],
        [22, 0, 23], [23, 0, 24], [23, 1, 28], [24, 0, 25], [25, 0, 26], [25, 1, 28], [26, 0, 27], [27, 0, 28], [28, 0, 29], [29, 0, 22],
        [22, 1, 30], [30, 0, 31],
      ]);
    },
  },
  {
    name: 'YouTube: ver vídeos de un canal',
    description: 'Busca el canal de la variable "canal" (su @usuario), abre su pestaña Vídeos y los reproduce uno tras otro, cada uno completo o hasta "max_seg" segundos. Los XPath están en variables al principio: si en tu teléfono no encuentra algo, copia del Inspector el XPath (absoluto o corto) y pégalo en la variable xp_… correspondiente.',
    build: () => {
      // Cómo reconoce YouTube en español un vídeo de la lista (su descripción accesible).
      const VID = 'contains(@content-desc,"visualizaciones") or contains(@content-desc,"reproducciones") or contains(@content-desc," vistas") '
        + 'or contains(@content-desc,"minutos") or contains(@content-desc,"segundos") or contains(@content-desc,"views")';
      const nextVideo = `(//*[@content-desc=$ultimo or @text=$ultimo]/following::*[${VID}])[1]`;
      const yt = "dumpsys media_session | grep -A 30 'package=com.google.android.youtube'";
      const capture = `${yt} | grep -m1 'description=' > /sdcard/nxf_yt.txt`;
      const check = `d=$(${yt}); s=$(echo "$d" | grep -m1 -o 'state=[0-9][0-9]*'); t=$(echo "$d" | grep -m1 'description='); `
        + 'case "$s" in \'\'|state=3|state=6|state=8) if [ "$t" = "$(cat /sdcard/nxf_yt.txt 2>/dev/null)" ]; then echo sigue; else echo fin; fi;; *) echo fin;; esac';
      const N = {};
      const nodes = [];
      const add = (key, type, params = {}) => { N[key] = nodes.length; nodes.push({ type, params }); };
      add('start', 'start');
      // Ajustes del flujo.
      add('canal', 'set_var', { name: 'canal', value: '@MrBeast' });
      add('videos', 'set_var', { name: 'videos', value: '20' });
      add('maxSeg', 'set_var', { name: 'max_seg', value: '600' });
      add('xpBuscar', 'set_var', { name: 'xp_buscar', value: '//*[@content-desc="Buscar" or @content-desc="Buscar en YouTube" or @resource-id="com.google.android.youtube:id/menu_item_1"]' });
      add('xpCanal', 'set_var', { name: 'xp_canal', value: '(//*[contains(@content-desc,"suscriptores") and contains(@content-desc,$canal)])[1]' });
      add('xpPestana', 'set_var', { name: 'xp_pestana_videos', value: '//*[@text="Vídeos" or @content-desc="Vídeos" or @text="Videos" or @content-desc="Videos"]' });
      add('xpVideo', 'set_var', { name: 'xp_video', value: `(//*[${VID}])[1]` });
      add('vistos', 'set_var', { name: 'vistos', value: '0' });
      add('open', 'open_app', { package: 'com.google.android.youtube' });
      add('w0', 'random_wait', { min: 4000, max: 6000 });
      // Buscar el canal; si algo falla, se abre su pestaña de vídeos por enlace.
      add('tapBuscar', 'tap_xpath', { xpath: '{xp_buscar}', timeout: 8000 });
      add('w1', 'random_wait', { min: 800, max: 1500 });
      add('escribir', 'type_text', { text: '{canal}', humanize: true });
      add('enter', 'key', { key: 'ENTER' });
      add('w2', 'random_wait', { min: 3000, max: 5000 });
      add('tapCanal', 'tap_xpath', { xpath: '{xp_canal}', timeout: 8000 });
      add('w3', 'random_wait', { min: 2500, max: 4000 });
      add('tapPestana', 'tap_xpath', { xpath: '{xp_pestana_videos}', timeout: 6000 });
      add('enlace', 'shell', { command: "am start -a android.intent.action.VIEW -d 'https://www.youtube.com/{canal}/videos' -p com.google.android.youtube", var: '' });
      add('w4', 'random_wait', { min: 3000, max: 5000 });
      add('ultimo0', 'set_var', { name: 'ultimo', value: '' });
      // Un vídeo por vuelta: el siguiente al último visto, o el de xp_video la primera vez.
      add('loop', 'loop', { times: '{videos}' });
      add('primero', 'if_var', { name: 'ultimo', op: '==', value: '' });
      add('bajar', 'swipe', { x1: '50%', y1: '72%', x2: '50%', y2: '45%', ms: 700, humanize: false });
      add('w5', 'random_wait', { min: 1200, max: 2200 });
      add('leerSig', 'read_text', { xpath: nextVideo, var: 'actual', timeout: 2000 });
      add('ultimoVisible', 'if_xpath', { xpath: '//*[@content-desc=$ultimo or @text=$ultimo]', timeout: 1000 });
      add('leerPrimero', 'read_text', { xpath: '{xp_video}', var: 'actual', timeout: 6000 });
      add('tapPrimero', 'tap_xpath', { xpath: '{xp_video}', timeout: 3000 });
      add('tapSig', 'tap_xpath', { xpath: nextVideo, timeout: 3000 });
      add('guardar', 'set_var', { name: 'ultimo', value: '{actual}' });
      add('log0', 'log', { message: '{device.name}: reproduciendo {actual}' });
      // Ver el vídeo: cada ~30 s se mira si YouTube sigue con el mismo; como mucho max_seg segundos.
      add('w6', 'random_wait', { min: 8000, max: 11000 });
      add('captura', 'shell', { command: capture, var: '' });
      add('visto0', 'set_var', { name: 'visto', value: '0' });
      add('w7', 'random_wait', { min: 25000, max: 35000 });
      add('sumar', 'math_var', { name: 'visto', op: '+', value: '30' });
      add('comprobar', 'shell', { command: check, var: 'estado' });
      add('terminado', 'if_var', { name: 'estado', op: '==', value: 'fin' });
      add('tope', 'if_var', { name: 'visto', op: '>=', value: '{max_seg}' });
      add('pausa', 'shell', { command: 'input keyevent 127', var: '' });
      add('contar', 'math_var', { name: 'vistos', op: '+', value: '1' });
      add('log1', 'log', { message: '{device.name}: vídeo {vistos} visto (~{visto} s)' });
      add('atras', 'key', { key: 'BACK' });
      add('w8', 'random_wait', { min: 2000, max: 3500 });
      add('sinMas', 'log', { message: '{device.name}: no se encontró el siguiente vídeo en la lista de {canal}' });
      add('fin', 'log', { message: '{device.name}: {vistos} vídeos vistos de {canal}' });
      add('inicio', 'key', { key: 'HOME' });
      const L = (a, out, b) => [N[a], out, N[b]];
      const chain = (...keys) => keys.slice(1).map((k, i) => L(keys[i], 0, k));
      return buildGraph(nodes.map((n, i) => ({ ...n, x: (i % 7) * 215, y: Math.floor(i / 7) * 280 })), [
        ...chain('start', 'canal', 'videos', 'maxSeg', 'xpBuscar', 'xpCanal', 'xpPestana', 'xpVideo', 'vistos', 'open', 'w0', 'tapBuscar', 'w1', 'escribir', 'enter', 'w2', 'tapCanal', 'w3', 'tapPestana', 'w4', 'ultimo0', 'loop'),
        L('tapBuscar', 1, 'enlace'), L('tapCanal', 1, 'enlace'), L('tapPestana', 1, 'enlace'), L('enlace', 0, 'w4'),
        L('loop', 0, 'primero'), L('loop', 1, 'fin'),
        L('primero', 0, 'leerPrimero'), L('primero', 1, 'bajar'), ...chain('bajar', 'w5', 'leerSig'),
        L('leerSig', 0, 'tapSig'), L('leerSig', 1, 'ultimoVisible'), L('ultimoVisible', 0, 'sinMas'), L('ultimoVisible', 1, 'leerPrimero'),
        L('leerPrimero', 0, 'tapPrimero'), L('leerPrimero', 1, 'sinMas'), L('tapPrimero', 0, 'guardar'), L('tapPrimero', 1, 'sinMas'),
        L('tapSig', 0, 'guardar'), L('tapSig', 1, 'leerPrimero'),
        ...chain('guardar', 'log0', 'w6', 'captura', 'visto0', 'w7', 'sumar', 'comprobar', 'terminado'),
        L('terminado', 0, 'pausa'), L('terminado', 1, 'tope'), L('tope', 0, 'pausa'), L('tope', 1, 'w7'),
        ...chain('pausa', 'contar', 'log1', 'atras', 'w8', 'loop'),
        L('sinMas', 0, 'fin'), L('fin', 0, 'inicio'),
      ]);
    },
  },
];
