// Descarga y localiza herramientas externas: Android platform-tools (adb) y scrcpy (espejo en tiempo real).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PLATFORM_TOOLS_URL = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';
const SCRCPY_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest';

function findFile(dir, name, depth = 3) {
  if (!fs.existsSync(dir) || depth < 0) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'user-agent': 'nexus-farmer' } });
  if (!res.ok) throw new Error(`Descarga fallida (${res.status}) ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let got = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    if (total) onProgress?.(Math.round((got / total) * 100));
  }
  await new Promise((r) => out.end(r));
}

function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    // tar (bsdtar) viene con Windows 10/11 y extrae .zip; PowerShell como respaldo.
    execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true }, (err) => {
      if (!err) return resolve();
      execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dir}'`],
        { windowsHide: true }, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

export class Tools {
  constructor(toolsDir) {
    this.dir = toolsDir;
  }

  localAdb() {
    return findFile(path.join(this.dir, 'platform-tools'), process.platform === 'win32' ? 'adb.exe' : 'adb', 1);
  }

  localScrcpy() {
    return findFile(path.join(this.dir, 'scrcpy'), process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy', 2);
  }

  async installPlatformTools(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const zip = path.join(this.dir, 'platform-tools.zip');
    await download(PLATFORM_TOOLS_URL, zip, onProgress);
    await unzip(zip, this.dir);
    fs.rmSync(zip, { force: true });
    const adb = this.localAdb();
    if (!adb) throw new Error('No se encontró adb.exe tras descomprimir');
    return adb;
  }

  async installScrcpy(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const rel = await (await fetch(SCRCPY_API, { headers: { 'user-agent': 'nexus-farmer' } })).json();
    const asset = (rel.assets || []).find((a) => /win64.*\.zip$/i.test(a.name));
    if (!asset) throw new Error('No se encontró el paquete win64 de scrcpy');
    const zip = path.join(this.dir, 'scrcpy.zip');
    await download(asset.browser_download_url, zip, onProgress);
    fs.rmSync(path.join(this.dir, 'scrcpy'), { recursive: true, force: true });
    await unzip(zip, path.join(this.dir, 'scrcpy'));
    fs.rmSync(zip, { force: true });
    const exe = this.localScrcpy();
    if (!exe) throw new Error('No se encontró scrcpy.exe tras descomprimir');
    return exe;
  }
}
