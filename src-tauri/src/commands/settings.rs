use crate::detector::{self, AppState};
use crate::models::TrackingState;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_store::StoreExt;

const SETTINGS_STORE: &str = "settings.json";
pub const DEFAULT_CONFIRM_SHORTCUT: &str = "CommandOrControl+Shift+Y";
const ACTIVITY_DETECTION_KEY: &str = "activityDetectionEnabled";

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|err| err.to_string())?;
    manager.is_enabled().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_autostart_status(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn reset_all_data(app: AppHandle) -> Result<TrackingState, String> {
    detector::reset_all_data(&app)
}

#[tauri::command]
pub fn get_confirm_shortcut(app: AppHandle) -> Result<String, String> {
    let store = app.store(SETTINGS_STORE).map_err(|err| err.to_string())?;
    Ok(store
        .get("confirmShortcut")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_CONFIRM_SHORTCUT.to_string()))
}

#[tauri::command]
pub fn set_confirm_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|err| err.to_string())?;
    manager
        .register(shortcut.as_str())
        .map_err(|err| err.to_string())?;

    let store = app.store(SETTINGS_STORE).map_err(|err| err.to_string())?;
    store.set("confirmShortcut", serde_json::Value::String(shortcut.clone()));
    store.save().map_err(|err| err.to_string())?;

    Ok(shortcut)
}

#[tauri::command]
pub fn get_activity_detection_enabled(state: State<AppState>) -> bool {
    *state.activity_detection_enabled.lock().unwrap()
}

#[tauri::command]
pub fn set_activity_detection_enabled(
    app: AppHandle,
    state: State<AppState>,
    enabled: bool,
) -> Result<bool, String> {
    *state.activity_detection_enabled.lock().unwrap() = enabled;

    let store = app.store(SETTINGS_STORE).map_err(|err| err.to_string())?;
    store.set(ACTIVITY_DETECTION_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|err| err.to_string())?;

    Ok(enabled)
}
