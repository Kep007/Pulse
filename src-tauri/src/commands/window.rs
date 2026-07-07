use crate::detector;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn open_home_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("home") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    detector::close_for_shutdown(&app);
    app.exit(0);
}

#[tauri::command]
pub fn is_ctrl_pressed() -> bool {
    detector::is_ctrl_pressed()
}
