// Cuentas por plataforma: usuario, contraseña (cifrada en el proceso principal), teléfono y estado de la sesión.
import { state, $, $$, esc, call, toast, modal, deviceName, icon } from './core.js';
import { TEMPLATES } from './templates.js';

const PLATFORMS = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', google: 'Google (YouTube)' };
const STATUS = { 'sesión iniciada': 'ok', error: 'error', iniciando: 'warn', 'en cola': 'run', detenido: 'error' };
const selected = new Set();
let secure = null; // ¿el sistema puede cifrar las contraseñas? (en Windows, siempre)
const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');

function visible() {
  const p = $('#accPlatform').value;
  const q = $('#accFilter').value.trim().toLowerCase();
  return (state.accounts || []).filter((a) => (!p || a.platform === p)
    && (!q || a.user.toLowerCase().includes(q) || (a.serial && deviceName(a.serial).toLowerCase().includes(q))));
}

export function renderAccounts() {
  const all = state.accounts || [];
  for (const id of [...selected]) if (!all.some((a) => a.id === id)) selected.delete(id);
  $('#navAccCount').textContent = all.length || '';
  if (state.view !== 'accounts') return;
  const ok = all.filter((a) => a.status === 'sesión iniciada').length;
  const free = all.filter((a) => !a.serial).length;
  const where = secure === false
    ? 'Atención: este equipo no permite cifrar, así que las contraseñas se guardan sin cifrar.'
    : 'Las contraseñas se guardan cifradas en este equipo.';
  $('#accSummary').textContent = all.length
    ? `${all.length} cuentas · ${ok} con sesión iniciada · ${free} sin teléfono. ${where}`
    : `Añade tus cuentas de cada red social y asígnalas a los teléfonos. ${where}`;
  $('#accSummary').classList.toggle('error-text', secure === false);
  const list = visible();
  const phones = state.devices.filter((d) => d.state === 'device' || all.some((a) => a.serial === d.serial));
  const phoneOpts = (a) => `<option value="">Sin teléfono</option>${phones.map((d) => `<option value="${esc(d.serial)}" ${a.serial === d.serial ? 'selected' : ''}>${esc(deviceName(d.serial))}</option>`).join('')}
    ${a.serial && !phones.some((d) => d.serial === a.serial) ? `<option value="${esc(a.serial)}" selected>${esc(deviceName(a.serial))} (desconectado)</option>` : ''}`;
  $('#accTable').innerHTML = `<thead><tr><th class="c"><input type="checkbox" id="accAll" ${list.length && list.every((a) => selected.has(a.id)) ? 'checked' : ''}/></th>
    <th>Plataforma</th><th>Usuario</th><th>Contraseña</th><th>Teléfono</th><th>Estado</th><th>Última sesión</th></tr></thead><tbody>${list.length ? list.map((a) => `<tr data-id="${esc(a.id)}">
      <td class="c"><input type="checkbox" data-sel ${selected.has(a.id) ? 'checked' : ''}/></td>
      <td>${esc(PLATFORMS[a.platform] || a.platform)}</td>
      <td class="mono">${esc(a.user)}</td>
      <td><span class="muted">${a.hasPass ? '••••••••' : 'sin contraseña'}</span> <button class="ghost sm" data-a="pass" title="Cambiar contraseña">${icon('key', 13)}</button></td>
      <td><select data-a="phone">${phoneOpts(a)}</select></td>
      <td><span class="chip ${STATUS[a.status] || ''}" title="${esc(a.message || '')}">${esc(a.status)}</span>${a.message ? `<div class="muted small">${esc(a.message)}</div>` : ''}</td>
      <td class="muted small">${a.lastLogin ? new Date(a.lastLogin).toLocaleString('es-ES') : '—'}</td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="7">${all.length ? 'Ninguna cuenta coincide con el filtro' : 'Todavía no hay cuentas: pulsa "Añadir cuentas"'}</td></tr>`}</tbody>`;
  $('#accAll')?.addEventListener('change', (e) => { for (const a of list) e.target.checked ? selected.add(a.id) : selected.delete(a.id); renderAccounts(); });
  $$('#accTable tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-sel]').onchange = (e) => { e.target.checked ? selected.add(id) : selected.delete(id); };
    tr.querySelector('[data-a="phone"]').onchange = (e) => call('accUpdate', id, { serial: e.target.value || null }).catch((err) => toast(errText(err), 'error'));
    tr.querySelector('[data-a="pass"]').onclick = async () => {
      const v = await modal({ title: 'Cambiar contraseña', fields: [{ key: 'p', label: 'Nueva contraseña', type: 'password' }], okText: 'Guardar' });
      if (v?.p) { await call('accUpdate', id, { pass: v.p }); toast('Contraseña guardada'); }
    };
  });
}

export function onAccounts(list) {
  state.accounts = list;
  renderAccounts();
}

async function importDialog() {
  const v = await modal({
    title: 'Añadir cuentas',
    html: '<p class="muted small">Una por línea: <code>usuario:contraseña</code> (también vale <code>;</code>, <code>,</code> o tabulador). Si el usuario ya existe, se actualiza su contraseña. Para Google pon el correo de la cuenta de YouTube.</p>',
    fields: [
      { key: 'platform', label: 'Plataforma', type: 'select', value: $('#accPlatform').value || 'tiktok', options: Object.entries(PLATFORMS) },
      { key: 'text', label: 'Cuentas', type: 'textarea', placeholder: 'usuario1:contraseña1\nusuario2:contraseña2' },
      { key: 'auto', label: 'Repartirlas entre los teléfonos conectados que no tengan cuenta de esa plataforma', type: 'checkbox', value: true },
    ],
    okText: 'Añadir',
  });
  if (!v) return;
  try {
    const r = await call('accImport', v.text, v.platform);
    let msg = `${r.added} cuenta(s) añadidas${r.updated ? `, ${r.updated} actualizadas` : ''}`;
    if (v.auto) {
      const n = await call('accAutoAssign', state.devices.filter((d) => d.state === 'device').map((d) => d.serial), v.platform);
      msg += ` · ${n} asignadas a teléfonos`;
    }
    if (r.invalid.length) msg += ` · ${r.invalid.length} línea(s) no válidas`;
    toast(msg, r.invalid.length ? 'warn' : 'info');
  } catch (e) { toast(errText(e), 'error'); }
}

async function createFlows() {
  const tpls = TEMPLATES.filter((t) => t.login);
  const have = new Set(state.workflows.map((w) => w.name));
  const missing = tpls.filter((t) => !have.has(t.name));
  if (!missing.length) return toast('Ya tienes los flujos de inicio de sesión (puedes ajustarlos en Automatización)');
  for (const t of missing) state.workflows.push(await call('saveWorkflow', { id: null, name: t.name, description: t.description, graph: t.build() }));
  toast(`${missing.length} flujo(s) creados. Los XPath están en variables al principio de cada uno, por si hay que ajustarlos.`);
}

export function initAccounts() {
  const sel = $('#accPlatform');
  sel.innerHTML += Object.entries(PLATFORMS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.onchange = renderAccounts;
  $('#accFilter').oninput = renderAccounts;
  window.addEventListener('view', (e) => { if (e.detail === 'accounts') renderAccounts(); });
  call('accSecure').then((v) => { secure = v; renderAccounts(); }).catch(() => {});
  $('#accImport').onclick = importDialog;
  $('#accFlows').onclick = () => createFlows().catch((e) => toast(errText(e), 'error'));
  $('#accAuto').onclick = async () => {
    const serials = state.devices.filter((d) => d.state === 'device').map((d) => d.serial);
    if (!serials.length) return toast('No hay teléfonos conectados', 'warn');
    const n = await call('accAutoAssign', serials, sel.value || null);
    toast(n ? `${n} cuenta(s) asignadas` : 'No quedaban cuentas libres o todos los teléfonos ya tienen cuenta de esa plataforma');
  };
  $('#accLogin').onclick = async () => {
    const ids = selected.size ? [...selected] : visible().map((a) => a.id);
    if (!ids.length) return toast('No hay cuentas', 'warn');
    try {
      const r = await call('accLogin', ids);
      toast(`Iniciando sesión en ${r.queued} cuenta(s)${r.skipped ? ` · ${r.skipped} sin teléfono, saltadas` : ''}`);
    } catch (e) { toast(errText(e), 'error'); }
  };
  $('#accStop').onclick = () => call('accStop');
  $('#accDelete').onclick = async () => {
    if (!selected.size) return toast('Marca las cuentas que quieres eliminar', 'warn');
    const ok = await modal({ title: 'Eliminar cuentas', html: `<p>¿Eliminar ${selected.size} cuenta(s) de la app? No se borran de la red social.</p>`, okText: 'Eliminar' });
    if (ok) { await call('accRemove', [...selected]); selected.clear(); }
  };
  renderAccounts();
}
