// Editor visual de automatizaciones por nodos (Drawflow).
import { NODE_TYPES, NODE_MAP, CATEGORIES, defaultParams } from '../shared/nodes.js';
import { state, $, esc, call, toast, modal, icon } from './core.js';
import { selectedSerials } from './devices.js';
import { TEMPLATES, buildGraph } from './templates.js';

let editor;
let current = null; // flujo abierto {id, name, graph}
let dirty = false;

const catColor = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.color]));
const catLabel = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

function nodeHtml(type, data) {
  const def = NODE_MAP[type];
  if (!def) return `<div class="node-body"><div class="nh">${esc(type)}</div></div>`;
  const fields = def.params.map((p) => {
    const v = data?.[p.key] ?? p.default;
    if (p.type === 'select') {
      return `<label>${esc(p.label)}<select data-key="${p.key}">${p.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    }
    if (p.type === 'checkbox') return `<label class="chk"><input type="checkbox" data-key="${p.key}" ${v ? 'checked' : ''}/> ${esc(p.label)}</label>`;
    return `<label>${esc(p.label)}<input data-key="${p.key}" type="${p.type === 'number' ? 'number' : 'text'}" value="${esc(v)}"/></label>`;
  }).join('');
  return `<div class="node-body" style="--c:${catColor[def.category]}">
    <div class="nh"><span class="nic">${icon(def.icon, 14)}</span>${esc(def.label)}<small>${esc(catLabel[def.category])}</small></div>
    ${fields || def.help ? `<div class="nf">${fields}${def.help ? `<div class="help">${esc(def.help)}</div>` : ''}</div>` : ''}
  </div>`;
}

/** Etiqueta las salidas (sí/no, repetir/terminado…) y aplica el color de categoría al nodo. */
function decorateNodes() {
  for (const [id, n] of Object.entries(editor.drawflow.drawflow.Home.data)) {
    const el = document.getElementById(`node-${id}`);
    const def = NODE_MAP[n.name];
    if (!el || !def) continue;
    el.style.setProperty('--c', catColor[def.category]);
    if (def.outputs.length > 1) {
      def.outputs.forEach((label, i) => el.querySelector(`.output.output_${i + 1}`)?.setAttribute('data-label', label));
    }
  }
}

// Prefijo para que el tipo de nodo no choque con clases CSS de la interfaz (log, stop, view...).
const nodeClass = (type) => `n-${type}`;

function addNode(type, x, y) {
  const def = NODE_MAP[type];
  const data = defaultParams(type);
  editor.addNode(type, def.inputs ?? 1, def.outputs.length, x, y, nodeClass(type), data, nodeHtml(type, data));
  decorateNodes();
}

function emptyGraph() {
  return buildGraph([{ type: 'start', x: 80, y: 200 }], []);
}

function loadGraph(graph) {
  const g = structuredClone(graph || emptyGraph());
  for (const n of Object.values(g.drawflow?.Home?.data || {})) {
    n.html = nodeHtml(n.name, n.data);
    n.class = nodeClass(n.name);
  }
  editor.clear();
  editor.import(g);
  decorateNodes();
  fitView();
  dirty = false;
}

function openWorkflow(wf) {
  current = wf ? structuredClone(wf) : { id: null, name: 'Nuevo flujo', graph: emptyGraph() };
  $('#wfName').value = current.name;
  loadGraph(current.graph);
  refreshWorkflowSelect();
}

export function refreshWorkflowSelect() {
  const sel = $('#wfSelect');
  sel.innerHTML = `${current && !current.id ? '<option value="">(sin guardar)</option>' : ''}${state.workflows.map((w) => `<option value="${w.id}" ${current?.id === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}`;
}

async function save() {
  current.name = $('#wfName').value.trim() || 'Sin nombre';
  current.graph = editor.export();
  const saved = await call('saveWorkflow', current);
  current = structuredClone(saved);
  const i = state.workflows.findIndex((w) => w.id === saved.id);
  if (i >= 0) state.workflows[i] = saved; else state.workflows.push(saved);
  dirty = false;
  refreshWorkflowSelect();
  toast(`Flujo "${saved.name}" guardado`);
  return saved;
}

async function confirmDiscard() {
  if (!dirty) return true;
  const v = await modal({ title: 'Hay cambios sin guardar', html: '<p>¿Descartar los cambios del flujo actual?</p>', okText: 'Descartar' });
  return !!v;
}

/** Encuadra todos los nodos en el lienzo (solo si la vista del editor está visible). */
function fitView() {
  const box = $('#drawflow');
  const nodes = Object.values(editor.drawflow.drawflow.Home.data);
  if (!nodes.length || !box.clientWidth) return;
  const els = nodes.map((n) => document.getElementById(`node-${n.id}`)).filter(Boolean);
  const minX = Math.min(...nodes.map((n) => n.pos_x));
  const minY = Math.min(...nodes.map((n) => n.pos_y));
  const maxX = Math.max(...els.map((el) => el.offsetLeft + el.offsetWidth));
  const maxY = Math.max(...els.map((el) => el.offsetTop + el.offsetHeight));
  const pad = 60;
  const zoom = Math.max(0.55, Math.min(1, (box.clientWidth - pad * 2) / (maxX - minX + 60), (box.clientHeight - pad * 2) / (maxY - minY)));
  // Drawflow escala desde el centro del lienzo (transform-origin 50% 50%), así que se compensa en el desplazamiento.
  const pc = editor.precanvas;
  const cx = pc.clientWidth / 2;
  const cy = pc.clientHeight / 2;
  const offY = Math.max(0, (box.clientHeight - pad * 2 - (maxY - minY) * zoom) / 2);
  editor.zoom = zoom;
  editor.zoom_last_value = zoom;
  editor.canvas_x = pad - minX * zoom - cx * (1 - zoom);
  editor.canvas_y = pad + offY - minY * zoom - cy * (1 - zoom);
  pc.style.transform = `translate(${editor.canvas_x}px, ${editor.canvas_y}px) scale(${zoom})`;
}

/** Resalta en el lienzo el nodo que se está ejecutando en algún dispositivo. */
export function highlightRuns() {
  if (!editor) return;
  document.querySelectorAll('.drawflow-node.active-run').forEach((n) => n.classList.remove('active-run'));
  if (!current?.id) return;
  for (const r of state.runs) {
    if (r.workflowId !== current.id || r.status !== 'running') continue;
    for (const d of Object.values(r.devices)) if (d.nodeId) document.getElementById(`node-${d.nodeId}`)?.classList.add('active-run');
  }
}

function buildPalette() {
  const pal = $('#palette');
  const q = ($('#palSearch')?.value || '').trim().toLowerCase();
  pal.innerHTML = CATEGORIES.map((c) => {
    const items = NODE_TYPES.filter((n) => n.category === c.id && (!q || n.label.toLowerCase().includes(q)));
    if (!items.length) return '';
    return `<h4>${esc(c.label)}</h4>${items.map((n) =>
      `<div class="item" draggable="true" data-type="${n.type}" style="--c:${c.color}" title="${esc(n.help || 'Arrastra al lienzo o haz doble clic')}"><span class="nic">${icon(n.icon, 14)}</span>${esc(n.label)}</div>`).join('')}`;
  }).join('') || '<p class="muted">Ningún nodo coincide</p>';
  pal.querySelectorAll('.item').forEach((it) => {
    it.addEventListener('dragstart', (e) => e.dataTransfer.setData('node', it.dataset.type));
    it.addEventListener('dblclick', () => {
      const r = editor.precanvas.getBoundingClientRect();
      addNode(it.dataset.type, (-r.x + 400) / editor.zoom, (-r.y + 250) / editor.zoom);
    });
  });
}

export function initEditor() {
  const container = $('#drawflow');
  editor = new window.Drawflow(container);
  editor.reroute = true;
  editor.reroute_fix_curvature = true;
  editor.start();
  buildPalette();
  $('#palSearch').oninput = buildPalette;

  container.addEventListener('dragover', (e) => e.preventDefault());
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('node');
    if (!type) return;
    const pc = editor.precanvas;
    const ratio = pc.clientWidth / (pc.clientWidth * editor.zoom);
    const x = e.clientX * ratio - pc.getBoundingClientRect().x * ratio;
    const y = e.clientY * ratio - pc.getBoundingClientRect().y * ratio;
    addNode(type, x, y);
  });

  // Los campos de cada nodo actualizan sus datos (incluidas casillas, que Drawflow no maneja).
  const onField = (e) => {
    const key = e.target.dataset?.key;
    const nodeEl = e.target.closest('.drawflow-node');
    if (!key || !nodeEl) return;
    const id = nodeEl.id.replace('node-', '');
    const node = editor.getNodeFromId(id);
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    editor.updateNodeDataFromId(id, { ...node.data, [key]: value });
    dirty = true;
  };
  container.addEventListener('input', onField);
  container.addEventListener('change', onField);
  for (const ev of ['nodeCreated', 'nodeRemoved', 'connectionCreated', 'connectionRemoved', 'nodeMoved']) editor.on(ev, () => { dirty = true; });
  editor.on('connectionCreated', decorateNodes);

  $('#wfSelect').onchange = async (e) => {
    if (!(await confirmDiscard())) return refreshWorkflowSelect();
    openWorkflow(state.workflows.find((w) => w.id === e.target.value));
  };
  $('#wfName').oninput = () => { dirty = true; };
  $('#wfNew').onclick = async () => { if (await confirmDiscard()) openWorkflow(null); };
  $('#wfSave').onclick = save;
  $('#wfDuplicate').onclick = async () => {
    current = { id: null, name: `${$('#wfName').value} (copia)`, graph: editor.export() };
    $('#wfName').value = current.name;
    await save();
  };
  $('#wfDelete').onclick = async () => {
    if (!current?.id) return openWorkflow(null);
    const v = await modal({ title: `¿Eliminar "${current.name}"?`, okText: 'Eliminar' });
    if (!v) return;
    await call('deleteWorkflow', current.id);
    state.workflows = state.workflows.filter((w) => w.id !== current.id);
    openWorkflow(state.workflows[0] || null);
  };
  $('#wfExport').onclick = async () => { const wf = await save(); if (await call('exportWorkflow', wf.id)) toast('Flujo exportado'); };
  $('#wfImport').onclick = async () => {
    const imported = await call('importWorkflow');
    if (!imported.length) return;
    state.workflows.push(...imported);
    openWorkflow(imported[0]);
    toast(`${imported.length} flujo(s) importado(s)`);
  };
  $('#wfTemplate').onclick = async () => {
    const v = await modal({ title: 'Plantillas', fields: [{ key: 'i', label: 'Plantilla', type: 'select', options: TEMPLATES.map((t, i) => [i, t.name]) }],
      html: TEMPLATES.map((t) => `<p><b>${esc(t.name)}.</b> ${esc(t.description)}</p>`).join(''), okText: 'Usar plantilla' });
    if (!v || !(await confirmDiscard())) return;
    const t = TEMPLATES[Number(v.i)];
    openWorkflow({ id: null, name: t.name, graph: t.build() });
    dirty = true;
  };
  $('#wfFit').onclick = fitView;
  $('#wfZoomIn').onclick = () => editor.zoom_in();
  $('#wfZoomOut').onclick = () => editor.zoom_out();
  $('#wfRun').onclick = async () => {
    const wf = dirty || !current.id ? await save() : current;
    const serials = selectedSerials({ fallbackAll: true });
    if (!serials.length) return toast('No hay dispositivos listos', 'warn');
    await call('runWorkflow', wf.id, serials);
    toast(`"${wf.name}" lanzado en ${serials.length} dispositivo(s)`);
    highlightRuns();
  };
  window.addEventListener('keydown', (e) => {
    if (state.view === 'editor' && e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  // Drawflow calcula las curvas con posiciones del DOM: si el grafo se cargó con la vista oculta, se recarga al mostrarla.
  window.addEventListener('view', (e) => {
    if (e.detail !== 'editor') return;
    requestAnimationFrame(() => {
      const wasDirty = dirty;
      loadGraph(editor.export());
      dirty = wasDirty;
      highlightRuns();
    });
  });

  openWorkflow(state.workflows[0] || { id: null, name: TEMPLATES[0].name, graph: TEMPLATES[0].build() });
}
