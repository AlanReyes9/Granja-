// Pantalla de activación y datos de la licencia.
import { api, esc, h, icon, toast, state, modal } from './core.js';

const fmtDate = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

async function status() {
  return api.call('licenseStatus');
}

function errorText(e) {
  return String(e?.message || e).replace(/^Error invoking remote method 'call': (Error: )?/, '');
}

/** Muestra la pantalla de activación hasta que haya una licencia válida. */
function showActivation(st) {
  return new Promise((resolve) => {
    const el = h(`<div class="activation">
      <div class="act-card">
        <img src="assets/logo.svg" alt="Nexus Dev" width="56" height="56" />
        <h1>Activa Nexus Farmer</h1>
        <p class="muted">${esc(st.reason || 'Introduce tu serial o tu clave de licencia.')}</p>
        ${st.configured ? '' : '<p class="act-error">Esta copia de la app no tiene configurada la clave de licencias. Contacta con Nexus Dev.</p>'}
        <div class="machine">
          <span>ID de este equipo</span>
          <div><code id="actMachine">${esc(st.machineId)}</code><button class="ghost sm" id="actCopy">${icon('copy', 14)}Copiar</button></div>
        </div>
        <div class="filter-tabs" id="actTabs">
          <button data-t="online" class="${st.onlineAvailable ? 'active' : ''}" ${st.onlineAvailable ? '' : 'disabled'}>Con serial</button>
          <button data-t="offline" class="${st.onlineAvailable ? '' : 'active'}">Sin conexión</button>
        </div>
        <div class="act-pane" data-t="online">
          <label>Serial<input id="actSerial" class="mono" placeholder="NXF-XXXXX-XXXXX-XXXXX-XXXXX" value="${esc(st.serial && st.serial.startsWith('NXF-') ? st.serial : '')}" spellcheck="false" /></label>
          <p class="muted small">El serial queda vinculado a este equipo al activarlo. Necesitas conexión a internet.</p>
        </div>
        <div class="act-pane hidden" data-t="offline">
          <label>Clave de licencia<textarea id="actKey" class="mono" rows="4" placeholder="NXF1.…" spellcheck="false"></textarea></label>
          <p class="muted small">Envía el ID de este equipo a Nexus Dev y pega aquí la clave que te devuelvan. Solo funciona en este equipo.</p>
        </div>
        <p class="act-error hidden" id="actError"></p>
        <button class="primary act-go" id="actGo">${icon('check', 16)}Activar</button>
      </div>
    </div>`);
    document.body.appendChild(el);
    let tab = st.onlineAvailable ? 'online' : 'offline';
    const setTab = (t) => {
      tab = t;
      el.querySelectorAll('#actTabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      el.querySelectorAll('.act-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.t !== t));
    };
    setTab(tab);
    el.querySelectorAll('#actTabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
    el.querySelector('#actCopy').onclick = () => { navigator.clipboard.writeText(st.machineId); toast('ID de equipo copiado'); };
    const go = el.querySelector('#actGo');
    const err = el.querySelector('#actError');
    go.onclick = async () => {
      err.classList.add('hidden');
      go.disabled = true;
      go.lastChild.textContent = 'Activando…';
      try {
        const res = tab === 'online'
          ? await api.call('licenseActivateOnline', el.querySelector('#actSerial').value)
          : await api.call('licenseActivateOffline', el.querySelector('#actKey').value);
        if (!res.active) throw new Error(res.reason);
        el.remove();
        resolve(res);
      } catch (e) {
        err.textContent = errorText(e);
        err.classList.remove('hidden');
      } finally {
        go.disabled = false;
        go.lastChild.textContent = 'Activar';
      }
    };
    el.querySelector(st.onlineAvailable ? '#actSerial' : '#actKey').focus();
  });
}

/** Espera a que la app esté activada (muestra la pantalla de activación si hace falta). */
export async function ensureLicensed() {
  const st = await status();
  if (st.active) return st;
  return showActivation(st);
}

/** Avisos y reacción a cambios de licencia mientras la app está abierta. */
export function watchLicense(st) {
  state.license = st;
  if (st.daysLeft != null && st.daysLeft <= 7) {
    toast(`Tu licencia caduca en ${st.daysLeft} día${st.daysLeft === 1 ? '' : 's'} (${fmtDate(st.expires)}). Renuévala para no perder el acceso.`, 'warn', 12000);
  }
  api.on(({ type, payload }) => {
    if (type !== 'license') return;
    state.license = payload;
    // Licencia revocada, caducada o liberada: se vuelve a la pantalla de activación.
    if (!payload.active) location.reload();
  });
}

/** Bloque "Licencia" de Ajustes. */
export function licenseFieldset() {
  const st = state.license || {};
  const exp = st.expires == null ? 'Permanente' : `${fmtDate(st.expires)} (${st.daysLeft} día${st.daysLeft === 1 ? '' : 's'})`;
  const el = h(`<fieldset><legend>Licencia</legend><div class="kv">
      <span>Estado</span><span>${st.active ? '<span class="chip ok">Activa</span>' : '<span class="chip error">Inactiva</span>'}</span>
      <span>Tipo</span><span>${st.mode === 'online' ? 'Serial en línea' : 'Clave sin conexión'}</span>
      <span>Serial</span><span class="mono">${esc(st.serial || '-')}</span>
      <span>Cliente</span><span>${esc(st.client || '-')}</span>
      <span>Plan</span><span>${esc(st.plan || '-')}</span>
      <span>Caduca</span><span>${esc(exp)}</span>
      ${st.mode === 'online' ? `<span>Última comprobación</span><span>${st.lastCheck ? new Date(st.lastCheck).toLocaleString('es-ES') : '-'}</span>` : ''}
      <span>ID de equipo</span><span class="mono">${esc(st.machineId || '')}</span>
    </div>
    <div class="inline">
      ${st.mode === 'online' ? `<button id="licCheck">${icon('refresh', 15)}Comprobar ahora</button>` : ''}
      <button id="licChange" class="ghost danger">${icon('x', 15)}Cambiar licencia</button>
    </div></fieldset>`);
  el.querySelector('#licCheck')?.addEventListener('click', async () => {
    const r = await api.call('licenseRevalidate');
    state.license = r;
    toast(r.active ? 'Licencia comprobada con el servidor' : r.reason, r.active ? 'info' : 'error');
    el.replaceWith(licenseFieldset());
  });
  el.querySelector('#licChange').onclick = async () => {
    const ok = await modal({ title: 'Cambiar licencia', html: '<p>Se quitará la licencia de este equipo y tendrás que introducir otra. Si es un serial en línea, seguirá vinculado a este equipo y podrás volver a activarlo aquí.</p>', okText: 'Quitar licencia' });
    if (!ok) return;
    await api.call('licenseDeactivate');
    location.reload();
  };
  return el;
}

