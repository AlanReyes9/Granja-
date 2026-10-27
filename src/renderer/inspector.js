// Inspector: muestra los elementos de la pantalla de un teléfono (texto, resource-id, XPath, posición)
// para saber qué poner en los nodos "Tocar texto", "Tocar por resource-id", "Tocar por XPath" o "Tocar".
import { state, $, $$, esc, h, call, toast, modal, deviceName, icon } from './core.js';
import { selectedSerials } from './devices.js';
import { addNodeToCurrent } from './editor.js';
import { queryXpath } from '../main/automation/xpath.js';

export async function openInspector(serial) {
  const ready = state.devices.filter((d) => d.state === 'device');
  if (!ready.length) return toast('No hay dispositivos listos para inspeccionar', 'warn');
  serial = serial || selectedSerials()[0] || ready[0].serial;
  const html = `<div class="inline-row"><select id="insDevice">${ready.map((d) => `<option value="${esc(d.serial)}" ${d.serial === serial ? 'selected' : ''}>${esc(deviceName(d.serial))}</option>`).join('')}</select>
      <button id="insRefresh" class="primary">${icon('refresh', 15)}Capturar</button>
      <button id="insXml" title="Guarda los elementos de esta pantalla en un archivo .xml">${icon('download', 15)}Guardar XML</button></div>
    <div class="inspector">
      <div class="screen"><img alt="" /><div class="msg">Capturando…</div><div class="layer"></div></div>
      <div class="props">
        <div class="search sm"><i data-icon="search" data-size="14"></i><input id="insFilter" placeholder="Filtrar elementos" style="width:100%" /></div>
        <div class="el-list" id="insList"></div>
        <div class="section-title">Elemento seleccionado</div>
        <div class="kv" id="insProps"><span>-</span><span class="muted">Haz clic en un recuadro de la pantalla o en la lista</span></div>
        <div class="btn-grid" id="insActions"></div>
        <div class="section-title">Probar XPath</div>
        <div class="inline-row"><input id="insXpath" class="mono" placeholder='//android.widget.Button[@text="Aceptar"]' spellcheck="false" style="flex:1" />
          <button id="insXpathTest">${icon('search', 14)}Probar</button></div>
        <div class="muted small" id="insXpathResult"></div>
      </div>
    </div>`;
  modal({ title: 'Inspector de pantalla', html, okText: '', cancelText: 'Cerrar', wide: true, onMount: (el) => {
    let data = null;
    let selected = null;
    const screen = el.querySelector('.screen');
    const layer = el.querySelector('.layer');
    const fit = () => {
      // La capa de recuadros ocupa exactamente el área visible de la imagen (object-fit: contain).
      const img = screen.querySelector('img');
      const r = screen.getBoundingClientRect();
      const iw = img.naturalWidth || 9; const ih = img.naturalHeight || 19.5;
      const k = Math.min(r.width / iw, r.height / ih);
      Object.assign(layer.style, { width: `${iw * k}px`, height: `${ih * k}px`, left: `${(r.width - iw * k) / 2}px`, top: `${(r.height - ih * k) / 2}px` });
    };
    const label = (n) => n.text || n.desc || n.id.split('/').pop() || n.cls.split('.').pop();
    const select = (n) => {
      selected = n;
      $$('.box-el', el).forEach((b) => b.classList.toggle('sel', b._node === n));
      $$('#insList div', el).forEach((b) => b.classList.toggle('sel', b._node === n));
      el.querySelector('#insXpath').value = n.xpath || '';
      el.querySelector('#insXpathResult').textContent = '';
      const rows = [['Texto', n.text], ['Descripción', n.desc], ['resource-id', n.id], ['XPath', n.xpath], ['XPath absoluto', n.xpathAbs],
        ['Clase', n.cls], ['Centro', `${n.cx}, ${n.cy}`],
        ['Centro en %', `${(n.cx / data.size.width * 100).toFixed(1)}%, ${(n.cy / data.size.height * 100).toFixed(1)}%`], ['Pulsable', n.clickable ? 'sí' : 'no']];
      el.querySelector('#insProps').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span class="mono">${esc(v || '-')}</span>`).join('');
      const acts = el.querySelector('#insActions');
      acts.innerHTML = '';
      const add = (txt, ic, fn, dis) => { const b = h(`<button ${dis ? 'disabled' : ''}>${icon(ic, 14)}${txt}</button>`); b.onclick = fn; acts.appendChild(b); };
      const copy = (v, what) => { navigator.clipboard.writeText(v); toast(`${what} copiado: ${v}`); };
      add('Copiar texto', 'copy', () => copy(n.text || n.desc, 'Texto'), !(n.text || n.desc));
      add('Copiar id', 'hash', () => copy(n.id, 'resource-id'), !n.id);
      add('Copiar XPath', 'copy', () => copy(n.xpath, 'XPath'));
      add('Copiar XPath absoluto', 'copy', () => copy(n.xpathAbs, 'XPath absoluto'));
      add('Añadir "Tocar por XPath" al flujo', 'plus', () => {
        const xpath = el.querySelector('#insXpath').value.trim() || n.xpath;
        const wf = addNodeToCurrent('tap_xpath', { xpath });
        if (wf) toast(`Nodo "Tocar por XPath" añadido a ${wf}`);
        else toast('Abre un flujo en Automatización para añadirle el nodo', 'warn');
      });
      add('Copiar posición', 'pointer', () => copy(`${(n.cx / data.size.width * 100).toFixed(1)}% ${(n.cy / data.size.height * 100).toFixed(1)}%`, 'Posición'));
      add('Tocar en el teléfono', 'play', async () => { await call('tap', [serial], n.cx / data.size.width, n.cy / data.size.height); setTimeout(load, 900); });
    };
    const boxFor = (n, extra = '') => {
      const [x1, y1, x2, y2] = n.bounds;
      const b = h(`<div class="box-el ${extra}"></div>`);
      Object.assign(b.style, { left: `${x1 / data.size.width * 100}%`, top: `${y1 / data.size.height * 100}%`, width: `${(x2 - x1) / data.size.width * 100}%`, height: `${(y2 - y1) / data.size.height * 100}%` });
      b.title = label(n);
      b._node = n;
      b.onclick = () => select(n);
      return b;
    };
    const renderList = () => {
      const q = el.querySelector('#insFilter').value.trim().toLowerCase();
      const list = el.querySelector('#insList');
      list.innerHTML = '';
      for (const n of data.nodes) {
        if (!(n.text || n.desc || n.id)) continue;
        if (q && !`${n.text} ${n.desc} ${n.id}`.toLowerCase().includes(q)) continue;
        const row = h(`<div title="${esc(n.id)}">${esc(label(n))} <span class="muted">${esc(n.id ? n.id.split('/').pop() : n.cls.split('.').pop())}</span></div>`);
        row._node = n;
        row.onclick = () => select(n);
        list.appendChild(row);
      }
      if (!list.children.length) list.innerHTML = '<div class="muted">Sin elementos con texto o id</div>';
    };
    const load = async () => {
      serial = el.querySelector('#insDevice').value;
      screen.querySelector('.msg').textContent = 'Capturando…';
      try {
        data = await call('inspect', serial);
      } catch {
        screen.querySelector('.msg').textContent = 'No se pudo inspeccionar la pantalla';
        return;
      }
      const img = screen.querySelector('img');
      img.onload = () => {
        fit();
        layer.innerHTML = '';
        // Primero los grandes para que los pequeños queden encima y se puedan pulsar.
        const nodes = [...data.nodes].sort((a, b) => (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]) - (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]));
        for (const n of nodes) {
          if (!(n.text || n.desc || n.id || n.clickable)) continue;
          layer.appendChild(boxFor(n));
        }
      };
      img.src = data.shot.data;
      screen.querySelector('.msg').textContent = '';
      renderList();
    };
    // Marca en la captura los elementos que cumplen el XPath escrito.
    const testXpath = () => {
      const xpath = el.querySelector('#insXpath').value.trim();
      const out = el.querySelector('#insXpathResult');
      if (!xpath || !data) return;
      layer.querySelectorAll('.box-el.tmp').forEach((b) => b.remove());
      let found;
      try {
        found = queryXpath(data.nodes, xpath);
      } catch (e) {
        out.textContent = e.message;
        return;
      }
      const ids = new Set(found.map((x) => x.index));
      $$('.box-el', el).forEach((b) => b.classList.toggle('match', ids.has(b._node.index)));
      // Elementos sin texto ni id no tienen recuadro: se dibuja uno temporal para verlos.
      const drawn = new Set($$('.box-el', el).map((b) => b._node.index));
      for (const n of found) if (!drawn.has(n.index)) layer.appendChild(boxFor(n, 'tmp match'));
      out.textContent = found.length === 0 ? 'Ningún elemento cumple ese XPath en esta captura'
        : found.length === 1 ? '1 elemento: el nodo tocará exactamente ese'
          : `${found.length} elementos: el nodo tocará el primero. Afina el XPath si no es el que quieres.`;
    };
    el.querySelector('#insXpathTest').onclick = testXpath;
    el.querySelector('#insXpath').onkeydown = (e) => { if (e.key === 'Enter') testXpath(); };
    el.querySelector('#insRefresh').onclick = load;
    el.querySelector('#insXml').onclick = async () => {
      if (!data?.xml) return toast('Captura primero la pantalla', 'warn');
      toast(`Pantalla guardada en ${await call('saveUiXml', serial, data.xml)}`);
    };
    el.querySelector('#insDevice').onchange = load;
    el.querySelector('#insFilter').oninput = renderList;
    load();
  } });
}
