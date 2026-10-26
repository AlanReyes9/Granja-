// Punto de entrada de la interfaz: navegación, barra lateral y eventos del proceso principal.
import { state, api, $, $$, esc, toast, call, reloadState, switchView } from './core.js';
import { initDevices, renderDevices } from './devices.js';
import { initEditor, highlightRuns } from './editor.js';
import { initViews, renderRuns, appendLog, renderSchedules, renderTables, renderSettings, renderHistory } from './views.js';

export function renderSideStatus() {
  const ready = state.devices.filter((d) => d.state === 'device').length;
  const running = state.runs.filter((r) => r.status === 'running').length;
  $('#sideStatus').innerHTML = `
    <div><b>${ready}</b> / ${state.devices.length} dispositivos listos</div>
    <div><b>${running}</b> ejecuciones activas</div>
    <div>${state.adbVersion ? esc(state.adbVersion.replace('Android Debug Bridge ', 'ADB ')) : '<span class="err">ADB no encontrado</span>'}</div>
    ${state.settings.otgEnabled ? '<div>Motor OTG directo: <b>activo</b></div>' : ''}
    ${state.api?.running ? `<div>API: <b>${esc(state.api.address)}</b></div>` : ''}
    ${state.lastError ? `<div class="err">${esc(state.lastError)}</div>` : ''}
    <div class="muted">v${esc(state.version || '')}</div>`;
}

async function main() {
  await reloadState();
  $$('nav button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  window.addEventListener('view', (e) => { if (e.detail === 'runs') renderHistory(); });
  initDevices();
  initEditor();
  initViews();
  renderDevices();
  renderSideStatus();
  renderRuns();
  renderSchedules();
  renderTables();
  renderSettings();

  api.on(({ type, payload }) => {
    if (type === 'devices') {
      state.devices = payload;
      for (const s of [...state.selected]) if (!payload.some((d) => d.serial === s)) state.selected.delete(s);
      renderDevices();
      renderSideStatus();
    } else if (type === 'runs') {
      state.runs = payload;
      renderRuns();
      renderDevices(true);
      highlightRuns();
      renderSideStatus();
    } else if (type === 'log') appendLog(payload);
    else if (type === 'toast') toast(payload.message, payload.level);
    else if (type === 'health') { state.health = payload; renderDevices(true); }
    else if (type === 'progress') {
      const p = $('#progress');
      p.classList.toggle('hidden', payload.pct >= 100);
      p.querySelector('span').textContent = `${payload.label}… ${payload.pct}%`;
      p.querySelector('i').style.width = `${payload.pct}%`;
    }
  });

  // Estado de ADB/API se refresca periódicamente para la barra lateral.
  setInterval(async () => {
    const s = await api.call('getState').catch(() => null);
    if (!s) return;
    Object.assign(state, { adbVersion: s.adbVersion, lastError: s.lastError, api: s.api });
    renderSideStatus();
  }, 10000);

  if (!state.adbVersion) {
    toast('No se encontró ADB. Ve a Ajustes → "Descargar platform-tools" para instalarlo automáticamente.', 'warn', 12000);
  }
}

main();
