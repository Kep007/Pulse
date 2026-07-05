use crate::db;
use crate::detector::{self, AppState};
use crate::models::ProjectDto;
use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

// Emitted after any write to the project catalog (create/rename/archive/
// reorder) so every window's own list — the widget's ProjectPicker, the
// dashboard's filter dropdowns, etc. — can re-fetch instead of silently
// going stale until its component happens to remount. Payload-less: it's a
// "go re-fetch listProjects()" signal, not a diff.
const CATALOG_CHANGED_EVENT: &str = "catalog-changed";

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<AppState>,
    name: String,
    color: Option<String>,
) -> Result<ProjectDto, String> {
    let project = {
        let conn = state.db.lock().unwrap();
        db::create_project(&conn, name.trim(), color.as_deref()).map_err(|err| err.to_string())?
    };
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(project)
}

#[tauri::command]
pub fn update_project(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    name: String,
    color: Option<String>,
) -> Result<(), String> {
    {
        let conn = state.db.lock().unwrap();
        db::update_project(&conn, id, name.trim(), color.as_deref())
            .map_err(|err| err.to_string())?;
    }
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;
    detector::refresh_state(&app);
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn archive_project(app: AppHandle, state: State<AppState>, id: i64) -> Result<(), String> {
    {
        let conn = state.db.lock().unwrap();
        db::archive_project(&conn, id, Utc::now()).map_err(|err| err.to_string())?;
    }
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;
    detector::refresh_state(&app);
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn reorder_projects(
    app: AppHandle,
    state: State<AppState>,
    ordered_ids: Vec<i64>,
) -> Result<(), String> {
    {
        let conn = state.db.lock().unwrap();
        db::reorder_projects(&conn, &ordered_ids).map_err(|err| err.to_string())?;
    }
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn set_project_aliases(
    app: AppHandle,
    state: State<AppState>,
    project_id: i64,
    aliases: Vec<String>,
) -> Result<(), String> {
    {
        let conn = state.db.lock().unwrap();
        db::set_project_aliases(&conn, project_id, &aliases).map_err(|err| err.to_string())?;
    }
    detector::refresh_matcher(&app).map_err(|err| err.to_string())?;
    let _ = app.emit(CATALOG_CHANGED_EVENT, ());
    Ok(())
}
