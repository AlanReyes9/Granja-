// Descarga y localiza herramientas externas: Android platform-tools (adb) y scrcpy (espejo en tiempo real).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// Paquete de cada sistema: Windows, macOS (Intel y Apple Silicon) y Linux.
const PT_OS = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform] || 'linux';
const PLATFORM_TOOLS_URL = `https://dl.google.com/android/repository/platform-tools-latest-${PT_OS}.zip`;
const SCRCPY_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest';
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Paquete de scrcpy para este sistema y procesador. */
export function scrcpyAssetPattern(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return /win64.*\.zip$/i;
  if (platform === 'darwin') return arch === 'arm64' ? /macos-aarch64.*\.tar\.gz$/i : /macos-x86_64.*\.tar\.gz$/i;
  return /linux-x86_64.*\.tar\.gz$/i;
}

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
    // tar (bsdtar) viene con Windows 10/11 y macOS y extrae .zip y .tar.gz; respaldo: PowerShell o unzip.
    execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true }, (err) => {
      if (!err) return resolve();
      if (process.platform !== 'win32') {
        execFile('unzip', ['-o', zip, '-d', dir], (err2) => (err2 ? reject(err2) : resolve()));
        return;
      }
      execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dir}'`],
        { windowsHide: true }, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

/** En macOS y Linux los ejecutables descomprimidos necesitan permiso de ejecución. */
function makeExecutable(file) {
  if (process.platform === 'win32' || !file) return;
  try { fs.chmodSync(file, 0o755); } catch {}
}

export class Tools {
  constructor(toolsDir) {
    this.dir = toolsDir;
  }

  localAdb() {
    return findFile(path.join(this.dir, 'platform-tools'), `adb${EXE}`, 1);
  }

  localScrcpy() {
    return findFile(path.join(this.dir, 'scrcpy'), `scrcpy${EXE}`, 2);
  }

  async installPlatformTools(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const zip = path.join(this.dir, 'platform-tools.zip');
    await download(PLATFORM_TOOLS_URL, zip, onProgress);
    await unzip(zip, this.dir);
    fs.rmSync(zip, { force: true });
    const adb = this.localAdb();
    if (!adb) throw new Error(`No se encontró adb${EXE} tras descomprimir`);
    makeExecutable(adb);
    return adb;
  }

  async installScrcpy(onProgress) {
    fs.mkdirSync(this.dir, { recursive: true });
    const rel = await (await fetch(SCRCPY_API, { headers: { 'user-agent': 'nexus-farmer' } })).json();
    const asset = (rel.assets || []).find((a) => scrcpyAssetPattern().test(a.name));
    if (!asset) throw new Error(`No se encontró el paquete de scrcpy para ${process.platform} ${process.arch}`);
    const zip = path.join(this.dir, asset.name.endsWith('.zip') ? 'scrcpy.zip' : 'scrcpy.tar.gz');
    await download(asset.browser_download_url, zip, onProgress);
    fs.rmSync(path.join(this.dir, 'scrcpy'), { recursive: true, force: true });
    await unzip(zip, path.join(this.dir, 'scrcpy'));
    fs.rmSync(zip, { force: true });
    const exe = this.localScrcpy();
    if (!exe) throw new Error(`No se encontró scrcpy${EXE} tras descomprimir`);
    makeExecutable(exe);
    // scrcpy para macOS/Linux trae su propio adb al lado: también tiene que poder ejecutarse.
    makeExecutable(findFile(path.dirname(exe), 'adb', 0));
    return exe;
  }
}
