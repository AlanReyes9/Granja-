// Notificaciones salientes: Telegram y/o webhook genérico (Discord, Slack, n8n, Make...).
export class Notifier {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  async send(message) {
    const s = this.getSettings();
    const jobs = [];
    if (s.telegramToken && s.telegramChatId) {
      jobs.push(fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: s.telegramChatId, text: `Granja: ${message}` }),
      }));
    }
    if (s.webhookUrl) {
      jobs.push(fetch(s.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: message, content: message, source: 'granja-farm-manager', time: new Date().toISOString() }),
      }));
    }
    if (!jobs.length) throw new Error('No hay Telegram ni webhook configurado');
    const results = await Promise.allSettled(jobs);
    const failed = results.find((r) => r.status === 'rejected' || !r.value.ok);
    if (failed) throw new Error(failed.reason?.message || `HTTP ${failed.value.status}`);
  }
}
