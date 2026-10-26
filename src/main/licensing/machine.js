// Identificador estable del equipo. Se deriva del identificador del sistema operativo
// (MachineGuid en Windows) y se resume con SHA-256, así no se expone el valor original.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
      }
    }
  } catch {}
  // Último recurso: nombre del equipo y MAC de la primera interfaz física.
  const mac = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.mac !== '00:00:00:00:00:00')?.mac || '';
  return `${os.hostname()}|${mac}`;
}

/** Convierte un identificador bruto en el ID de equipo que ve el cliente: XXXXX-XXXXX-XXXXX-XXXXX. */
export function formatMachineId(raw) {
  const hex = crypto.createHash('sha256').update(`nexus-farmer:${raw}`).digest('hex').slice(0, 20).toUpperCase();
  return hex.match(/.{5}/g).join('-');
}

let cached;
export function getMachineId() {
  cached ??= formatMachineId(rawMachineId());
  return cached;
}

export function normalizeMachineId(id) {
  const clean = String(id || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return clean.length === 20 ? clean.match(/.{5}/g).join('-') : null;
}
