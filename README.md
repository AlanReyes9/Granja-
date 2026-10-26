# Granja Farm Manager

Aplicación de escritorio para Windows (`.exe`) para gestionar una granja de teléfonos Android: vista en vivo de todas las pantallas, control individual o sincronizado, acciones masivas y un **editor de automatizaciones por nodos** al estilo GenFarmer, con funciones extra.

## Descarga

- **Instalador:** `GranjaFarmManager-Setup-x.y.z.exe`
- **Portable (sin instalar):** `GranjaFarmManager-Portable-x.y.z.exe`

GitHub Actions compila los dos en cada push (pestaña **Actions → Compilar .exe para Windows → Artifacts**). Si subes un tag `v1.0.0`, además se publican en **Releases**.

## Conexión de dispositivos

| Modo | Cómo |
|---|---|
| **USB (adb)** | Cable o hub USB, con *Depuración USB* activada. Aparecen solos. |
| **Hubs / adaptadores OTG** | Igual que USB, o con el **motor USB directo (OTG)**: habla el protocolo ADB por libusb sin `adb.exe` ni servidor ADB, así un hub grande no satura el servidor. Se activa en *Ajustes*. |
| **Wi-Fi** | *Conectar* → IP:puerto, **emparejar con código** (Android 11+), **escanear la red local** o pasar los seleccionados de **USB → Wi-Fi** en un clic. Si se cortan, se reconectan solos. |

> Si no tienes ADB, en **Ajustes → Descargar platform-tools** se descarga el oficial de Google. Para el espejo en tiempo real, **Descargar scrcpy**.
>
> Motor OTG en Windows: el teléfono tiene que usar un driver WinUSB (el *Google USB Driver* lo es) y `adb.exe` no debe tenerlo abierto (usa *Reiniciar ADB* o cierra el servidor).

## Funciones

**Granja y control**
- Cuadrícula compacta con la pantalla de cada teléfono en vivo; el tamaño se ajusta con un deslizador.
- **Doble clic** en una pantalla la abre en grande, con controles, datos del teléfono, proxy y apps.
- Clic = tocar, arrastrar = deslizar, mantener = pulsación larga, rueda = scroll, clic derecho = Atrás.
- **Control sincronizado**: lo que haces en una pantalla se repite en todos los seleccionados, con coordenadas proporcionales para que funcione con resoluciones distintas.
- Espejo en tiempo real, modo solo-ver y **grabación de vídeo** con scrcpy.
- Acciones masivas: instalar APK (también arrastrándolos a la ventana), enviar archivos, shell, escribir texto, abrir URL, proxy HTTP, despertar, Inicio/Atrás y reinicio normal, recovery o bootloader.
- Nombres y **grupos** (renombrado en lote con patrón `Teléfono-##`), búsqueda y filtro por grupo.
- Ficha de cada dispositivo: batería, temperatura, IP, Android, almacenamiento, apps instaladas (abrir, cerrar, desinstalar).

**Proxys por teléfono**
- Pega tu lista (`host:puerto`, `host:puerto:usuario:clave` o `http://usuario:clave@host:puerto`), sin duplicados.
- Reparto automático de un proxy distinto por teléfono, en orden o aleatorio; si hay más teléfonos que proxys, se reparten en ciclo. También se puede elegir el proxy de cada teléfono a mano.
- Prueba de conexión con latencia y opción de saltar los proxys que no responden.
- El proxy asignado se ve en cada tarjeta y se vuelve a aplicar solo cuando el teléfono se reconecta.
- Nodos *Aplicar proxy asignado* y *Rotar proxy* para usarlos dentro de los flujos.
- Android aplica el proxy HTTP global del sistema, que no admite usuario y contraseña: con proxys autenticados hay que autorizar la IP de la granja en el proveedor.

**Automatización por nodos** (40 nodos)
- *Flujo:* inicio, espera, espera aleatoria, bucles, rama aleatoria (%), variables, condiciones, registro y fin.
- *Interacción:* tocar (px o %, con variación humana), pulsación larga, deslizar con **curva humanizada**, scroll, escribir texto (también letra a letra) y teclas.
- *Pantalla/UI:* tocar por texto o por `resource-id` (uiautomator), "si aparece texto", leer texto, **si hay un color en un punto** y captura de pantalla.
- *Apps:* abrir, cerrar, borrar datos, "si la app está en primer plano", abrir URL, instalar y desinstalar.
- *Sistema:* shell con la salida guardada en una variable, despertar y desbloquear con PIN, proxy, proxy asignado, rotar proxy, **modo avión para rotar IP**, Wi-Fi y envío de archivos.
- *Datos e integraciones:* fila de una tabla CSV, petición HTTP y notificación.
- Plantillas en el texto: `{variable}`, `{rand:1-100}`, `{pick:hola|buenas}`, `{device.name}`, `{timestamp}`.
- En el lienzo se resalta en tiempo real el nodo que está ejecutando cada teléfono.
- Ejecución en paralelo con límite de concurrencia y **arranque escalonado** entre dispositivos.
- Plantillas listas para usar, importar y exportar flujos (`.granja.json`), y Ctrl+S para guardar.

**Extras frente a GenFarmer**
- **Programador**: lanza flujos cada N minutos o a una hora fija ciertos días, en todos los teléfonos, en un grupo o en una lista.
- **Tablas de datos CSV** (cuentas, textos, bios…): una fila distinta para cada dispositivo, aleatoria o secuencial.
- **Alertas por Telegram o webhook** (Discord, Slack, n8n, Make): batería baja, temperatura alta, desconexiones o el nodo *Notificar*.
- **API REST local** para controlar la granja desde scripts y bots:
  - `GET /api/devices`
  - `GET /api/workflows`
  - `POST /api/run {"workflow":"Nombre","group":"A"}`
  - `POST /api/shell`
  - `GET /api/screenshot/:serie`
  - `POST /api/stop`
  - `GET /api/proxies`
  - `POST /api/proxies/assign`
- Motor **USB directo/OTG** sin `adb.exe`.
- Escaneo de la red, emparejamiento inalámbrico y USB→Wi-Fi automático.
- Registro en vivo con filtros e **historial exportable a CSV**.

## Escribir texto con acentos o emojis

`input text` de Android solo admite ASCII. Para escribir otros caracteres, instala y activa **ADBKeyBoard** en el teléfono; la app lo usa automáticamente cuando hace falta.

## Desarrollo

```bash
npm install
npm start          # abre la app
npm test           # pruebas del motor
npm run dist       # genera los .exe en dist/ (mejor en Windows)
```

Estructura:
- `src/main`: proceso principal (ADB, motor OTG, motor de nodos, programador, API, alertas).
- `src/renderer`: interfaz.
- `src/shared/nodes.js`: definición de los nodos.

Los datos se guardan en `%APPDATA%/Granja Farm Manager/granja-data.json` y las capturas y grabaciones en `Imágenes/Granja`.

## Uso responsable

Respeta los términos de servicio de las plataformas que automatices y usa solo dispositivos y cuentas propios o autorizados.
