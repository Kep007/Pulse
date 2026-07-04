use crate::db;
use crate::detector::{self, AppState};
use crate::models::ProjectDto;
use chrono::Utc;
use tauri::{AppHandle, State};

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
    Ok(())
}

#[tauri::command]
pub fn reorder_projects(state: State<AppState>, ordered_ids: Vec<i64>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::reorder_projects(&conn, &ordered_ids).map_err(|err| err.to_string())
}
