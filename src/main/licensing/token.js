// Formato de las licencias: "NXF1.<datos en base64url>.<firma Ed25519 en base64url>".
// Lo usan la app (verificar), la herramienta del vendedor (firmar claves sin conexión) y las pruebas.
import crypto from 'node:crypto';

export const PREFIX = 'NXF1';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function publicKeyFromBase64(b64) {
  return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
}

export function privateKeyFromBase64(b64) {
  return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
}

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

/** Firma los datos de una licencia y devuelve el texto de la licencia. */
export function signToken(payload, privateKeyB64) {
  const data = b64url(JSON.stringify(payload));
  const sig = crypto.sign(null, Buffer.from(data), privateKeyFromBase64(privateKeyB64));
  return `${PREFIX}.${data}.${b64url(sig)}`;
}

/** Comprueba la firma y devuelve los datos; lanza un error si la licencia no es auténtica. */
export function verifyToken(token, publicKeyB64) {
  const clean = String(token || '').replace(/\s+/g, '');
  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('El texto no es una licencia de Nexus Farmer');
  const [, data, sig] = parts;
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(data), publicKeyFromBase64(publicKeyB64), Buffer.from(sig, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('La licencia no es válida (firma incorrecta)');
  return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
}
