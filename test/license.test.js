import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPair, signToken, verifyToken } from '../src/main/licensing/token.js';
import { LicenseManager } from '../src/main/licensing/license.js';
import { formatMachineId, normalizeMachineId } from '../src/main/licensing/machine.js';
import { handleRequest } from '../supabase/functions/licencias/core.js';

const DAY = 86400000;
const keys = generateKeyPair();
const PC1 = formatMachineId('equipo-1');
const PC2 = formatMachineId('equipo-2');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-lic-'));

function manager({ machine = PC1, now = () => Date.now(), dir = tmp(), fetch, serverUrl = '' } = {}) {
  return new LicenseManager({ dir, publicKey: keys.publicKey, machineId: () => machine, now, fetch, serverUrl, graceDays: 7, allowOffline: true });
}

const offlineKey = (fields = {}) => signToken({ v: 1, k: 'offline', s: 'OFF-1', m: PC1, c: 'Ana', p: 'Pro', e: Date.now() + 30 * DAY, i: Date.now(), ...fields }, keys.privateKey);

test('ID de equipo: formato estable y normalización', () => {
  assert.match(PC1, /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/);
  assert.equal(formatMachineId('equipo-1'), PC1);
  assert.notEqual(PC1, PC2);
  assert.equal(normalizeMachineId(PC1.toLowerCase().replace(/-/g, ' ')), PC1);
  assert.equal(normalizeMachineId('123'), null);
});

test('firma: una licencia manipulada o firmada con otra clave no vale', () => {
  const t = offlineKey();
  assert.equal(verifyToken(t, keys.publicKey).c, 'Ana');
  const [pre, data, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url')), e: null })).toString('base64url');
  assert.throws(() => verifyToken(`${pre}.${forged}.${sig}`, keys.publicKey), /firma/);
  const other = generateKeyPair();
  assert.throws(() => verifyToken(signToken({ v: 1 }, other.privateKey), keys.publicKey), /firma/);
  assert.throws(() => verifyToken('hola', keys.publicKey), /no es una licencia/);
});

test('sin conexión: activa en su equipo y no en otro', () => {
  const m = manager();
  assert.equal(m.status().active, false);
  const st = m.activateOffline(offlineKey());
  assert.equal(st.active, true);
  assert.equal(st.client, 'Ana');
  assert.equal(st.daysLeft, 30);
  // Persistencia: otra instancia con la misma carpeta sigue activada.
  assert.equal(manager({ dir: path.dirname(m.file) }).status().active, true);
  assert.throws(() => manager({ machine: PC2 }).activateOffline(offlineKey()), /otro equipo/);
});

test('sin conexión: caducidad, permanente y reloj atrasado', () => {
  assert.throws(() => manager().activateOffline(offlineKey({ e: Date.now() - DAY })), /caducó/);
  assert.equal(manager().activateOffline(offlineKey({ e: null })).expires, null);
  let now = Date.now();
  const m = manager({ now: () => now });
  m.activateOffline(offlineKey({ e: now + 30 * DAY }));
  now += 40 * DAY;
  assert.match(m.status().reason, /caducó/);
  // Atrasar el reloj después de haber visto una fecha posterior se detecta.
  now -= 20 * DAY;
  assert.equal(m.status().code, 'clock');
});

// ----- Servidor en línea: lógica real de la función de Supabase con una base de datos en memoria -----
function fakeServer(rows, clock) {
  const db = {
    async get(s) { return rows[s] ? { ...rows[s] } : null; },
    async update(s, patch) { Object.assign(rows[s], patch); },
  };
  return async (_url, opts) => {
    const out = await handleRequest(JSON.parse(opts.body), { db, privateKey: keys.privateKey, now: clock() });
    return { ok: out.status === 200, status: out.status, json: async () => out.body };
  };
}

test('en línea: el serial se ata al primer equipo y caduca a los N días de activarse', async () => {
  let now = Date.now();
  const rows = { 'NXF-AAAAA-BBBBB-CCCCC-DDDDD': { serial: 'NXF-AAAAA-BBBBB-CCCCC-DDDDD', client: 'Luis', plan: 'Pro', days: 30, permanent: false, revoked: false } };
  const fetch = fakeServer(rows, () => now);
  const pc1 = manager({ fetch, serverUrl: 'https://x', now: () => now });
  const st = await pc1.activateOnline('nxf-aaaaa-bbbbb-ccccc-ddddd');
  assert.equal(st.active, true);
  assert.equal(st.mode, 'online');
  assert.equal(st.daysLeft, 30);
  assert.equal(rows['NXF-AAAAA-BBBBB-CCCCC-DDDDD'].machine_id, PC1);
  // Volver a activar en el mismo equipo funciona; en otro equipo, no.
  assert.equal((await pc1.activateOnline('NXF-AAAAA-BBBBB-CCCCC-DDDDD')).active, true);
  const pc2 = manager({ machine: PC2, fetch, serverUrl: 'https://x', now: () => now });
  await assert.rejects(pc2.activateOnline('NXF-AAAAA-BBBBB-CCCCC-DDDDD'), /otro equipo/);
  await assert.rejects(pc2.activateOnline('NXF-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ'), /no existe/);
  // Pasados los 30 días, la revalidación lo desactiva.
  now += 31 * DAY;
  const r = await pc1.revalidate();
  assert.equal(r.active, false);
  assert.match(r.reason, /caducó/);
});

test('en línea: revocar y liberar desactivan; renovar amplía la fecha', async () => {
  let now = Date.now();
  const S = 'NXF-11111-22222-33333-44444';
  const rows = { [S]: { serial: S, client: 'Eva', days: 10, permanent: false, revoked: false } };
  const fetch = fakeServer(rows, () => now);
  const pc1 = manager({ fetch, serverUrl: 'https://x', now: () => now });
  await pc1.activateOnline(S);
  // Renovar (el vendedor amplía la fecha en la base de datos).
  rows[S].expires_at = new Date(now + 100 * DAY).toISOString();
  assert.equal((await pc1.revalidate()).daysLeft, 100);
  // Liberar: el equipo 1 lo pierde y el equipo 2 puede activarlo.
  rows[S].machine_id = null;
  assert.match((await pc1.revalidate()).reason, /liberada/);
  const pc2 = manager({ machine: PC2, fetch, serverUrl: 'https://x', now: () => now });
  assert.equal((await pc2.activateOnline(S)).active, true);
  // Revocar.
  rows[S].revoked = true;
  assert.match((await pc2.revalidate()).reason, /revocado/);
  assert.equal(pc2.status().active, false);
});

test('en línea: sin conexión sigue funcionando durante el periodo de gracia', async () => {
  let now = Date.now();
  const S = 'NXF-55555-66666-77777-88888';
  const rows = { [S]: { serial: S, permanent: true, revoked: false } };
  let online = true;
  const server = fakeServer(rows, () => now);
  const fetch = (u, o) => (online ? server(u, o) : Promise.reject(new Error('sin red')));
  const pc = manager({ fetch, serverUrl: 'https://x', now: () => now });
  assert.equal((await pc.activateOnline(S)).expires, null);
  online = false;
  now += 5 * DAY;
  assert.equal((await pc.revalidate()).active, true);
  now += 3 * DAY;
  const st = await pc.revalidate();
  assert.equal(st.active, false);
  assert.equal(st.code, 'grace');
  online = true;
  assert.equal((await pc.revalidate()).active, true);
});

test('herramienta del vendedor: claves y licencia sin conexión', () => {
  const dir = tmp();
  const config = path.join(dir, 'config.js');
  fs.writeFileSync(config, "export const PUBLIC_KEY = '';\nexport const SERVER_URL = '';\nexport const OFFLINE_KEYS = true;\n");
  const env = { ...process.env, NEXUS_LICENCIAS_DIR: path.join(dir, 'priv'), NEXUS_LICENCIAS_CONFIG: config };
  const run = (...a) => execFileSync(process.execPath, ['tools/licencias.mjs', ...a], { env, encoding: 'utf8' });
  run('claves');
  const pub = fs.readFileSync(config, 'utf8').match(/PUBLIC_KEY = '([^']+)'/)[1];
  run('servidor', 'https://demo.supabase.co/functions/v1/licencias');
  assert.match(fs.readFileSync(config, 'utf8'), /SERVER_URL = 'https:\/\/demo/);
  const out = run('offline', '--equipo', PC1.toLowerCase(), '--dias', '15', '--cliente', 'Marta');
  const token = out.match(/NXF1\.[\w-]+\.[\w-]+/)[0];
  const m = new LicenseManager({ dir: tmp(), publicKey: pub, machineId: () => PC1, allowOffline: true });
  const st = m.activateOffline(token);
  assert.equal(st.client, 'Marta');
  assert.equal(st.daysLeft, 15);
  // Ejecutar "claves" otra vez no sustituye la clave privada.
  assert.match(run('claves'), /Ya existe/);
});

test('claves sin conexión desactivadas: la app las rechaza y la herramienta no las crea', () => {
  const m = new LicenseManager({ dir: tmp(), publicKey: keys.publicKey, machineId: () => PC1, allowOffline: false });
  assert.equal(m.status().offlineAvailable, false);
  assert.throws(() => m.activateOffline(offlineKey()), /no están permitidas/);
  // Una clave sin conexión guardada de antes también deja de valer.
  const dir = tmp();
  manager({ dir }).activateOffline(offlineKey());
  const st = new LicenseManager({ dir, publicKey: keys.publicKey, machineId: () => PC1, allowOffline: false }).status();
  assert.equal(st.active, false);
  assert.equal(st.code, 'offline-disabled');
  // La configuración real del proyecto las tiene desactivadas.
  const cfg = fs.readFileSync('src/main/licensing/config.js', 'utf8');
  assert.match(cfg, /OFFLINE_KEYS = false/);
  const d = tmp();
  const config = path.join(d, 'config.js');
  fs.writeFileSync(config, "export const PUBLIC_KEY = '';\nexport const SERVER_URL = '';\nexport const OFFLINE_KEYS = false;\n");
  const env = { ...process.env, NEXUS_LICENCIAS_DIR: path.join(d, 'priv'), NEXUS_LICENCIAS_CONFIG: config };
  execFileSync(process.execPath, ['tools/licencias.mjs', 'claves'], { env });
  assert.throws(() => execFileSync(process.execPath, ['tools/licencias.mjs', 'offline', '--equipo', PC1, '--dias', '5'], { env, stdio: 'pipe' }), /desactivadas/);
});
