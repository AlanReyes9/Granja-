// Calentamiento de cuentas: temas, redes, tiempos y teléfonos; y el estado de cada teléfono en cada red.
import { state, $, esc, h, call, toast, modal, deviceName, icon } from './core.js';
import { TEMPLATES } from './templates.js';
import { phonePicker } from './posts.js';

const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');
const STATUS = {
  programado: ['run', 'Programado'], pendiente: ['run', 'Pendiente'], calentando: ['warn', 'Calentando'],
  terminado: ['ok', 'Terminado'], cancelado: ['', 'Cancelado'], error: ['error', 'Error'],
};
const ITEM = { ok: 'ok', error: 'error', ejecutando: 'warn', 'en cola': '', detenido: 'error', cancelado: '', 'sin flujo': 'error' };

/** Los flujos de calentamiento se reconocen porque buscan la variable {tema}. */
export const isWarmFlow = (wf) => JSON.stringify(wf.graph || {}).includes('{tema}');

let phones;

function renderFlows() {
  const box = $('#wmFlowList');
  const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
  const flows = state.workflows.filter(isWarmFlow);
  box.innerHTML = flows.length
    ? flows.map((w) => `<label><input type="checkbox" value="${esc(w.id)}" ${checked.has(w.id) ? 'checked' : ''}/> ${esc(w.name.replace(/^Calentar:\s*/, ''))}</label>`).join('')
    : '<span class="muted small">Primero pulsa "Crear flujos de calentamiento"</span>';
  box.querySelectorAll('input').forEach((i) => (i.onchange = estimate));
}

/** Cuánto tardará, para que no haya sorpresas. */
function estimate() {
  const nets = $('#wmFlowList').querySelectorAll('input:checked').length;
  const videos = Number($('#wmVideos').value) || 0;
  const avg = ((Number($('#wmSecMin').value) || 0) + Math.max(Number($('#wmSecMin').value) || 0, Number($('#wmSecMax').value) || 0)) / 2;
  const rounds = Number($('#wmRounds').value) || 1;
  const min = Math.round((nets * rounds * (videos * (avg + 2) + 30)) / 60);
  $('#wmEstimate').textContent = nets && videos
    ? `Unos ${min} min por teléfono (todos a la vez). Déjalo vacío para empezar ya.` : 'Déjalo vacío para empezar ya.';
}

function renderJobs() {
  const list = state.warmups || [];
  $('#navWarmCount').textContent = list.filter((j) => ['calentando', 'programado'].includes(j.status)).length || '';
  if (state.view !== 'warm') return;
  const box = $('#wmList');
  if (!list.length) { box.innerHTML = '<p class="muted">Aún no hay calentamientos. Elige redes, temas y teléfonos, y pulsa Empezar.</p>'; return; }
  box.innerHTML = '';
  for (const j of list) {
    const [cls, label] = STATUS[j.status] || ['', j.status];
    const when = j.status === 'programado' ? `para el ${new Date(j.at).toLocaleString('es-ES')}` : new Date(j.startedAt || j.createdAt).toLocaleString('es-ES');
    const round = Math.min(j.round + 1, j.rounds);
    const head = j.platforms.map((p) => `<td><b>${esc(p.name.replace(/^Calentar:\s*/, ''))}</b></td>`).join('');
    const rows = j.items.map((it) => {
      const r = Math.min(j.round, j.rounds - 1);
      const cells = j.platforms.map((_, k) => { const st = it.results[`${r}:${k}`] || '—'; return `<td><span class="chip ${ITEM[st] ?? ''}">${esc(st)}</span></td>`; }).join('');
      return `<tr><td>${esc(deviceName(it.serial))}</td><td class="desc">${esc(it.topics[r])}</td>${cells}</tr>`;
    }).join('');
    const el = h(`<div class="pb-post">
      <div class="top"><span class="title">${esc(j.name)}</span><span class="chip ${cls}">${label}</span></div>
      <div class="muted small">${when} · ronda ${round} de ${j.rounds} · ${j.videos} vídeos por red · ${j.secMin}-${j.secMax} s por vídeo${j.error ? ` · ${esc(j.error)}` : ''}</div>
      <table><tr><td></td><td class="desc">Tema</td>${head}</tr>${rows}</table>
      <div class="group">
        ${['calentando', 'programado', 'pendiente'].includes(j.status) ? `<button class="ghost sm danger" data-a="cancel">${icon('square', 14)}${j.status === 'programado' ? 'Cancelar' : 'Detener'}</button>`
          : `<button class="ghost sm" data-a="del">${icon('trash', 14)}Quitar</button>`}
      </div></div>`);
    el.querySelector('[data-a="cancel"]')?.addEventListener('click', () => call('warmCancel', j.id));
    el.querySelector('[data-a="del"]')?.addEventListener('click', () => call('warmRemove', j.id));
    box.appendChild(el);
  }
}

export function onWarmups(list) {
  state.warmups = list;
  renderJobs();
}

export const renderWarmPhones = () => phones?.render();

async function createFlows() {
  const tpls = TEMPLATES.filter((t) => t.warm);
  const have = new Set(state.workflows.map((w) => w.name));
  const missing = tpls.filter((t) => !have.has(t.name));
  if (!missing.length) {
    const ok = await modal({ title: 'Flujos de calentamiento', html: '<p>Ya tienes los cuatro flujos. ¿Quieres volver a crearlos? Se añaden como copias nuevas; tus cambios en los actuales se conservan.</p>', okText: 'Crear de nuevo' });
    if (!ok) return;
  }
  for (const t of missing.length ? missing : tpls) {
    const wf = await call('saveWorkflow', { id: null, name: have.has(t.name) ? `${t.name} (nuevo)` : t.name, description: t.description, graph: t.build() });
    state.workflows.push(wf);
  }
  renderFlows();
  toast('Flujos creados. Puedes ajustarlos en Automatización (los XPath están en variables al principio).');
}

export function initWarm() {
  phones = phonePicker({ box: '#wmDevices', group: '#wmGroup', all: '#wmAll', count: '#wmDevCount' });
  window.addEventListener('view', (e) => { if (e.detail === 'warm') { renderFlows(); phones.render(); renderJobs(); estimate(); } });
  $('#wmFlows').onclick = () => createFlows().catch((e) => toast(errText(e), 'error'));
  for (const id of ['#wmVideos', '#wmSecMin', '#wmSecMax', '#wmRounds']) $(id).oninput = estimate;
  $('#wmStart').onclick = async () => {
    const at = $('#wmAt').value ? new Date($('#wmAt').value).getTime() : null;
    if (at && at < Date.now() - 60000) return toast('Esa hora ya ha pasado', 'warn');
    const opts = {
      workflowIds: [...$('#wmFlowList').querySelectorAll('input:checked')].map((i) => i.value),
      serials: phones.selected(), topics: $('#wmTopics').value.split('\n'), topicMode: $('#wmMode').value,
      videos: Number($('#wmVideos').value), rounds: Number($('#wmRounds').value),
      secMin: Number($('#wmSecMin').value), secMax: Number($('#wmSecMax').value), at,
    };
    try {
      const j = await call('warmCreate', opts);
      toast(j.status === 'programado' ? `Calentamiento programado para el ${new Date(j.at).toLocaleString('es-ES')}` : `Calentando ${j.items.length} teléfono(s)`);
      $('#wmAt').value = '';
    } catch (e) { toast(errText(e), 'error'); }
  };
  renderJobs();
}
