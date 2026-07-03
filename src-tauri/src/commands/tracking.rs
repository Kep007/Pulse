use crate::detector::{self, AppState};
use crate::models::{ActivityTypeDto, ProjectDto, TrackingState};
use crate::db;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_current_state(app: AppHandle) -> TrackingState {
    detector::get_current_state(&app)
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> Result<Vec<ProjectDto>, String> {
    let conn = state.db.lock().unwrap();
    db::list_projects(&conn).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_activity_types(state: State<AppState>) -> Result<Vec<ActivityTypeDto>, String> {
    let conn = state.db.lock().unwrap();
    db::list_activity_types(&conn).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_active_project(app: AppHandle, project_id: Option<i64>) -> TrackingState {
    detector::set_active_project(&app, project_id)
}

#[tauri::command]
pub fn set_active_activity(app: AppHandle, activity_type_id: Option<i64>) -> TrackingState {
    detector::set_active_activity(&app, activity_type_id)
}

#[tauri::command]
pub fn pause_tracking(app: AppHandle) -> TrackingState {
    detector::pause(&app)
}

#[tauri::command]
pub fn resume_tracking(app: AppHandle) -> TrackingState {
    detector::resume(&app)
}

#[tauri::command]
pub fn confirm_pending_suggestion(app: AppHandle) -> TrackingState {
    detector::confirm_pending_suggestion(&app)
}

#[tauri::command]
pub fn deny_pending_suggestion(app: AppHandle) -> TrackingState {
    detector::deny_pending_suggestion(&app)
}
