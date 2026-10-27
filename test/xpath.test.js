import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUiDump, addXpaths, findNode } from '../src/main/automation/actions.js';
import { queryXpath } from '../src/main/automation/xpath.js';

const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.app" content-desc="" clickable="false" bounds="[0,0][1080,2340]">
  <node index="0" text="" resource-id="com.app:id/form" class="android.widget.LinearLayout" package="com.app" content-desc="" clickable="false" bounds="[0,100][1080,1200]">
    <node index="0" text="Usuario" resource-id="com.app:id/user" class="android.widget.EditText" package="com.app" content-desc="" clickable="true" bounds="[40,200][1040,320]" />
    <node index="1" text="" resource-id="com.app:id/pass" class="android.widget.EditText" package="com.app" content-desc="" clickable="true" bounds="[40,360][1040,480]" />
    <node index="2" text="Entrar" resource-id="com.app:id/login" class="android.widget.Button" package="com.app" content-desc="" clickable="true" bounds="[40,560][1040,680]" />
  </node>
  <node index="1" text="" resource-id="" class="android.widget.LinearLayout" package="com.app" content-desc="" clickable="false" bounds="[0,1300][1080,2000]">
    <node index="0" text="Me gusta" resource-id="com.app:id/like" class="android.widget.Button" package="com.app" content-desc="Me gusta la foto" clickable="true" bounds="[0,1300][540,1400]" />
    <node index="1" text="Me gusta" resource-id="com.app:id/like" class="android.widget.Button" package="com.app" content-desc="Me gusta el vídeo" clickable="true" bounds="[540,1300][1080,1400]" />
    <node index="2" text="It's &quot;ok&quot;" resource-id="" class="android.widget.TextView" package="com.app" content-desc="" clickable="false" bounds="[0,1500][1080,1600]" />
  </node>
</node></hierarchy>`;

const nodes = addXpaths(parseUiDump(XML));
const q = (x) => queryXpath(nodes, x).map((n) => n.text || n.desc || n.id || n.cls);
const byText = (t) => nodes.find((n) => n.text === t);

test('árbol del volcado: padres e hijos', () => {
  assert.equal(nodes.length, 9);
  assert.equal(nodes[0].parent, null);
  assert.deepEqual(nodes[1].children, [2, 3, 4]);
  assert.equal(nodes[4].attrs['resource-id'], 'com.app:id/login');
});

test('XPath: rutas, atributos y funciones', () => {
  assert.deepEqual(q('//android.widget.Button[@text="Entrar"]'), ['Entrar']);
  assert.deepEqual(q("//*[@resource-id='com.app:id/login']"), ['Entrar']);
  assert.deepEqual(q('/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[1]/android.widget.EditText[2]'), ['com.app:id/pass']);
  assert.deepEqual(q('/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout[2]/*[1]'), ['Me gusta']);
  assert.deepEqual(q('//android.widget.EditText'), ['Usuario', 'com.app:id/pass']);
  assert.deepEqual(q('(//android.widget.EditText)[2]'), ['com.app:id/pass']);
  assert.deepEqual(q('(//android.widget.EditText)[last()]'), ['com.app:id/pass']);
  assert.equal(q('//android.widget.Button[1]').length, 2, '//x[1] es el primero de cada padre');
  assert.deepEqual(q('//*[contains(@content-desc,"vídeo")]').length, 1);
  assert.deepEqual(q('//*[starts-with(@text,"Usu")]'), ['Usuario']);
  assert.deepEqual(q('//*[text()="Entrar"]'), ['Entrar']);
  assert.deepEqual(q('//*[@text="Me gusta" and @content-desc="Me gusta el vídeo"]').length, 1);
  assert.deepEqual(q('//*[@text="Entrar" or @text="Usuario"]'), ['Usuario', 'Entrar']);
  assert.deepEqual(q('//android.widget.EditText[not(@text="")]'), ['Usuario']);
  assert.deepEqual(q('//*[@text="Entrar"]/..'), ['com.app:id/form']);
  assert.deepEqual(q('//*[@resource-id="com.app:id/form"]//android.widget.Button'), ['Entrar']);
  assert.deepEqual(q(`//*[contains(@text,'"ok"')]`), [`It's "ok"`]);
  assert.deepEqual(q('//*[@noexiste="x"]'), []);
  assert.deepEqual(q('//android.widget.ImageView'), []);
});

test('XPath no válido: error claro', () => {
  for (const bad of ['', 'android.widget.Button', '//*[@text="a"', '//*[foo(@text)]', '//*[@text=]', '//a]']) {
    assert.throws(() => queryXpath(nodes, bad), /XPath/, bad);
  }
});

test('XPath generado: único y apunta al elemento correcto', () => {
  for (const n of nodes) {
    const found = queryXpath(nodes, n.xpath);
    assert.equal(found[0], n, `${n.xpath} debe dar ${n.cls}`);
    assert.deepEqual(queryXpath(nodes, n.xpathAbs), [n], n.xpathAbs);
  }
  assert.equal(byText('Entrar').xpath, '//android.widget.Button[@resource-id="com.app:id/login"]');
  // Dos botones con el mismo id y texto: se distinguen por la descripción.
  assert.equal(nodes.find((n) => n.desc === 'Me gusta el vídeo').xpath, '//android.widget.Button[@content-desc="Me gusta el vídeo"]');
  // Texto con comillas simples y dobles: no se puede escribir en XPath, se usa la ruta absoluta.
  const tv = nodes.find((n) => n.cls.endsWith('TextView'));
  assert.equal(tv.xpath, tv.xpathAbs);
  assert.equal(findNode(nodes, { xpath: '//*[@text="Entrar"]' }).cx, 540);
});
