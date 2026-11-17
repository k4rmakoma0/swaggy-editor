//! Menú nativo. Cada opción propia emite el evento `menu` con su id a la interfaz.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, label);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };

    let mut file = SubmenuBuilder::new(app, "Archivo")
        .item(&item("new", "Nuevo", Some("CmdOrCtrl+N"))?)
        .item(&item("open", "Abrir…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("save", "Guardar", Some("CmdOrCtrl+S"))?)
        .item(&item("save_as", "Guardar como…", Some("CmdOrCtrl+Shift+S"))?);
    if !cfg!(target_os = "macos") {
        file = file
            .separator()
            .item(&item("quit", "Salir", Some("CmdOrCtrl+Q"))?);
    }
    let file = file.build()?;

    // Deshacer/rehacer los gestiona el editor (CodeMirror) para que su historial
    // no choque con el del sistema; aquí solo van portapapeles y selección.
    let edit = SubmenuBuilder::new(app, "Editar")
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "Vista")
        .item(&item("mode_view", "Solo visualizar", Some("CmdOrCtrl+1"))?)
        .item(&item("mode_split", "Mixto", Some("CmdOrCtrl+2"))?)
        .item(&item("mode_edit", "Solo editar", Some("CmdOrCtrl+3"))?)
        .separator()
        .item(&item("format", "Formatear documento", Some("Shift+Alt+F"))?)
        .item(&item("to_json", "Convertir a JSON", None)?)
        .item(&item("to_yaml", "Convertir a YAML", None)?)
        .separator()
        .item(&item("problems", "Mostrar/ocultar problemas", Some("CmdOrCtrl+Shift+M"))?)
        .build()?;

    let mut menu = MenuBuilder::new(app);

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Swaggy Editor")
            .about(None)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&item("quit", "Salir de Swaggy Editor", Some("CmdOrCtrl+Q"))?)
            .build()?;
        menu = menu.item(&app_menu);
    }

    menu.items(&[&file, &edit, &view]).build()
}
