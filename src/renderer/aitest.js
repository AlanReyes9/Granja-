// Pruebas de apps con IA: formulario, lista de pruebas en vivo e informe de cada una.
import { state, api, $, esc, h, call, toast, modal, deviceName, icon } from './core.js';

const runs = new Map(); // id -> informe (en curso o terminado)
const lastLog = new Map(); // id -> último mensaje
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');

async function refreshKey() {
  const st = await call('aiKeyStatus');
  $('#aiKeyState').textContent = st.configured ? (st.fromEnv ? 'Clave de ANTHROPIC_API_KEY' : 'Clave configurada') : 'Falta la clave de la API';
  $('#aiKeyState').classList.toggle('error-text', !st.configured);
  return st;
}

function renderDevicesPick() {
  const box = $('#aiDevices');
  const ready = state.devices.filter((d) => d.state === 'device');
  const checked = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
  if (!checked.size) for (const s of state.selected) checked.add(s);
  box.innerHTML = ready.length ? ready.map((d) => `<label><input type="checkbox" value="${esc(d.serial)}" ${checked.has(d.serial) ? 'checked' : ''}/> ${esc(deviceName(d.serial))}</label>`).join('')
    : '<span class="muted small">No hay teléfonos conectados</span>';
  box.querySelectorAll('input').forEach((i) => (i.onchange = loadPackages));
}

let pkgFor = '';
async function loadPackages() {
  const first = $('#aiDevices input:checked')?.value;
  if (!first || first === pkgFor) return;
  pkgFor = first;
  try {
    const pkgs = await call('listPackages', first);
    $('#aiPkgList').innerHTML = pkgs.map((p) => `<option value="${esc(p)}"></option>`).join('');
  } catch {}
}

const statusBadge = (r) => r.status === 'ejecutando' ? '<span class="badge run">En curso</span>'
  : r.status === 'superada' ? '<span class="badge ok">Superada</span>' : `<span class="badge ko">${esc(r.status)}</span>`;

function renderRuns() {
  const list = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  const active = list.filter((r) => r.status === 'ejecutando').length;
  $('#navAiCount').textContent = active || '';
  const box = $('#aiRuns');
  if (!list.length) { box.innerHTML = '<p class="muted">Todavía no hay pruebas. Elige teléfono, app y objetivo, y pulsa Empezar prueba.</p>'; return; }
  box.innerHTML = '';
  for (const r of list) {
    const last = r.steps.at(-1);
    const el = h(`<div class="ai-run">
      <img class="thumb" alt="" />
      <div><div class="title">${esc(r.pkg)} ${statusBadge(r)}</div>
        <div class="muted small">${esc(deviceName(r.serial))} · ${r.steps.length} pasos · ${r.bugs.length} fallo(s) · ${new Date(r.startedAt).toLocaleString('es-ES')}</div>
        <div class="small">${esc(r.goal.slice(0, 140))}</div>
        <div class="log">${esc(r.status === 'ejecutando' ? lastLog.get(r.id) || 'Empezando…' : r.summary.slice(0, 220))}</div></div>
      <div class="actions">
        <button class="soft sm" data-a="view">${icon('eye', 14)}Informe</button>
        ${r.status === 'ejecutando' ? `<button class="ghost sm danger" data-a="stop">${icon('square', 14)}Detener</button>`
          : `<button class="ghost sm" data-a="html">${icon('download', 14)}HTML</button><button class="ghost sm" data-a="del">${icon('x', 14)}Quitar</button>`}
      </div></div>`);
    if (last?.screenshot) call('aiTestShot', last.screenshot).then((src) => { if (src) el.querySelector('img').src = src; });
    el.querySelector('[data-a="view"]').onclick = () => openReport(r.id);
    el.querySelector('[data-a="stop"]')?.addEventListener('click', () => call('aiTestStop', r.id));
    el.querySelector('[data-a="html"]')?.addEventListener('click', async () => { const f = await call('aiTestExport', r.id); if (f) toast(`Informe guardado en ${f}`); });
    el.querySelector('[data-a="del"]')?.addEventListener('click', async () => { await call('aiTestDelete', r.id); runs.delete(r.id); renderRuns(); });
    box.appendChild(el);
  }
}

function openReport(id) {
  const r = runs.get(id);
  if (!r) return;
  const html = `<div class="ai-detail">
    <p>${statusBadge(r)} · ${esc(deviceName(r.serial))} · ${r.steps.length} pasos · tokens: ${r.usage?.input || 0} entrada / ${r.usage?.output || 0} salida</p>
    <p><b>Objetivo:</b> ${esc(r.goal)}</p>
    ${r.summary ? `<div class="section-title">Conclusión</div><p style="white-space:pre-wrap">${esc(r.summary)}</p>` : ''}
    <div class="section-title">Fallos (${r.bugs.length})</div>
    ${r.bugs.map((b) => `<div class="bug"><b>[${esc(b.severity)}] ${esc(b.title)}</b> (paso ${b.step})\nPasos: ${esc(b.steps)}\nEsperado: ${esc(b.expected)}\nObtenido: ${esc(b.actual)}</div>`).join('') || '<p class="muted">Ninguno.</p>'}
    <div class="section-title">Pasos</div>
    <div class="steps">${r.steps.map((s) => `<div class="step"><img data-shot="${esc(s.screenshot || '')}" alt="" /><b>${s.n}. ${esc(s.action)}</b><br>${esc(s.reason)}<br><span class="muted">${esc(s.outcome)}</span></div>`).join('')}</div>
  </div>`;
  modal({ title: `Prueba de ${r.pkg}`, html, okText: 'Cerrar', cancelText: '', wide: true, onMount: (el) => {
    el.querySelectorAll('img[data-shot]').forEach((img) => { if (img.dataset.shot) call('aiTestShot', img.dataset.shot).then((src) => { if (src) img.src = src; }); });
  } });
}

/** Eventos de las pruebas en curso (desde el proceso principal). */
export function onAiEvent({ id, kind, payload, report }) {
  const r = runs.get(id);
  if (kind === 'done' && report) runs.set(id, report);
  else if (r && kind === 'step') r.steps.push(payload);
  else if (r && kind === 'bug') { r.bugs.push(payload); toast(`Fallo encontrado: ${payload.title}`, 'warn'); }
  else if (kind === 'log') lastLog.set(id, payload.message);
  if (kind === 'done') toast(`Prueba de ${report.pkg} terminada: ${report.status}`, report.passed ? 'info' : 'warn');
  if (state.view === 'aitest' || kind === 'done') renderRuns();
}

export async function initAiTest() {
  for (const r of await call('aiTests').catch(() => [])) runs.set(r.id, r);
  renderRuns();
  refreshKey().catch(() => {});
  window.addEventListener('view', (e) => { if (e.detail === 'aitest') { renderDevicesPick(); loadPackages(); renderRuns(); } });
  $('#aiKeyBtn').onclick = async () => {
    const v = await modal({ title: 'Clave de la API de Claude', html: '<p class="muted small">Créala en console.anthropic.com → API Keys. Se guarda cifrada en este equipo. Déjala vacía para borrarla.</p>',
      fields: [{ key: 'k', label: 'Clave (sk-ant-…)', type: 'password' }], okText: 'Guardar' });
    if (!v) return;
    await call('aiSetKey', v.k);
    toast(v.k ? 'Clave guardada' : 'Clave borrada');
    refreshKey();
  };
  $('#aiStart').onclick = async () => {
    const serials = [...$('#aiDevices').querySelectorAll('input:checked')].map((i) => i.value);
    const opts = { serials, pkg: $('#aiPkg').value.trim(), goal: $('#aiGoal').value.trim(), maxSteps: Number($('#aiSteps').value), clearData: $('#aiClear').checked, effort: $('#aiEffort').value };
    try {
      const ids = await call('aiTestStart', opts);
      for (const r of await call('aiTests')) if (ids.includes(r.id)) runs.set(r.id, r);
      toast(`${ids.length} prueba(s) en marcha`);
      renderRuns();
    } catch (e) { toast(errText(e), 'error'); }
  };
}
