mod matcher;
mod win;

use crate::db;
use crate::models::{PendingSuggestion, Source, TrackingState};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub use matcher::Matcher;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Consecutive polls a newly-detected project/activity must hold before it
/// is proposed to the user — filters out a quick alt-tab glance.
const DEBOUNCE_HITS: u8 = 3;

#[derive(Clone, PartialEq)]
struct Suggestion {
    project: Option<i64>,
    activity: Option<i64>,
}

struct Candidate {
    suggestion: Suggestion,
    hits: u8,
}

pub struct DetectorState {
    stable_project: Option<i64>,
    stable_activity: Option<i64>,
    source: Source,
    is_paused: bool,
    segment_started_at: DateTime<Utc>,
    candidate: Option<Candidate>,
    /// An auto-detected project/activity waiting for the user to confirm or
    /// deny it via the toast window or the global confirm shortcut.
    pending: Option<Suggestion>,
    /// The last suggestion the user denied — held so the exact same
    /// detection isn't re-proposed every debounce cycle; cleared as soon as
    /// the foreground detection differs from it even once.
    suppressed: Option<Suggestion>,
}

impl DetectorState {
    fn initial(now: DateTime<Utc>) -> Self {
        DetectorState {
            stable_project: None,
            stable_activity: None,
            source: Source::Auto,
            is_paused: false,
            segment_started_at: now,
            candidate: None,
            pending: None,
            suppressed: None,
        }
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub matcher: Mutex<Matcher>,
    detector: Mutex<DetectorState>,
}

impl AppState {
    pub fn new(conn: Connection) -> rusqlite::Result<Self> {
        let projects = db::project_match_terms(&conn)?;
        let rules = db::activity_rules(&conn)?;

        Ok(AppState {
            db: Mutex::new(conn),
            matcher: Mutex::new(Matcher::build(&projects, &rules)),
            detector: Mutex::new(DetectorState::initial(Utc::now())),
        })
    }
}

/// Starts the background loop that polls the foreground window every
/// `POLL_INTERVAL` and reconciles it against the debounced tracking state.
pub fn spawn_polling(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        loop {
            interval.tick().await;
            tick(&app);
        }
    });
}

fn tick(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();

    if detector.is_paused {
        return;
    }

    let Some(info) = win::read_foreground_info() else {
        return;
    };

    // Looking at Pulse's own windows (the widget, Home, a toast) is never
    // itself "an activity" — ignore the tick entirely rather than let it
    // count as detected idle time and reset the current segment.
    if info.process_name.eq_ignore_ascii_case("pulse") {
        return;
    }

    let (detected_project, detected_activity) = {
        let matcher = state.matcher.lock().unwrap();
        (
            matcher.match_project(&info.window_title, &info.process_name),
            matcher.match_activity(&info.window_title, &info.process_name),
        )
    };
    let detected = Suggestion {
        project: detected_project,
        activity: detected_activity,
    };

    if detector.suppressed.as_ref() != Some(&detected) {
        detector.suppressed = None;
    }

    if detected.project == detector.stable_project && detected.activity == detector.stable_activity
    {
        detector.candidate = None;
        return;
    }

    let should_commit = match detector.candidate.as_mut() {
        Some(candidate) if candidate.suggestion == detected => {
            candidate.hits += 1;
            candidate.hits >= DEBOUNCE_HITS
        }
        _ => {
            detector.candidate = Some(Candidate {
                suggestion: detected.clone(),
                hits: 1,
            });
            false
        }
    };

    if !should_commit {
        return;
    }

    detector.candidate = None;

    // Reverting to "nothing detected" needs no confirmation — there's no
    // specific claim being made that could be wrong.
    let is_idle = detected.project.is_none() && detected.activity.is_none();
    if is_idle {
        let conn = state.db.lock().unwrap();
        commit(
            app,
            &mut detector,
            &conn,
            None,
            None,
            Source::Auto,
            Some(&info.window_title),
            Some(&info.process_name),
        );
        return;
    }

    if detector.suppressed.as_ref() == Some(&detected) {
        return;
    }

    detector.pending = Some(detected.clone());
    detector.is_paused = true;

    let conn = state.db.lock().unwrap();
    let tracking_state = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &tracking_state);
    if let Some(pending) = &tracking_state.pending {
        let _ = app.emit("suggestion-pending", pending);
    }
}

pub fn get_current_state(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    let conn = state.db.lock().unwrap();
    build_tracking_state(&conn, &detector)
}

pub fn set_active_project(app: &AppHandle, project_id: Option<i64>) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.pending = None;
    detector.is_paused = false;
    let conn = state.db.lock().unwrap();
    let activity_type_id = detector.stable_activity;
    let label = project_id
        .and_then(|id| db::get_project(&conn, id).ok().flatten())
        .map(|p| p.name)
        .unwrap_or_else(|| "Nessun progetto".to_string());
    let result = commit(
        app,
        &mut detector,
        &conn,
        project_id,
        activity_type_id,
        Source::Manual,
        None,
        None,
    );
    emit_toast(app, &format!("Progetto: {label}"));
    result
}

pub fn set_active_activity(app: &AppHandle, activity_type_id: Option<i64>) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.pending = None;
    detector.is_paused = false;
    let conn = state.db.lock().unwrap();
    let project_id = detector.stable_project;
    let label = activity_type_id
        .and_then(|id| db::get_activity_type(&conn, id).ok().flatten())
        .map(|a| a.name)
        .unwrap_or_else(|| "Nessuna attività".to_string());
    let result = commit(
        app,
        &mut detector,
        &conn,
        project_id,
        activity_type_id,
        Source::Manual,
        None,
        None,
    );
    emit_toast(app, &format!("Attività: {label}"));
    result
}

pub fn pause(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.is_paused = true;
    detector.pending = None;
    let conn = state.db.lock().unwrap();
    let result = commit(app, &mut detector, &conn, None, None, Source::Manual, None, None);
    emit_toast(app, "Tracciamento in pausa");
    result
}

/// Resuming always re-enters automatic detection, re-evaluating the
/// foreground window immediately instead of waiting for the next poll.
pub fn resume(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.is_paused = false;
    detector.pending = None;
    detector.suppressed = None;

    let info = win::read_foreground_info();
    let (project_id, activity_type_id) = match &info {
        Some(info) => {
            let matcher = state.matcher.lock().unwrap();
            (
                matcher.match_project(&info.window_title, &info.process_name),
                matcher.match_activity(&info.window_title, &info.process_name),
            )
        }
        None => (None, None),
    };

    let conn = state.db.lock().unwrap();
    let result = commit(
        app,
        &mut detector,
        &conn,
        project_id,
        activity_type_id,
        Source::Auto,
        info.as_ref().map(|i| i.window_title.as_str()),
        info.as_ref().map(|i| i.process_name.as_str()),
    );
    emit_toast(app, "Tracciamento ripreso");
    result
}

/// Applies a pending auto-detected suggestion (confirmed via the toast
/// window or the global confirm shortcut). No-op if nothing is pending.
pub fn confirm_pending_suggestion(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();

    let Some(suggestion) = detector.pending.take() else {
        let conn = state.db.lock().unwrap();
        return build_tracking_state(&conn, &detector);
    };

    detector.suppressed = None;
    detector.is_paused = false;
    let conn = state.db.lock().unwrap();
    commit(
        app,
        &mut detector,
        &conn,
        suggestion.project,
        suggestion.activity,
        Source::Auto,
        None,
        None,
    )
}

/// Rejects a pending auto-detected suggestion, resuming tracking on whatever
/// was active before it — and remembers the rejection so the exact same
/// suggestion isn't immediately proposed again.
pub fn deny_pending_suggestion(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();

    if let Some(suggestion) = detector.pending.take() {
        detector.suppressed = Some(suggestion);
    }
    detector.is_paused = false;

    let conn = state.db.lock().unwrap();
    let tracking_state = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &tracking_state);
    tracking_state
}

fn commit(
    app: &AppHandle,
    detector: &mut DetectorState,
    conn: &Connection,
    project_id: Option<i64>,
    activity_type_id: Option<i64>,
    source: Source,
    window_title: Option<&str>,
    process_name: Option<&str>,
) -> TrackingState {
    let now = Utc::now();

    if let Err(err) = db::transition_segment(
        conn,
        project_id,
        activity_type_id,
        source,
        now,
        window_title,
        process_name,
    ) {
        eprintln!("Pulse: failed to write time segment: {err}");
    }

    detector.stable_project = project_id;
    detector.stable_activity = activity_type_id;
    detector.source = source;
    detector.segment_started_at = now;
    detector.candidate = None;

    let state = build_tracking_state(conn, detector);
    let _ = app.emit("state-changed", &state);
    state
}

fn emit_toast(app: &AppHandle, text: &str) {
    let _ = app.emit(
        "toast-message",
        &crate::models::ToastMessage {
            text: text.to_string(),
        },
    );
}

/// Wipes tracked history and resets the in-memory detector to idle so the
/// widget reflects the empty state immediately, without waiting for the
/// next poll to notice the DB changed out from under it.
pub fn reset_all_data(app: &AppHandle) -> Result<TrackingState, String> {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    let conn = state.db.lock().unwrap();

    let now = Utc::now();
    db::reset_all_data(&conn, now).map_err(|err| err.to_string())?;

    detector.stable_project = None;
    detector.stable_activity = None;
    detector.source = Source::Auto;
    detector.segment_started_at = now;
    detector.candidate = None;
    detector.pending = None;
    detector.suppressed = None;

    let tracking_state = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &tracking_state);
    drop(conn);
    emit_toast(app, "Dati azzerati");
    Ok(tracking_state)
}

fn build_tracking_state(conn: &Connection, detector: &DetectorState) -> TrackingState {
    let project = detector
        .stable_project
        .and_then(|id| db::get_project(conn, id).ok().flatten());
    let activity_type = detector
        .stable_activity
        .and_then(|id| db::get_activity_type(conn, id).ok().flatten());
    let pending = detector.pending.as_ref().map(|suggestion| PendingSuggestion {
        project: suggestion
            .project
            .and_then(|id| db::get_project(conn, id).ok().flatten()),
        activity_type: suggestion
            .activity
            .and_then(|id| db::get_activity_type(conn, id).ok().flatten()),
    });

    TrackingState {
        project,
        activity_type,
        source: detector.source,
        is_paused: detector.is_paused,
        segment_started_at: detector.segment_started_at.to_rfc3339(),
        pending,
    }
}
