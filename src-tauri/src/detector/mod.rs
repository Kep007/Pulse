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
pub use win::is_ctrl_pressed;

const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Consecutive polls a newly-detected project/activity must hold before it
/// is proposed to the user — filters out a quick alt-tab glance. At
/// POLL_INTERVAL=2s this commits ~10s after the switch first appears, per
/// the user's ask: a project switch should only take effect once it's been
/// the foreground window for a real stretch, not a glance.
const DEBOUNCE_HITS: u8 = 6;
/// No keyboard/mouse input for this long stops crediting time to whatever
/// project/activity is current — see the idle handling at the top of
/// `tick`. Deliberately keyboard-inclusive (not mouse-only): typing counts
/// as activity even with the mouse untouched.
const IDLE_THRESHOLD_SECS: u64 = 60;

#[derive(Clone, PartialEq)]
struct Suggestion {
    project: Option<i64>,
    activity: Option<i64>,
}

struct Candidate {
    suggestion: Suggestion,
    hits: u8,
    /// When this suggestion was first noticed — used to backdate the
    /// eventual commit so the debounce wait itself (~10s) isn't lost time:
    /// the new segment starts when the window actually changed, not when
    /// the app finally became confident enough to act on it.
    first_seen: DateTime<Utc>,
}

pub struct DetectorState {
    stable_project: Option<i64>,
    stable_activity: Option<i64>,
    source: Source,
    is_paused: bool,
    /// True once system-wide idle time has crossed IDLE_THRESHOLD_SECS.
    /// stable_project/stable_activity are left untouched while idle — only
    /// the open DB segment is closed — so resuming activity can reopen
    /// tracking on the same one without waiting for a fresh detection.
    is_idle: bool,
    segment_started_at: DateTime<Utc>,
    /// Seconds already tracked today on the current project/activity before
    /// `segment_started_at` — recomputed by `commit` every time a segment
    /// opens. See TrackingState::today_seconds_before_segment.
    today_seconds_before_segment: i64,
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
            is_idle: false,
            segment_started_at: now,
            today_seconds_before_segment: 0,
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
    /// Whether the poller attempts to match an activity type at all.
    /// Projects are the priority right now — activity detection is real but
    /// parked, off by default, and flippable from Settings without touching
    /// this architecture again once it's wanted back.
    pub activity_detection_enabled: Mutex<bool>,
}

impl AppState {
    pub fn new(conn: Connection) -> rusqlite::Result<Self> {
        let projects = db::project_match_terms(&conn)?;
        let rules = db::activity_rules(&conn)?;

        Ok(AppState {
            db: Mutex::new(conn),
            matcher: Mutex::new(Matcher::build(&projects, &rules)),
            detector: Mutex::new(DetectorState::initial(Utc::now())),
            activity_detection_enabled: Mutex::new(false),
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

    let idle_seconds = win::system_idle_seconds();
    let now = Utc::now();

    if idle_seconds >= IDLE_THRESHOLD_SECS {
        // Only worth entering idle if something was actually being tracked —
        // otherwise there's no segment to close and nothing to protect.
        if !detector.is_idle
            && (detector.stable_project.is_some() || detector.stable_activity.is_some())
        {
            // The system went quiet `idle_seconds` ago, not just now that
            // this poll noticed — backdating the close is what keeps that
            // whole stretch out of the project's tracked time instead of
            // only the portion after this tick.
            let idle_started_at = now - chrono::Duration::seconds(idle_seconds as i64);
            let conn = state.db.lock().unwrap();
            if let Err(err) = db::close_open_segment(&conn, idle_started_at) {
                eprintln!("Pulse: failed to close segment on idle: {err}");
            }
            detector.is_idle = true;
            detector.candidate = None;
            let tracking_state = build_tracking_state(&conn, &detector);
            drop(conn);
            let _ = app.emit("state-changed", &tracking_state);
        }
        return;
    }

    if detector.is_idle {
        // Input is back — reopen tracking on whatever was current before,
        // starting now rather than waiting for a fresh detection.
        detector.is_idle = false;
        let project_id = detector.stable_project;
        let activity_type_id = detector.stable_activity;
        let source = detector.source;
        let conn = state.db.lock().unwrap();
        commit(
            app,
            &mut detector,
            &conn,
            project_id,
            activity_type_id,
            source,
            None,
            None,
            now,
        );
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
        let activity_enabled = *state.activity_detection_enabled.lock().unwrap();
        (
            matcher.match_project(&info.window_title, &info.process_name),
            activity_enabled
                .then(|| matcher.match_activity(&info.window_title, &info.process_name))
                .flatten(),
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

    // A foreground window that doesn't match any project or activity (File
    // Explorer, Pinterest for reference, a quick web search) isn't itself
    // idle — the user is very plausibly still on whatever was last
    // confirmed, just glancing elsewhere. Ignoring it outright, without
    // touching an in-flight candidate, means it can't reset progress toward
    // a genuine switch that's mid-debounce, and it never on its own drops
    // the current segment to "no project" the way it used to.
    if detected.project.is_none() && detected.activity.is_none() {
        return;
    }

    eprintln!(
        "Pulse: window_title={:?} process_name={:?} -> project={:?} activity={:?}",
        info.window_title, info.process_name, detected.project, detected.activity
    );

    let should_commit = match detector.candidate.as_mut() {
        Some(candidate) if candidate.suggestion == detected => {
            candidate.hits += 1;
            candidate.hits >= DEBOUNCE_HITS
        }
        _ => {
            detector.candidate = Some(Candidate {
                suggestion: detected.clone(),
                hits: 1,
                first_seen: Utc::now(),
            });
            false
        }
    };

    if !should_commit {
        return;
    }

    // The window actually changed back when the candidate first appeared,
    // not just now that the debounce finally cleared — backdating the
    // commit to that moment is what keeps the ~10s debounce wait from
    // being lost time on every single switch.
    let detected_since = detector
        .candidate
        .as_ref()
        .map(|candidate| candidate.first_seen)
        .unwrap_or_else(Utc::now);
    detector.candidate = None;

    if detector.suppressed.as_ref() == Some(&detected) {
        return;
    }

    // The current segment being Source::Auto means it was itself just a
    // guess — a new detection can replace it without asking. The confirm
    // dialog (below) is reserved for protecting a *deliberate* manual
    // choice, which is why it only applies in the Source::Manual branch.
    if detector.source == Source::Auto {
        let conn = state.db.lock().unwrap();
        let label = detection_label(&conn, detected.project, detected.activity);
        commit(
            app,
            &mut detector,
            &conn,
            detected.project,
            detected.activity,
            Source::Auto,
            Some(&info.window_title),
            Some(&info.process_name),
            detected_since,
        );
        drop(conn);
        emit_toast(app, &label);
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

/// "Progetto: X · Attività" for the info toast shown when an auto-detected
/// change replaces another auto-detected segment (see the Source::Auto
/// branch in `tick`) — no confirmation needed, but still worth surfacing.
fn detection_label(conn: &Connection, project_id: Option<i64>, activity_id: Option<i64>) -> String {
    let project_name = project_id.and_then(|id| db::get_project(conn, id).ok().flatten()).map(|p| p.name);
    let activity_name = activity_id
        .and_then(|id| db::get_activity_type(conn, id).ok().flatten())
        .map(|a| a.name);

    match (project_name, activity_name) {
        (Some(p), Some(a)) => format!("Progetto: {p} · {a}"),
        (Some(p), None) => format!("Progetto: {p}"),
        (None, Some(a)) => format!("Attività: {a}"),
        (None, None) => "Progetto aggiornato".to_string(),
    }
}

pub fn get_current_state(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    let conn = state.db.lock().unwrap();
    build_tracking_state(&conn, &detector)
}

/// Recompiles the in-memory matcher from the current project/alias/activity
/// rule catalog — matching itself never touches SQLite, so any project
/// create/rename/archive would otherwise keep being matched (or not
/// matched) against stale data until the next app restart.
pub fn refresh_matcher(app: &AppHandle) -> rusqlite::Result<()> {
    let state = app.state::<AppState>();
    let (projects, rules) = {
        let conn = state.db.lock().unwrap();
        (db::project_match_terms(&conn)?, db::activity_rules(&conn)?)
    };
    let mut matcher = state.matcher.lock().unwrap();
    *matcher = Matcher::build(&projects, &rules);
    Ok(())
}

/// Re-emits the current tracking state so the widget picks up a project
/// rename/archive immediately, instead of waiting for the next auto-detect
/// tick or manual action to refresh its display.
pub fn refresh_state(app: &AppHandle) {
    let state = get_current_state(app);
    let _ = app.emit("state-changed", &state);
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
        Utc::now(),
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
        Utc::now(),
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
    let result = commit(
        app,
        &mut detector,
        &conn,
        None,
        None,
        Source::Manual,
        None,
        None,
        Utc::now(),
    );
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
        Utc::now(),
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
        Utc::now(),
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
    at: DateTime<Utc>,
) -> TrackingState {
    if let Err(err) = db::transition_segment(
        conn,
        project_id,
        activity_type_id,
        source,
        at,
        window_title,
        process_name,
    ) {
        eprintln!("Pulse: failed to write time segment: {err}");
    }

    let today_start = at
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| DateTime::from_naive_utc_and_offset(naive, Utc))
        .unwrap_or(at);
    detector.today_seconds_before_segment =
        db::seconds_tracked_since(conn, project_id, activity_type_id, today_start).unwrap_or(0);

    detector.stable_project = project_id;
    detector.stable_activity = activity_type_id;
    detector.source = source;
    detector.segment_started_at = at;
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
    detector.is_idle = false;
    detector.segment_started_at = now;
    detector.today_seconds_before_segment = 0;
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
        is_idle: detector.is_idle,
        segment_started_at: detector.segment_started_at.to_rfc3339(),
        today_seconds_before_segment: detector.today_seconds_before_segment,
        pending,
    }
}
