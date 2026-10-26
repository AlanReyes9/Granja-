// Estado global y utilidades compartidas de la interfaz (modales, avisos, llamadas al proceso principal).
import { icon, hydrateIcons } from './icons.js';

export { icon, hydrateIcons };
export const api = window.granja;
export const state = {
  devices: [], settings: {}, workflows: [], schedules: [], deviceMeta: {}, tables: [], runs: [], health: {}, proxies: [],
  selected: new Set(),
  view: 'devices',
  groupFilter: null, // null = todos; nombre de grupo o marcador de "sin grupo"
  trFilter: null, // null | 'usb' | 'wifi' | 'otg'
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message, level = 'info', ms = 4500) {
  const ic = { info: 'check', warn: 'alert', error: 'x-circle' }[level] || 'info';
  const el = h(`<div class="toast ${level}">${icon(ic)}<span>${esc(message)}</span></div>`);
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export async function call(method, ...args) {
  try {
    return await api.call(method, ...args);
  } catch (e) {
    const msg = String(e.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');
    toast(msg, 'error', 7000);
    throw e;
  }
}

/** Modal genérico. html va antes de los campos y after, después. fields: [{key,label,type,value,options,placeholder}] -> Promise<valores|null> */
export function modal({ title, fields = [], html = '', after = '', okText = 'Aceptar', wide = false, cancelText = 'Cancelar', onMount }) {
  return new Promise((resolve) => {
    const body = fields.map((f) => {
      const v = f.value ?? '';
      if (f.type === 'textarea') return `<label>${esc(f.label)}<textarea data-k="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea></label>`;
      if (f.type === 'select') return `<label>${esc(f.label)}<select data-k="${f.key}">${f.options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select></label>`;
      if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" data-k="${f.key}" ${v ? 'checked' : ''}/> ${esc(f.label)}</label>`;
      return `<label>${esc(f.label)}<input data-k="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"/></label>`;
    }).join('');
    const el = h(`<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}">
      <header><h3>${esc(title)}</h3><button class="ghost icon-only x" title="Cerrar">${icon('x')}</button></header>
      <div class="body">${html}${body}${after}</div>
      <footer>${cancelText ? `<button class="ghost cancel">${esc(cancelText)}</button>` : ''}${okText ? `<button class="primary ok">${esc(okText)}</button>` : ''}</footer>
    </div></div>`);
    const close = (val) => { el.remove(); resolve(val); };
    el.querySelector('.x').onclick = () => close(null);
    el.querySelector('.cancel')?.addEventListener('click', () => close(null));
    el.querySelector('.ok')?.addEventListener('click', () => {
      const out = {};
      $$('[data-k]', el).forEach((i) => { out[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value; });
      close(out);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') el.querySelector('.ok')?.click();
    });
    hydrateIcons(el);
    $('#modalRoot').appendChild(el);
    el.querySelector('.body input:not([type=checkbox]),.body textarea,.body select')?.focus();
    onMount?.(el, close);
  });
}

export function showResults(title, results) {
  const html = `<div class="results">${results.map((r) => `<div class="${r.ok ? '' : 'fail'}"><b>${esc(deviceName(r.serial))}</b> · ${r.ok ? 'correcto' : 'error'}\n${esc(r.out || '')}</div>`).join('')}</div>`;
  const ok = results.filter((r) => r.ok).length;
  return modal({ title: `${title}: ${ok} de ${results.length} correctos`, html, okText: 'Cerrar', cancelText: '', wide: true });
}

export function deviceName(serial) {
  return state.deviceMeta[serial]?.name || state.devices.find((d) => d.serial === serial)?.model || serial;
}

export async function reloadState() {
  const s = await call('getState');
  Object.assign(state, s);
  return s;
}

export function switchView(name) {
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  state.view = name;
  const sec = $(`#view-${name}`);
  $('#pageTitle').textContent = sec?.dataset.title || '';
  $('#pageSub').textContent = name === 'devices' ? state.devicesSub || '' : '';
  window.dispatchEvent(new CustomEvent('view', { detail: name }));
}

