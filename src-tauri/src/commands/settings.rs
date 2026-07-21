use crate::db;
use crate::detector::mouse_hook::{self, MouseButton};
use crate::detector::{self, AppState};
use crate::models::TrackingState;
use std::str::FromStr;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_store::StoreExt;

pub const DEFAULT_CONFIRM_SHORTCUT: &str = "CommandOrControl+Shift+KeyY";
/// Default global shortcut that toggles the idle lock (meeting/thinking
/// mode). L for "lock"; distinct from the confirm shortcut's default.
pub const DEFAULT_LOCK_SHORTCUT: &str = "CommandOrControl+Shift+KeyL";
const ACTIVITY_DETECTION_KEY: &str = "activityDetectionEnabled";
const LOCK_SHORTCUT_KEY: &str = "lockShortcut";
const IDLE_TIMEOUT_KEY: &str = "idleTimeoutSecs";
/// Bounds for the configurable idle threshold — 30s floor keeps a too-eager
/// setting from flapping the segment every couple of ticks; 1h ceiling is
/// well past any real "long meeting". Settings only offers a preset list
/// inside this range, but the clamp guards against anything else.
const IDLE_TIMEOUT_MIN_SECS: u64 = 30;
const IDLE_TIMEOUT_MAX_SECS: u64 = 3600;

/// Absolute path so `tauri-plugin-store` writes next to the database instead
/// of its own default (roaming `app_data_dir`) — see `db::data_dir`.
pub(crate) fn settings_store_path(app: &AppHandle) -> std::path::PathBuf {
    crate::db::data_dir(app).join("settings.json")
}

const COMPANY_NAME_KEY: &str = "companyName";
const COMPANY_ALIASES_KEY: &str = "companyAliases";
/// The id of the catalog project that mirrors the configured company, so a
/// later rename edits that same row instead of creating a duplicate. See
/// `sync_company_project`.
const COMPANY_PROJECT_ID_KEY: &str = "companyProjectId";

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

    // Mirror the company onto a real catalog project so it shows up in the
    // widget's project picker and can be tracked like any other project. This
    // is the authoritative edit, so it pushes the company's name/aliases onto
    // that project.
    sync_company_project(&app, true)?;

    // The company terms live inside the compiled matcher — without this,
    // the new priority rule would only apply after an app restart.
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;
    // The picker and dashboard dropdowns re-fetch on this — without it the new
    // (or renamed) company project wouldn't appear until they remounted.
    let _ = app.emit(crate::commands::projects::CATALOG_CHANGED_EVENT, ());

    Ok(CompanyDto { name, aliases })
}

/// Keeps a real catalog project in step with the configured company, so "your
/// company" behaves like an actual project — visible in the picker, selectable,
/// trackable — not just an invisible matcher-priority hint. The mirrored
/// project's id is remembered in the settings store so a rename reuses it.
///
/// `push_fields` distinguishes the two callers: the company card's explicit
/// save (`true`) writes the company's current name and aliases onto the
/// project, while the startup reconciliation (`false`) only (re)creates a
/// missing project — it never overwrites fields, so aliases the user tweaked
/// from the Projects table survive every launch.
pub(crate) fn sync_company_project(app: &AppHandle, push_fields: bool) -> Result<(), String> {
    let company = read_company(app)?;
    let name = company.name.trim().to_string();
    // Company cleared: leave any previously-mirrored project in place (it may
    // hold tracked history) and simply stop tracking the link.
    if name.is_empty() {
        return Ok(());
    }

    let store = app.store(settings_store_path(app)).map_err(|err| err.to_string())?;
    let stored_id = store.get(COMPANY_PROJECT_ID_KEY).and_then(|value| value.as_i64());

    let state = app.state::<AppState>();
    let conn = state.db.lock().unwrap();

    // Reuse the remembered project if it's still live; otherwise adopt an
    // existing active project with the same name (a company project the user
    // created by hand before this synced automatically); otherwise create one.
    let existing = match stored_id {
        Some(id) if db::project_is_active(&conn, id).map_err(|err| err.to_string())? => Some(id),
        _ => db::find_active_project_id_by_name(&conn, &name).map_err(|err| err.to_string())?,
    };

    let project_id = match existing {
        Some(id) => {
            if push_fields {
                db::set_project_name(&conn, id, &name).map_err(|err| err.to_string())?;
                db::set_project_aliases(&conn, id, &company.aliases).map_err(|err| err.to_string())?;
            }
            id
        }
        None => {
            let created = db::create_project(&conn, &name, None).map_err(|err| err.to_string())?;
            db::set_project_aliases(&conn, created.id, &company.aliases)
                .map_err(|err| err.to_string())?;
            created.id
        }
    };
    drop(conn);

    if stored_id != Some(project_id) {
        store.set(COMPANY_PROJECT_ID_KEY, serde_json::Value::from(project_id));
        store.save().map_err(|err| err.to_string())?;
    }

    Ok(())
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
pub fn get_idle_lock(app: AppHandle) -> bool {
    detector::is_idle_locked(&app)
}

#[tauri::command]
pub fn set_idle_lock(app: AppHandle, enabled: bool) -> TrackingState {
    detector::set_idle_lock(&app, enabled)
}

#[tauri::command]
pub fn get_idle_timeout(app: AppHandle) -> u64 {
    detector::idle_timeout_secs(&app)
}

#[tauri::command]
pub fn set_idle_timeout(app: AppHandle, seconds: u64) -> Result<u64, String> {
    let seconds = seconds.clamp(IDLE_TIMEOUT_MIN_SECS, IDLE_TIMEOUT_MAX_SECS);
    detector::set_idle_timeout_secs(&app, seconds);

    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    store.set(IDLE_TIMEOUT_KEY, serde_json::Value::from(seconds));
    store.save().map_err(|err| err.to_string())?;

    Ok(seconds)
}

#[tauri::command]
pub fn get_lock_shortcut(app: AppHandle) -> Result<String, String> {
    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    Ok(store
        .get(LOCK_SHORTCUT_KEY)
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| DEFAULT_LOCK_SHORTCUT.to_string()))
}

/// Rebinds the global idle-lock shortcut. Keyboard-only (unlike the confirm
/// shortcut, which also accepts a mouse side button): the lock lives entirely
/// in the keyboard hotkey path, so a mouse binding here would silently never
/// fire. Registers the new hotkey before unregistering the old one so a bad
/// combination leaves the working one intact, and keeps `AppState.lock_shortcut`
/// in step so the shared handler can still tell a lock press from a confirm.
#[tauri::command]
pub fn set_lock_shortcut(
    app: AppHandle,
    state: State<AppState>,
    shortcut: String,
) -> Result<String, String> {
    if MouseButton::parse(&shortcut).is_some() {
        return Err("Il blocco supporta solo scorciatoie da tastiera.".to_string());
    }

    let previous = {
        let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
        store
            .get(LOCK_SHORTCUT_KEY)
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| DEFAULT_LOCK_SHORTCUT.to_string())
    };

    let manager = app.global_shortcut();
    let hotkey = parse_accelerator(&shortcut)?;
    manager.register(hotkey).map_err(|err| err.to_string())?;

    if previous != shortcut {
        if let Ok(previous_hotkey) = parse_accelerator(&previous) {
            let _ = manager.unregister(previous_hotkey);
        }
    }
    *state.lock_shortcut.lock().unwrap() = Some(hotkey);

    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    store.set(LOCK_SHORTCUT_KEY, serde_json::Value::String(shortcut.clone()));
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
