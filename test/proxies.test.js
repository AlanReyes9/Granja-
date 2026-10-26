import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProxyLine, parseProxyList, distribute, ProxyManager } from '../src/main/proxies.js';

test('formatos de proxy', () => {
  assert.deepEqual(parseProxyLine('1.2.3.4:8080'), { scheme: 'http', host: '1.2.3.4', port: 8080, user: '', pass: '', key: '1.2.3.4:8080' });
  const a = parseProxyLine('1.2.3.4:3128:ana:se:cr');
  assert.equal(a.user, 'ana'); assert.equal(a.pass, 'se:cr'); assert.equal(a.key, '1.2.3.4:3128');
  const b = parseProxyLine('http://ana:x@p.ejemplo.com:8000');
  assert.deepEqual([b.host, b.port, b.user, b.pass], ['p.ejemplo.com', 8000, 'ana', 'x']);
  assert.equal(parseProxyLine('ana:x@h:1').host, 'h');
  assert.equal(parseProxyLine('host:sinpuerto'), null);
  assert.equal(parseProxyLine('# comentario'), null);
  const { list, invalid } = parseProxyList('1.1.1.1:80\n1.1.1.1:80\n\nmal\n2.2.2.2:81');
  assert.equal(list.length, 2);
  assert.deepEqual(invalid, ['mal']);
});

const P = (k, status = 'ok') => ({ key: k, status });

test('reparto: uno distinto por teléfono y en ciclo si faltan', () => {
  const r = distribute(['a', 'b', 'c'], [P('p1'), P('p2'), P('p3')]);
  assert.deepEqual(r, { a: 'p1', b: 'p2', c: 'p3' });
  const r2 = distribute(['a', 'b', 'c'], [P('p1'), P('p2')]);
  assert.deepEqual(r2, { a: 'p1', b: 'p2', c: 'p1' });
});

test('reparto: no repite proxys ya usados por otros teléfonos', () => {
  const r = distribute(['c'], [P('p1'), P('p2'), P('p3')], { current: { a: 'p1', b: 'p2' } });
  assert.deepEqual(r, { c: 'p3' });
  // Reasignar a un teléfono que ya tenía uno libera el suyo.
  const r2 = distribute(['a'], [P('p1'), P('p2')], { current: { a: 'p1', b: 'p2' } });
  assert.deepEqual(r2, { a: 'p1' });
});

test('reparto: saltar proxys caídos y error si no hay', () => {
  assert.deepEqual(distribute(['a'], [P('p1', 'error'), P('p2')], { onlyHealthy: true }), { a: 'p2' });
  assert.throws(() => distribute(['a'], [P('p1', 'error')], { onlyHealthy: true }), /No hay proxys/);
  const rnd = distribute(['a', 'b'], [P('p1'), P('p2')], { strategy: 'random' });
  assert.deepEqual(Object.values(rnd).sort(), ['p1', 'p2']);
});

test('ProxyManager: lista, asignación, rotación, aplicación y borrado', async () => {
  const data = { proxies: [], deviceMeta: { a: { name: 'Tel-1' } } };
  const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
  const cmds = [];
  const devices = { get: (s) => ({ shell: async (c) => { cmds.push([s, c]); return ''; } }) };
  const pm = new ProxyManager({ store, devices });
  pm.setList('1.1.1.1:80\n2.2.2.2:81:u:p');
  assert.equal(pm.list().length, 2);
  pm.setList('3.3.3.3:82', { append: true });
  assert.equal(pm.list().length, 3);
  pm.assign(['a', 'b']);
  assert.deepEqual(pm.assignments(), { a: '1.1.1.1:80', b: '2.2.2.2:81' });
  assert.equal(data.deviceMeta.a.name, 'Tel-1');
  assert.equal(pm.rotate('a'), '3.3.3.3:82');
  await pm.apply('a');
  assert.deepEqual(cmds.pop(), ['a', 'settings put global http_proxy 3.3.3.3:82']);
  pm.remove(['3.3.3.3:82']);
  assert.equal(pm.assignments().a, undefined);
  await pm.apply('a');
  assert.deepEqual(cmds.pop(), ['a', 'settings put global http_proxy :0']);
});
