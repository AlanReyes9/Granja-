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
    description: 'Busca el canal de la variable "canal" (su @usuario), abre su pestaña Vídeos y los reproduce uno tras otro, cada uno completo o hasta "max_seg" segundos. Los XPath están en variables al principio (absoluto | corto, de YouTube en español): si en tu teléfono no encuentra algo, copia del Inspector el XPath y pégalo en la variable xp_… correspondiente.',
    build: () => {
      // Cómo reconoce YouTube en español un vídeo de la lista (su descripción accesible).
      const VID = 'contains(@content-desc,"visualizaciones") or contains(@content-desc,"reproducciones") or contains(@content-desc," vistas") '
        + 'or contains(@content-desc,"minutos") or contains(@content-desc,"segundos") or contains(@content-desc,"views")';
      const nextVideo = `(//*[@content-desc=$ultimo or @text=$ultimo]/following::*[${VID}])[1]`;
      // Ruta común de YouTube (Android, en español) hasta el contenido de cada pantalla, sacada del Inspector.
      const ABS = '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout/android.widget.FrameLayout/android.widget.LinearLayout/android.widget.FrameLayout/androidx.drawerlayout.widget.DrawerLayout/android.widget.FrameLayout/android.view.ViewGroup/android.widget.FrameLayout[2]/android.view.ViewGroup/android.view.ViewGroup/android.widget.FrameLayout[2]/android.widget.ScrollView';
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
      add('xpBuscar', 'set_var', { name: 'xp_buscar', value: `${ABS}/android.widget.LinearLayout/android.widget.FrameLayout/android.view.ViewGroup/android.support.v7.widget.LinearLayoutCompat/android.widget.FrameLayout[2]/android.view.ViewGroup/android.widget.ImageView | //*[@content-desc="Buscar" or @content-desc="Buscar en YouTube"]` });
      add('xpCanal', 'set_var', { name: 'xp_canal', value: `${ABS}/android.widget.FrameLayout/android.widget.FrameLayout/android.support.v7.widget.RecyclerView/android.view.ViewGroup[1]/android.view.ViewGroup[2] | //*[@content-desc="Ver canal"]` });
      add('xpPestana', 'set_var', { name: 'xp_pestana_videos', value: `${ABS}/android.widget.LinearLayout/android.view.ViewGroup/android.widget.FrameLayout/android.widget.HorizontalScrollView/android.widget.LinearLayout/android.widget.Button[2] | //*[@content-desc="Vídeos" or @text="Vídeos" or @content-desc="Videos" or @text="Videos"]` });
      add('xpVideo', 'set_var', { name: 'xp_video', value: `${ABS}/android.widget.FrameLayout[2]/android.widget.FrameLayout/androidx.viewpager.widget.ViewPager/android.view.ViewGroup/android.support.v7.widget.RecyclerView/android.view.ViewGroup[2] | (//*[${VID}])[1]` });
      add('vistos', 'set_var', { name: 'vistos', value: '0' });
      // Se cierra antes para que YouTube arranque siempre en Inicio (de ahí sale el XPath de la lupa).
      add('cerrar', 'stop_app', { package: 'com.google.android.youtube' });
      add('w00', 'random_wait', { min: 1000, max: 2000 });
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
      add('leerSig', 'read_text', { id: '', xpath: nextVideo, var: 'actual', timeout: 2000 });
      add('ultimoVisible', 'if_xpath', { xpath: '//*[@content-desc=$ultimo or @text=$ultimo]', timeout: 1000 });
      add('leerPrimero', 'read_text', { id: '', xpath: '{xp_video}', var: 'actual', timeout: 6000 });
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
        ...chain('start', 'canal', 'videos', 'maxSeg', 'xpBuscar', 'xpCanal', 'xpPestana', 'xpVideo', 'vistos', 'cerrar', 'w00', 'open', 'w0', 'tapBuscar', 'w1', 'escribir', 'enter', 'w2', 'tapCanal', 'w3', 'tapPestana', 'w4', 'ultimo0', 'loop'),
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

/** Texto de un botón en español o inglés (texto visible o descripción de accesibilidad). */
const anyText = (...words) => `//*[${words.flatMap((w) => [`@text="${w}"`, `@content-desc="${w}"`]).join(' or ')}]`;

/**
 * Flujo de publicación: comparte {clip} con la app, pulsa Siguiente (una o dos veces), escribe {descripcion}
 * y pulsa Publicar. Los XPath van en variables al principio para ajustarlos con el Inspector.
 */
function publishFlow({ pkg, xpAntes = '', xpSiguiente, xpDescripcion, xpPublicar, nextRequired = true }) {
  const nodes = [];
  const N = {};
  const add = (key, type, params = {}) => { N[key] = nodes.length; nodes.push({ type, params }); };
  add('start', 'start');
  add('xa', 'set_var', { name: 'xp_antes', value: xpAntes });
  add('xs', 'set_var', { name: 'xp_siguiente', value: xpSiguiente });
  add('xd', 'set_var', { name: 'xp_descripcion', value: xpDescripcion });
  add('xp', 'set_var', { name: 'xp_publicar', value: xpPublicar });
  add('wake', 'wake_unlock');
  add('cerrar', 'stop_app', { package: pkg });
  add('compartir', 'share_media', { path: '{clip}', package: pkg, mime: 'video/*' });
  add('w1', 'random_wait', { min: 5000, max: 8000 });
  add('hayAntes', 'if_var', { name: 'xp_antes', op: '==', value: '' });
  add('antes', 'tap_xpath', { xpath: '{xp_antes}', timeout: 10000 });
  add('w2', 'random_wait', { min: 3000, max: 5000 });
  add('sig1', 'tap_xpath', { xpath: '{xp_siguiente}', timeout: nextRequired ? 20000 : 8000 });
  add('w3', 'random_wait', { min: 2500, max: 4000 });
  add('otroSig', 'if_xpath', { xpath: '{xp_siguiente}', timeout: 3000 });
  add('sig2', 'tap_xpath', { xpath: '{xp_siguiente}', timeout: 3000 });
  add('w4', 'random_wait', { min: 2500, max: 4000 });
  add('sinDesc', 'if_var', { name: 'descripcion', op: '==', value: '' });
  add('campo', 'tap_xpath', { xpath: '{xp_descripcion}', timeout: 8000 });
  add('escribir', 'type_text', { text: '{descripcion}', humanize: false });
  add('w5', 'random_wait', { min: 800, max: 1500 });
  add('teclado', 'key', { key: 'BACK' });
  add('w6', 'random_wait', { min: 1000, max: 2000 });
  add('noCampo', 'log', { message: '{device.name}: no encontré el campo de descripción; se publica sin ella' });
  add('publicar', 'tap_xpath', { xpath: '{xp_publicar}', timeout: 12000 });
  add('w7', 'random_wait', { min: 10000, max: 15000 });
  add('ok', 'log', { message: '{device.name}: publicado {clip_nombre}' });
  add('inicio', 'key', { key: 'HOME' });
  add('captura', 'screenshot', { name: 'fallo_publicar_{device.name}_{timestamp}' });
  add('fallo', 'fail', { message: 'No se pudo publicar {clip_nombre} en {device.name} (mira la captura y ajusta los XPath)' });
  const L = (a, out, b) => [N[a], out, N[b]];
  const chain = (...keys) => keys.slice(1).map((k, i) => L(keys[i], 0, k));
  return buildGraph(nodes.map((n, i) => ({ ...n, x: (i % 7) * 215, y: Math.floor(i / 7) * 280 })), [
    ...chain('start', 'xa', 'xs', 'xd', 'xp', 'wake', 'cerrar', 'compartir', 'w1', 'hayAntes'),
    L('compartir', 1, 'captura'),
    L('hayAntes', 0, 'sig1'), L('hayAntes', 1, 'antes'), L('antes', 0, 'w2'), L('antes', 1, 'sig1'), L('w2', 0, 'sig1'),
    L('sig1', 0, 'w3'), L('sig1', 1, nextRequired ? 'captura' : 'sinDesc'), L('w3', 0, 'otroSig'),
    L('otroSig', 0, 'sig2'), L('otroSig', 1, 'sinDesc'), L('sig2', 0, 'w4'), L('sig2', 1, 'sinDesc'), L('w4', 0, 'sinDesc'),
    L('sinDesc', 0, 'publicar'), L('sinDesc', 1, 'campo'),
    L('campo', 0, 'escribir'), L('campo', 1, 'noCampo'), L('noCampo', 0, 'publicar'),
    ...chain('escribir', 'w5', 'teclado', 'w6', 'publicar'),
    L('publicar', 0, 'w7'), L('publicar', 1, 'captura'), ...chain('w7', 'ok', 'inicio'),
    L('captura', 0, 'fallo'),
  ]);
}

export const PUBLISH_PLATFORMS = [
  { key: 'tiktok', name: 'Publicar clip: TikTok', pkg: 'com.zhiliaoapp.musically',
    description: 'Comparte {clip} con TikTok, pulsa Siguiente, escribe {descripcion} y pulsa Publicar. Para usarlo desde Publicaciones.',
    xp: { xpSiguiente: anyText('Siguiente', 'Next'), xpDescripcion: '(//android.widget.EditText)[1]', xpPublicar: anyText('Publicar', 'Post') } },
  { key: 'shorts', name: 'Publicar clip: YouTube Shorts', pkg: 'com.google.android.youtube',
    description: 'Comparte {clip} con YouTube (vídeo vertical corto = Short), pulsa Siguiente, pone {descripcion} como título y pulsa Subir.',
    xp: { xpSiguiente: anyText('Siguiente', 'Next'), xpDescripcion: '(//android.widget.EditText)[1]',
      xpPublicar: anyText('Subir', 'Upload', 'Subir Short', 'Upload Short', 'Publicar', 'Post') } },
  { key: 'reels', name: 'Publicar clip: Instagram Reels', pkg: 'com.instagram.android',
    description: 'Comparte {clip} con Instagram, elige Reels, pulsa Siguiente, escribe {descripcion} y pulsa Compartir.',
    xp: { xpAntes: anyText('Reels', 'Reel'), xpSiguiente: anyText('Siguiente', 'Next'), xpDescripcion: '(//android.widget.EditText)[1]',
      xpPublicar: anyText('Compartir', 'Share') } },
  { key: 'facebook', name: 'Publicar clip: Facebook', pkg: 'com.facebook.katana',
    description: 'Comparte {clip} con Facebook, pulsa Siguiente si aparece, escribe {descripcion} y pulsa Publicar.',
    xp: { xpSiguiente: anyText('Siguiente', 'Next'), xpDescripcion: '(//android.widget.EditText)[1]',
      xpPublicar: anyText('Publicar', 'Post', 'Compartir ahora', 'Share now', 'Compartir', 'Share'), nextRequired: false } },
];

/**
 * Calentamiento: abre la app, busca {tema}, abre el primer vídeo de los resultados y pasa al siguiente
 * cada {ms_min}-{ms_max} ms hasta ver {videos}. Solo mira: no da me gusta, no comenta ni sigue.
 * Con deepLink la búsqueda se abre por enlace (YouTube); si no, con el buscador de la app.
 */
function warmFlow({ pkg, name, deepLink = '', xpBuscar = '', xpCampo, xpPestana = '', xpPrimero, primeroX = '25%', primeroY = '40%' }) {
  const nodes = [];
  const N = {};
  const add = (key, type, params = {}) => { N[key] = nodes.length; nodes.push({ type, params }); };
  add('start', 'start');
  add('xb', 'set_var', { name: 'xp_buscar', value: xpBuscar });
  add('xc', 'set_var', { name: 'xp_campo', value: xpCampo });
  add('xt', 'set_var', { name: 'xp_pestana', value: xpPestana });
  add('xf', 'set_var', { name: 'xp_primero', value: xpPrimero });
  add('px', 'set_var', { name: 'primero_x', value: primeroX });
  add('py', 'set_var', { name: 'primero_y', value: primeroY });
  add('vistos', 'set_var', { name: 'vistos', value: '0' });
  add('wake', 'wake_unlock');
  add('cerrar', 'stop_app', { package: pkg });
  if (deepLink) add('abrir', 'shell', { command: `am start -a android.intent.action.VIEW -d '${deepLink}' -p ${pkg}`, var: '' });
  else add('abrir', 'open_app', { package: pkg });
  add('w1', 'random_wait', { min: 5000, max: 8000 });
  if (!deepLink) {
    add('buscar', 'tap_xpath', { xpath: '{xp_buscar}', timeout: 10000 });
    add('w2', 'random_wait', { min: 1500, max: 2500 });
    add('campo', 'tap_xpath', { xpath: '{xp_campo}', timeout: 5000 });
    add('escribir', 'type_text', { text: '{tema}', humanize: true });
    add('enter', 'key', { key: 'ENTER' });
    add('w3', 'random_wait', { min: 4000, max: 6000 });
  }
  add('hayPestana', 'if_var', { name: 'xp_pestana', op: '==', value: '' });
  add('pestana', 'tap_xpath', { xpath: '{xp_pestana}', timeout: 6000 });
  add('w4', 'random_wait', { min: 2500, max: 4000 });
  add('hayPrimero', 'if_var', { name: 'xp_primero', op: '==', value: '' });
  add('primero', 'tap_xpath', { xpath: '{xp_primero}', timeout: 6000 });
  add('primeroPunto', 'tap', { x: '{primero_x}', y: '{primero_y}', jitter: 6 });
  add('w5', 'random_wait', { min: 3000, max: 5000 });
  add('loop', 'loop', { times: '{videos}' });
  add('mirar', 'random_wait', { min: '{ms_min}', max: '{ms_max}' });
  add('contar', 'math_var', { name: 'vistos', op: '+', value: '1' });
  add('siguiente', 'swipe', { x1: '50%', y1: '78%', x2: '50%', y2: '22%', ms: 350, humanize: false });
  add('w6', 'random_wait', { min: 1500, max: 3000 });
  add('fin', 'log', { message: `{device.name}: {vistos} vídeos de «{tema}» en ${name}` });
  add('inicio', 'key', { key: 'HOME' });
  if (!deepLink) {
    add('sinBuscador', 'screenshot', { name: `calentar_${name}_{device.name}_{timestamp}` });
    add('fallo', 'fail', { message: `No encontré el buscador de ${name} en {device.name} (ajusta xp_buscar con el Inspector)` });
  }
  const L = (a, out, b) => [N[a], out, N[b]];
  const chain = (...keys) => keys.slice(1).map((k, i) => L(keys[i], 0, k));
  const links = [
    ...chain('start', 'xb', 'xc', 'xt', 'xf', 'px', 'py', 'vistos', 'wake', 'cerrar', 'abrir', 'w1'),
    L('hayPestana', 0, 'w4'), L('hayPestana', 1, 'pestana'), L('pestana', 0, 'w4'), L('pestana', 1, 'w4'),
    L('w4', 0, 'hayPrimero'), L('hayPrimero', 0, 'primeroPunto'), L('hayPrimero', 1, 'primero'), L('primero', 0, 'w5'), L('primero', 1, 'primeroPunto'), L('primeroPunto', 0, 'w5'),
    L('w5', 0, 'loop'), L('loop', 0, 'mirar'), L('loop', 1, 'fin'),
    ...chain('mirar', 'contar', 'siguiente', 'w6', 'loop'),
    L('fin', 0, 'inicio'),
  ];
  if (deepLink) links.push(L('w1', 0, 'hayPestana'));
  else {
    links.push(L('w1', 0, 'buscar'), L('buscar', 0, 'w2'), L('buscar', 1, 'sinBuscador'), L('sinBuscador', 0, 'fallo'), L('w2', 0, 'campo'),
      L('campo', 0, 'escribir'), L('campo', 1, 'escribir'), ...chain('escribir', 'enter', 'w3', 'hayPestana'));
  }
  return buildGraph(nodes.map((n, i) => ({ ...n, x: (i % 7) * 215, y: Math.floor(i / 7) * 280 })), links);
}

export const WARM_PLATFORMS = [
  { key: 'tiktok', name: 'Calentar: TikTok', app: 'TikTok', pkg: 'com.zhiliaoapp.musically',
    xp: { xpBuscar: anyText('Buscar', 'Search'), xpCampo: '//android.widget.EditText', xpPestana: anyText('Vídeos', 'Videos'),
      xpPrimero: '', primeroX: '25%', primeroY: '35%' } },
  { key: 'youtube', name: 'Calentar: YouTube Shorts', app: 'YouTube', pkg: 'com.google.android.youtube',
    xp: { deepLink: 'https://www.youtube.com/results?search_query={tema_url}', xpCampo: '', xpPestana: anyText('Shorts'),
      xpPrimero: '', primeroX: '25%', primeroY: '40%' } },
  { key: 'instagram', name: 'Calentar: Instagram Reels', app: 'Instagram', pkg: 'com.instagram.android',
    xp: { xpBuscar: anyText('Buscar y explorar', 'Search and explore', 'Buscar', 'Search'), xpCampo: '//android.widget.EditText',
      xpPestana: anyText('Reels'), xpPrimero: '', primeroX: '17%', primeroY: '35%' } },
  { key: 'facebook', name: 'Calentar: Facebook', app: 'Facebook', pkg: 'com.facebook.katana',
    xp: { xpBuscar: anyText('Buscar', 'Search', 'Buscar en Facebook', 'Search Facebook'), xpCampo: '//android.widget.EditText',
      xpPestana: anyText('Reels', 'Vídeos', 'Videos'), xpPrimero: '', primeroX: '25%', primeroY: '40%' } },
];

function warmTemplates() {
  return WARM_PLATFORMS.map((p) => ({ name: p.name, warm: p.key,
    description: `Abre ${p.app}, busca {tema}, abre el primer vídeo de los resultados y pasa al siguiente cada cierto tiempo. Para usarlo desde Calentamiento.`,
    build: () => warmFlow({ pkg: p.pkg, name: p.app, ...p.xp }) }));
}

function publishTemplates() {
  return PUBLISH_PLATFORMS.map((p) => ({ name: p.name, description: p.description, publish: p.key, build: () => publishFlow({ pkg: p.pkg, ...p.xp }) }));
}

/**
 * Inicio de sesión: abre la app, comprueba si ya hay sesión, toca los pasos hasta el formulario
 * (xp_paso1..3, opcionales), escribe {usuario} y {clave} y comprueba el resultado.
 * Variables vacías = ese paso se salta.
 */
function loginFlow({ key, pkg, openCmd = '', pasos = [], xpUsuario = '(//android.widget.EditText)[1]', xpTrasUsuario = '',
  xpClave = '(//android.widget.EditText)[2]', xpBoton, xpSesion = '', xpReto = '', xpDespues = '' }) {
  const nodes = [];
  const N = {};
  const add = (k, type, params = {}) => { N[k] = nodes.length; nodes.push({ type, params }); };
  const vars = { login_plataforma: key, xp_paso1: pasos[0] || '', xp_paso2: pasos[1] || '', xp_paso3: pasos[2] || '', xp_usuario: xpUsuario,
    xp_tras_usuario: xpTrasUsuario, xp_clave: xpClave, xp_boton: xpBoton, xp_sesion: xpSesion, xp_reto: xpReto, xp_despues: xpDespues };
  add('start', 'start');
  const varKeys = Object.keys(vars).map((name) => { add(`v_${name}`, 'set_var', { name, value: vars[name] }); return `v_${name}`; });
  add('wake', 'wake_unlock');
  add('cerrar', 'stop_app', { package: pkg });
  if (openCmd) add('abrir', 'shell', { command: openCmd, var: '' });
  else add('abrir', 'open_app', { package: pkg });
  add('w1', 'random_wait', { min: 5000, max: 8000 });
  add('h1', 'if_var', { name: 'xp_paso1', op: '==', value: '' });
  add('p1', 'tap_xpath', { xpath: '{xp_paso1}', timeout: 8000 });
  add('w2', 'random_wait', { min: 2000, max: 3500 });
  add('hs', 'if_var', { name: 'xp_sesion', op: '==', value: '' });
  add('s0', 'if_xpath', { xpath: '{xp_sesion}', timeout: 3000 });
  add('ya', 'log', { message: '{device.name}: ya tenía la sesión iniciada' });
  add('c2', 'if_xpath', { xpath: '{xp_usuario}', timeout: 2500 });
  add('h2', 'if_var', { name: 'xp_paso2', op: '==', value: '' });
  add('p2', 'tap_xpath', { xpath: '{xp_paso2}', timeout: 6000 });
  add('w3', 'random_wait', { min: 2000, max: 3500 });
  add('c3', 'if_xpath', { xpath: '{xp_usuario}', timeout: 2500 });
  add('h3', 'if_var', { name: 'xp_paso3', op: '==', value: '' });
  add('p3', 'tap_xpath', { xpath: '{xp_paso3}', timeout: 6000 });
  add('w4', 'random_wait', { min: 2000, max: 3500 });
  add('campoU', 'tap_xpath', { xpath: '{xp_usuario}', timeout: 10000 });
  add('escU', 'type_text', { text: '{usuario}', humanize: false });
  add('w5', 'random_wait', { min: 800, max: 1500 });
  add('ht', 'if_var', { name: 'xp_tras_usuario', op: '==', value: '' });
  add('tras', 'tap_xpath', { xpath: '{xp_tras_usuario}', timeout: 6000 });
  add('w6', 'random_wait', { min: 3000, max: 5000 });
  add('campoC', 'tap_xpath', { xpath: '{xp_clave}', timeout: 15000 });
  add('escC', 'type_text', { text: '{clave}', humanize: false });
  add('w7', 'random_wait', { min: 800, max: 1500 });
  add('boton', 'tap_xpath', { xpath: '{xp_boton}', timeout: 8000 });
  add('enter', 'key', { key: 'ENTER' });
  add('w8', 'random_wait', { min: 8000, max: 12000 });
  add('hr', 'if_var', { name: 'xp_reto', op: '==', value: '' });
  add('reto', 'if_xpath', { xpath: '{xp_reto}', timeout: 2000 });
  add('hd', 'if_var', { name: 'xp_despues', op: '==', value: '' });
  add('d1', 'tap_xpath', { xpath: '{xp_despues}', timeout: 4000 });
  add('w9', 'random_wait', { min: 2000, max: 3500 });
  add('d2', 'tap_xpath', { xpath: '{xp_despues}', timeout: 3000 });
  add('hs2', 'if_var', { name: 'xp_sesion', op: '==', value: '' });
  add('s2', 'if_xpath', { xpath: '{xp_sesion}', timeout: 10000 });
  add('sigue', 'if_xpath', { xpath: '{xp_clave}', timeout: 2000 });
  add('dudoso', 'log', { message: '{device.name}: se envió el inicio de sesión (no se pudo confirmar en pantalla)' });
  add('ok', 'log', { message: '{device.name}: sesión iniciada como {usuario}' });
  add('inicio', 'key', { key: 'HOME' });
  add('m1', 'set_var', { name: 'motivo', value: 'No encontré el campo de usuario (ajusta xp_usuario o los pasos xp_paso1..3)' });
  add('m2', 'set_var', { name: 'motivo', value: 'No apareció el campo de contraseña (ajusta xp_clave)' });
  add('m3', 'set_var', { name: 'motivo', value: 'La app pide un código o una verificación: complétala a mano en el teléfono' });
  add('m4', 'set_var', { name: 'motivo', value: 'Usuario o contraseña incorrectos, o la app pidió algo más (mira la captura)' });
  add('captura', 'screenshot', { name: `login_${key}_{device.name}_{timestamp}` });
  add('fallo', 'fail', { message: '{motivo}' });
  const L = (a, out, b) => [N[a], out, N[b]];
  const chain = (...keys) => keys.slice(1).map((k, i) => L(keys[i], 0, k));
  return buildGraph(nodes.map((n, i) => ({ ...n, x: (i % 8) * 215, y: Math.floor(i / 8) * 280 })), [
    ...chain('start', ...varKeys, 'wake', 'cerrar', 'abrir', 'w1', 'h1'),
    L('h1', 0, 'hs'), L('h1', 1, 'p1'), L('p1', 0, 'w2'), L('p1', 1, 'hs'), L('w2', 0, 'hs'),
    L('hs', 0, 'c2'), L('hs', 1, 's0'), L('s0', 0, 'ya'), L('s0', 1, 'c2'), L('ya', 0, 'inicio'),
    L('c2', 0, 'campoU'), L('c2', 1, 'h2'), L('h2', 0, 'c3'), L('h2', 1, 'p2'), L('p2', 0, 'w3'), L('p2', 1, 'c3'), L('w3', 0, 'c3'),
    L('c3', 0, 'campoU'), L('c3', 1, 'h3'), L('h3', 0, 'campoU'), L('h3', 1, 'p3'), L('p3', 0, 'w4'), L('p3', 1, 'campoU'), L('w4', 0, 'campoU'),
    L('campoU', 0, 'escU'), L('campoU', 1, 'm1'), ...chain('escU', 'w5', 'ht'),
    L('ht', 0, 'campoC'), L('ht', 1, 'tras'), L('tras', 0, 'w6'), L('tras', 1, 'campoC'), L('w6', 0, 'campoC'),
    L('campoC', 0, 'escC'), L('campoC', 1, 'm2'), ...chain('escC', 'w7', 'boton'),
    L('boton', 0, 'w8'), L('boton', 1, 'enter'), L('enter', 0, 'w8'),
    L('w8', 0, 'hr'), L('hr', 0, 'hd'), L('hr', 1, 'reto'), L('reto', 0, 'm3'), L('reto', 1, 'hd'),
    L('hd', 0, 'hs2'), L('hd', 1, 'd1'), L('d1', 0, 'w9'), L('d1', 1, 'hs2'), L('w9', 0, 'd2'), L('d2', 0, 'hs2'), L('d2', 1, 'hs2'),
    L('hs2', 0, 'sigue'), L('hs2', 1, 's2'), L('s2', 0, 'ok'), L('s2', 1, 'sigue'),
    L('sigue', 0, 'm4'), L('sigue', 1, 'dudoso'), L('dudoso', 0, 'ok'), L('ok', 0, 'inicio'),
    L('m1', 0, 'captura'), L('m2', 0, 'captura'), L('m3', 0, 'captura'), L('m4', 0, 'captura'), L('captura', 0, 'fallo'),
  ]);
}

const codeText = (...words) => `//*[${words.map((w) => `contains(@text,"${w}")`).join(' or ')}]`;

export const LOGIN_PLATFORMS = [
  { key: 'tiktok', name: 'Iniciar sesión: TikTok', app: 'TikTok', pkg: 'com.zhiliaoapp.musically',
    xp: { pasos: [anyText('Perfil', 'Profile'), anyText('Iniciar sesión', 'Log in'),
      anyText('Usar teléfono/correo/nombre de usuario', 'Use phone / email / username', 'Usa el teléfono, correo electrónico o nombre de usuario')],
    xpUsuario: '(//android.widget.EditText)[1]', xpClave: '(//android.widget.EditText)[2]', xpBoton: anyText('Iniciar sesión', 'Log in'),
    xpSesion: anyText('Editar perfil', 'Edit profile'), xpReto: codeText('código', 'code', 'Verifica', 'Verify') } },
  { key: 'instagram', name: 'Iniciar sesión: Instagram', app: 'Instagram', pkg: 'com.instagram.android',
    xp: { pasos: ['', anyText('Iniciar sesión', 'Log in', 'Ya tengo una cuenta', 'I already have an account'), anyText('Iniciar sesión en otra cuenta', 'Log into another account', 'Cambiar de cuenta', 'Switch accounts')],
      xpBoton: anyText('Iniciar sesión', 'Log in'), xpSesion: anyText('Inicio', 'Home', 'Perfil', 'Profile'),
      xpReto: codeText('código', 'code', 'Confirma que eres tú', 'Confirm it'), xpDespues: anyText('Ahora no', 'Not now', 'Omitir', 'Skip') } },
  { key: 'facebook', name: 'Iniciar sesión: Facebook', app: 'Facebook', pkg: 'com.facebook.katana',
    xp: { pasos: ['', anyText('Iniciar sesión en otra cuenta', 'Log into another account', 'Usar otro perfil', 'Use another profile'), anyText('Ya tengo una cuenta', 'I already have an account', 'Iniciar sesión', 'Log in')],
      xpBoton: anyText('Iniciar sesión', 'Log in'), xpSesion: '//*[contains(@content-desc,"Inicio, pestaña") or contains(@content-desc,"Home, tab")]',
      xpReto: codeText('código', 'code', 'aprobación', 'approve', 'Comprueba', 'Check your'), xpDespues: anyText('Ahora no', 'Not now', 'Omitir', 'Skip', 'Guardar', 'Save') } },
  { key: 'google', name: 'Iniciar sesión: Google (YouTube)', app: 'Google', pkg: 'com.android.settings',
    xp: { openCmd: 'am start -a android.settings.ADD_ACCOUNT_SETTINGS --esa account_types com.google',
      xpUsuario: '(//android.widget.EditText)[1]', xpTrasUsuario: anyText('Siguiente', 'Next'), xpClave: '//android.widget.EditText[@password="true"] | (//android.widget.EditText)[1]',
      xpBoton: anyText('Siguiente', 'Next'), xpReto: codeText('código', 'code', 'Verifica que eres tú', 'Verify it'),
      xpDespues: anyText('Acepto', 'I agree', 'Aceptar', 'Accept', 'Más', 'More') } },
];

function loginTemplates() {
  return LOGIN_PLATFORMS.map((p) => ({ name: p.name, login: p.key,
    description: `Inicia sesión en ${p.app} con {usuario} y {clave}. Para usarlo desde Cuentas.`,
    build: () => loginFlow({ key: p.key, pkg: p.pkg, ...p.xp }) }));
}

TEMPLATES.push(...publishTemplates(), ...warmTemplates(), ...loginTemplates());
