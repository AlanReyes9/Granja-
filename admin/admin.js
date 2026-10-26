// Panel de licencias de Nexus Farmer. Página estática que habla con Supabase (Auth + REST).
// Solo crea seriales en línea: las claves sin conexión no existen en este panel.

const CFG = window.NEXUS_ADMIN_CONFIG || {};
const BASE = String(CFG.supabaseUrl || '').replace(/\/$/, '');
const DAY = 86400000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: sin I, L, O ni U

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');

const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
};
const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

function toast(msg, level = 'ok') {
  const el = h(`<div class="toast ${level === 'error' ? 'error' : ''}">${esc(msg)}</div>`);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------------------------------------------------------------- Sesión y API
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem('nexus.admin') || 'null'); } catch { return null; } },
  set(s) { sessionStorage.setItem('nexus.admin', JSON.stringify(s)); },
  clear() { sessionStorage.removeItem('nexus.admin'); },
};

async function auth(path, body) {
  const res = await fetch(`${BASE}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: CFG.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'No se pudo iniciar sesión');
  return { token: data.access_token, refresh: data.refresh_token, expires: Date.now() + (data.expires_in || 3600) * 1000, email: data.user?.email };
}

async function accessToken() {
  let s = session.get();
  if (!s) throw new Error('Sesión cerrada');
  if (Date.now() > s.expires - 60000) {
    s = { ...(await auth('token?grant_type=refresh_token', { refresh_token: s.refresh })), email: s.email };
    session.set(s);
  }
  return s.token;
}

async function api(method, path, body, prefer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: CFG.anonKey, authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message || `Error ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- Datos
const data = { licencias: [], clientes: [] };

async function loadAll() {
  const [lic, cli] = await Promise.all([
    api('GET', 'licencias?select=*&order=created_at.desc'),
    api('GET', 'clientes?select=*&order=nombre.asc'),
  ]);
  data.licencias = lic;
  data.clientes = cli;
}

const clientName = (l) => data.clientes.find((c) => c.id === l.client_id)?.nombre || l.client || '';

/** Estado de un serial para el panel. */
function estado(l, now = Date.now()) {
  const exp = l.expires_at ? Date.parse(l.expires_at) : null;
  if (l.revoked) return { key: 'revocado', label: 'Revocado', cls: 'bad' };
  if (exp && now > exp) return { key: 'caducado', label: 'Caducado', cls: 'bad' };
  if (!l.machine_id) return { key: 'sin-activar', label: 'Sin activar', cls: 'new' };
  if (exp && exp - now < 7 * DAY) return { key: 'pronto', label: `Caduca en ${Math.max(1, Math.ceil((exp - now) / DAY))} d`, cls: 'warn' };
  return { key: 'activo', label: 'Activo', cls: 'ok' };
}

function duracion(l) {
  if (l.permanent) return 'Permanente';
  if (l.expires_at) return fmtDate(l.expires_at);
  if (l.days) return `${l.days} días al activar`;
  return '-';
}

export function nuevoSerial() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return `NXF-${chars.match(/.{5}/g).join('-')}`;
}

// ---------------------------------------------------------------- Modales y menús
function modal({ title, body, ok = 'Guardar', danger = false, onOk, wide = false }) {
  const el = h(`<div class="modal-bg"><div class="modal" style="${wide ? 'width:min(720px,100%)' : ''}">
    <header><h2>${esc(title)}</h2><button class="ghost icon x" title="Cerrar">${icon('x')}</button></header>
    <div class="body"></div>
    <footer>${ok ? `<button class="ghost cancel">Cancelar</button><button class="${danger ? 'danger' : 'primary'} ok">${esc(ok)}</button>` : '<button class="primary cancel">Cerrar</button>'}</footer>
  </div></div>`);
  const b = el.querySelector('.body');
  if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  const close = () => el.remove();
  el.querySelector('.x').onclick = close;
  el.querySelector('.cancel').onclick = close;
  el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
  el.querySelector('.ok')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { if ((await onOk(b)) !== false) close(); } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
  $('#modalRoot').appendChild(el);
  b.querySelector('input:not([type=radio]):not([type=checkbox]), select, textarea')?.focus();
  return el;
}

function openMenu(anchor, items) {
  $('.menu')?.remove();
  const m = h('<div class="menu"></div>');
  for (const it of items) {
    if (it === '-') { m.appendChild(h('<hr>')); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`);
    b.onclick = () => { m.remove(); it.run(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${window.scrollY + r.bottom + 4}px`;
  m.style.left = `${Math.max(8, window.scrollX + r.right - m.offsetWidth)}px`;
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}

const copy = (text, what = 'Copiado') => navigator.clipboard.writeText(text).then(() => toast(what));

// ---------------------------------------------------------------- Vistas
let view = 'resumen';
let filtros = { q: '', estado: '', cliente: '' };

function render() {
  const s = session.get();
  $('#app').innerHTML = '';
  const shell = h(`<div class="shell">
    <aside class="side">
      <div class="brand"><img src="logo.svg" alt="Nexus Dev" /><div><b>Nexus Farmer</b><small>Panel de licencias</small></div></div>
      <nav>
        <button data-v="resumen">${icon('home', 18)}Resumen</button>
        <button data-v="seriales">${icon('key', 18)}Seriales</button>
        <button data-v="clientes">${icon('users', 18)}Clientes</button>
      </nav>
      <div class="user"><span class="muted">Sesión</span><b>${esc(s?.email)}</b><button class="sm" id="logout">${icon('out', 15)}Cerrar sesión</button></div>
    </aside>
    <main><div class="top"><div><h1 id="title"></h1><div class="sub" id="sub"></div></div><div class="toolbar" id="topActions"></div></div>
      <div class="content" id="content"></div></main>
  </div>`);
  $('#app').appendChild(shell);
  $$('.side nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === view);
    b.onclick = () => { view = b.dataset.v; render(); };
  });
  $('#logout').onclick = () => { fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: CFG.anonKey, authorization: `Bearer ${s?.token}` } }).catch(() => {}); session.clear(); start(); };
  const refresh = h(`<button class="ghost" title="Recargar datos">${icon('refresh')}Actualizar</button>`);
  refresh.onclick = async () => { await loadAll(); render(); toast('Datos actualizados'); };
  $('#topActions').appendChild(refresh);
  ({ resumen: renderResumen, seriales: renderSeriales, clientes: renderClientes })[view]();
}

function setHead(title, sub, actions = []) {
  $('#title').textContent = title;
  $('#sub').textContent = sub;
  for (const a of actions) $('#topActions').appendChild(a);
}

function renderResumen() {
  const now = Date.now();
  const lic = data.licencias;
  const by = (k) => lic.filter((l) => estado(l, now).key === k).length;
  const activos = by('activo') + by('pronto');
  setHead('Resumen', `${lic.length} seriales · ${data.clientes.length} clientes`, [btnCrear()]);
  const kpis = h(`<div class="kpis">
    <div class="kpi" data-f=""><span>Seriales</span><b>${lic.length}</b></div>
    <div class="kpi ok" data-f="activo"><span>Activos en un equipo</span><b>${activos}</b></div>
    <div class="kpi" data-f="sin-activar"><span>Sin activar</span><b>${by('sin-activar')}</b></div>
    <div class="kpi warn" data-f="pronto"><span>Caducan en 7 días</span><b>${by('pronto')}</b></div>
    <div class="kpi bad" data-f="caducado"><span>Caducados</span><b>${by('caducado')}</b></div>
    <div class="kpi bad" data-f="revocado"><span>Revocados</span><b>${by('revocado')}</b></div>
    <div class="kpi" data-c="1"><span>Clientes</span><b>${data.clientes.length}</b></div>
  </div>`);
  $$('.kpi', kpis).forEach((k) => (k.onclick = () => {
    if (k.dataset.c) view = 'clientes'; else { view = 'seriales'; filtros = { q: '', estado: k.dataset.f, cliente: '' }; }
    render();
  }));
  const pronto = lic.filter((l) => ['pronto'].includes(estado(l, now).key)).sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
  const recientes = lic.filter((l) => l.activated_at).sort((a, b) => Date.parse(b.activated_at) - Date.parse(a.activated_at)).slice(0, 8);
  const grid = h(`<div class="grid2">
    <div class="panel"><div class="panel-head"><h3>Caducan pronto</h3></div>${miniTable(pronto, (l) => fmtDate(l.expires_at), 'Caduca')}</div>
    <div class="panel"><div class="panel-head"><h3>Últimas activaciones</h3></div>${miniTable(recientes, (l) => fmtDateTime(l.activated_at), 'Activado')}</div>
  </div>`);
  $('#content').append(kpis, grid);
}

function miniTable(rows, dateFn, dateLabel) {
  if (!rows.length) return '<div class="empty">Nada por aquí</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Serial</th><th>Cliente</th><th>${dateLabel}</th></tr></thead><tbody>
    ${rows.map((l) => `<tr><td class="mono">${esc(l.serial)}</td><td>${esc(clientName(l) || '-')}</td><td>${dateFn(l)}</td></tr>`).join('')}</tbody></table></div>`;
}

function btnCrear(clienteId) {
  const b = h(`<button class="primary">${icon('plus')}Crear seriales</button>`);
  b.onclick = () => crearSeriales(clienteId);
  return b;
}

function renderSeriales() {
  const now = Date.now();
  const q = filtros.q.trim().toLowerCase();
  const rows = data.licencias.filter((l) => {
    const st = estado(l, now).key;
    if (filtros.estado && !(filtros.estado === 'activo' ? ['activo', 'pronto'].includes(st) : st === filtros.estado)) return false;
    if (filtros.cliente && l.client_id !== filtros.cliente) return false;
    return !q || [l.serial, clientName(l), l.plan, l.machine_id, l.notes].some((v) => String(v || '').toLowerCase().includes(q));
  });
  setHead('Seriales', `${rows.length} de ${data.licencias.length}`, [btnCrear(filtros.cliente || undefined)]);
  const panel = h(`<div class="panel">
    <div class="panel-head"><div class="toolbar">
      <input class="search" id="fq" placeholder="Buscar serial, cliente, plan, equipo…" value="${esc(filtros.q)}" />
      <select id="fe"><option value="">Todos los estados</option>
        ${[['sin-activar', 'Sin activar'], ['activo', 'Activos'], ['pronto', 'Caducan pronto'], ['caducado', 'Caducados'], ['revocado', 'Revocados']]
          .map(([v, t]) => `<option value="${v}" ${filtros.estado === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="fc"><option value="">Todos los clientes</option>${data.clientes.map((c) => `<option value="${c.id}" ${filtros.cliente === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
    </div></div>
    <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Serial</th><th>Cliente</th><th>Plan</th><th>Estado</th><th>Caduca</th><th>Equipo</th><th>Última conexión</th><th></th></tr></thead><tbody>
      ${rows.map((l) => {
        const st = estado(l, now);
        return `<tr data-s="${esc(l.serial)}"><td><span class="serial mono">${esc(l.serial)}<button class="ghost icon copy" title="Copiar">${icon('copy', 14)}</button></span></td>
          <td>${esc(clientName(l) || '-')}</td><td>${esc(l.plan || '-')}</td><td><span class="chip ${st.cls}">${esc(st.label)}</span></td>
          <td>${esc(duracion(l))}</td><td class="mono small">${esc(l.machine_id || '-')}</td><td class="small">${fmtDateTime(l.last_seen_at)}</td>
          <td class="actions"><button class="ghost icon more" title="Acciones">${icon('more')}</button></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No hay seriales con estos filtros</div>'}</div>
  </div>`);
  $('#content').appendChild(panel);
  const fq = $('#fq');
  fq.oninput = () => { filtros.q = fq.value; const pos = fq.selectionStart; render(); $('#fq').focus(); $('#fq').setSelectionRange(pos, pos); };
  $('#fe').onchange = (e) => { filtros.estado = e.target.value; render(); };
  $('#fc').onchange = (e) => { filtros.cliente = e.target.value; render(); };
  $$('tr[data-s]', panel).forEach((tr) => {
    const l = data.licencias.find((x) => x.serial === tr.dataset.s);
    tr.querySelector('.copy').onclick = () => copy(l.serial, `Serial ${l.serial} copiado`);
    tr.querySelector('.more').onclick = (e) => { e.stopPropagation(); accionesSerial(e.currentTarget, l); };
  });
}

function accionesSerial(anchor, l) {
  const items = [
    { label: 'Ver detalles', run: () => detalles(l) },
    { label: 'Renovar o cambiar duración', run: () => renovar(l) },
    { label: 'Editar cliente, plan y notas', run: () => editarSerial(l) },
  ];
  if (l.machine_id) items.push({ label: 'Liberar equipo (pasar a otro PC)', run: () => liberar(l) });
  items.push('-');
  items.push(l.revoked
    ? { label: 'Reactivar', run: () => patchSerial(l, { revoked: false }, 'Serial reactivado') }
    : { label: 'Revocar', danger: true, run: () => revocar(l) });
  if (!l.machine_id) items.push({ label: 'Eliminar', danger: true, run: () => eliminarSerial(l) });
  openMenu(anchor, items);
}

async function patchSerial(l, patch, msg) {
  const [u] = await api('PATCH', `licencias?serial=eq.${encodeURIComponent(l.serial)}`, patch, 'return=representation');
  Object.assign(l, u);
  toast(msg);
  render();
}

function clienteSelect(selected) {
  return `<select name="cliente"><option value="">Sin cliente</option>${data.clientes.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
    <option value="__nuevo">+ Nuevo cliente…</option></select>`;
}

function duracionFields(l = null) {
  const exp = l?.expires_at ? new Date(l.expires_at).toISOString().slice(0, 10) : '';
  const mode = !l ? 'dias' : l.permanent ? 'permanente' : 'dias';
  return `<div class="options">
    <label class="option"><input type="radio" name="dur" value="dias" ${mode === 'dias' ? 'checked' : ''}/>
      ${l?.machine_id ? 'Añadir días' : l ? 'Días (desde la activación)' : 'Días desde la activación'}<input type="number" name="dias" min="1" value="30" /></label>
    <label class="option"><input type="radio" name="dur" value="fecha" />Hasta una fecha<input type="date" name="fecha" value="${esc(exp)}" /></label>
    <label class="option"><input type="radio" name="dur" value="permanente" ${mode === 'permanente' && l ? 'checked' : ''}/>Permanente</label>
  </div>`;
}

function leerDuracion(b) {
  const mode = $('input[name=dur]:checked', b).value;
  if (mode === 'permanente') return { permanent: true };
  if (mode === 'fecha') {
    const v = $('input[name=fecha]', b).value;
    if (!v) throw new Error('Elige una fecha');
    const t = Date.parse(`${v}T23:59:59`);
    if (t < Date.now()) throw new Error('La fecha ya ha pasado');
    return { permanent: false, expiresAt: new Date(t).toISOString() };
  }
  const d = Number($('input[name=dias]', b).value);
  if (!Number.isInteger(d) || d < 1) throw new Error('Los días deben ser un número entero positivo');
  return { permanent: false, days: d };
}

async function resolverCliente(b) {
  const v = $('select[name=cliente]', b).value;
  if (v !== '__nuevo') return v || null;
  const nombre = $('input[name=nuevoCliente]', b).value.trim();
  if (!nombre) throw new Error('Escribe el nombre del nuevo cliente');
  const [c] = await api('POST', 'clientes', { nombre }, 'return=representation');
  data.clientes.push(c);
  data.clientes.sort((a, b2) => a.nombre.localeCompare(b2.nombre));
  return c.id;
}

function crearSeriales(clienteId) {
  const body = h(`<div style="display:flex;flex-direction:column;gap:14px">
    <div class="note">Se crean <b>seriales en línea</b>: cada uno queda vinculado al primer equipo que lo active. Con "días", la cuenta empieza al activarlo.</div>
    <div class="row2"><label class="field">Cliente${clienteSelect(clienteId)}</label><label class="field">Plan<input name="plan" placeholder="Pro, Básico, Anual…" list="planes" /></label></div>
    <label class="field hidden" id="nuevoWrap">Nombre del nuevo cliente<input name="nuevoCliente" /></label>
    <datalist id="planes">${[...new Set(data.licencias.map((l) => l.plan).filter(Boolean))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    <label class="field">Duración</label>${duracionFields()}
    <div class="row2"><label class="field">Cantidad<input type="number" name="cantidad" min="1" max="100" value="1" /></label><label class="field">Notas<input name="notas" placeholder="Opcional" /></label></div>
  </div>`);
  $('select[name=cliente]', body).onchange = (e) => $('#nuevoWrap', body).classList.toggle('hidden', e.target.value !== '__nuevo');
  modal({ title: 'Crear seriales', body, ok: 'Crear', onOk: async (b) => {
    const dur = leerDuracion(b);
    const n = Number($('input[name=cantidad]', b).value);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('La cantidad debe estar entre 1 y 100');
    const clientId = await resolverCliente(b);
    const nombre = data.clientes.find((c) => c.id === clientId)?.nombre || '';
    const base = { client_id: clientId, client: nombre, plan: $('input[name=plan]', b).value.trim(), notes: $('input[name=notas]', b).value.trim(),
      permanent: !!dur.permanent, days: dur.days ?? null, expires_at: dur.expiresAt ?? null };
    let created = [];
    for (let intento = 0; intento < 3 && created.length < n; intento++) {
      try {
        const rows = Array.from({ length: n - created.length }, () => ({ ...base, serial: nuevoSerial() }));
        created = created.concat(await api('POST', 'licencias', rows, 'return=representation'));
      } catch (e) {
        if (e.code !== '23505') throw e; // 23505: serial repetido (rarísimo) → se generan otros
      }
    }
    data.licencias.unshift(...created);
    render();
    mostrarCreados(created);
  } });
}

function mostrarCreados(rows) {
  const text = rows.map((r) => r.serial).join('\n');
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <p class="muted" style="margin:0">Envía cada serial a su cliente. Lo escribirá en Nexus Farmer → <b>Con serial</b> → Activar.</p>
    <div class="serial-list mono">${rows.map((r) => `<div>${esc(r.serial)}</div>`).join('')}</div>
    <button id="copyAll">${icon('copy')}Copiar ${rows.length > 1 ? `los ${rows.length} seriales` : 'el serial'}</button></div>`);
  $('#copyAll', body).onclick = () => copy(text, rows.length > 1 ? 'Seriales copiados' : 'Serial copiado');
  modal({ title: `${rows.length} serial${rows.length > 1 ? 'es creados' : ' creado'}`, body, ok: null });
}

function detalles(l) {
  const st = estado(l);
  const rows = [['Serial', `<span class="mono">${esc(l.serial)}</span>`], ['Estado', `<span class="chip ${st.cls}">${esc(st.label)}</span>`],
    ['Cliente', esc(clientName(l) || '-')], ['Plan', esc(l.plan || '-')], ['Duración', esc(duracion(l))], ['Equipo', `<span class="mono">${esc(l.machine_id || '-')}</span>`],
    ['Activado', fmtDateTime(l.activated_at)], ['Última conexión', fmtDateTime(l.last_seen_at)], ['Versión de la app', esc(l.app_version || '-')],
    ['Creado', fmtDateTime(l.created_at)], ['Notas', esc(l.notes || '-')]];
  modal({ title: 'Detalles del serial', body: `<div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>`, ok: null });
}

function renovar(l) {
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <p class="muted" style="margin:0">Duración actual: <b>${esc(duracion(l))}</b>. El cliente verá el cambio al abrir la app o, como mucho, en 6 horas.</p>
    ${duracionFields(l)}</div>`);
  modal({ title: `Renovar ${l.serial}`, body, ok: 'Guardar', onOk: async (b) => {
    const d = leerDuracion(b);
    let patch;
    if (d.permanent) patch = { permanent: true };
    else if (d.expiresAt) patch = { permanent: false, expires_at: d.expiresAt };
    else if (!l.machine_id && !l.expires_at) patch = { permanent: false, days: d.days };
    else {
      const desde = Math.max(Date.now(), l.expires_at ? Date.parse(l.expires_at) : 0);
      patch = { permanent: false, expires_at: new Date(desde + d.days * DAY).toISOString() };
    }
    await patchSerial(l, patch, 'Duración actualizada');
  } });
}

function editarSerial(l) {
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <label class="field">Cliente${clienteSelect(l.client_id)}</label>
    <label class="field hidden" id="nuevoWrap">Nombre del nuevo cliente<input name="nuevoCliente" /></label>
    <label class="field">Plan<input name="plan" value="${esc(l.plan)}" /></label>
    <label class="field">Notas<textarea name="notas" rows="3">${esc(l.notes)}</textarea></label></div>`);
  $('select[name=cliente]', body).onchange = (e) => $('#nuevoWrap', body).classList.toggle('hidden', e.target.value !== '__nuevo');
  modal({ title: `Editar ${l.serial}`, body, onOk: async (b) => {
    const clientId = await resolverCliente(b);
    await patchSerial(l, { client_id: clientId, client: data.clientes.find((c) => c.id === clientId)?.nombre || '',
      plan: $('input[name=plan]', b).value.trim(), notes: $('textarea[name=notas]', b).value.trim() }, 'Serial actualizado');
  } });
}

function liberar(l) {
  modal({ title: 'Liberar equipo', ok: 'Liberar', body: `<p style="margin:0">El serial <b class="mono">${esc(l.serial)}</b> dejará de funcionar en el equipo <span class="mono">${esc(l.machine_id)}</span> (en su próxima comprobación) y se podrá activar en otro PC.</p>`,
    onOk: () => patchSerial(l, { machine_id: null }, 'Equipo liberado') });
}

function revocar(l) {
  modal({ title: 'Revocar serial', ok: 'Revocar', danger: true, body: `<p style="margin:0">El serial <b class="mono">${esc(l.serial)}</b> dejará de funcionar (al abrir la app o, como mucho, en 6 horas). Puedes reactivarlo después.</p>`,
    onOk: () => patchSerial(l, { revoked: true }, 'Serial revocado') });
}

function eliminarSerial(l) {
  modal({ title: 'Eliminar serial', ok: 'Eliminar', danger: true, body: `<p style="margin:0">Se eliminará <b class="mono">${esc(l.serial)}</b>. Solo se pueden eliminar seriales que nunca se han activado.</p>`,
    onOk: async () => {
      await api('DELETE', `licencias?serial=eq.${encodeURIComponent(l.serial)}&machine_id=is.null`);
      data.licencias = data.licencias.filter((x) => x.serial !== l.serial);
      toast('Serial eliminado');
      render();
    } });
}

function renderClientes() {
  const now = Date.now();
  const q = filtros.qc?.trim().toLowerCase() || '';
  const rows = data.clientes.filter((c) => !q || [c.nombre, c.email, c.telefono, c.notas].some((v) => String(v || '').toLowerCase().includes(q)));
  const nuevo = h(`<button class="primary">${icon('plus')}Nuevo cliente</button>`);
  nuevo.onclick = () => editarCliente();
  setHead('Clientes', `${data.clientes.length} clientes`, [nuevo]);
  const panel = h(`<div class="panel">
    <div class="panel-head"><div class="toolbar"><input class="search" id="fqc" placeholder="Buscar por nombre, email o teléfono…" value="${esc(filtros.qc || '')}" /></div></div>
    <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Cliente</th><th>Email</th><th>Teléfono</th><th>Seriales</th><th>Activos</th><th>Alta</th><th></th></tr></thead><tbody>
      ${rows.map((c) => {
        const lic = data.licencias.filter((l) => l.client_id === c.id);
        const act = lic.filter((l) => ['activo', 'pronto'].includes(estado(l, now).key)).length;
        return `<tr data-c="${c.id}"><td><b>${esc(c.nombre)}</b>${c.notas ? `<div class="muted small">${esc(c.notas)}</div>` : ''}</td><td>${esc(c.email || '-')}</td><td>${esc(c.telefono || '-')}</td>
          <td>${lic.length}</td><td>${act ? `<span class="chip ok">${act}</span>` : '0'}</td><td class="small">${fmtDate(c.created_at)}</td>
          <td class="actions"><button class="ghost icon more" title="Acciones">${icon('more')}</button></td></tr>`;
      }).join('')}</tbody></table>` : `<div class="empty">${data.clientes.length ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}</div>`}</div></div>`);
  $('#content').appendChild(panel);
  const fq = $('#fqc');
  fq.oninput = () => { filtros.qc = fq.value; const pos = fq.selectionStart; render(); $('#fqc').focus(); $('#fqc').setSelectionRange(pos, pos); };
  $$('tr[data-c]', panel).forEach((tr) => {
    const c = data.clientes.find((x) => x.id === tr.dataset.c);
    tr.querySelector('.more').onclick = (e) => {
      e.stopPropagation();
      openMenu(e.currentTarget, [
        { label: 'Ver sus seriales', run: () => { view = 'seriales'; filtros = { q: '', estado: '', cliente: c.id }; render(); } },
        { label: 'Crear serial para este cliente', run: () => crearSeriales(c.id) },
        { label: 'Editar', run: () => editarCliente(c) },
        '-',
        { label: 'Eliminar cliente', danger: true, run: () => eliminarCliente(c) },
      ]);
    };
  });
}

function editarCliente(c = null) {
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <label class="field">Nombre<input name="nombre" value="${esc(c?.nombre)}" required /></label>
    <div class="row2"><label class="field">Email<input name="email" type="email" value="${esc(c?.email)}" /></label><label class="field">Teléfono<input name="telefono" value="${esc(c?.telefono)}" /></label></div>
    <label class="field">Notas<textarea name="notas" rows="3">${esc(c?.notas)}</textarea></label></div>`);
  modal({ title: c ? 'Editar cliente' : 'Nuevo cliente', body, onOk: async (b) => {
    const v = { nombre: $('input[name=nombre]', b).value.trim(), email: $('input[name=email]', b).value.trim(), telefono: $('input[name=telefono]', b).value.trim(), notas: $('textarea[name=notas]', b).value.trim() };
    if (!v.nombre) throw new Error('El nombre es obligatorio');
    if (c) {
      const [u] = await api('PATCH', `clientes?id=eq.${c.id}`, v, 'return=representation');
      Object.assign(c, u);
      // El nombre del cliente también se guarda en sus seriales (es el que ve la app).
      if (data.licencias.some((l) => l.client_id === c.id)) {
        await api('PATCH', `licencias?client_id=eq.${c.id}`, { client: v.nombre });
        data.licencias.filter((l) => l.client_id === c.id).forEach((l) => { l.client = v.nombre; });
      }
      toast('Cliente actualizado');
    } else {
      const [n] = await api('POST', 'clientes', v, 'return=representation');
      data.clientes.push(n);
      toast('Cliente creado');
    }
    data.clientes.sort((a, b2) => a.nombre.localeCompare(b2.nombre));
    render();
  } });
}

function eliminarCliente(c) {
  const n = data.licencias.filter((l) => l.client_id === c.id).length;
  modal({ title: 'Eliminar cliente', ok: 'Eliminar', danger: true,
    body: `<p style="margin:0">Se eliminará <b>${esc(c.nombre)}</b>.${n ? ` Sus ${n} serial(es) <b>seguirán funcionando</b>, pero quedarán sin cliente asignado.` : ''}</p>`,
    onOk: async () => {
      await api('DELETE', `clientes?id=eq.${c.id}`);
      data.clientes = data.clientes.filter((x) => x.id !== c.id);
      data.licencias.filter((l) => l.client_id === c.id).forEach((l) => { l.client_id = null; });
      toast('Cliente eliminado');
      render();
    } });
}

// ---------------------------------------------------------------- Arranque
function renderLogin(error = '') {
  $('#app').innerHTML = '';
  const el = h(`<div class="login"><form>
    <img src="logo.svg" alt="Nexus Dev" />
    <div><h1>Panel de licencias</h1><p class="muted" style="margin:4px 0 0">Nexus Farmer · Nexus Dev</p></div>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label class="field">Email<input name="email" type="email" autocomplete="username" required /></label>
    <label class="field">Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
    <button class="primary" type="submit" style="height:42px">Entrar</button>
  </form></div>`);
  el.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    f.querySelector('button').disabled = true;
    try {
      session.set(await auth('token?grant_type=password', { email: f.email.value.trim(), password: f.password.value }));
      await start();
    } catch (err) {
      renderLogin(err.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : err.message);
    }
  };
  $('#app').appendChild(el);
  el.querySelector('input').focus();
}

function renderSetup() {
  $('#app').innerHTML = `<div class="login"><div class="setup panel" style="padding:28px">
    <h1>Configura el panel</h1>
    <p>Edita <b>admin/config.js</b> con los datos de tu proyecto de Supabase (Project Settings → API):</p>
    <pre>window.NEXUS_ADMIN_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  anonKey: 'eyJ...',   // la clave "anon public", nunca la service_role
};</pre>
    <p class="muted">Los pasos completos están en docs/LICENCIAS.md.</p></div></div>`;
}

async function start() {
  if (!BASE || !CFG.anonKey) return renderSetup();
  if (!session.get()) return renderLogin();
  try {
    const admins = await api('GET', 'admins?select=email');
    if (!admins.length) { session.clear(); return renderLogin('Tu usuario no tiene permiso de administrador'); }
    await loadAll();
    render();
  } catch (e) {
    session.clear();
    renderLogin(e.message);
  }
}

start();
