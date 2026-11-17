// Evita la consola extra en Windows en modo release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod spec;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager};

use spec::{Analysis, Format};

/// Archivo recibido al arrancar (argumento de línea de comandos o «Abrir con» en macOS)
/// que la interfaz todavía no ha recogido.
struct PendingFile(Mutex<Option<String>>);

#[derive(Serialize)]
struct OpenedFile {
    path: String,
    content: String,
    format: Format,
}

#[tauri::command]
fn analyze(content: String, format: Format) -> Analysis {
    spec::analyze(&content, format)
}

#[tauri::command]
fn convert(content: String, from: Format, to: Format) -> Result<String, String> {
    spec::convert(&content, from, to)
}

#[tauri::command]
fn format_document(content: String, format: Format) -> Result<String, String> {
    spec::convert(&content, format, format)
}

#[tauri::command]
fn read_file(path: String) -> Result<OpenedFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer {path}: {e}"))?;
    let mut content = String::from_utf8(bytes)
        .map_err(|_| format!("{path} no es un archivo de texto UTF-8"))?;
    if content.starts_with('\u{feff}') {
        content.remove(0);
    }
    let format = Format::from_path(Path::new(&path)).unwrap_or_else(|| Format::sniff(&content));
    Ok(OpenedFile {
        path,
        content,
        format,
    })
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("No se pudo guardar {path}: {e}"))
}

#[tauri::command]
fn take_pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}

/// Primer argumento que apunte a un archivo existente (`swaggy-editor api.yaml`).
fn file_from_args() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile(Mutex::new(file_from_args())))
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            analyze,
            convert,
            format_document,
            read_file,
            write_file,
            take_pending_file
        ])
        .build(tauri::generate_context!())
        .expect("no se pudo iniciar Swaggy Editor");

    app.run(|_app, _event| {
        // macOS entrega los archivos de «Abrir con» / doble clic como un evento.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            if let Some(path) = urls.iter().find_map(|u| u.to_file_path().ok()) {
                let path = path.to_string_lossy().into_owned();
                if let Ok(mut pending) = _app.state::<PendingFile>().0.lock() {
                    *pending = Some(path.clone());
                }
                let _ = _app.emit("open-file", path);
            }
        }
    });
}
