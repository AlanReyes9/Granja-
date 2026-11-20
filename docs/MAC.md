# Nexus Farmer en Mac (procesador Intel)

## Requisitos

- Mac con procesador **Intel** y **macOS 12 Monterey o posterior**.
- Para saber qué procesador tienes: menú  > Acerca de este Mac. Si pone "Chip Apple M1/M2/M3…", es Apple Silicon, no Intel.

## Instalar

1. Descarga `NexusFarmer-Mac-Intel-1.0.0.dmg` de la release **ultima**.
2. Ábrelo y arrastra **Nexus Farmer** a la carpeta **Aplicaciones**.

También está `NexusFarmer-Mac-Intel-1.0.0.zip`: se descomprime y la app se abre sin instalar.

## Abrirla la primera vez

La app no está firmada por Apple (para eso hace falta la cuenta de desarrollador de Apple, de pago), así que macOS la bloquea la primera vez:

1. En **Aplicaciones**, haz clic derecho (o Control + clic) en **Nexus Farmer** > **Abrir** > **Abrir**.
2. Si no aparece el botón **Abrir**: **Ajustes del Sistema** > **Privacidad y seguridad**, baja hasta el aviso de Nexus Farmer y pulsa **Abrir igualmente**.
3. Si dice que la app "está dañada", abre **Terminal** y ejecuta:

   ```
   xattr -cr "/Applications/Nexus Farmer.app"
   ```

   y vuelve a abrirla. Solo hay que hacerlo una vez.

## ADB y teléfonos

- En **Ajustes** de la app, pulsa **Descargar platform-tools**: descarga el ADB de Mac automáticamente.
- En Mac no hacen falta drivers USB: conecta los teléfonos con la depuración USB activada.
- El modo OTG/red, las cuentas, publicaciones, calentamiento y el resto funcionan igual que en Windows.
- Las contraseñas de las cuentas se guardan cifradas en el Llavero de macOS.
