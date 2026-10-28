// Vista de proxys: lista, pruebas y asignación de un proxy por teléfono.
import { state, $, $$, esc, call, toast, modal, showResults, deviceName, icon, reloadState } from './core.js';
import { selectedSerials, renderDevices } from './devices.js';

const pxSelected = new Set();
const devSelected = new Set();

function assignments() {
  return Object.fromEntries(Object.entries(state.deviceMeta).filter(([, m]) => m.proxy).map(([s, m]) => [s, m.proxy]));
}

function statusChip(p) {
  if (p.status === 'ok') return `<span class="chip ok">${p.latency} ms</span>`;
  if (p.status === 'auth') return `<span class="chip error" title="${esc(p.message || '')}">Usuario o clave incorrectos</span>`;
  if (p.status === 'error') return `<span class="chip error" title="${esc(p.message || '')}">Sin respuesta</span>`;
  return '<span class="chip">Sin probar</span>';
}

export function renderProxies() {
  const asg = assignments();
  const usedBy = {};
  for (const [s, k] of Object.entries(asg)) (usedBy[k] ||= []).push(s);
  const q = $('#pxFilter').value.trim().toLowerCase();
  const list = state.proxies.filter((p) => !q || p.key.includes(q) || (usedBy[p.key] || []).some((s) => deviceName(s).toLowerCase().includes(q)));
  for (const k of [...pxSelected]) if (!state.proxies.some((p) => p.key === k)) pxSelected.delete(k);

  const ok = state.proxies.filter((p) => p.status === 'ok').length;
  const bad = state.proxies.filter((p) => p.status === 'error' || p.status === 'auth').length;
  const assignedDevices = state.devices.filter((d) => asg[d.serial]).length;
  $('#proxySummary').textContent = state.proxies.length
    ? `${state.proxies.length} proxys · ${ok} responden · ${bad} sin respuesta · ${assignedDevices} de ${state.devices.length} dispositivos con proxy`
    : 'Pega tu lista de proxys para repartirlos entre los teléfonos';

  $('#pxTable').innerHTML = `<thead><tr><th class="c"><input type="checkbox" id="pxAll" ${list.length && list.every((p) => pxSelected.has(p.key)) ? 'checked' : ''}/></th>
    <th>Proxy</th><th>Tipo</th><th>Auth</th><th>Estado</th><th>Asignado a</th></tr></thead><tbody>${list.length ? list.map((p) => `<tr>
      <td class="c"><input type="checkbox" data-px="${esc(p.key)}" ${pxSelected.has(p.key) ? 'checked' : ''}/></td>
      <td class="mono">${esc(p.key)}</td><td>${esc(p.scheme.toUpperCase())}</td>
      <td>${p.user ? `<span class="chip" title="Usuario: ${esc(p.user)}. El teléfono navega a través de la app, que añade el usuario y la clave: mantén la app abierta">Con clave</span>` : '<span class="muted">-</span>'}</td>
      <td>${statusChip(p)}</td>
      <td>${(usedBy[p.key] || []).map((s) => esc(deviceName(s))).join(', ') || '<span class="muted">Libre</span>'}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="6">No hay proxys guardados</td></tr>'}</tbody>`;
  $('#pxAll').onchange = (e) => { list.forEach((p) => (e.target.checked ? pxSelected.add(p.key) : pxSelected.delete(p.key))); renderProxies(); };
  $$('#pxTable [data-px]').forEach((c) => (c.onchange = () => { c.checked ? pxSelected.add(c.dataset.px) : pxSelected.delete(c.dataset.px); }));

  const devs = [...state.devices].sort((a, b) => deviceName(a.serial).localeCompare(deviceName(b.serial), undefined, { numeric: true }));
  const opts = (cur) => `<option value="">Sin proxy</option>${state.proxies.map((p) => `<option value="${esc(p.key)}" ${p.key === cur ? 'selected' : ''}>${esc(p.key)}${usedBy[p.key]?.length && p.key !== cur ? ` (en uso: ${usedBy[p.key].length})` : ''}</option>`).join('')}`;
  $('#pxDevTable').innerHTML = `<thead><tr><th class="c"><input type="checkbox" id="pxDevAll" ${devs.length && devs.every((d) => devSelected.has(d.serial)) ? 'checked' : ''}/></th>
    <th>Dispositivo</th><th>Grupo</th><th>Conexión</th><th>Proxy asignado</th><th></th></tr></thead><tbody>${devs.length ? devs.map((d) => {
      const m = state.deviceMeta[d.serial] || {};
      return `<tr><td class="c"><input type="checkbox" data-dev="${esc(d.serial)}" ${devSelected.has(d.serial) ? 'checked' : ''}/></td>
        <td><b>${esc(deviceName(d.serial))}</b><div class="muted mono" style="font-size:11px">${esc(d.serial)}</div></td>
        <td>${esc(m.group || '-')}</td><td><span class="chip ${d.transport}">${d.transport === 'wifi' ? 'Wi-Fi' : d.transport.toUpperCase()}</span></td>
        <td><select data-assign="${esc(d.serial)}">${opts(m.proxy)}</select></td>
        <td><button class="sm" data-apply="${esc(d.serial)}" ${d.state !== 'device' ? 'disabled' : ''}>${icon('check', 13)}Aplicar</button></td></tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="6">No hay dispositivos conectados</td></tr>'}</tbody>`;
  $('#pxDevAll').onchange = (e) => { devs.forEach((d) => (e.target.checked ? devSelected.add(d.serial) : devSelected.delete(d.serial))); renderProxies(); };
  $$('#pxDevTable [data-dev]').forEach((c) => (c.onchange = () => { c.checked ? devSelected.add(c.dataset.dev) : devSelected.delete(c.dataset.dev); }));
  $$('#pxDevTable [data-assign]').forEach((sel) => (sel.onchange = async () => {
    state.deviceMeta = await call('proxySetOne', sel.dataset.assign, sel.value, false);
    renderProxies();
    renderDevices();
  }));
  $$('#pxDevTable [data-apply]').forEach((b) => (b.onclick = async () => {
    const [r] = await call('proxiesApply', [b.dataset.apply]);
    toast(r.ok ? `${deviceName(r.serial)}: ${r.out}` : r.out, r.ok ? 'info' : 'error');
  }));
  window.dispatchEvent(new Event('state'));
}

/** Diálogo para repartir proxys entre un conjunto de teléfonos. */
export async function openAssignModal(serials) {
  if (!state.proxies.length) return toast('No hay proxys en la lista', 'warn');
  const ready = state.devices.filter((d) => d.state === 'device').map((d) => d.serial);
  const v = await modal({
    title: 'Asignar proxys a dispositivos',
    html: `<p>Se asigna un proxy distinto a cada teléfono mientras queden proxys libres. Si hay más teléfonos que proxys, se reparten en ciclo.</p>`,
    fields: [
      { key: 'target', label: 'Dispositivos', type: 'select', value: serials.length && serials.length < ready.length ? 'sel' : 'all',
        options: [['sel', `Seleccionados (${serials.length})`], ['all', `Todos los conectados (${ready.length})`]] },
      { key: 'strategy', label: 'Orden', type: 'select', options: [['sequential', 'En orden de la lista'], ['random', 'Aleatorio']] },
      { key: 'onlyHealthy', label: 'Saltar proxys que no respondieron en la última prueba', type: 'checkbox', value: true },
      { key: 'apply', label: 'Aplicar ahora en los teléfonos', type: 'checkbox', value: true },
    ],
    okText: 'Asignar',
  });
  if (!v) return;
  const targets = v.target === 'sel' ? serials : ready;
  if (!targets.length) return toast('No hay dispositivos para asignar', 'warn');
  const result = await call('proxiesAssign', targets, { strategy: v.strategy, onlyHealthy: v.onlyHealthy, apply: v.apply });
  await reloadState();
  renderProxies();
  renderDevices();
  showResults('Proxys asignados', Object.entries(result).map(([serial, out]) => ({ serial, ok: true, out })));
}

export function initProxies() {
  $('#pxInput').value = state.proxies.map((p) => (p.user ? `${p.host}:${p.port}:${p.user}:${p.pass}` : p.key)).join('\n');
  const save = async (append) => {
    const res = await call('proxiesSet', $('#pxInput').value, append);
    state.proxies = res.proxies;
    $('#pxInput').value = state.proxies.map((p) => (p.user ? `${p.host}:${p.port}:${p.user}:${p.pass}` : p.key)).join('\n');
    renderProxies();
    const bad = res.invalid.length;
    toast(`${state.proxies.length} proxys en la lista${bad ? `. Se ignoró ${bad === 1 ? '1 línea no válida' : `${bad} líneas no válidas`}: ${res.invalid.slice(0, 3).join(', ')}` : ''}`, bad ? 'warn' : 'info');
  };
  $('#pxReplace').onclick = () => save(false);
  $('#pxAppend').onclick = () => save(true);
  $('#pxFilter').oninput = renderProxies;
  $('#pxTest').onclick = async () => {
    if (!state.proxies.length) return toast('No hay proxys que probar', 'warn');
    state.proxies = await call('proxiesTest', pxSelected.size ? [...pxSelected] : null);
    renderProxies();
    toast('Prueba de conexión terminada');
  };
  $('#pxDelete').onclick = async () => {
    if (!pxSelected.size) return toast('Marca los proxys que quieres eliminar', 'warn');
    const v = await modal({ title: `Eliminar ${pxSelected.size} proxys`, html: '<p>También se quitará la asignación de los teléfonos que los usan.</p>', okText: 'Eliminar' });
    if (!v) return;
    state.proxies = await call('proxiesRemove', [...pxSelected]);
    pxSelected.clear();
    await reloadState();
    $('#pxInput').value = state.proxies.map((p) => (p.user ? `${p.host}:${p.port}:${p.user}:${p.pass}` : p.key)).join('\n');
    renderProxies();
    renderDevices();
  };
  $('#pxAssign').onclick = () => openAssignModal(devSelected.size ? [...devSelected] : selectedSerials());
  $('#pxApplyAll').onclick = async () => {
    const serials = state.devices.filter((d) => d.state === 'device' && state.deviceMeta[d.serial]?.proxy).map((d) => d.serial);
    if (!serials.length) return toast('Ningún dispositivo conectado tiene proxy asignado', 'warn');
    showResults('Aplicar proxys', await call('proxiesApply', serials));
  };
  $('#pxUnassign').onclick = async () => {
    if (!devSelected.size) return toast('Marca los dispositivos en la tabla de asignación', 'warn');
    const v = await modal({ title: `Quitar asignación a ${devSelected.size} dispositivos`,
      fields: [{ key: 'clear', label: 'Quitar también el proxy activo en el teléfono', type: 'checkbox', value: true }], okText: 'Quitar' });
    if (!v) return;
    state.deviceMeta = await call('proxiesUnassign', [...devSelected], v.clear);
    renderProxies();
    renderDevices();
  };
  renderProxies();
}
