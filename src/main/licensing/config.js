// Configuración de licencias de Nexus Farmer.
// PUBLIC_KEY: clave pública Ed25519 (SPKI DER en base64). La escribe "node tools/licencias.mjs claves".
//   Con ella la app comprueba que un serial o una clave la firmaste tú; no sirve para crear licencias.
// SERVER_URL: dirección de la función de activación en línea (Supabase). Vacía = solo claves sin conexión.
export const PUBLIC_KEY = '';
export const SERVER_URL = '';
// Claves sin conexión (generadas para un ID de equipo). Desactivadas: solo se aceptan seriales en línea,
// que se pueden revocar, renovar y liberar desde el panel. Ponlo a true solo si quieres volver a usarlas.
export const OFFLINE_KEYS = false;

// Días que la app sigue funcionando sin poder contactar con el servidor (licencias en línea).
export const GRACE_DAYS = 7;
// Cada cuánto se revalida una licencia en línea mientras la app está abierta.
export const REVALIDATE_HOURS = 6;
