// Punto de entrada de la interfaz: navegación, barra lateral y eventos del proceso principal.
import { state, api, $, $$, esc, toast, reloadState, switchView, hydrateIcons } from './core.js';
import { initDevices, renderDevices, onStreamState } from './devices.js';
import { initEditor, highlightRuns } from './editor.js';
import { initViews, renderRuns, appendLog, renderSchedules, renderTables, renderSettings, renderHistory } from './views.js';
import { initProxies, renderProxies } from './proxies.js';
import { openInspector } from './inspector.js';
import { icon } from './icons.js';
import { ensureLicensed, watchLicense } from './license.js';

export function renderSideStatus() {
  const ready = state.devices.filter((d) => d.state === 'device').length;
  const running = state.runs.filter((r) => r.status === 'running').length;
  const adb = state.adbVersion ? state.adbVersion.replace('Android Debug Bridge version', 'ADB') : null;
  $('#sideStatus').innerHTML = `
    <div class="big">${ready}<span style="font-size:13px;font-weight:500;opacity:.85"> / ${state.devices.length} listos</span></div>
    <div class="row"><span class="dot ${adb ? 'ok' : 'err'}"></span>${adb ? esc(adb) : 'ADB no encontrado'}</div>
    ${state.settings.otgEnabled ? '<div class="row"><span class="dot ok"></span>Motor USB directo activo</div>' : ''}
    ${state.api?.running ? `<div class="row"><span class="dot ok"></span>API ${esc(state.api.address)}</div>` : ''}
    ${state.lastError ? `<div class="row err"><span class="dot err"></span>${esc(state.lastError)}</div>` : ''}
    <div class="row" style="opacity:.75">Versión ${esc(state.version || '')}</div>`;
  $('#navDevCount').textContent = state.devices.length ? `${ready}/${state.devices.length}` : '';
  $('#navRunCount').textContent = running || '';
  $('#navProxyCount').textContent = state.proxies.length || '';
  $('#monitorCount').textContent = running || '';
}

/** Contrae o expande el menú lateral y recuerda la elección. */
function setSidebarCollapsed(on) {
  document.body.classList.toggle('side-collapsed', on);
  $('#sideToggle').title = on ? 'Expandir menú (Ctrl+B)' : 'Contraer menú (Ctrl+B)';
  try { localStorage.setItem('nexus.sidebarCollapsed', on ? '1' : '0'); } catch {}
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#btnTheme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  try { localStorage.setItem('granja.theme', theme); } catch {}
}

async function main() {
  hydrateIcons();
  let theme = 'light';
  try { theme = localStorage.getItem('granja.theme') || 'light'; } catch {}
  applyTheme(theme);
  $('#btnTheme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#btnMonitor').onclick = () => switchView('runs');
  // Con el menú contraído solo se ven los iconos: el nombre de cada sección queda como tooltip.
  $$('nav button').forEach((b) => { b.title = b.querySelector('span').textContent; });
  let sideCollapsed = false;
  try { sideCollapsed = localStorage.getItem('nexus.sidebarCollapsed') === '1'; } catch {}
  setSidebarCollapsed(sideCollapsed);
  $('#sideToggle').onclick = () => setSidebarCollapsed(!document.body.classList.contains('side-collapsed'));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'b') { e.preventDefault(); $('#sideToggle').click(); }
  });
  $('#btnInspector').onclick = () => openInspector();
  // Sin licencia válida no se carga nada más (el proceso principal también lo impide).
  watchLicense(await ensureLicensed());
  await reloadState();
  $$('nav button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  window.addEventListener('view', (e) => {
    if (e.detail === 'runs') renderHistory();
    if (e.detail === 'proxies') renderProxies();
  });
  initDevices();
  initEditor();
  initViews();
  initProxies();
  renderDevices();
  renderSideStatus();
  renderRuns();
  renderSchedules();
  renderTables();
  renderSettings();
  window.addEventListener('state', renderSideStatus);
  switchView('devices');

  api.on(({ type, payload }) => {
    if (type === 'devices') {
      state.devices = payload;
      for (const s of [...state.selected]) if (!payload.some((d) => d.serial === s)) state.selected.delete(s);
      renderDevices();
      renderSideStatus();
      if (state.view === 'proxies') renderProxies();
    } else if (type === 'runs') {
      state.runs = payload;
      renderRuns();
      renderDevices();
      highlightRuns();
      renderSideStatus();
    } else if (type === 'log') appendLog(payload);
    else if (type === 'streamState') onStreamState(payload);
    else if (type === 'toast') toast(payload.message, payload.level);
    else if (type === 'health') { state.health = payload; renderDevices(); }
    else if (type === 'progress') {
      const p = $('#progress');
      p.classList.toggle('hidden', payload.pct >= 100);
      p.querySelector('span').textContent = `${payload.label}: ${payload.pct}%`;
      p.querySelector('i').style.width = `${payload.pct}%`;
    }
  });

  // El estado de ADB y la API se refresca periódicamente para la barra lateral.
  setInterval(async () => {
    const s = await api.call('getState').catch(() => null);
    if (!s) return;
    Object.assign(state, { adbVersion: s.adbVersion, lastError: s.lastError, api: s.api });
    renderSideStatus();
  }, 10000);

  if (!state.adbVersion) {
    toast('No se encontró ADB. En Ajustes puedes descargar platform-tools automáticamente.', 'warn', 12000);
  }
}

main();
