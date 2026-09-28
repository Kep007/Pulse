//! Keeps the user's PCs in step through a private GitHub repository. Each PC
//! publishes only its own closed sessions (one file per day under
//! `devices/<its id>/`) and imports the others' into `remote_entries`, which
//! every chart reads alongside local history. Local history is never written
//! by a sync, so a sync can't corrupt it.

pub mod github;
pub mod store;

use crate::commands::settings::settings_store_path;
use crate::detector::{self, AppState};
use github::{GitHub, PushError};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use store::{DayFile, FORMAT_VERSION};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;

const REPO_KEY: &str = "syncRepo";
const ENABLED_KEY: &str = "syncEnabled";
const DEVICE_ID_KEY: &str = "deviceId";
const KEYRING_SERVICE: &str = "Pulse";
const KEYRING_USER: &str = "github-sync";
const FIRST_SYNC_DELAY: Duration = Duration::from_secs(30);
const SYNC_INTERVAL: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub struct SyncRuntime {
    running: AtomicBool,
    last_sync: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusDto {
    pub repo: Option<String>,
    pub enabled: bool,
    pub has_token: bool,
    pub device_name: String,
    pub running: bool,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| err.to_string())
}

fn read_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok().filter(|token| !token.is_empty())
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".to_string())
}

/// Stable per-installation id, created on first use and kept next to the
/// database (both live in the same data folder, so they always travel
/// together).
fn device_id(app: &AppHandle) -> Result<String, String> {
    let store = app.store(settings_store_path(app)).map_err(|err| err.to_string())?;
    if let Some(id) = store.get(DEVICE_ID_KEY).and_then(|value| value.as_str().map(str::to_string)) {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    store.set(DEVICE_ID_KEY, serde_json::Value::String(id.clone()));
    store.save().map_err(|err| err.to_string())?;
    Ok(id)
}

fn config(app: &AppHandle) -> (Option<String>, bool) {
    let Ok(store) = app.store(settings_store_path(app)) else {
        return (None, false);
    };
    let repo = store
        .get(REPO_KEY)
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|repo| !repo.is_empty());
    let enabled = store.get(ENABLED_KEY).and_then(|value| value.as_bool()).unwrap_or(false);
    (repo, enabled)
}

fn status(app: &AppHandle) -> SyncStatusDto {
    let (repo, enabled) = config(app);
    let runtime = app.state::<SyncRuntime>();
    let last_sync = runtime.last_sync.lock().unwrap().clone();
    let last_error = runtime.last_error.lock().unwrap().clone();
    SyncStatusDto {
        repo,
        enabled,
        has_token: read_token().is_some(),
        device_name: device_name(),
        running: runtime.running.load(Ordering::SeqCst),
        last_sync,
        last_error,
    }
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let ok = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    };
    ok(owner) && ok(name)
}

/// One full round: publish this PC's changed days, then import the other
/// PCs' changed days. Network calls never hold the database lock.
async fn run_sync(app: &AppHandle) -> Result<(), String> {
    let (repo, _) = config(app);
    let repo = repo.ok_or("Imposta prima il repository GitHub.")?;
    let token = read_token().ok_or("Inserisci prima il token GitHub.")?;
    let my_device = device_id(app)?;
    let my_name = device_name();
    let gh = GitHub::new(&repo, &token)?;
    let state = app.state::<AppState>();

    let mut attempt = 0;
    let items = loop {
        attempt += 1;
        let head = gh.head().await?;
        let items = gh.tree(&head.tree_sha).await?;

        let days = {
            let conn = state.db.lock().unwrap();
            store::local_days(&conn).map_err(|err| err.to_string())?
        };
        let mut changes: Vec<(String, Option<String>)> = Vec::new();
        for (day, entries) in &days {
            let file = DayFile {
                version: FORMAT_VERSION,
                device_id: my_device.clone(),
                device_name: my_name.clone(),
                day: day.clone(),
                entries: entries.clone(),
            };
            let content = serde_json::to_string_pretty(&file).map_err(|err| err.to_string())?;
            let path = store::day_path(&my_device, day);
            let upstream = items.iter().find(|item| item.path == path).map(|item| item.sha.as_str());
            if upstream != Some(store::git_blob_sha(content.as_bytes()).as_str()) {
                changes.push((path, Some(content)));
            }
        }
        // Days this PC no longer has (deleted or reset here) go away upstream too.
        for item in &items {
            if let Some((device, day)) = store::parse_day_path(&item.path) {
                if device == my_device && !days.contains_key(day) {
                    changes.push((item.path.clone(), None));
                }
            }
        }

        if changes.is_empty() {
            break items;
        }
        let message = format!("{my_name}: {} giorni aggiornati", changes.len());
        match gh.commit_files(&head, &changes, &message).await {
            Ok(()) => break items,
            Err(PushError::Conflict) if attempt < 3 => continue,
            Err(PushError::Conflict) => return Err("L'altro PC sta sincronizzando: riprova tra poco.".to_string()),
            Err(PushError::Other(message)) => return Err(message),
        }
    };

    let imported = {
        let conn = state.db.lock().unwrap();
        store::imported_shas(&conn).map_err(|err| err.to_string())?
    };
    let mut other_paths = Vec::new();
    let mut changed_history = false;
    let mut created_projects = false;
    for item in &items {
        let Some((device, _)) = store::parse_day_path(&item.path) else {
            continue;
        };
        if device == my_device {
            continue;
        }
        other_paths.push(item.path.clone());
        if imported.get(&item.path) == Some(&item.sha) {
            continue;
        }
        let bytes = gh.blob(&item.sha).await?;
        let file: DayFile = match serde_json::from_slice(&bytes) {
            Ok(file) => file,
            Err(err) => {
                log::warn!("sync: skipping unreadable {}: {err}", item.path);
                continue;
            }
        };
        if file.version > FORMAT_VERSION {
            log::warn!("sync: {} was written by a newer Pulse, skipped", item.path);
            continue;
        }
        let conn = state.db.lock().unwrap();
        created_projects |= store::import_day(&conn, &file, &item.path, &item.sha)
            .map_err(|err| err.to_string())?;
        changed_history = true;
    }
    {
        let conn = state.db.lock().unwrap();
        if store::forget_missing(&conn, &other_paths).map_err(|err| err.to_string())? > 0 {
            changed_history = true;
        }
    }

    if created_projects {
        if let Err(err) = detector::refresh_matcher(app) {
            log::error!("sync: failed to refresh matcher: {err}");
        }
        let _ = app.emit(crate::commands::projects::CATALOG_CHANGED_EVENT, ());
    }
    if changed_history {
        detector::refresh_today_total(app);
        let _ = app.emit("history-changed", ());
    }
    Ok(())
}

async fn sync_once(app: &AppHandle) -> SyncStatusDto {
    let runtime = app.state::<SyncRuntime>();
    if runtime.running.swap(true, Ordering::SeqCst) {
        return status(app);
    }
    let _ = app.emit("sync-status", status(app));
    let result = run_sync(app).await;
    {
        let runtime = app.state::<SyncRuntime>();
        match result {
            Ok(()) => {
                *runtime.last_sync.lock().unwrap() = Some(chrono::Utc::now().to_rfc3339());
                *runtime.last_error.lock().unwrap() = None;
            }
            Err(err) => {
                log::warn!("sync failed: {err}");
                *runtime.last_error.lock().unwrap() = Some(err);
            }
        }
        runtime.running.store(false, Ordering::SeqCst);
    }
    let result = status(app);
    let _ = app.emit("sync-status", &result);
    result
}

/// Background sync: shortly after startup, then every SYNC_INTERVAL, only
/// while the user has it enabled and configured.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_SYNC_DELAY).await;
        let mut interval = tokio::time::interval(SYNC_INTERVAL);
        loop {
            interval.tick().await;
            let (repo, enabled) = config(&app);
            if enabled && repo.is_some() && read_token().is_some() {
                sync_once(&app).await;
            }
        }
    });
}

#[tauri::command]
pub fn get_sync_status(app: AppHandle) -> SyncStatusDto {
    status(&app)
}

/// Saves the repository and on/off switch; a non-empty `token` replaces the
/// stored one (an empty or missing one keeps it).
#[tauri::command]
pub fn set_sync_config(
    app: AppHandle,
    repo: String,
    token: Option<String>,
    enabled: bool,
) -> Result<SyncStatusDto, String> {
    let repo = repo
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_end_matches(".git")
        .trim_matches('/')
        .to_string();
    if !repo.is_empty() && !valid_repo(&repo) {
        return Err("Scrivi il repository come utente/nome, es. mario/pulse-sync.".to_string());
    }
    if let Some(token) = token.map(|token| token.trim().to_string()).filter(|token| !token.is_empty()) {
        keyring_entry()?.set_password(&token).map_err(|err| err.to_string())?;
    }
    let store = app.store(settings_store_path(&app)).map_err(|err| err.to_string())?;
    store.set(REPO_KEY, serde_json::Value::String(repo));
    store.set(ENABLED_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|err| err.to_string())?;
    Ok(status(&app))
}

#[tauri::command]
pub fn forget_sync_token(app: AppHandle) -> SyncStatusDto {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    status(&app)
}

#[tauri::command]
pub async fn sync_now(app: AppHandle) -> Result<SyncStatusDto, String> {
    Ok(sync_once(&app).await)
}

#[cfg(test)]
mod tests {
    use super::valid_repo;

    /// Round-trips a day file through a real repository, then removes it.
    /// Run with: PULSE_SYNC_TEST_REPO=owner/name PULSE_SYNC_TEST_TOKEN=...
    /// cargo test --lib github_round_trip -- --ignored
    #[test]
    #[ignore]
    fn github_round_trip() {
        use super::github::GitHub;
        use super::store::{day_path, git_blob_sha};
        let repo = std::env::var("PULSE_SYNC_TEST_REPO").unwrap();
        let token = std::env::var("PULSE_SYNC_TEST_TOKEN").unwrap();
        tauri::async_runtime::block_on(async {
            let gh = GitHub::new(&repo, &token).unwrap();
            let path = day_path("integration-test", "2000-01-01");
            let content = "{\"hello\":\"pulse\"}\n".to_string();

            let head = gh.head().await.unwrap();
            gh.commit_files(&head, &[(path.clone(), Some(content.clone()))], "test: write")
                .await
                .map_err(|err| format!("{err:?}"))
                .unwrap();

            let head = gh.head().await.unwrap();
            let item = gh
                .tree(&head.tree_sha)
                .await
                .unwrap()
                .into_iter()
                .find(|item| item.path == path)
                .expect("file committed");
            assert_eq!(item.sha, git_blob_sha(content.as_bytes()), "local blob sha matches GitHub's");
            assert_eq!(gh.blob(&item.sha).await.unwrap(), content.as_bytes());

            gh.commit_files(&head, &[(path.clone(), None)], "test: cleanup")
                .await
                .map_err(|err| format!("{err:?}"))
                .unwrap();
            let head = gh.head().await.unwrap();
            assert!(gh.tree(&head.tree_sha).await.unwrap().iter().all(|item| item.path != path));
        });
    }

    #[test]
    fn repo_names_are_owner_slash_name() {
        assert!(valid_repo("Kep007/pulse-sync"));
        assert!(!valid_repo("pulse-sync"));
        assert!(!valid_repo("a/b/c"));
        assert!(!valid_repo("a/b c"));
    }
}
