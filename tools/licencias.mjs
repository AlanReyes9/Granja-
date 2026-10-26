#!/usr/bin/env node
// Herramienta del vendedor para las licencias de Nexus Farmer. Ver docs/LICENCIAS.md.
//
//   node tools/licencias.mjs claves
//   node tools/licencias.mjs servidor https://<proyecto>.supabase.co/functions/v1/licencias
//   node tools/licencias.mjs offline --equipo XXXXX-XXXXX-XXXXX-XXXXX --dias 30 --cliente "Juan"
//   node tools/licencias.mjs crear --cantidad 5 --dias 30 --cliente "Juan" --plan Pro
//   node tools/licencias.mjs listar [texto]
//   node tools/licencias.mjs ver NXF-...
//   node tools/licencias.mjs renovar NXF-... --dias 30
//   node tools/licencias.mjs liberar NXF-...      (lo desata del equipo para usarlo en otro)
//   node tools/licencias.mjs revocar NXF-...      /   reactivar NXF-...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, signToken, verifyToken } from '../src/main/licensing/token.js';
import { normalizeMachineId } from '../src/main/licensing/machine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIV_DIR = process.env.NEXUS_LICENCIAS_DIR || path.join(ROOT, 'licencias-privado');
const PRIV_FILE = path.join(PRIV_DIR, 'clave-privada.txt');
const ENV_FILE = path.join(PRIV_DIR, '.env');
const CONFIG = process.env.NEXUS_LICENCIAS_CONFIG || path.join(ROOT, 'src/main/licensing/config.js');
const DAY = 24 * 3600 * 1000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: sin I, L, O ni U

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function privateKey() {
  if (!fs.existsSync(PRIV_FILE)) die(`No existe ${PRIV_FILE}. Ejecuta primero: node tools/licencias.mjs claves`);
  return fs.readFileSync(PRIV_FILE, 'utf8').trim();
}

function setConfig(name, value) {
  const src = fs.readFileSync(CONFIG, 'utf8');
  const re = new RegExp(`export const ${name} = '[^']*';`);
  if (!re.test(src)) die(`No encuentro ${name} en ${CONFIG}`);
  fs.writeFileSync(CONFIG, src.replace(re, `export const ${name} = '${value}';`));
}

/** Duración a partir de --dias N, --hasta AAAA-MM-DD o --permanente. */
function duration(args, { required = true } = {}) {
  if (args.permanente) return { permanent: true };
  if (args.hasta) {
    const t = Date.parse(`${args.hasta}T23:59:59`);
    if (Number.isNaN(t)) die('--hasta debe tener el formato AAAA-MM-DD');
    return { expiresAt: t };
  }
  if (args.dias) {
    const d = Number(args.dias);
    if (!Number.isInteger(d) || d < 1) die('--dias debe ser un número entero positivo');
    return { days: d };
  }
  if (required) die('Indica la duración: --dias N, --hasta AAAA-MM-DD o --permanente');
  return null;
}

function newSerial() {
  const bytes = crypto.randomBytes(20);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return `NXF-${chars.match(/.{5}/g).join('-')}`;
}

function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    die(`Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Ponlos en ${ENV_FILE} (ver docs/LICENCIAS.md).`);
  }
  return env;
}

async function db(method, query, body) {
  const env = loadEnv();
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/licencias${query}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) die(`Supabase respondió ${res.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('es-ES') : '-');

function printLicense(l) {
  const exp = l.permanent ? 'permanente' : l.expires_at ? `caduca ${fmtDate(l.expires_at)}` : `${l.days} días desde la activación`;
  const state = l.revoked ? 'REVOCADO' : l.machine_id ? `activo en ${l.machine_id}` : 'sin activar';
  console.log(`${l.serial}  ${state}  ${exp}  ${l.client || ''}${l.plan ? ` [${l.plan}]` : ''}`);
}

const serialArg = (args) => {
  const s = String(args._[1] || '').trim().toUpperCase();
  if (!/^NXF(-[0-9A-Z]{5}){4}$/.test(s)) die('Indica un serial con formato NXF-XXXXX-XXXXX-XXXXX-XXXXX');
  return s;
};

const commands = {
  claves() {
    fs.mkdirSync(PRIV_DIR, { recursive: true });
    if (fs.existsSync(PRIV_FILE)) {
      console.log(`Ya existe una clave privada en ${PRIV_FILE}; no se sobrescribe.`);
      console.log('Si generas otra, todas las licencias emitidas dejarán de valer. Bórrala a mano solo si de verdad quieres empezar de cero.');
      const pub = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(privateKey(), 'base64'), format: 'der', type: 'pkcs8' }))
        .export({ type: 'spki', format: 'der' }).toString('base64');
      setConfig('PUBLIC_KEY', pub);
      console.log('Clave pública comprobada en src/main/licensing/config.js.');
      return;
    }
    const { publicKey, privateKey: priv } = generateKeyPair();
    fs.writeFileSync(PRIV_FILE, `${priv}\n`, { mode: 0o600 });
    setConfig('PUBLIC_KEY', publicKey);
    console.log(`\nClave privada guardada en: ${PRIV_FILE}`);
    console.log('  GUÁRDALA BIEN Y NO LA COMPARTAS: quien la tenga puede crear licencias.');
    console.log('Clave pública escrita en src/main/licensing/config.js (va dentro de la app; es pública).');
    console.log('\nPara el servidor en línea, guarda la clave privada como secreto de Supabase:');
    console.log(`  supabase secrets set LICENSE_PRIVATE_KEY=${priv}\n`);
  },

  servidor(args) {
    const url = String(args._[1] || '').trim();
    if (!/^https:\/\//.test(url)) die('Indica la URL https de la función, p. ej. https://abcd.supabase.co/functions/v1/licencias');
    setConfig('SERVER_URL', url);
    console.log(`Servidor de licencias configurado en src/main/licensing/config.js: ${url}`);
  },

  offline(args) {
    const machine = normalizeMachineId(args.equipo);
    if (!machine) die('--equipo debe ser el ID de equipo que muestra la app (XXXXX-XXXXX-XXXXX-XXXXX)');
    const d = duration(args);
    const now = Date.now();
    const e = d.permanent ? null : d.expiresAt ?? now + d.days * DAY;
    const id = `OFF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const token = signToken({ v: 1, k: 'offline', s: id, m: machine, c: String(args.cliente || ''), p: String(args.plan || ''), e, i: now }, privateKey());
    console.log(`\nLicencia sin conexión ${id} para el equipo ${machine}`);
    console.log(`Cliente: ${args.cliente || '-'} · ${e ? `caduca el ${fmtDate(e)}` : 'permanente'}\n`);
    console.log(token);
    console.log('\nEl cliente la pega en "Activar sin conexión". Solo funciona en ese equipo.\n');
  },

  async crear(args) {
    const d = duration(args);
    const n = Math.min(500, Math.max(1, Number(args.cantidad) || 1));
    const rows = Array.from({ length: n }, () => ({
      serial: newSerial(),
      client: String(args.cliente || ''),
      plan: String(args.plan || ''),
      notes: String(args.nota || ''),
      permanent: !!d.permanent,
      days: d.days ?? null,
      expires_at: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
    }));
    const created = await db('POST', '', rows);
    console.log(`\n${created.length} serial(es) creados:\n`);
    created.forEach(printLicense);
    console.log('');
  },

  async listar(args) {
    const q = args._[1] ? `&or=(serial.ilike.*${encodeURIComponent(args._[1])}*,client.ilike.*${encodeURIComponent(args._[1])}*)` : '';
    const rows = await db('GET', `?select=*&order=created_at.desc${q}`);
    if (!rows.length) console.log('No hay seriales.');
    rows.forEach(printLicense);
  },

  async ver(args) {
    const [l] = await db('GET', `?serial=eq.${serialArg(args)}&select=*`);
    if (!l) die('Ese serial no existe');
    console.log(JSON.stringify(l, null, 2));
  },

  async renovar(args) {
    const serial = serialArg(args);
    const d = duration(args);
    const [l] = await db('GET', `?serial=eq.${serial}&select=*`);
    if (!l) die('Ese serial no existe');
    let patch;
    if (d.permanent) patch = { permanent: true };
    else if (d.expiresAt) patch = { permanent: false, expires_at: new Date(d.expiresAt).toISOString() };
    else if (!l.expires_at && !l.machine_id) patch = { permanent: false, days: (l.days || 0) + d.days };
    else {
      const base = Math.max(Date.now(), l.expires_at ? Date.parse(l.expires_at) : 0);
      patch = { permanent: false, expires_at: new Date(base + d.days * DAY).toISOString() };
    }
    const [u] = await db('PATCH', `?serial=eq.${serial}`, patch);
    printLicense(u);
    console.log('El cliente verá la nueva fecha en la próxima revalidación (al abrir la app o en unas horas).');
  },

  async liberar(args) {
    const [u] = await db('PATCH', `?serial=eq.${serialArg(args)}`, { machine_id: null });
    if (!u) die('Ese serial no existe');
    printLicense(u);
    console.log('El serial queda libre para activarlo en otro equipo; el equipo anterior lo perderá al revalidar.');
  },

  async revocar(args) {
    const [u] = await db('PATCH', `?serial=eq.${serialArg(args)}`, { revoked: true });
    if (!u) die('Ese serial no existe');
    printLicense(u);
  },

  async reactivar(args) {
    const [u] = await db('PATCH', `?serial=eq.${serialArg(args)}`, { revoked: false });
    if (!u) die('Ese serial no existe');
    printLicense(u);
  },

  comprobar(args) {
    // Útil para soporte: verifica una licencia y muestra su contenido.
    const cfg = fs.readFileSync(CONFIG, 'utf8').match(/PUBLIC_KEY = '([^']*)'/)[1];
    console.log(verifyToken(args._[1], cfg));
  },
};

const args = parseArgs(process.argv.slice(2));
const cmd = commands[args._[0]];
if (!cmd) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(args._[0] ? 1 : 0);
}
await cmd(args);
