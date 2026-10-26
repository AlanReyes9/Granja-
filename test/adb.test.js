import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AdbExe } from '../src/main/adb/exe.js';

test('shell: código de salida remoto distinto de 0 no es un error, un fallo de adb sí', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'granja-adb-'));
  const script = path.join(dir, 'adb.js');
  fs.writeFileSync(script, `
const cmd = process.argv.slice(5).join(' ');
if (process.argv[3] === 'OFF') { process.stderr.write("adb: device 'OFF' not found\\n"); process.exit(1); }
if (cmd.startsWith('grep')) { process.exit(1); }
if (cmd.startsWith('aviso')) { process.stdout.write('salida'); process.stderr.write('aviso por stderr'); process.exit(2); }
process.stdout.write('ok');
`);
  // adb falso: el propio node ejecutando el script (funciona igual en Windows y en Linux).
  class FakeAdb extends AdbExe {
    get bin() { return process.execPath; }
    run(args, opts) { return super.run([script, ...args], opts); }
  }
  const adb = new FakeAdb();
  assert.equal(await adb.shell('S1', 'echo'), 'ok');
  assert.equal(await adb.shell('S1', 'grep nada'), '');
  assert.equal(await adb.shell('S1', 'aviso'), 'salidaaviso por stderr');
  await assert.rejects(adb.shell('OFF', 'echo'), /not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});
