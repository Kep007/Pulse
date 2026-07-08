use crate::detector;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn open_home_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("home") {
        // show() alone doesn't restore a minimized window on Windows — it
        // stays minimized in the taskbar, so a click on "Home" in the widget
        // looked like it did nothing whenever the window had been minimized
        // rather than closed.
        let _ = window.unminimize();
        let _ = window.center();
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
