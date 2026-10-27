import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Los archivos que las demás pruebas no cargan (main.js, la interfaz…) también tienen que compilar:
// un error de sintaxis ahí deja la app sin abrir aunque todo lo demás pase.
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : /\.(m?js|cjs)$/.test(e.name) ? [p] : [];
});

test('todos los archivos de src compilan', () => {
  for (const f of files('src')) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }), f);
  }
});
