use crate::db;
use crate::detector::{self, AppState};
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter, Manager};

fn parse_instant(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| format!("Orario non valido: {value}"))
}

/// Everything showing tracked time has to catch up after a manual edit: the
/// widget's "today" counter and the Home window's charts and timeline.
fn after_history_edit(app: &AppHandle) {
    detector::refresh_today_total(app);
    let _ = app.emit("history-changed", ());
}

/// Adds or edits a block of time by hand (see `db::write_time_range`).
#[tauri::command]
pub fn save_time_range(
    app: AppHandle,
    replace_ids: Vec<i64>,
    project_id: Option<i64>,
    start: String,
    end: String,
) -> Result<(), String> {
    let (start, end) = (parse_instant(&start)?, parse_instant(&end)?);
    {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        db::write_time_range(&conn, &replace_ids, project_id, None, start, end, Utc::now())
            .map_err(|err| err.to_string())?;
    }
    after_history_edit(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_time_entries(app: AppHandle, ids: Vec<i64>) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        db::delete_time_entries(&conn, &ids).map_err(|err| err.to_string())?;
    }
    after_history_edit(&app);
    Ok(())
}
