# Swaggy Editor

App de escritorio para **editar y visualizar** especificaciones **OpenAPI 3.x** y **Swagger 2.0**, en **YAML** o **JSON**. Funciona en Windows, macOS y Linux.

Está hecha con [Tauri 2](https://v2.tauri.app): el backend en **Rust** se encarga de leer y guardar archivos, parsear JSON/YAML, validar y convertir. La interfaz usa [CodeMirror 6](https://codemirror.net) como editor y [Swagger UI](https://github.com/swagger-api/swagger-ui) para la vista previa.

## Funciones

- **Tres modos de vista**: *Ver* (solo documentación), *Mixto* (editor y vista lado a lado, con divisor redimensionable) y *Editar* (solo el editor).
- **JSON y YAML**: detección automática, resaltado de sintaxis y conversión en un clic (se conserva el orden de las claves).
- **Vista previa en vivo**: mientras escribes. Si hay un error, se sigue mostrando la última versión válida y se marca la línea con el problema.
- **Validación**: falta de `openapi`/`swagger`, `info.title` o `info.version`; rutas que no empiezan con `/`; `operationId` duplicados; parámetros de ruta sin declarar; operaciones sin `responses`; `$ref` locales que no existen.
- **Panel de problemas**: al hacer clic en uno, el editor salta a esa línea.
- **Formatear documento**, archivos recientes, arrastrar y soltar, aviso de cambios sin guardar y menú nativo con atajos.
- Asociación con archivos `.yaml`, `.yml` y `.json` («Abrir con…»).

| Atajo | Acción |
| --- | --- |
| `Ctrl/⌘ + N` / `O` / `S` | Nuevo / Abrir / Guardar |
| `Ctrl/⌘ + Shift + S` | Guardar como (si cambias la extensión, convierte el formato) |
| `Ctrl/⌘ + 1` / `2` / `3` | Ver / Mixto / Editar |
| `Shift + Alt + F` | Formatear documento |
| `Ctrl/⌘ + Shift + M` | Mostrar u ocultar problemas |

> Formatear o convertir un YAML elimina sus comentarios. La app te avisa antes de hacerlo.

## Requisitos

- [Rust](https://rustup.rs) (stable) y [Node.js](https://nodejs.org) 20 o superior.
- **macOS**: Xcode Command Line Tools.
- **Windows**: Microsoft C++ Build Tools y WebView2 (ya viene en Windows 10/11).
- **Linux (Debian/Ubuntu)**:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

## Desarrollo

```bash
npm install
npm run tauri dev       # abre la app con recarga en caliente
```

Para probar solo la interfaz en el navegador (con un backend simulado): `npm run dev` y abre http://localhost:1420.

Pruebas del backend en Rust:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Compilar instaladores

```bash
npm run tauri build
```

Los instaladores quedan en `src-tauri/target/release/bundle/`:

| Sistema | Formatos |
| --- | --- |
| macOS | `.app`, `.dmg` |
| Windows | `.msi`, `.exe` (NSIS) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Tauri compila para el sistema donde se ejecuta. Para generar los tres a la vez está el workflow [`.github/workflows/release.yml`](.github/workflows/release.yml): sube el proyecto a GitHub y publica una etiqueta (`git tag v0.1.0 && git push --tags`). Se creará un borrador de *release* con todos los instaladores.

### Abrir en macOS

Desde la versión 0.1.2 la app está firmada con Developer ID y notarizada por Apple, así que abre sin avisos.

Las versiones anteriores no lo están:

- **0.1.1**: ábrela, pulsa **Aceptar** en el aviso y ve a **Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente**.
- **0.1.0**: si dice que la app «está dañada», quítale la marca de cuarentena:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Swaggy Editor.app"
  ```

### Firma y notarización de macOS

Sin configuración, el workflow firma la app *ad-hoc* y macOS pide «Abrir igualmente» la primera vez. Para que abra sin avisos hace falta una cuenta de Apple Developer y estos secretos en el repositorio (**Settings → Secrets and variables → Actions**):

| Secreto | Valor |
| --- | --- |
| `APPLE_CERTIFICATE` | Certificado «Developer ID Application» exportado como `.p12`, en base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Contraseña con la que exportaste el `.p12` |
| `APPLE_SIGNING_IDENTITY` | Nombre completo del certificado, p. ej. `Developer ID Application: Tu Nombre (TEAMID)` |
| `APPLE_ID` | Correo de tu cuenta de Apple Developer |
| `APPLE_PASSWORD` | Contraseña de app generada en [appleid.apple.com](https://appleid.apple.com) (no tu contraseña normal) |
| `APPLE_TEAM_ID` | Tu Team ID (los 10 caracteres entre paréntesis del certificado) |

Para exportar el certificado: abre **Acceso a Llaveros → Mis certificados**, clic derecho en «Developer ID Application: …» → **Exportar**, formato `.p12`. Luego, desde la carpeta del proyecto:

```bash
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE
gh secret set APPLE_CERTIFICATE_PASSWORD
gh secret set APPLE_SIGNING_IDENTITY
gh secret set APPLE_ID
gh secret set APPLE_PASSWORD
gh secret set APPLE_TEAM_ID
rm DeveloperID.p12
```

Cada `gh secret set` sin valor te pide escribirlo, así no queda en el historial de la terminal. Con los secretos cargados, el workflow firma, notariza y comprueba con `spctl` que macOS acepta la app.

Para firmar con tu certificado en local (sin notarizar): `APPLE_SIGNING_IDENTITY="Developer ID Application: …" npm run tauri build`.

## Estructura

```
src/                 Interfaz (TypeScript)
  main.ts            Estado, modos, archivos, menú y atajos
  editor.ts          CodeMirror (JSON/YAML, errores en línea, tema claro/oscuro)
  preview.ts         Swagger UI
  api.ts             Llamadas al backend Rust
  dev-mock.ts        Backend simulado (solo en `npm run dev` desde el navegador)
src-tauri/src/
  main.rs            Comandos Tauri, archivos, «Abrir con»
  menu.rs            Menú nativo
  spec.rs            Parseo, validación y conversión (con pruebas)
samples/             Ejemplos Swagger 2.0 (JSON) y OpenAPI 3.1 (YAML)
```
