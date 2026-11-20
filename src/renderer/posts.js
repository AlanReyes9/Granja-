// Publicaciones en lote: elegir clips, descripciones y teléfonos, y seguir cómo va cada publicación.
import { state, $, esc, h, call, toast, modal, deviceName, icon } from './core.js';
import { TEMPLATES } from './templates.js';

let clips = [];
const baseName = (p) => String(p).split(/[\\/]/).pop();
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');

const STATUS = {
  programada: ['run', 'Programada'], pendiente: ['run', 'Pendiente'], publicando: ['warn', 'Publicando'],
  terminada: ['ok', 'Terminada'], cancelada: ['', 'Cancelada'], error: ['error', 'Error'],
};
const ITEM = { ok: 'ok', error: 'error', ejecutando: 'warn', 'en cola': '', pendiente: '', detenido: 'error', cancelado: '', interrumpido: 'error' };

/** Los flujos de publicación se reconocen por el nodo "Compartir vídeo/foto a app". */
export const isPublishFlow = (wf) => JSON.stringify(wf.graph || {}).includes('"name":"share_media"');

function renderFlows() {
  const sel = $('#pbFlow');
  const cur = sel.value;
  const flows = state.workflows.filter(isPublishFlow);
  sel.innerHTML = flows.length
    ? flows.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')
    : '<option value="">Primero pulsa "Crear flujos TikTok / Shorts / Reels / Facebook"</option>';
  if (flows.some((w) => w.id === cur)) sel.value = cur;
}

function renderClips() {
  const box = $('#pbClips');
  box.innerHTML = clips.length ? '' : '<span class="muted small">Ningún clip todavía</span>';
  clips.forEach((c, i) => {
    const el = h(`<div class="clip" title="${esc(c)}">${icon('record', 12)}<span>${esc(baseName(c))}</span><button class="ghost icon-only" title="Quitar">${icon('x', 12)}</button></div>`);
    el.querySelector('button').onclick = () => { clips.splice(i, 1); renderClips(); renderPreview(); };
    box.appendChild(el);
  });
}

/**
 * Lista de teléfonos con casillas, botón "Todos" y selector de grupo (la usan Publicaciones y Calentamiento).
 * Devuelve { render, selected }.
 */
export function phonePicker({ box, group, all, count, onChange = () => {} }) {
  const selected = () => [...$(box).querySelectorAll('input:checked')].map((i) => i.value);
  const changed = () => { if (count) $(count).textContent = selected().length ? `(${selected().length})` : ''; onChange(); };
  const render = () => {
    const ready = state.devices.filter((d) => d.state === 'device');
    const checked = new Set(selected());
    $(box).innerHTML = ready.length
      ? ready.map((d) => `<label><input type="checkbox" value="${esc(d.serial)}" ${checked.has(d.serial) ? 'checked' : ''}/> ${esc(deviceName(d.serial))}</label>`).join('')
      : '<span class="muted small">No hay teléfonos conectados</span>';
    $(box).querySelectorAll('input').forEach((i) => (i.onchange = changed));
    const groups = [...new Set(Object.values(state.deviceMeta).map((m) => m.group).filter(Boolean))].sort();
    $(group).innerHTML = `<option value="">Elegir grupo…</option>${groups.map((g) => `<option>${esc(g)}</option>`).join('')}`;
    changed();
  };
  $(all).onclick = () => {
    const boxes = [...$(box).querySelectorAll('input')];
    const on = !boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = on));
    changed();
  };
  $(group).onchange = (e) => {
    const g = e.target.value;
    if (!g) return;
    $(box).querySelectorAll('input').forEach((b) => (b.checked = state.deviceMeta[b.value]?.group === g));
    e.target.value = '';
    changed();
  };
  return { render, selected };
}

let phones;
const selectedPhones = () => phones.selected();
export const renderPhones = () => phones.render();

/** Misma regla de reparto que el proceso principal: así se ve antes de publicar qué sube cada uno. */
function renderPreview() {
  const serials = selectedPhones();
  const caps = $('#pbCaptions').value.split('\n').map((c) => c.trim()).filter(Boolean);
  const mode = $('#pbMode').value;
  if (!serials.length || !clips.length) { $('#pbPreview').innerHTML = ''; return; }
  const rows = serials.map((s, i) => [deviceName(s), baseName(clips[mode === 'mismo' ? 0 : i % clips.length]), caps.length ? caps[i % caps.length] : '']);
  const more = rows.length > 12 ? `<p class="muted small">… y ${rows.length - 12} más</p>` : '';
  $('#pbPreview').innerHTML = `<div class="section-title">Qué publicará cada teléfono</div><table>${rows.slice(0, 12)
    .map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>${more}`;
}

function renderPosts() {
  const list = state.posts || [];
  $('#navPostCount').textContent = list.filter((p) => ['publicando', 'programada'].includes(p.status)).length || '';
  if (state.view !== 'posts') return;
  const box = $('#pbList');
  if (!list.length) { box.innerHTML = '<p class="muted">Aún no hay publicaciones. Añade clips, elige los teléfonos y pulsa Publicar.</p>'; return; }
  box.innerHTML = '';
  for (const p of list) {
    const [cls, label] = STATUS[p.status] || ['', p.status];
    const ok = p.items.filter((i) => i.status === 'ok').length;
    const bad = p.items.filter((i) => ITEM[i.status] === 'error').length;
    const when = p.status === 'programada' ? `para el ${new Date(p.at).toLocaleString('es-ES')}` : new Date(p.startedAt || p.createdAt).toLocaleString('es-ES');
    const el = h(`<div class="pb-post">
      <div class="top"><span class="title">${esc(p.name)}</span><span class="chip ${cls}">${label}</span></div>
      <div class="muted small">${esc(p.workflowName)} · ${when} · ${ok} publicadas · ${bad} con error · ${p.items.length} teléfono(s)${p.error ? ` · ${esc(p.error)}` : ''}</div>
      <table>${p.items.map((it) => `<tr><td>${esc(deviceName(it.serial))}</td><td>${esc(baseName(it.clip))}</td>
        <td class="desc">${esc(it.caption)}</td><td><span class="chip ${ITEM[it.status] ?? ''}">${esc(it.status)}</span></td></tr>`).join('')}</table>
      <div class="group">
        ${['publicando', 'programada'].includes(p.status) ? `<button class="ghost sm danger" data-a="cancel">${icon('square', 14)}${p.status === 'programada' ? 'Cancelar' : 'Detener'}</button>` : ''}
        ${p.status === 'terminada' && bad ? `<button class="soft sm" data-a="retry">${icon('refresh', 14)}Reintentar las que fallaron</button>` : ''}
        ${!['publicando'].includes(p.status) ? `<button class="ghost sm" data-a="del">${icon('trash', 14)}Quitar</button>` : ''}
      </div></div>`);
    el.querySelector('[data-a="cancel"]')?.addEventListener('click', () => call('postCancel', p.id));
    el.querySelector('[data-a="retry"]')?.addEventListener('click', async () => {
      try { await call('postRetry', p.id); toast('Reintentando en los teléfonos que fallaron'); } catch (e) { toast(errText(e), 'error'); }
    });
    el.querySelector('[data-a="del"]')?.addEventListener('click', () => call('postRemove', p.id));
    box.appendChild(el);
  }
}

export function onPosts(list) {
  state.posts = list;
  renderPosts();
}

/** Guarda las plantillas de publicación como flujos (se pueden editar en Automatización). */
async function createFlows() {
  const tpls = TEMPLATES.filter((t) => t.publish);
  const have = new Set(state.workflows.map((w) => w.name));
  const missing = tpls.filter((t) => !have.has(t.name));
  if (!missing.length) {
    const ok = await modal({ title: 'Flujos de publicación', html: '<p>Ya tienes los flujos de publicación. ¿Quieres volver a crearlos? Se añaden como copias nuevas; tus cambios en los actuales se conservan.</p>', okText: 'Crear de nuevo' });
    if (!ok) return;
  }
  for (const t of missing.length ? missing : tpls) {
    const wf = await call('saveWorkflow', { id: null, name: have.has(t.name) ? `${t.name} (nuevo)` : t.name, description: t.description, graph: t.build() });
    state.workflows.push(wf);
  }
  renderFlows();
  toast('Flujos creados. Puedes ajustarlos en Automatización (los XPath están en variables al principio).');
}

export function initPosts() {
  phones = phonePicker({ box: '#pbDevices', group: '#pbGroup', all: '#pbAll', count: '#pbDevCount', onChange: renderPreview });
  window.addEventListener('view', (e) => { if (e.detail === 'posts') { renderFlows(); renderPhones(); renderClips(); renderPosts(); } });
  $('#pbFlows').onclick = () => createFlows().catch((e) => toast(errText(e), 'error'));
  $('#pbAddFiles').onclick = async () => { clips.push(...(await call('pickMedia', false)).filter((f) => !clips.includes(f))); renderClips(); renderPreview(); };
  $('#pbAddFolder').onclick = async () => {
    const found = await call('pickMedia', true);
    if (!found.length) return toast('En esa carpeta no hay vídeos ni fotos', 'warn');
    clips.push(...found.filter((f) => !clips.includes(f)));
    renderClips();
    renderPreview();
  };
  $('#pbCaptions').oninput = renderPreview;
  $('#pbMode').onchange = renderPreview;
  $('#pbStart').onclick = async () => {
    const at = $('#pbAt').value ? new Date($('#pbAt').value).getTime() : null;
    if (at && at < Date.now() - 60000) return toast('Esa hora ya ha pasado', 'warn');
    const opts = { workflowId: $('#pbFlow').value, serials: selectedPhones(), clips, mode: $('#pbMode').value,
      captions: $('#pbCaptions').value.split('\n'), at };
    try {
      const p = await call('postCreate', opts);
      toast(p.status === 'programada' ? `Publicación programada para el ${new Date(p.at).toLocaleString('es-ES')}` : `Publicando en ${p.items.length} teléfono(s)`);
      $('#pbAt').value = '';
    } catch (e) { toast(errText(e), 'error'); }
  };
  renderPosts();
}
