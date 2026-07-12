use crate::detector::mouse_hook::{self, MouseButton};
use crate::detector::{self, AppState};
use crate::models::TrackingState;
use std::str::FromStr;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_store::StoreExt;

pub const DEFAULT_CONFIRM_SHORTCUT: &str = "CommandOrControl+Shift+KeyY";
const ACTIVITY_DETECTION_KEY: &str = "activityDetectionEnabled";

/// Absolute path so `tauri-plugin-store` writes next to the database instead
/// of its own default (roaming `app_data_dir`) — see `db::data_dir`.
pub(crate) fn settings_store_path(app: &AppHandle) -> std::path::PathBuf {
    crate::db::data_dir(app).join("settings.json")
}

const COMPANY_NAME_KEY: &str = "companyName";
const COMPANY_ALIASES_KEY: &str = "companyAliases";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyDto {
    pub name: String,
    pub aliases: Vec<String>,
}

fn read_company(app: &AppHandle) -> Result<CompanyDto, String> {
    let store = app.store(settings_store_path(app)).map_err(|err| err.to_string())?;
    let name = store
        .get(COMPANY_NAME_KEY)
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default();
    let aliases = store
        .get(COMPANY_ALIASES_KEY)
        .and_then(|value| {
            value.as_array().map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
        })
        .unwrap_or_default();
    Ok(CompanyDto { name, aliases })
}

/// The company's name + aliases as one flat term list for the matcher —
/// the matcher doesn't care which is which, only that a match through any
/// of these must yield to other projects (see Matcher::match_project).
pub(crate) fn company_terms(app: &AppHandle) -> Vec<String> {
    let Ok(company) = read_company(app) else {
        return Vec::new();
    };
    let mut terms: Vec<String> = Vec::new();
    if !company.name.trim().is_empty() {
        terms.push(company.name.trim().to_string());
    }
    terms.extend(
        company
            .aliases
            .iter()
            .map(|alias| alias.trim().to_string())
            .filter(|alias| !alias.is_empty()),
    );
    terms
}

#[tauri::command]
pub fn get_company(app: AppHandle) -> Result<CompanyDto, String> {
    read_company(&app)
}

#[tauri::command]
pub fn set_company(app: AppHandle, name: String, aliases: Vec<String>) -> Result<CompanyDto, String> {
    let name = name.trim().to_string();
    let aliases: Vec<String> = aliases
        .into_iter()
        .map(|alias| alias.trim().to_string())
        .filter(|alias| !alias.is_empty())
        .collect();

    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    store.set(COMPANY_NAME_KEY, serde_json::Value::String(name.clone()));
    store.set(
        COMPANY_ALIASES_KEY,
        serde_json::Value::Array(aliases.iter().cloned().map(serde_json::Value::String).collect()),
    );
    store.save().map_err(|err| err.to_string())?;

    // The company terms live inside the compiled matcher — without this,
    // the new priority rule would only apply after an app restart.
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;

    Ok(CompanyDto { name, aliases })
}

/// Parses our own accelerator strings ("CommandOrControl+Shift+KeyY") into a
/// `Shortcut` directly from `Modifiers`/`Code`, instead of going through the
/// `global-hotkey` crate's own `str::parse` — that convenience parser only
/// recognizes a fixed shortlist of named keys, which silently rejected any
/// physical key outside it (e.g. `IntlBackslash`, the extra key next to left
/// Shift on ISO/Italian keyboards). `Code::from_str` (from `keyboard-types`)
/// mirrors the full W3C UI Events code list instead — every value the
/// frontend's `event.code` can produce — so every physical key is
/// assignable, not just the crate's shortlist.
pub(crate) fn parse_accelerator(accelerator: &str) -> Result<Shortcut, String> {
    let mut mods = Modifiers::empty();
    let mut code = None;
    for token in accelerator.split('+') {
        match token {
            "CommandOrControl" => mods |= Modifiers::CONTROL,
            "Shift" => mods |= Modifiers::SHIFT,
            "Alt" => mods |= Modifiers::ALT,
            other => {
                code = Some(
                    Code::from_str(other).map_err(|_| format!("Tasto non supportato: {other}"))?,
                );
            }
        }
    }
    let code = code.ok_or_else(|| "Nessun tasto specificato".to_string())?;
    Ok(Shortcut::new(Some(mods), code))
}

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
    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    Ok(store
        .get("confirmShortcut")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_CONFIRM_SHORTCUT.to_string()))
}

#[tauri::command]
pub fn set_confirm_shortcut(app: AppHandle, shortcut: String) -> Result<String, String> {
    let previous = {
        let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
        store
            .get("confirmShortcut")
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| DEFAULT_CONFIRM_SHORTCUT.to_string())
    };

    // Mouse side buttons (Mouse4/Mouse5) go through a separate low-level
    // hook (see `mouse_hook`) — `RegisterHotKey`, behind the keyboard path
    // below, only understands keyboard virtual keys.
    if let Some(button) = MouseButton::parse(&shortcut) {
        if MouseButton::parse(&previous).is_none() {
            if let Ok(previous_hotkey) = parse_accelerator(&previous) {
                let _ = app.global_shortcut().unregister(previous_hotkey);
            }
        }
        mouse_hook::set_trigger(Some(button));
    } else {
        let manager = app.global_shortcut();
        let hotkey = parse_accelerator(&shortcut)?;
        // Register the new shortcut *before* dropping the old one — an
        // invalid or unsupported combination must leave the previously
        // working shortcut intact instead of the app ending up with none
        // registered at all.
        manager.register(hotkey).map_err(|err| err.to_string())?;

        if MouseButton::parse(&previous).is_some() {
            mouse_hook::set_trigger(None);
        } else if previous != shortcut {
            if let Ok(previous_hotkey) = parse_accelerator(&previous) {
                let _ = manager.unregister(previous_hotkey);
            }
        }
    }

    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
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

    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    store.set(ACTIVITY_DETECTION_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|err| err.to_string())?;

    Ok(enabled)
}
