// Lógica del servidor de licencias de Nexus Farmer. Sin dependencias: funciona en Supabase (Deno) y en Node.
// db: { get(serial), update(serial, patch) }  ·  privateKey: clave privada Ed25519 (PKCS8 DER en base64)

const DAY = 24 * 3600 * 1000;
const enc = new TextEncoder();

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let keyCache = null;
async function importKey(privateKeyB64) {
  if (keyCache?.src === privateKeyB64) return keyCache.key;
  const der = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  keyCache = { src: privateKeyB64, key };
  return key;
}

export async function signToken(payload, privateKeyB64) {
  const data = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, await importKey(privateKeyB64), enc.encode(data)));
  return `NXF1.${data}.${b64url(sig)}`;
}

const fail = (status, code, error) => ({ status, body: { error, code } });

/**
 * Procesa una petición { action: 'activate' | 'validate', serial, machineId, appVersion }.
 * - activate: ata el serial a este equipo si está libre (o ya era suyo).
 * - validate: solo renueva la licencia si el serial sigue atado a este equipo.
 */
export async function handleRequest(input, { db, privateKey, now = Date.now() }) {
  const serial = String(input?.serial || '').trim().toUpperCase();
  const machineId = String(input?.machineId || '').trim().toUpperCase();
  const action = input?.action === 'validate' ? 'validate' : 'activate';
  if (!/^NXF(-[0-9A-Z]{5}){4}$/.test(serial)) return fail(400, 'format', 'Serial con formato incorrecto');
  if (!/^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/.test(machineId)) return fail(400, 'machine', 'ID de equipo incorrecto');

  const lic = await db.get(serial);
  if (!lic) return fail(404, 'not-found', 'El serial no existe');
  if (lic.revoked) return fail(403, 'revoked', 'Este serial ha sido revocado');

  if (lic.machine_id && lic.machine_id !== machineId) {
    return fail(409, 'other-machine', 'Este serial ya está activado en otro equipo');
  }
  if (!lic.machine_id && action === 'validate') {
    return fail(409, 'released', 'La licencia de este equipo fue liberada. Vuelve a activarla con tu serial.');
  }

  const patch = { last_seen_at: new Date(now).toISOString() };
  if (input?.appVersion) patch.app_version = String(input.appVersion).slice(0, 20);
  let expiresAt = lic.expires_at ? Date.parse(lic.expires_at) : null;
  if (!lic.machine_id) {
    patch.machine_id = machineId;
    patch.activated_at = new Date(now).toISOString();
    // Los días de suscripción empiezan a contar al activar, salvo que el serial ya tuviera fecha fija.
    if (!lic.permanent && expiresAt == null && lic.days) {
      expiresAt = now + lic.days * DAY;
      patch.expires_at = new Date(expiresAt).toISOString();
    }
  }
  if (lic.permanent) expiresAt = null;
  if (!lic.permanent && expiresAt == null) return fail(500, 'config', 'El serial no tiene duración configurada');
  if (expiresAt != null && now > expiresAt) {
    await db.update(serial, patch);
    return fail(403, 'expired', `La suscripción caducó el ${new Date(expiresAt).toLocaleDateString('es-ES')}`);
  }
  await db.update(serial, patch);
  const token = await signToken({
    v: 1, k: 'online', s: serial, m: machineId, c: lic.client || '', p: lic.plan || '',
    e: expiresAt, i: now, chk: now,
  }, privateKey);
  return { status: 200, body: { token } };
}
