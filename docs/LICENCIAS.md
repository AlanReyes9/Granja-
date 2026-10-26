# Licencias de Nexus Farmer

Nexus Farmer no funciona sin una licencia válida. Hay dos formas de dar licencias, y puedes usar las dos a la vez:

| | Serial en línea | Clave sin conexión |
|---|---|---|
| Qué recibe el cliente | Un serial corto: `NXF-7KQ2M-…` | Un texto largo que empieza por `NXF1.` |
| Cómo se ata a un PC | El servidor lo ata al primer PC que lo activa | Lo generas para el ID de equipo que te envía el cliente |
| Necesita internet | Para activar y para comprobarlo cada pocas horas (funciona hasta 7 días sin conexión) | Nunca |
| Puedes revocarlo, renovarlo o pasarlo a otro PC | Sí, al momento | No: solo caduca en su fecha |
| Necesita servidor | Sí (Supabase, plan gratuito) | No |

En los dos casos la licencia va **firmada digitalmente** con tu clave privada. La app solo lleva la clave pública, que sirve para comprobar que una licencia la firmaste tú pero no para crear licencias. Nadie sin tu clave privada puede fabricar un serial o una clave que la app acepte.

Las licencias pueden caducar en una fecha (`--dias 30`, `--hasta 2027-01-31`) o ser permanentes (`--permanente`).

---

## 1. Primera vez: crear tus claves

Necesitas Node.js 22 en tu PC y una copia del repositorio.

```bash
npm install
node tools/licencias.mjs claves
```

Esto hace dos cosas:

- Guarda tu **clave privada** en `licencias-privado/clave-privada.txt`. Esa carpeta no se sube a GitHub.
  - **Haz una copia de seguridad.** Si la pierdes, no podrás crear más licencias para esta versión de la app.
  - **No la compartas.** Quien la tenga puede crear licencias.
- Escribe la **clave pública** en `src/main/licensing/config.js`.

Después sube ese cambio para que GitHub Actions compile la app con tu clave:

```bash
git add src/main/licensing/config.js
git commit -m "Configura la clave de licencias"
git push
```

> Mientras `config.js` no tenga la clave pública, la app no se puede activar: muestra "Esta copia de la app no tiene configurada la clave de licencias".

## 2. Claves sin conexión (sin servidor)

1. El cliente abre Nexus Farmer, copia el **ID de este equipo** (por ejemplo `3C36C-25402-F2373-69469`) y te lo envía.
2. Generas la clave para ese ID:

   ```bash
   node tools/licencias.mjs offline --equipo 3C36C-25402-F2373-69469 --dias 30 --cliente "Juan Pérez" --plan Pro
   # o --hasta 2027-01-31, o --permanente
   ```

3. Le envías el texto `NXF1.…` que aparece. El cliente lo pega en **Sin conexión → Activar**.

Esa clave solo funciona en ese equipo. Para renovarla, genera otra con una fecha nueva.

## 3. Seriales en línea (con servidor)

### 3.1 Montar el servidor en Supabase (una sola vez)

1. Crea una cuenta y un proyecto en [supabase.com](https://supabase.com). El plan gratuito es suficiente.
2. En el proyecto, abre **SQL Editor**, pega el contenido de `supabase/migrations/20261026000000_licencias.sql` y ejecútalo. Así se crea la tabla `licencias`.
3. Instala la [CLI de Supabase](https://supabase.com/docs/guides/cli) y despliega la función desde la carpeta del repositorio:

   ```bash
   supabase login
   supabase link --project-ref <id-de-tu-proyecto>
   supabase secrets set LICENSE_PRIVATE_KEY=<contenido de licencias-privado/clave-privada.txt>
   supabase functions deploy licencias --no-verify-jwt
   ```

4. Pon en la app la dirección de la función y súbelo:

   ```bash
   node tools/licencias.mjs servidor https://<id-de-tu-proyecto>.supabase.co/functions/v1/licencias
   git add src/main/licensing/config.js && git commit -m "Servidor de licencias" && git push
   ```

5. Para que la herramienta pueda crear y gestionar seriales, crea el archivo `licencias-privado/.env` con:

   ```
   SUPABASE_URL=https://<id-de-tu-proyecto>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role key de Project Settings → API>
   ```

   La *service role key* da acceso total a tu base de datos: no la pongas nunca en la app ni la compartas.

### 3.2 Crear y vender seriales

```bash
node tools/licencias.mjs crear --dias 30 --cliente "Juan Pérez" --plan Pro
node tools/licencias.mjs crear --cantidad 10 --dias 365 --plan Anual
node tools/licencias.mjs crear --permanente --cliente "Empresa X"
```

Con `--dias`, los días empiezan a contar **cuando el cliente activa el serial**, no cuando lo creas. El cliente escribe el serial en **Con serial → Activar** y queda atado a su PC.

### 3.3 Gestionar seriales

| Comando | Qué hace |
|---|---|
| `listar [texto]` | Lista los seriales, o busca por serial o cliente |
| `ver NXF-…` | Muestra todos los datos de un serial |
| `renovar NXF-… --dias 30` | Amplía la suscripción (o `--hasta`, `--permanente`) |
| `liberar NXF-…` | Lo desata del PC actual para que el cliente lo active en otro |
| `revocar NXF-…` / `reactivar NXF-…` | Bloquea o desbloquea el serial |

Los cambios llegan a la app del cliente en la siguiente comprobación: al abrirla o, como mucho, en 6 horas. También puedes ver y editar la tabla `licencias` desde el **Table Editor** de Supabase.

## 4. Qué comprueba la app

- La firma es tuya: una licencia inventada o modificada se rechaza.
- La licencia es para este equipo: el ID de equipo sale del identificador de Windows (MachineGuid).
- No ha caducado.
- El reloj no se ha atrasado: la app recuerda la fecha más reciente en la que se abrió.
- En línea: el servidor confirma que el serial sigue activo y atado a este PC. Sin conexión funciona hasta 7 días desde la última comprobación.

Sin licencia, el proceso principal de la app rechaza todas las funciones y no arranca ni los dispositivos, ni el programador, ni la API. No basta con ocultar la pantalla de activación.

## 5. Límites

- **Reinstalar Windows** cambia el ID de equipo. Con un serial en línea, usa `liberar` y el cliente lo vuelve a activar. Con una clave sin conexión, genera una nueva para el nuevo ID.
- **Claves sin conexión:** no se pueden revocar. Además, alguien que conserve la clave y borre los datos de la app podría atrasar el reloj para alargarla más allá de su fecha. Si necesitas control total, usa seriales en línea, que dependen de la hora del servidor.
- **Ninguna protección en el lado del cliente es irrompible.** Alguien con conocimientos podría modificar el programa instalado para saltarse la comprobación. La firma digital impide fabricar licencias, pero no impide parchear la app. El ejecutable desactiva las formas más fáciles de inyectar código (ejecutar Electron como Node, `--inspect`, `NODE_OPTIONS`).
- Cambiar de clave privada invalida todas las licencias emitidas con la anterior.
