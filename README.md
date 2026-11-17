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

La app no está firmada con un certificado de Apple Developer ni notarizada. La primera vez:

1. Abre el `.dmg` y arrastra **Swaggy Editor** a Aplicaciones.
2. Ábrela. macOS dirá que no puede verificar al desarrollador; pulsa **Aceptar**.
3. Ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el mensaje sobre Swaggy Editor y pulsa **Abrir igualmente**.

Si una versión anterior (0.1.0) dice que la app «está dañada», quítale la marca de cuarentena:

```bash
xattr -dr com.apple.quarantine "/Applications/Swaggy Editor.app"
```

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
