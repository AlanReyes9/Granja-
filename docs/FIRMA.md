# Quitar el aviso "podría ser malicioso" (firma de código)

Windows SmartScreen y Chrome avisan de cualquier `.exe` **sin firma digital** o con pocas descargas. No es un problema del programa. Sin un certificado de firma no hay forma legítima de quitar el aviso.

La compilación de GitHub Actions ya está preparada: en cuanto añades los secretos de una de estas dos opciones, los `.exe` de la release `ultima` salen firmados. No hay que tocar código.

## Opción B (recomendada): Azure Trusted Signing

Es el servicio de firma de Microsoft (también se llama *Artifact Signing*). Cuesta unos 10 USD al mes y las firmas generan reputación en SmartScreen rápido.

1. En el [portal de Azure](https://portal.azure.com) crea una cuenta de **Trusted Signing**. Valida tu identidad: como empresa (Nexus Dev) o como persona, según lo que permita tu país.
2. Crea un **perfil de certificado** de tipo *Public Trust*.
3. Crea un **registro de aplicación** (App registration) con un secreto de cliente. Dale el rol **Trusted Signing Certificate Profile Signer** en la cuenta de firma.
4. En GitHub ve a **Settings → Secrets and variables → Actions** de este repositorio:
   - **Secrets:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET`.
   - **Variables:**
     - `AZURE_SIGN_ENDPOINT`, por ejemplo `https://eus.codesigning.azure.net/`
     - `AZURE_SIGN_ACCOUNT`, el nombre de la cuenta de firma
     - `AZURE_SIGN_PROFILE`, el nombre del perfil de certificado
     - `AZURE_SIGN_PUBLISHER`, exactamente el nombre validado, por ejemplo `Nexus Dev`

## Opción A: certificado OV o EV (.pfx)

Se compra a una autoridad de certificación como Sectigo, DigiCert o SSL.com. Cuesta unos 200-400 USD al año.

1. Exporta el certificado a `.pfx` con contraseña y conviértelo a base64. En PowerShell:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificado.pfx")) | Set-Clipboard
   ```
2. En GitHub, en **Secrets**, añade `WIN_CSC_LINK` (el base64) y `WIN_CSC_KEY_PASSWORD`.

Los certificados actuales suelen venir en un token físico o en la nube del proveedor, y algunos no se pueden exportar a `.pfx`. En ese caso es más fácil la opción B.

## Después de firmar

- En el registro de la compilación (Actions) sale "Firmando con …". Si no hay certificado, sale un aviso.
- Durante los primeros días SmartScreen puede seguir avisando, hasta que el certificado acumule descargas. Eso pasa con cualquier firma nueva y desaparece solo.
- Mientras tanto, para instalar: **Más información → Ejecutar de todos modos**.
