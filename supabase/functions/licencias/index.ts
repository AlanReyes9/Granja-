// Función de Supabase (Deno) que activa y revalida licencias de Nexus Farmer.
// Variables necesarias: LICENSE_PRIVATE_KEY (secreto que tú configuras). SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY las pone Supabase automáticamente.
import { handleRequest } from './core.js';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const privateKey = Deno.env.get('LICENSE_PRIVATE_KEY')!;
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

const db = {
  async get(serial: string) {
    const res = await fetch(`${url}/rest/v1/licencias?serial=eq.${encodeURIComponent(serial)}&select=*`, { headers });
    if (!res.ok) throw new Error(`Base de datos: ${res.status}`);
    return (await res.json())[0] ?? null;
  },
  async update(serial: string, patch: Record<string, unknown>) {
    const res = await fetch(`${url}/rest/v1/licencias?serial=eq.${encodeURIComponent(serial)}`, {
      method: 'PATCH', headers, body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Base de datos: ${res.status}`);
  },
};

Deno.serve(async (req) => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (req.method !== 'POST') return json(405, { error: 'Usa POST' });
  try {
    const input = await req.json();
    const out = await handleRequest(input, { db, privateKey });
    return json(out.status, out.body);
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Error interno del servidor de licencias', code: 'server' });
  }
});
