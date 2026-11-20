// Centro de control, pestañas "General" (apps, dispositivo, multimedia, proxy), "Automatizar"
// (scripts por plataforma con su ventana de opciones, como en TrustFarm) y "ADB" (comandos rápidos).
import { state, $, $$, esc, call, toast, modal, switchView, hydrateIcons, showResults } from './core.js';
import { selectedSerials, deviceNumber } from './devices.js';
import { TEMPLATES } from './templates.js';

const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');

/** Apps de cada plataforma y qué plantilla usa cada script. */
export const APPS = {
  tiktok: { key: 'tiktok', name: 'TikTok', pkg: 'com.zhiliaoapp.musically', publish: 'tiktok', warm: 'tiktok', login: 'tiktok', account: 'tiktok' },
  instagram: { key: 'instagram', name: 'Instagram', pkg: 'com.instagram.android', publish: 'reels', warm: 'instagram', login: 'instagram', account: 'instagram' },
  facebook: { key: 'facebook', name: 'Facebook', pkg: 'com.facebook.katana', publish: 'facebook', warm: 'facebook', login: 'facebook', account: 'facebook' },
  youtube: { key: 'youtube', name: 'YouTube', pkg: 'com.google.android.youtube', publish: 'shorts', warm: 'youtube', login: 'google', account: 'google' },
};
let platform = 'tiktok';

/** Teléfonos seleccionados; avisa si no hay ninguno. */
function targets() {
  const serials = selectedSerials();
  if (!serials.length) toast('Selecciona teléfonos (en las tarjetas o en los números de abajo)', 'warn');
  return serials;
}

async function run(label, method, ...args) {
  const serials = targets();
  if (!serials.length) return;
  try {
    const res = await call(method, serials, ...args);
    const bad = res.filter((r) => !r.ok);
    toast(bad.length ? `${label}: ${res.length - bad.length} bien, ${bad.length} con error (${bad[0].out.split('\n')[0]})` : `${label}: hecho en ${res.length} teléfono(s)`, bad.length ? 'warn' : 'info');
  } catch (e) { toast(errText(e), 'error'); }
}

/** Elegir app: las cuatro plataformas o un paquete escrito a mano. */
async function pickApp(title, okText, extra = '') {
  const v = await modal({ title, html: extra, okText, fields: [
    { key: 'app', label: 'App', type: 'select', value: platform, options: [...Object.entries(APPS).map(([k, a]) => [a.pkg, a.name]), ['otra', 'Otra (escribe el paquete)']] },
    { key: 'pkg', label: 'Paquete (solo si eliges "Otra")', placeholder: 'com.ejemplo.app' },
  ] });
  if (!v) return null;
  return v.app === 'otra' ? v.pkg.trim() : v.app;
}

function renderApps() {
  const box = $('#genApps');
  box.innerHTML = Object.values(APPS).map((a) => `<div class="gen-app"><span>${esc(a.name)}</span>
    <button class="primary" data-app-open="${a.pkg}">Abrir</button><button class="ghost" data-app-stop="${a.pkg}">Detener</button></div>`).join('');
  $$('[data-app-open]', box).forEach((b) => (b.onclick = () => run('Abrir', 'openApp', b.dataset.appOpen)));
  $$('[data-app-stop]', box).forEach((b) => (b.onclick = () => run('Detener', 'stopApp', b.dataset.appStop)));
}

function initGeneral() {
  renderApps();
  const actions = {
    clear: async () => {
      const pkg = await pickApp('Borrar datos de una app', 'Borrar datos', '<p class="muted small">Borra los datos de la app en los teléfonos seleccionados: queda como recién instalada (se cierra la sesión).</p>');
      if (pkg) run('Borrar datos', 'clearApp', pkg);
    },
    perms: async () => {
      const pkg = await pickApp('Conceder permisos', 'Conceder', '<p class="muted small">Concede a la app los permisos de cámara, micrófono, fotos y vídeos, notificaciones, contactos y ubicación (los que la app pida).</p>');
      if (pkg) run('Permisos', 'grantPerms', pkg);
    },
    apk: () => $('.cc-toolbar [data-act="apk"]').click(),
    uninstall: async () => {
      const serials = targets();
      if (!serials.length) return;
      const pkgs = await call('listPackages', serials[0]).catch(() => []);
      const v = await modal({ title: 'Desinstalar app', okText: 'Desinstalar', html: '<p class="muted small">Lista de apps instaladas del primer teléfono seleccionado.</p>',
        fields: [{ key: 'pkg', label: 'App', type: 'select', options: pkgs.length ? pkgs : [['', 'No hay apps instaladas por el usuario']] }] });
      if (v?.pkg) run('Desinstalar', 'uninstallApp', v.pkg);
    },
    gallery: async () => {
      if (!targets().length) return;
      const files = await call('pickMedia', false);
      if (files.length) run('Subir a galería', 'galleryUpload', files);
    },
    galleryClear: async () => {
      if (!targets().length) return;
      const ok = await modal({ title: 'Limpiar galería', html: '<p>Se borran los vídeos y fotos que subió Nexus Farmer (carpeta DCIM/NexusFarmer). Las fotos propias del teléfono no se tocan.</p>', okText: 'Limpiar' });
      if (ok) run('Limpiar galería', 'galleryClear');
    },
    proxy: () => $('.cc-toolbar [data-act="proxy"]').click(),
  };
  $$('[data-gen]').forEach((b) => (b.onclick = () => actions[b.dataset.gen]()));
}

// ---------- Automatizar ----------

/** Busca el flujo de una plantilla y, si no existe, lo crea (se puede ajustar después en Automatización). */
async function ensureFlow(match) {
  const t = TEMPLATES.find(match);
  if (!t) throw new Error('Plantilla no encontrada');
  let wf = state.workflows.find((w) => w.name === t.name);
  if (!wf) {
    wf = await call('saveWorkflow', { id: null, name: t.name, description: t.description, graph: t.build() });
    state.workflows.push(wf);
    toast(`Flujo "${t.name}" creado (puedes ajustarlo en Automatización)`);
  }
  return wf;
}

/**
 * Ventana de script: teléfonos seleccionados con su número, límite de ejecución a la vez, aviso,
 * secciones a la izquierda y "Iniciar script". sections: [{ title, html }]. Devuelve los valores (data-k).
 */
async function scriptDialog({ title, info, sections = [], serials, onMount }) {
  const limit = state.settings.runConcurrency ?? 10;
  const nums = serials.map((s) => deviceNumber(s)).sort((a, b) => a - b);
  const html = `<div class="script-dlg">
    <div class="devs">Dispositivos seleccionados: ${serials.length}</div>
    <div class="devnums">${nums.map((n) => `<span>${n}</span>`).join('')}</div>
    <div class="limit">Límite de ejecución a la vez: ${limit}. Los demás esperan en la cola (se cambia en Ajustes).</div>
    ${info ? `<div class="info">${info}</div>` : ''}
    ${sections.length ? `<div class="layout"><div class="nav">${sections.map((s, i) => `<button type="button" data-pane="${i}" class="${i ? '' : 'active'}">${esc(s.title)}</button>`).join('')}</div>
      <div>${sections.map((s, i) => `<div class="pane ${i ? 'hidden' : ''}" data-pane="${i}"><h4>${esc(s.title)}</h4>${s.html}</div>`).join('')}</div></div>` : ''}
  </div>`;
  return modal({ title, html, okText: 'Iniciar script', wide: true, onMount: (el) => {
    $$('.nav [data-pane]', el).forEach((b) => (b.onclick = () => {
      $$('.nav [data-pane]', el).forEach((x) => x.classList.toggle('active', x === b));
      $$('.pane', el).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.pane));
    }));
    onMount?.(el);
  } });
}

const SCRIPTS = {
  login: {
    label: 'Iniciar sesión', icon: 'key', group: 'Cuenta',
    async start(app, serials) {
      const accounts = (state.accounts || []).filter((a) => a.platform === app.account && serials.includes(a.serial));
      const rows = serials.map((s) => {
        const a = accounts.find((x) => x.serial === s);
        return `<tr><td>${deviceNumber(s)}</td><td>${a ? esc(a.user) : '<span class="muted">sin cuenta asignada</span>'}</td></tr>`;
      }).join('');
      const v = await scriptDialog({ title: `Iniciar sesión · ${app.name}`, serials,
        info: `Cada teléfono inicia sesión en ${esc(app.name)} con la cuenta que tiene asignada en <b>Cuentas</b>. Los que no tengan cuenta se saltan.`,
        sections: [{ title: 'Cuentas', html: `<table><tr><td><b>Nº</b></td><td><b>Cuenta</b></td></tr>${rows}</table>` }] });
      if (!v) return;
      if (!accounts.length) return toast(`Ninguno de estos teléfonos tiene cuenta de ${app.name}: añádelas en Cuentas`, 'warn');
      await ensureFlow((t) => t.login === app.login);
      const r = await call('accLogin', accounts.map((a) => a.id));
      toast(`Iniciando sesión en ${r.queued} teléfono(s)`);
    },
  },
  accounts: {
    label: 'Cuentas', icon: 'list', group: 'Cuenta',
    start: () => switchView('accounts'),
  },
  post: {
    label: 'Publicar vídeo', icon: 'upload', group: 'Contenido',
    async start(app, serials) {
      let clip = '';
      const v = await scriptDialog({ title: `Publicar vídeo · ${app.name}`, serials,
        info: `Todos los teléfonos seleccionados publican el mismo vídeo en ${esc(app.name)} con su cuenta. Para un vídeo distinto por cuenta usa <b>Publicación masiva</b>.`,
        sections: [{ title: 'Vídeo', html: `<button type="button" class="soft" data-pick>Elegir vídeo…</button><div class="muted small" data-clip>Ningún vídeo elegido</div>
          <label>Descripción<textarea data-k="caption" rows="4" placeholder="Mira esto #clips"></textarea></label>` }],
        onMount: (el) => {
          el.querySelector('[data-pick]').onclick = async () => {
            const files = await call('pickMedia', false);
            if (files[0]) { clip = files[0]; el.querySelector('[data-clip]').textContent = clip.split(/[\\/]/).pop(); }
          };
        } });
      if (!v) return;
      if (!clip) return toast('Elige el vídeo que se va a publicar', 'warn');
      const wf = await ensureFlow((t) => t.publish === app.publish);
      const p = await call('postCreate', { workflowId: wf.id, serials, clips: [clip], captions: [v.caption], mode: 'mismo' });
      toast(`Publicando en ${p.items.length} teléfono(s): mira el estado en Publicaciones`);
    },
  },
  mass: {
    label: 'Masiva', icon: 'layers', group: 'Contenido',
    async start(app) {
      await ensureFlow((t) => t.publish === app.publish);
      switchView('posts');
      const wf = state.workflows.find((w) => w.name === TEMPLATES.find((t) => t.publish === app.publish).name);
      setTimeout(() => { const sel = $('#pbFlow'); if (sel && wf) sel.value = wf.id; }, 50);
    },
  },
  warm: {
    label: 'Calentamiento', icon: 'bolt', group: 'Crecimiento',
    async start(app, serials) {
      const v = await scriptDialog({ title: `Calentamiento · ${app.name}`, serials,
        info: `Cada teléfono abre ${esc(app.name)}, busca un tema y mira vídeos de ese tema, pasando al siguiente cada cierto tiempo. Solo mira: no da me gusta, no comenta ni sigue.`,
        sections: [
          { title: 'Temas', html: `<label>Temas que buscar (uno por línea)<textarea data-k="topics" rows="5" placeholder="recetas fáciles&#10;fútbol highlights"></textarea></label>
            <label>Tema de cada teléfono<select data-k="mode"><option value="orden">Uno distinto por teléfono</option><option value="aleatorio">Al azar</option></select></label>` },
          { title: 'Duración de visualización', html: `<div class="row2"><label>Vídeos<input data-k="videos" type="number" min="1" value="10" /></label>
            <label>Rondas (cambia de tema en cada una)<input data-k="rounds" type="number" min="1" value="1" /></label></div>
            <div class="row2"><label>Ver cada uno (mín. segundos)<input data-k="secMin" type="number" min="3" value="15" /></label>
            <label>Ver cada uno (máx. segundos)<input data-k="secMax" type="number" min="3" value="40" /></label></div>` },
        ] });
      if (!v) return;
      const wf = await ensureFlow((t) => t.warm === app.warm);
      const j = await call('warmCreate', { workflowIds: [wf.id], serials, topics: v.topics.split('\n'), topicMode: v.mode,
        videos: Number(v.videos), rounds: Number(v.rounds), secMin: Number(v.secMin), secMax: Number(v.secMax) });
      toast(`Calentando ${j.items.length} teléfono(s): mira el estado en Calentamiento`);
    },
  },
  popups: {
    label: 'Cerrar ventanas', icon: 'x-circle', group: 'Crecimiento',
    async start(app, serials) {
      const v = await scriptDialog({ title: 'Cerrar ventanas emergentes', serials,
        info: 'En la pantalla que tenga cada teléfono, toca los botones de cerrar o aceptar avisos (Ahora no, Omitir, Permitir, Aceptar...) hasta 5 veces.' });
      if (!v) return;
      const wf = await ensureFlow((t) => t.popups);
      await call('runWorkflow', wf.id, serials);
      toast(`Cerrando ventanas en ${serials.length} teléfono(s)`);
    },
  },
  profile: {
    label: 'Completar perfil', icon: 'tag', group: 'Cuenta', tool: 'profile',
    async start(app, serials) {
      let fotos = [];
      const v = await scriptDialog({ title: `Completar perfil · ${app.name}`, serials,
        info: `Cada teléfono abre su perfil de ${esc(app.name)}, pulsa "Editar perfil" y cambia lo que rellenes aquí. Una línea por teléfono, en orden (si hay menos líneas que teléfonos, se repiten). Lo que dejes vacío no se cambia.`,
        sections: [
          { title: 'Nombre y biografía', html: `<label>Nombres (uno por línea)${app.key === 'facebook' ? ' · en Facebook el nombre no se cambia desde aquí' : ''}<textarea data-k="nombres" rows="4" placeholder="Ana Recetas&#10;Cocina con Beto"></textarea></label>
            <label>Biografías (una por línea)<textarea data-k="bios" rows="4" placeholder="Recetas fáciles cada día 🍳"></textarea></label>` },
          { title: 'Foto de perfil', html: `<button type="button" class="soft" data-pick>Elegir fotos…</button><div class="muted small" data-fotos>Sin fotos: no se cambia la foto</div>
            <p class="muted small">Una foto por teléfono, en orden. Se sube a la galería y se elige como la más reciente.</p>` },
        ],
        onMount: (el) => {
          el.querySelector('[data-pick]').onclick = async () => {
            fotos = await call('pickMedia', false);
            el.querySelector('[data-fotos]').textContent = fotos.length ? fotos.map((f) => f.split(/[\\/]/).pop()).join(', ') : 'Sin fotos: no se cambia la foto';
          };
        } });
      if (!v) return;
      const nombres = lines(v.nombres);
      const bios = lines(v.bios);
      if (!nombres.length && !bios.length && !fotos.length) return toast('Rellena al menos un nombre, una biografía o una foto', 'warn');
      const wf = await ensureFlow((t) => t.tool === 'profile' && t.toolApp === app.key);
      const vars = Object.fromEntries(serials.map((s, i) => [s, { nombre: pick(nombres, i), bio: pick(bios, i), foto: pick(fotos, i) }]));
      await call('runWithVars', wf.id, serials, vars);
      toast(`Completando el perfil en ${serials.length} teléfono(s)`);
    },
  },
  switch: {
    label: 'Cambiar cuenta', icon: 'refresh', group: 'Cuenta', tool: 'switch',
    async start(app, serials) {
      const assigned = Object.fromEntries((state.accounts || []).filter((a) => a.platform === app.account && serials.includes(a.serial)).map((a) => [a.serial, a.user]));
      const v = await scriptDialog({ title: `Cambiar de cuenta · ${app.name}`, serials,
        info: `Cambia a otra cuenta que ya tenga la sesión iniciada en ese teléfono (el selector de cuentas de ${esc(app.name)}).`,
        sections: [{ title: 'Cuenta destino', html: `<label>¿A qué cuenta?<select data-k="modo"><option value="asignada">La asignada a cada teléfono en Cuentas</option><option value="lista">Las que escriba aquí</option></select></label>
          <label>Cuentas (una por línea, en orden de teléfono; solo si eliges "Las que escriba aquí")<textarea data-k="lista" rows="4" placeholder="mi_cuenta_2"></textarea></label>
          <table>${serials.map((s) => `<tr><td>${deviceNumber(s)}</td><td>${assigned[s] ? esc(assigned[s]) : '<span class="muted">sin cuenta asignada</span>'}</td></tr>`).join('')}</table>` }] });
      if (!v) return;
      const list = lines(v.lista);
      const target = (s, i) => (v.modo === 'lista' ? pick(list, i) : assigned[s] || '').replace(/^@/, '');
      const go = serials.filter((s, i) => target(s, i));
      if (!go.length) return toast(v.modo === 'lista' ? 'Escribe al menos una cuenta' : 'Ninguno de estos teléfonos tiene cuenta asignada en Cuentas', 'warn');
      const wf = await ensureFlow((t) => t.tool === 'switch' && t.toolApp === app.key);
      const vars = Object.fromEntries(serials.map((s, i) => [s, { cuenta_destino: target(s, i), cuenta_arroba: `@${target(s, i)}` }]).filter(([, x]) => x.cuenta_destino));
      await call('runWithVars', wf.id, go, vars);
      toast(`Cambiando de cuenta en ${go.length} teléfono(s)`);
    },
  },
  delete: {
    label: 'Borrar posts', icon: 'trash', group: 'Contenido', tool: 'delete',
    async start(app, serials) {
      const v = await scriptDialog({ title: `Borrar publicación · ${app.name}`, serials,
        info: `<b>Atención:</b> borra de verdad las publicaciones más recientes del perfil de cada teléfono en ${esc(app.name)}. No se puede deshacer.`,
        sections: [{ title: 'Cuántas', html: `<label>Publicaciones a borrar por cuenta (las más recientes)<input data-k="cuantas" type="number" min="1" max="50" value="1" /></label>
          <label>Escribe BORRAR para confirmar<input data-k="confirma" placeholder="BORRAR" /></label>` }] });
      if (!v) return;
      if (v.confirma.trim().toUpperCase() !== 'BORRAR') return toast('No se borró nada: escribe BORRAR para confirmar', 'warn');
      const wf = await ensureFlow((t) => t.tool === 'delete' && t.toolApp === app.key);
      const n = String(Math.min(50, Math.max(1, Number(v.cuantas) || 1)));
      await call('runWithVars', wf.id, serials, Object.fromEntries(serials.map((s) => [s, { cuantas: n }])));
      toast(`Borrando ${n} publicación(es) en ${serials.length} teléfono(s)`);
    },
  },
  privacy: {
    label: 'Privacidad', icon: 'shield', group: 'Contenido', tool: 'privacy',
    async start(app, serials) {
      const v = await scriptDialog({ title: `Privacidad · ${app.name}`, serials,
        info: `Pone las cuentas de ${esc(app.name)} como privadas o públicas. Si ya están así, no toca nada.`,
        sections: [{ title: 'Cuenta privada', html: `<label>Dejar la cuenta<select data-k="privada"><option value="sí">Privada</option><option value="no">Pública</option></select></label>` }] });
      if (!v) return;
      const wf = await ensureFlow((t) => t.tool === 'privacy' && t.toolApp === app.key);
      await call('runWithVars', wf.id, serials, Object.fromEntries(serials.map((s) => [s, { privada: v.privada }])));
      toast(`Cambiando la privacidad en ${serials.length} teléfono(s)`);
    },
  },
};

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const pick = (list, i) => (list.length ? list[i % list.length] : '');

/** Orden de los botones dentro de cada grupo (como en TrustFarm). */
const ORDER = ['login', 'profile', 'switch', 'accounts', 'post', 'mass', 'delete', 'privacy', 'warm', 'popups'];

/** ¿Hay flujo de esta herramienta para esta red? */
const available = (s) => !s.tool || TEMPLATES.some((t) => t.tool === s.tool && t.toolApp === platform);

function renderAuto() {
  $('#autoPlatforms').innerHTML = Object.entries(APPS).map(([k, a]) => `<button class="${k === platform ? 'active' : ''}" data-plat="${k}">${esc(a.name)}</button>`).join('');
  $$('#autoPlatforms [data-plat]').forEach((b) => (b.onclick = () => { platform = b.dataset.plat; renderAuto(); }));
  const groups = [...new Set(Object.values(SCRIPTS).map((s) => s.group))];
  $('#autoActions').innerHTML = groups.map((g) => `<div class="section-title">${esc(g)}</div><div class="cc-buttons">${ORDER.map((k) => [k, SCRIPTS[k]])
    .filter(([, s]) => s.group === g).map(([k, s]) => `<button class="soft" data-script="${k}" ${available(s) ? '' : `disabled title="Aún no disponible para ${esc(APPS[platform].name)}"`}><i data-icon="${s.icon}"></i>${esc(s.label)}</button>`).join('')}</div>`).join('');
  hydrateIcons($('#autoActions'));
  $$('#autoActions [data-script]').forEach((b) => (b.onclick = async () => {
    const s = SCRIPTS[b.dataset.script];
    const serials = ['accounts', 'mass'].includes(b.dataset.script) ? [] : targets();
    if (!serials.length && !['accounts', 'mass'].includes(b.dataset.script)) return;
    try { await s.start(APPS[platform], serials); } catch (e) { toast(errText(e), 'error'); }
  }));
}

// ---------- Comandos ADB ----------

/** Comandos rápidos. show: enseñar la salida de cada teléfono. */
const ADB_COMMANDS = [
  { group: 'Pantalla', items: [
    { label: 'Brillo mínimo', cmd: 'settings put system screen_brightness_mode 0; settings put system screen_brightness 5' },
    { label: 'Brillo normal', cmd: 'settings put system screen_brightness_mode 0; settings put system screen_brightness 120' },
    { label: 'Siempre encendida', cmd: 'svc power stayon true; settings put system screen_off_timeout 1800000' },
    { label: 'Apagado normal', cmd: 'svc power stayon false; settings put system screen_off_timeout 60000' },
    { label: 'Sin animaciones', cmd: 'settings put global window_animation_scale 0; settings put global transition_animation_scale 0; settings put global animator_duration_scale 0' },
    { label: 'Con animaciones', cmd: 'settings put global window_animation_scale 1; settings put global transition_animation_scale 1; settings put global animator_duration_scale 1' },
  ] },
  { group: 'Conexión', items: [
    { label: 'Wi-Fi sí', cmd: 'svc wifi enable' },
    { label: 'Wi-Fi no', cmd: 'svc wifi disable' },
    { label: 'Datos sí', cmd: 'svc data enable' },
    { label: 'Datos no', cmd: 'svc data disable' },
    { label: 'Modo avión sí', cmd: 'cmd connectivity airplane-mode enable 2>/dev/null || (settings put global airplane_mode_on 1; am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true)' },
    { label: 'Modo avión no', cmd: 'cmd connectivity airplane-mode disable 2>/dev/null || (settings put global airplane_mode_on 0; am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false)' },
    { label: 'Ver IP pública', cmd: 'curl -s -m 8 https://api.ipify.org 2>/dev/null || toybox wget -qO- -T 8 https://api.ipify.org', show: true },
    { label: 'Ver IP local', cmd: "ip -4 addr show wlan0 | grep inet | awk '{print $2}'", show: true },
  ] },
  { group: 'Sistema', items: [
    { label: 'No molestar sí', cmd: 'cmd notification set_dnd on' },
    { label: 'No molestar no', cmd: 'cmd notification set_dnd off' },
    { label: 'Volumen a 0', cmd: 'cmd media_session volume --stream 3 --set 0 2>/dev/null || media volume --stream 3 --set 0' },
    { label: 'Hora automática', cmd: 'settings put global auto_time 1; settings put global auto_time_zone 1' },
    { label: 'Cerrar apps', cmd: 'am kill-all' },
    { label: 'Batería', cmd: "dumpsys battery | grep -E 'level|temperature|status'", show: true },
    { label: 'Modelo y Android', cmd: 'echo "$(getprop ro.product.model) · Android $(getprop ro.build.version.release)"', show: true },
    { label: 'Abrir Ajustes', cmd: 'am start -a android.settings.SETTINGS' },
  ] },
];

async function runShell(label, cmd, show) {
  const serials = targets();
  if (!serials.length) return;
  try {
    const res = await call('shellCmd', serials, cmd);
    if (show) showResults(label, res);
    else {
      const bad = res.filter((r) => !r.ok);
      toast(bad.length ? `${label}: ${bad.length} con error (${bad[0].out.split('\n')[0]})` : `${label}: hecho en ${res.length} teléfono(s)`, bad.length ? 'warn' : 'info');
    }
  } catch (e) { toast(errText(e), 'error'); }
}

function initAdb() {
  $('#adbQuick').innerHTML = ADB_COMMANDS.map((g, gi) => `<div class="section-title">${esc(g.group)}</div><div class="cc-buttons">${g.items
    .map((c, i) => `<button class="soft" data-adb="${gi}.${i}" title="${esc(c.cmd)}">${esc(c.label)}</button>`).join('')}</div>`).join('');
  $$('#adbQuick [data-adb]').forEach((b) => (b.onclick = () => {
    const [gi, i] = b.dataset.adb.split('.').map(Number);
    const c = ADB_COMMANDS[gi].items[i];
    runShell(c.label, c.cmd, c.show);
  }));
  $('#adbRun').onclick = () => {
    const cmd = $('#adbCmd').value.trim();
    if (!cmd) return toast('Escribe un comando (se ejecuta con adb shell)', 'warn');
    runShell('Comando', cmd, true);
  };
}

export function initControlTabs() {
  initAdb();
  initGeneral();
  renderAuto();
}
