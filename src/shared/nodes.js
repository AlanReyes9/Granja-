// Definiciones de nodos de automatización. Las usa el editor (renderer) y el motor (main).
// icon = nombre de icono del set de la interfaz (src/renderer/icons.js).
// Cada parámetro de texto admite plantillas: {variable}, {rand:1-100}, {pick:a|b|c}.

export const KEYCODES = {
  HOME: 3, BACK: 4, CALL: 5, ENDCALL: 6, VOLUME_UP: 24, VOLUME_DOWN: 25, POWER: 26,
  CAMERA: 27, ENTER: 66, DEL: 67, TAB: 61, SPACE: 62, MENU: 82, SEARCH: 84,
  MEDIA_PLAY_PAUSE: 85, APP_SWITCH: 187, WAKEUP: 224, SLEEP: 223, MUTE: 164,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, ESCAPE: 111,
};

export const CATEGORIES = [
  { id: 'flow', label: 'Flujo', color: '#7c5cff' },
  { id: 'input', label: 'Interacción', color: '#2dbd7e' },
  { id: 'ui', label: 'Pantalla / UI', color: '#e8a33d' },
  { id: 'apps', label: 'Apps', color: '#3d9be8' },
  { id: 'system', label: 'Sistema', color: '#e85d5d' },
  { id: 'data', label: 'Datos e integraciones', color: '#d65db1' },
];

const t = (key, label, def = '', extra = {}) => ({ key, label, type: 'text', default: def, ...extra });
const n = (key, label, def = 0, extra = {}) => ({ key, label, type: 'number', default: def, ...extra });
const s = (key, label, options, def) => ({ key, label, type: 'select', options, default: def ?? options[0] });
const b = (key, label, def = false) => ({ key, label, type: 'checkbox', default: def });

export const NODE_TYPES = [
  // ---------- Flujo ----------
  { type: 'start', label: 'Inicio', category: 'flow', icon: 'play', inputs: 0, outputs: ['siguiente'], params: [] },
  { type: 'wait', label: 'Esperar', category: 'flow', icon: 'clock', outputs: ['siguiente'], params: [n('ms', 'Milisegundos', 1000)] },
  { type: 'random_wait', label: 'Espera aleatoria', category: 'flow', icon: 'shuffle', outputs: ['siguiente'],
    params: [n('min', 'Mín. ms', 800), n('max', 'Máx. ms', 2500)] },
  { type: 'loop', label: 'Repetir N veces', category: 'flow', icon: 'repeat', outputs: ['repetir', 'terminado'],
    params: [t('times', 'Veces', '5')],
    help: 'Conecta "repetir" al cuerpo del bucle y el último nodo del cuerpo de vuelta a la entrada de este nodo.' },
  { type: 'random_branch', label: 'Rama aleatoria', category: 'flow', icon: 'split', outputs: ['A', 'B'],
    params: [n('percent', '% de ir por A', 50)] },
  { type: 'set_var', label: 'Definir variable', category: 'flow', icon: 'variable', outputs: ['siguiente'],
    params: [t('name', 'Nombre', 'contador'), t('value', 'Valor', '0')] },
  { type: 'math_var', label: 'Operar variable', category: 'flow', icon: 'calculator', outputs: ['siguiente'],
    params: [t('name', 'Nombre', 'contador'), s('op', 'Operación', ['+', '-', '*', '/']), t('value', 'Valor', '1')] },
  { type: 'if_var', label: 'Si variable…', category: 'flow', icon: 'branch', outputs: ['sí', 'no'],
    params: [t('name', 'Variable', 'contador'), s('op', 'Condición', ['==', '!=', '>', '<', '>=', '<=', 'contiene']), t('value', 'Valor', '10')] },
  { type: 'log', label: 'Registrar mensaje', category: 'flow', icon: 'file-text', outputs: ['siguiente'], params: [t('message', 'Mensaje', 'Hola desde {device.name}')] },
  { type: 'stop', label: 'Fin', category: 'flow', icon: 'square', outputs: [], params: [] },

  // ---------- Interacción ----------
  { type: 'tap', label: 'Tocar', category: 'input', icon: 'pointer', outputs: ['siguiente'],
    params: [t('x', 'X (px o %)', '50%'), t('y', 'Y (px o %)', '50%'), n('jitter', 'Variación humana px', 6)] },
  { type: 'long_press', label: 'Mantener pulsado', category: 'input', icon: 'hand', outputs: ['siguiente'],
    params: [t('x', 'X (px o %)', '50%'), t('y', 'Y (px o %)', '50%'), n('ms', 'Duración ms', 800)] },
  { type: 'swipe', label: 'Deslizar', category: 'input', icon: 'move', outputs: ['siguiente'],
    params: [t('x1', 'X inicio', '50%'), t('y1', 'Y inicio', '75%'), t('x2', 'X fin', '50%'), t('y2', 'Y fin', '25%'),
      n('ms', 'Duración ms', 350), b('humanize', 'Humanizar (curva y variación)', true)] },
  { type: 'scroll', label: 'Scroll', category: 'input', icon: 'scroll', outputs: ['siguiente'],
    params: [s('direction', 'Dirección', ['abajo', 'arriba', 'izquierda', 'derecha']), t('count', 'Veces', '1'), n('pause', 'Pausa entre scrolls ms', 1200)] },
  { type: 'type_text', label: 'Escribir texto', category: 'input', icon: 'keyboard', outputs: ['siguiente'],
    params: [t('text', 'Texto', '{pick:Hola|Buenas|Qué tal}'), b('humanize', 'Teclear letra a letra', false)] },
  { type: 'key', label: 'Tecla', category: 'input', icon: 'circle-dot', outputs: ['siguiente'],
    params: [s('key', 'Tecla', Object.keys(KEYCODES), 'BACK')] },

  // ---------- Pantalla / UI ----------
  { type: 'tap_text', label: 'Tocar texto', category: 'ui', icon: 'search', outputs: ['encontrado', 'no encontrado'],
    params: [t('text', 'Texto / descripción', 'Aceptar'), b('exact', 'Coincidencia exacta', false), n('timeout', 'Esperar hasta (ms)', 5000)] },
  { type: 'tap_id', label: 'Tocar por resource-id', category: 'ui', icon: 'hash', outputs: ['encontrado', 'no encontrado'],
    params: [t('id', 'resource-id', 'com.app:id/boton'), n('timeout', 'Esperar hasta (ms)', 5000)] },
  { type: 'tap_xpath', label: 'Tocar por XPath', category: 'ui', icon: 'hash', outputs: ['encontrado', 'no encontrado'],
    params: [t('xpath', 'XPath (cópialo del inspector)', '//android.widget.Button[@text="Aceptar"]'), n('timeout', 'Esperar hasta (ms)', 5000)] },
  { type: 'if_xpath', label: 'Si aparece XPath', category: 'ui', icon: 'eye', outputs: ['sí', 'no'],
    params: [t('xpath', 'XPath', '//*[@text="Iniciar sesión"]'), n('timeout', 'Esperar hasta (ms)', 3000)] },
  { type: 'if_text', label: 'Si aparece texto', category: 'ui', icon: 'eye', outputs: ['sí', 'no'],
    params: [t('text', 'Texto', 'Iniciar sesión'), b('exact', 'Coincidencia exacta', false), n('timeout', 'Esperar hasta (ms)', 3000)] },
  { type: 'read_text', label: 'Leer texto de elemento', category: 'ui', icon: 'book', outputs: ['encontrado', 'no encontrado'],
    params: [t('id', 'resource-id', 'com.app:id/titulo'), t('xpath', 'o XPath (si lo rellenas, se usa en vez del id)', ''), t('var', 'Guardar en variable', 'texto'), n('timeout', 'Esperar hasta (ms)', 2000)] },
  { type: 'if_color', label: 'Si color en punto', category: 'ui', icon: 'palette', outputs: ['sí', 'no'],
    params: [t('x', 'X (px o %)', '50%'), t('y', 'Y (px o %)', '50%'), t('color', 'Color hex', '#FFFFFF'), n('tolerance', 'Tolerancia (0-255)', 24)] },
  { type: 'screenshot', label: 'Captura de pantalla', category: 'ui', icon: 'camera', outputs: ['siguiente'],
    params: [t('name', 'Nombre de archivo', '{device.name}_{timestamp}')] },

  // ---------- Apps ----------
  { type: 'open_app', label: 'Abrir app', category: 'apps', icon: 'rocket', outputs: ['siguiente'], params: [t('package', 'Paquete', 'com.android.chrome')] },
  { type: 'stop_app', label: 'Cerrar app', category: 'apps', icon: 'x-circle', outputs: ['siguiente'], params: [t('package', 'Paquete', 'com.android.chrome')] },
  { type: 'clear_app', label: 'Borrar datos de app', category: 'apps', icon: 'eraser', outputs: ['siguiente'], params: [t('package', 'Paquete', 'com.android.chrome')] },
  { type: 'if_app', label: 'Si app en primer plano', category: 'apps', icon: 'app-window', outputs: ['sí', 'no'], params: [t('package', 'Paquete', 'com.android.chrome')] },
  { type: 'open_url', label: 'Abrir URL', category: 'apps', icon: 'globe', outputs: ['siguiente'], params: [t('url', 'URL', 'https://example.com')] },
  { type: 'install_apk', label: 'Instalar APK', category: 'apps', icon: 'package', outputs: ['ok', 'error'], params: [t('path', 'Ruta del APK en el PC', 'C:\\apks\\app.apk')] },
  { type: 'uninstall', label: 'Desinstalar app', category: 'apps', icon: 'trash', outputs: ['siguiente'], params: [t('package', 'Paquete', 'com.ejemplo.app')] },

  // ---------- Sistema ----------
  { type: 'shell', label: 'Comando shell', category: 'system', icon: 'terminal', outputs: ['siguiente'],
    params: [t('command', 'Comando', 'getprop ro.product.model'), t('var', 'Guardar salida en variable', 'salida')] },
  { type: 'wake_unlock', label: 'Despertar y desbloquear', category: 'system', icon: 'unlock', outputs: ['siguiente'], params: [t('pin', 'PIN (opcional)', '')] },
  { type: 'set_proxy', label: 'Proxy HTTP', category: 'system', icon: 'shield', outputs: ['siguiente'], params: [t('proxy', 'host:puerto (vacío = quitar)', '')] },
  { type: 'proxy_assigned', label: 'Aplicar proxy asignado', category: 'system', icon: 'shield-check', outputs: ['ok', 'sin proxy'], params: [],
    help: 'Aplica el proxy que este teléfono tiene asignado en la sección Proxys.' },
  { type: 'proxy_rotate', label: 'Rotar proxy', category: 'system', icon: 'refresh', outputs: ['siguiente'], params: [],
    help: 'Asigna al teléfono el siguiente proxy libre de la lista y lo aplica. Queda en {proxy}.' },
  { type: 'airplane', label: 'Modo avión (rotar IP)', category: 'system', icon: 'plane', outputs: ['siguiente'],
    params: [n('ms', 'Tiempo en modo avión ms', 4000)], help: 'Requiere root o Android que permita cmd connectivity.' },
  { type: 'wifi', label: 'Wi-Fi', category: 'system', icon: 'wifi', outputs: ['siguiente'], params: [s('state', 'Estado', ['encender', 'apagar'])] },
  { type: 'push_file', label: 'Enviar archivo', category: 'system', icon: 'upload', outputs: ['siguiente'],
    params: [t('local', 'Archivo en PC', 'C:\\media\\foto.jpg'), t('remote', 'Destino', '/sdcard/Download/'), b('scan', 'Refrescar galería', true)] },

  // ---------- Datos e integraciones ----------
  { type: 'data_row', label: 'Leer fila de tabla', category: 'data', icon: 'table', outputs: ['ok', 'sin datos'],
    params: [t('table', 'Tabla', 'cuentas'), s('mode', 'Fila', ['por dispositivo', 'aleatoria', 'secuencial'])],
    help: 'Carga las columnas de la fila como variables: {usuario}, {clave}, etc.' },
  { type: 'http', label: 'Petición HTTP', category: 'data', icon: 'link', outputs: ['ok', 'error'],
    params: [s('method', 'Método', ['GET', 'POST', 'PUT', 'DELETE']), t('url', 'URL', 'https://api.ejemplo.com'), t('body', 'Cuerpo (JSON)', ''), t('var', 'Guardar respuesta en', 'respuesta')] },
  { type: 'notify', label: 'Notificar (Telegram/Webhook)', category: 'data', icon: 'bell', outputs: ['siguiente'], params: [t('message', 'Mensaje', '{device.name}: tarea completada')] },
];

export const NODE_MAP = Object.fromEntries(NODE_TYPES.map((d) => [d.type, d]));

export function defaultParams(type) {
  const def = NODE_MAP[type];
  return Object.fromEntries((def?.params ?? []).map((p) => [p.key, p.default]));
}
