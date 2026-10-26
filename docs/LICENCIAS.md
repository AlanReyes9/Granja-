# Licencias de Nexus Farmer

Nexus Farmer necesita un **serial** para funcionar:

- Los seriales los creas tú en el **panel de licencias** (una página web) o con la herramienta de línea de comandos.
- Cada serial queda **atado al primer equipo que lo activa**. En otro PC sale "Este serial ya está activado en otro equipo".
- Al crear cada serial eliges su duración: días desde la activación, hasta una fecha o permanente.
- Desde el panel puedes **renovar**, **revocar** y **liberar** un serial (para que el cliente lo pase a otro PC).
- La app comprueba el serial con el servidor al abrirse y cada 6 horas. Sin internet sigue funcionando hasta 7 días.
- La respuesta del servidor va **firmada digitalmente** con tu clave privada. La app solo lleva la clave pública, así que nadie puede fabricar una activación falsa ni montar un servidor falso.

> Las **claves sin conexión** están desactivadas: la app no las acepta, el panel no las ofrece y la herramienta se niega a generarlas. Para volver a usarlas habría que poner `OFFLINE_KEYS = true` en `src/main/licensing/config.js`. No es recomendable, porque no se pueden revocar.

---

## 1. Crear tus claves (una sola vez)

Necesitas Node.js 22 y una copia del repositorio en tu PC:

```bash
npm install
node tools/licencias.mjs claves
```

- La **clave privada** se guarda en `licencias-privado/clave-privada.txt`. Esa carpeta no se sube a GitHub.
  - Haz una copia de seguridad.
  - No la compartas: quien la tenga puede activar copias de la app.
- La **clave pública** se escribe en `src/main/licensing/config.js`.

## 2. Montar el servidor en Supabase (una sola vez)

1. Crea una cuenta y un proyecto en [supabase.com](https://supabase.com). El plan gratuito es suficiente.
2. En **SQL Editor**, ejecuta en este orden el contenido de:
   - `supabase/migrations/20261026000000_licencias.sql` (tabla de seriales)
   - `supabase/migrations/20261027000000_panel_admin.sql` (clientes, administradores y permisos)
3. Despliega la función de activación con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

   ```bash
   supabase login
   supabase link --project-ref <id-de-tu-proyecto>
   supabase secrets set LICENSE_PRIVATE_KEY=<contenido de licencias-privado/clave-privada.txt>
   supabase functions deploy licencias --no-verify-jwt
   ```

4. Pon la dirección de la función en la app y súbelo; GitHub Actions compilará el `.exe` con tu configuración:

   ```bash
   node tools/licencias.mjs servidor https://<id-de-tu-proyecto>.supabase.co/functions/v1/licencias
   git add src/main/licensing/config.js
   git commit -m "Configura licencias"
   git push
   ```

## 3. Panel de licencias (página web)

La carpeta `admin/` es una página web estática:

- **Resumen:** totales por estado, seriales que caducan pronto y últimas activaciones.
- **Seriales:** crear (para un cliente existente o nuevo, en lote), buscar, filtrar, copiar, renovar, liberar equipo, revocar o reactivar, y eliminar los que nunca se activaron.
- **Clientes:** alta, edición y baja, y sus seriales.

### Configurarlo

1. **Crea tu usuario administrador** en Supabase: **Authentication → Users → Add user**, con email y contraseña.
2. **Dale permiso de administrador** en el **SQL Editor**:

   ```sql
   insert into public.admins (email) values ('tu-correo@ejemplo.com');
   ```

   Solo los emails de esa tabla pueden ver o cambiar datos. Cualquier otro usuario ve el panel vacío y no puede modificar nada; lo garantizan las reglas de la base de datos, no la página.
3. **Recomendado:** en **Authentication → Sign In / Providers → Email**, desactiva *Allow new users to sign up* para que nadie más pueda crear usuarios.
4. **Edita `admin/config.js`** con los datos de **Project Settings → API**:

   ```js
   window.NEXUS_ADMIN_CONFIG = {
     supabaseUrl: 'https://<id-de-tu-proyecto>.supabase.co',
     anonKey: '<anon public key>',   // nunca la service_role
   };
   ```

### Publicarlo

La página tiene que servirse por http(s); no funciona abriendo el archivo con doble clic. Opciones:

- **Vercel o Netlify (gratis):** sube la carpeta `admin/` y tendrás una dirección como `https://nexus-licencias.vercel.app`.
- **En tu PC:** `npx serve admin` y abre la dirección que te indique.

## 4. Herramienta de línea de comandos (opcional)

Hace lo mismo que el panel desde la terminal. Necesita `licencias-privado/.env` con:

```
SUPABASE_URL=https://<id-de-tu-proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

| Comando | Qué hace |
|---|---|
| `crear --dias 30 --cliente "Juan" --plan Pro [--cantidad 5]` | Crea seriales (o `--hasta AAAA-MM-DD`, `--permanente`) |
| `listar [texto]` / `ver NXF-…` | Consulta seriales |
| `renovar NXF-… --dias 30` | Amplía la suscripción |
| `liberar NXF-…` | Lo desata del PC actual |
| `revocar NXF-…` / `reactivar NXF-…` | Bloquea o desbloquea |

## 5. Qué comprueba la app

- La firma es tuya: una activación inventada o modificada se rechaza.
- La licencia es para este equipo: el ID de equipo sale del identificador de Windows (MachineGuid).
- No ha caducado (según la hora del servidor en la última comprobación) y el reloj del PC no se ha atrasado.
- El servidor confirma, al abrir la app y cada 6 horas, que el serial sigue activo y atado a este PC.

Sin licencia, el proceso principal de la app rechaza todas las funciones y no arranca ni los dispositivos, ni el programador, ni la API.

## 6. Límites

- **Reinstalar Windows** cambia el ID de equipo. Libera el serial en el panel y el cliente lo vuelve a activar.
- **Ninguna protección en el lado del cliente es irrompible.** Alguien con conocimientos podría modificar el programa instalado para saltarse la comprobación. La firma impide fabricar activaciones, pero no impide parchear la app. El ejecutable desactiva las formas más fáciles de inyectar código (ejecutar Electron como Node, `--inspect`, `NODE_OPTIONS`).
- Cambiar de clave privada invalida todas las activaciones. Los clientes tendrían que volver a activar (sus seriales siguen valiendo).
