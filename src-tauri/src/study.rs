//! Detection study ("Fase 1"): for a month, record what the detector saw on
//! screen, what it matched and how the user corrected it, so the next round
//! of detection improvements is driven by real data. Local by default; on
//! day 31 the export is uploaded once to the private sync repository (when
//! sync is configured) and a red reminder shows at every launch until the
//! study is closed.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

pub const STUDY_DAYS: i64 = 31;
const RETENTION_DAYS: i64 = 35;
/// Same window seen again within this gap continues the same row (ticks are
/// every 2s; a short hop elsewhere and back starts a new one anyway).
const CONTINUE_GAP_SECS: i64 = 10;

const STARTED_KEY: &str = "study_started_at";
const CLOSED_KEY: &str = "study_closed_at";
const UPLOADED_KEY: &str = "study_uploaded_at";

pub struct Observation<'a> {
    pub process: &'a str,
    pub title: &'a str,
    pub matched_text: &'a str,
    pub detected_project_id: Option<i64>,
    pub matched_term: Option<&'a str>,
    pub tracked_project_id: Option<i64>,
    pub paused: bool,
}

/// The row being extended, so a window held for an hour is one row, not 1800.
#[derive(Default)]
pub struct Recorder {
    current: Option<(i64, String, DateTime<Utc>)>,
}

impl Recorder {
    pub fn record(&mut self, conn: &Connection, now: DateTime<Utc>, seen: &Observation) -> rusqlite::Result<()> {
        let state = if seen.paused { "paused" } else { "tracking" };
        let key = format!(
            "{}\u{1}{}\u{1}{}\u{1}{:?}\u{1}{:?}\u{1}{}",
            seen.process, seen.title, seen.matched_text, seen.detected_project_id, seen.tracked_project_id, state
        );
        if let Some((id, current_key, last_seen)) = &mut self.current {
            if *current_key == key && (now - *last_seen).num_seconds() <= CONTINUE_GAP_SECS {
                conn.execute(
                    "UPDATE detection_log SET ended_at = ?1 WHERE id = ?2",
                    rusqlite::params![now.to_rfc3339(), *id],
                )?;
                *last_seen = now;
                return Ok(());
            }
        }
        conn.execute(
            "INSERT INTO detection_log
                (started_at, ended_at, process, title, matched_text, detected_project_id,
                 matched_term, tracked_project_id, state)
             VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                now.to_rfc3339(),
                seen.process,
                seen.title,
                seen.matched_text,
                seen.detected_project_id,
                seen.matched_term,
                seen.tracked_project_id,
                state,
            ],
        )?;
        self.current = Some((conn.last_insert_rowid(), key, now));
        Ok(())
    }
}

pub fn record_event(conn: &Connection, kind: &str, project_id: Option<i64>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO detection_events (at, kind, project_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![Utc::now().to_rfc3339(), kind, project_id],
    )?;
    Ok(())
}

pub fn prune(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<()> {
    let cutoff = (now - Duration::days(RETENTION_DAYS)).to_rfc3339();
    conn.execute("DELETE FROM detection_log WHERE started_at < ?1", [&cutoff])?;
    conn.execute("DELETE FROM detection_events WHERE at < ?1", [&cutoff])?;
    Ok(())
}

fn meta(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

fn clear_meta(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM app_meta WHERE key = ?1", [key])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyStatus {
    pub active: bool,
    pub started_at: Option<String>,
    pub days_elapsed: i64,
    pub due: bool,
    pub uploaded_at: Option<String>,
    pub windows_logged: i64,
}

pub fn status(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<StudyStatus> {
    let started_at = meta(conn, STARTED_KEY)?;
    let closed = meta(conn, CLOSED_KEY)?.is_some();
    let active = started_at.is_some() && !closed;
    let days_elapsed = started_at
        .as_deref()
        .and_then(|started| DateTime::parse_from_rfc3339(started).ok())
        .map(|started| (now - started.with_timezone(&Utc)).num_days())
        .unwrap_or(0);
    let windows_logged = conn.query_row("SELECT COUNT(*) FROM detection_log", [], |row| row.get(0))?;
    Ok(StudyStatus {
        active,
        started_at,
        days_elapsed,
        due: active && days_elapsed >= STUDY_DAYS,
        uploaded_at: meta(conn, UPLOADED_KEY)?,
        windows_logged,
    })
}

/// Starts a fresh study (clearing any previous one's data).
pub fn start(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM detection_log", [])?;
    conn.execute("DELETE FROM detection_events", [])?;
    set_meta(conn, STARTED_KEY, &now.to_rfc3339())?;
    clear_meta(conn, CLOSED_KEY)?;
    clear_meta(conn, UPLOADED_KEY)
}

/// Ends the study: stops recording and the reminder, and deletes the log.
pub fn close(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM detection_log", [])?;
    conn.execute("DELETE FROM detection_events", [])?;
    set_meta(conn, CLOSED_KEY, &now.to_rfc3339())
}

pub fn mark_uploaded(conn: &Connection, now: DateTime<Utc>) -> rusqlite::Result<()> {
    set_meta(conn, UPLOADED_KEY, &now.to_rfc3339())
}

/// Cheap check (two meta lookups) for the hot paths that record.
pub fn is_active(conn: &Connection) -> bool {
    matches!(meta(conn, STARTED_KEY), Ok(Some(_))) && matches!(meta(conn, CLOSED_KEY), Ok(None))
}

/// Records a correction event only while a study is running.
pub fn record_event_if_active(conn: &Connection, kind: &str, project_id: Option<i64>) {
    if is_active(conn) {
        if let Err(err) = record_event(conn, kind, project_id) {
            log::warn!("study: failed to record {kind}: {err}");
        }
    }
}

/// The whole study as one JSON document: the log, the corrections, and the
/// project catalog (names + aliases) so ids can be read without the DB.
pub fn export_json(conn: &Connection, now: DateTime<Utc>, device_name: &str) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT started_at, ended_at, process, title, matched_text, detected_project_id,
                matched_term, tracked_project_id, state
         FROM detection_log ORDER BY started_at",
    )?;
    let log: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            let started: String = row.get(0)?;
            let ended: String = row.get(1)?;
            let seconds = match (DateTime::parse_from_rfc3339(&started), DateTime::parse_from_rfc3339(&ended)) {
                (Ok(a), Ok(b)) => (b - a).num_seconds() + 2,
                _ => 0,
            };
            Ok(serde_json::json!({
                "startedAt": started,
                "seconds": seconds,
                "process": row.get::<_, String>(2)?,
                "title": row.get::<_, String>(3)?,
                "matchedText": row.get::<_, String>(4)?,
                "detectedProjectId": row.get::<_, Option<i64>>(5)?,
                "matchedTerm": row.get::<_, Option<String>>(6)?,
                "trackedProjectId": row.get::<_, Option<i64>>(7)?,
                "state": row.get::<_, String>(8)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare("SELECT at, kind, project_id FROM detection_events ORDER BY at")?;
    let events: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "at": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "projectId": row.get::<_, Option<i64>>(2)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let projects: Vec<serde_json::Value> = crate::db::list_projects(conn)?
        .into_iter()
        .map(|project| serde_json::json!({ "id": project.id, "name": project.name, "aliases": project.aliases }))
        .collect();

    let document = serde_json::json!({
        "format": "pulse-detection-study/1",
        "exportedAt": now.to_rfc3339(),
        "device": device_name,
        "pulseVersion": env!("CARGO_PKG_VERSION"),
        "status": status(conn, now)?,
        "projects": projects,
        "log": log,
        "events": events,
    });
    Ok(serde_json::to_string_pretty(&document).expect("serializable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::run_migrations(&conn).unwrap();
        conn
    }

    fn seen<'a>(title: &'a str, detected: Option<i64>) -> Observation<'a> {
        Observation {
            process: "explorer",
            title,
            matched_text: title,
            detected_project_id: detected,
            matched_term: None,
            tracked_project_id: Some(1),
            paused: false,
        }
    }

    fn rows(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM detection_log", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn a_window_held_still_is_one_row_and_a_change_starts_another() {
        let conn = test_conn();
        let mut recorder = Recorder::default();
        let t0 = Utc::now();
        for tick in 0..30 {
            recorder
                .record(&conn, t0 + Duration::seconds(tick * 2), &seen("Ottobre - Esplora file", None))
                .unwrap();
        }
        assert_eq!(rows(&conn), 1);
        recorder
            .record(&conn, t0 + Duration::seconds(62), &seen("brief.pdf - Chrome", Some(2)))
            .unwrap();
        assert_eq!(rows(&conn), 2);
        // Coming back after a long gap is a new stretch, not the old row.
        recorder
            .record(&conn, t0 + Duration::seconds(300), &seen("brief.pdf - Chrome", Some(2)))
            .unwrap();
        assert_eq!(rows(&conn), 3);
    }

    #[test]
    fn study_becomes_due_after_31_days_until_closed() {
        let conn = test_conn();
        let t0 = Utc::now();
        assert!(!status(&conn, t0).unwrap().active);
        start(&conn, t0).unwrap();
        assert!(!status(&conn, t0 + Duration::days(30)).unwrap().due);
        assert!(status(&conn, t0 + Duration::days(31)).unwrap().due);
        close(&conn, t0 + Duration::days(32)).unwrap();
        let closed = status(&conn, t0 + Duration::days(40)).unwrap();
        assert!(!closed.active && !closed.due);
    }

    #[test]
    fn export_contains_log_events_and_projects() {
        let conn = test_conn();
        start(&conn, Utc::now()).unwrap();
        let mut recorder = Recorder::default();
        recorder.record(&conn, Utc::now(), &seen("Ottobre", None)).unwrap();
        record_event(&conn, "manual_project", Some(1)).unwrap();
        let json: serde_json::Value = serde_json::from_str(&export_json(&conn, Utc::now(), "PC").unwrap()).unwrap();
        assert_eq!(json["log"].as_array().unwrap().len(), 1);
        assert_eq!(json["events"][0]["kind"], "manual_project");
        assert!(json["projects"].as_array().unwrap().len() > 0);
    }

    #[test]
    fn pruning_drops_rows_older_than_retention() {
        let conn = test_conn();
        let mut recorder = Recorder::default();
        let old = Utc::now() - Duration::days(40);
        recorder.record(&conn, old, &seen("vecchio", None)).unwrap();
        recorder.record(&conn, Utc::now(), &seen("nuovo", None)).unwrap();
        prune(&conn, Utc::now()).unwrap();
        assert_eq!(rows(&conn), 1);
    }
}

// ---- Commands & reminder ----------------------------------------------------

use crate::detector::{self, AppState};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyExportDto {
    pub path: String,
    pub uploaded_to: Option<String>,
    pub upload_error: Option<String>,
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".to_string())
}

#[tauri::command]
pub fn get_study_status(app: AppHandle) -> Result<StudyStatus, String> {
    let state = app.state::<AppState>();
    let conn = state.db.lock().unwrap();
    status(&conn, Utc::now()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn start_study(app: AppHandle) -> Result<StudyStatus, String> {
    let result = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        start(&conn, Utc::now()).map_err(|err| err.to_string())?;
        status(&conn, Utc::now()).map_err(|err| err.to_string())?
    };
    detector::set_study_active(&app, true);
    Ok(result)
}

#[tauri::command]
pub fn close_study(app: AppHandle) -> Result<StudyStatus, String> {
    detector::set_study_active(&app, false);
    let state = app.state::<AppState>();
    let conn = state.db.lock().unwrap();
    close(&conn, Utc::now()).map_err(|err| err.to_string())?;
    status(&conn, Utc::now()).map_err(|err| err.to_string())
}

/// Writes the export to Documenti (shown in Explorer) and, when sync is set
/// up, also commits it to the private repository.
async fn export(app: &AppHandle, reveal: bool) -> Result<StudyExportDto, String> {
    let now = Utc::now();
    let content = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        export_json(&conn, now, &device_name()).map_err(|err| err.to_string())?
    };
    let name = format!("pulse-studio-rilevamento-{}.json", now.format("%Y-%m-%d"));
    let dir = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| crate::db::data_dir(app));
    let path = dir.join(&name);
    std::fs::write(&path, &content).map_err(|err| err.to_string())?;

    let (uploaded_to, upload_error) = if crate::sync::is_configured(app) {
        match crate::sync::upload_study_file(app, &name, content).await {
            Ok(location) => {
                let state = app.state::<AppState>();
                let conn = state.db.lock().unwrap();
                let _ = mark_uploaded(&conn, now);
                (Some(location), None)
            }
            Err(err) => (None, Some(err)),
        }
    } else {
        (None, None)
    };

    if reveal {
        let _ = app.opener().reveal_item_in_dir(&path);
    }
    Ok(StudyExportDto {
        path: path.to_string_lossy().to_string(),
        uploaded_to,
        upload_error,
    })
}

#[tauri::command]
pub async fn export_study(app: AppHandle) -> Result<StudyExportDto, String> {
    export(&app, true).await
}

/// The user opted into the study for every PC, so it starts by itself on
/// the first launch of a version that has it — unless one already ran or
/// was closed here.
pub fn ensure_started(app: &AppHandle) {
    let started = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        let fresh = matches!(meta(&conn, STARTED_KEY), Ok(None)) && matches!(meta(&conn, CLOSED_KEY), Ok(None));
        fresh && start(&conn, Utc::now()).is_ok()
    };
    if started {
        log::info!("detection study started");
        detector::set_study_active(app, true);
    }
}

/// At startup: past day 31, upload the study once on its own (if sync is
/// set up) and show the red reminder — every launch, until it's closed.
pub fn spawn_reminder(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Let the toast window load first.
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        let current = {
            let state = app.state::<AppState>();
            let conn = state.db.lock().unwrap();
            let _ = prune(&conn, Utc::now());
            status(&conn, Utc::now())
        };
        let Ok(current) = current else {
            return;
        };
        if !current.due {
            return;
        }
        if current.uploaded_at.is_none() && crate::sync::is_configured(&app) {
            match export(&app, false).await {
                Ok(result) => log::info!("study auto-export: {:?}", result.uploaded_to),
                Err(err) => log::warn!("study auto-export failed: {err}"),
            }
        }
        let latest = {
            let state = app.state::<AppState>();
            let conn = state.db.lock().unwrap();
            status(&conn, Utc::now()).unwrap_or(current)
        };
        let _ = app.emit("study-reminder", &latest);
    });
}
