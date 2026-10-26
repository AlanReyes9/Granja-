// Persistencia simple en JSON dentro de la carpeta de datos del usuario.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = {
  adbPath: '',
  scrcpyPath: '',
  otgEnabled: false,
  autoReconnectWifi: true,
  screenshotInterval: 3000,
  thumbnailConcurrency: 6,
  runConcurrency: 10,
  runStaggerMs: 0,
  apiEnabled: false,
  apiPort: 8787,
  apiToken: '',
  telegramToken: '',
  telegramChatId: '',
  webhookUrl: '',
  alertBatteryBelow: 15,
  alertTempAbove: 45,
  alertOnDisconnect: true,
  autoApplyProxy: true,
};

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'granja-data.json');
    this.data = { settings: { ...DEFAULT_SETTINGS }, workflows: [], schedules: [], deviceMeta: {}, tables: [], history: [], proxies: [] };
    try {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...loaded, settings: { ...DEFAULT_SETTINGS, ...(loaded.settings || {}) } };
    } catch {}
    this.timer = null;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
