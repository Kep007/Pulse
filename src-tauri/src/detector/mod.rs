pub mod breaks;
pub mod browser_signal;
mod matcher;
pub mod mouse_hook;
mod win;

use crate::db;
use crate::models::{BreakPromptDto, PendingSuggestion, ResumeOfferDto, Source, TrackingState};
use breaks::{BreakEvent, BreakSchedule, BreakTracker, DayRecapSettings, ForgottenWork};
use browser_signal::{BrowserSignal, MatchIntent};
use chrono::{DateTime, Datelike, Local, TimeZone, Timelike, Utc};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::Shortcut;

pub use matcher::Matcher;
pub use win::{cursor_over_window, is_ctrl_pressed};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// Consecutive polls a newly-detected project/activity must hold before it
/// is committed. At POLL_INTERVAL=2s this commits 4-6s after the switch
/// first appears — long enough that flipping through open windows looking
/// for the right one (customers reported landing on the wrong project for
/// ~3s, realizing, and moving on — each such glance became a recorded
/// segment) never registers, short enough that a real switch still commits
/// almost immediately, and with `Candidate::first_seen` backdating none of
/// the wait is lost time. Was 2 (2-4s), which let those glances through;
/// glances that outlast even this are caught by the second line of defense,
/// micro-segment absorption in `db::transition_segment`.
const DEBOUNCE_HITS: u8 = 3;
/// Default seconds of no keyboard/mouse input before crediting time to
/// whatever project/activity is current stops — see the idle handling at the
/// top of `tick`. Deliberately keyboard-inclusive (not mouse-only): typing
/// counts as activity even with the mouse untouched. This is only the
/// fallback: the live value lives in `DetectorState::idle_timeout_secs`,
/// configurable from Settings (1m/2m/3m/5m/...) and loaded from the store at
/// startup.
pub const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 60;
/// A confirm prompt the user lets lapse (never answering Sì/No before the
/// foreground moves on) this many times in a row for the same suggestion is
/// muted for the rest of the session — the user has made clear, by ignoring
/// it, that they don't want to switch there.
const IGNORED_SUGGESTION_LIMIT: u8 = 5;

#[derive(Clone, PartialEq, Eq, Hash)]
struct Suggestion {
    project: Option<i64>,
    activity: Option<i64>,
}

struct Candidate {
    suggestion: Suggestion,
    hits: u8,
    /// When this suggestion was first noticed — used to backdate the
    /// eventual commit so the debounce wait itself (~2-4s) isn't lost time:
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
    /// When true the idle handling in `tick` is skipped entirely: no amount
    /// of inactivity closes the open segment, so a meeting, a call, or a long
    /// think keeps crediting time to the current project. Toggled from the
    /// widget button, the global lock shortcut, or Settings. Intentionally
    /// NOT persisted — it resets to off on every launch so a lock left on by
    /// accident can never silently inflate tomorrow's tracked time.
    idle_lock: bool,
    /// Live idle threshold in seconds (see `DEFAULT_IDLE_TIMEOUT_SECS`).
    /// Loaded from the settings store at startup and changed from Settings.
    idle_timeout_secs: u64,
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
    /// Consecutive unanswered confirm prompts per suggestion — reset as soon
    /// as the user answers that suggestion either way.
    ignored_counts: HashMap<Suggestion, u8>,
    /// Suggestions that hit IGNORED_SUGGESTION_LIMIT: never prompted again
    /// this session unless the user picks that project/activity by hand.
    /// In-memory only, like `idle_lock`, so a restart gives them a fresh start.
    muted: HashSet<Suggestion>,
    /// The user's scheduled daily break (lunch) — see `breaks`. Loaded from
    /// the settings store at startup, changed from Settings.
    break_schedule: BreakSchedule,
    break_tracker: BreakTracker,
    /// Set while the "Pausa pranzo — continua a lavorare?" prompt is up;
    /// holds the break's end (minutes since local midnight).
    break_prompt: Option<u32>,
    /// When the current pause began — used at a break's end to tell a pause
    /// taken *for* the break (resume it) from an unrelated earlier one.
    paused_at: Option<DateTime<Utc>>,
    forgotten_work: ForgottenWork,
    /// "You've been working on X since 15:02 — resume from there?"
    resume_offer: Option<(Suggestion, DateTime<Utc>)>,
    day_recap: DayRecapSettings,
    recap_shown_on: Option<chrono::NaiveDate>,
}

impl DetectorState {
    /// Records that the pending prompt lapsed without an answer. Returns the
    /// suggestion if this lapse is the one that mutes it.
    fn abandon_pending(&mut self) -> Option<Suggestion> {
        let suggestion = self.pending.take()?;
        let count = self.ignored_counts.entry(suggestion.clone()).or_insert(0);
        *count += 1;
        if *count >= IGNORED_SUGGESTION_LIMIT {
            self.ignored_counts.remove(&suggestion);
            self.muted.insert(suggestion.clone());
            return Some(suggestion);
        }
        None
    }

    fn forget_ignored(&mut self, suggestion: &Suggestion) {
        self.ignored_counts.remove(suggestion);
    }

    /// A hand-picked project/activity lifts any mute on it — the user has now
    /// shown they do work there.
    fn unmute_matching(&mut self, project: Option<i64>, activity: Option<i64>) {
        let matches = |s: &Suggestion| {
            (project.is_some() && s.project == project)
                || (project.is_none() && activity.is_some() && s.activity == activity)
        };
        self.muted.retain(|s| !matches(s));
        self.ignored_counts.retain(|s, _| !matches(s));
    }

    fn initial(now: DateTime<Utc>) -> Self {
        DetectorState {
            stable_project: None,
            stable_activity: None,
            source: Source::Auto,
            is_paused: false,
            is_idle: false,
            idle_lock: false,
            idle_timeout_secs: DEFAULT_IDLE_TIMEOUT_SECS,
            segment_started_at: now,
            today_seconds_before_segment: 0,
            candidate: None,
            pending: None,
            suppressed: None,
            ignored_counts: HashMap::new(),
            muted: HashSet::new(),
            break_schedule: BreakSchedule::default(),
            break_tracker: BreakTracker::default(),
            break_prompt: None,
            paused_at: None,
            forgotten_work: ForgottenWork::default(),
            resume_offer: None,
            day_recap: DayRecapSettings::default(),
            recap_shown_on: None,
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
    /// The active browser tab reported by the companion extension, if it's
    /// installed and running — see `browser_signal`. Stays `None` for the
    /// app's entire lifetime otherwise, which is what makes every browser
    /// tab fall back to plain window-title matching with no behavior change.
    pub browser_signal: Mutex<Option<BrowserSignal>>,
    /// The currently-registered global shortcut that toggles the idle lock,
    /// if any. The global-shortcut handler in `lib.rs` fires for *every*
    /// registered hotkey, so it compares the pressed one against this to tell
    /// a lock press apart from a confirm press. Kept in sync by
    /// `set_lock_shortcut` and set once at startup.
    pub lock_shortcut: Mutex<Option<Shortcut>>,
}

impl AppState {
    pub fn new(conn: Connection, company_terms: &[String]) -> rusqlite::Result<Self> {
        let projects = db::project_match_terms(&conn)?;
        let rules = db::activity_rules(&conn)?;

        Ok(AppState {
            db: Mutex::new(conn),
            matcher: Mutex::new(Matcher::build(&projects, &rules, company_terms)),
            detector: Mutex::new(DetectorState::initial(Utc::now())),
            activity_detection_enabled: Mutex::new(false),
            browser_signal: Mutex::new(None),
            lock_shortcut: Mutex::new(None),
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

/// Re-asserts the widget/toast windows' topmost z-order every tick. Windows
/// can silently knock an "always on top" window out of the topmost band
/// without ever clearing its flag — e.g. opening a File Explorer window has
/// been observed to leave the widget logically topmost but visually behind
/// it — so `alwaysOnTop: true` in tauri.conf.json alone isn't enough; it only
/// takes effect once, at window creation. Goes through `win::force_topmost`
/// (raw SetWindowPos), NOT `window.set_always_on_top(true)`: tao diffs
/// against its cached flags and silently drops the call when it believes the
/// window is already topmost — which is exactly the broken state being
/// repaired, so the previous implementation on top of it never did anything.
fn reassert_always_on_top(app: &AppHandle) {
    for label in ["main", "toast"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Ok(hwnd) = window.hwnd() {
                win::force_topmost(hwnd.0 as isize);
            }
        }
    }
}

/// What the foreground window says the user is working on. None while
/// Pulse's own windows are in front (never itself "an activity") or when the
/// foreground can't be read.
fn detect_foreground(state: &AppState) -> Option<(Suggestion, win::ForegroundInfo)> {
    let info = win::read_foreground_info()?;
    if info.process_name.eq_ignore_ascii_case("pulse") {
        return None;
    }

    // The companion browser extension (if installed) can override what gets
    // matched — e.g. a Pinterest pin's page title has nothing to do with
    // project detection, or WhatsApp Web's contact name (never present in
    // the OS window title, which stays "WhatsApp" regardless of which chat
    // is open) is a better match target than the title itself. Absent the
    // extension this is always `UseWindowTitle`, so behavior is unchanged.
    let match_intent = {
        let signal = state.browser_signal.lock().unwrap();
        browser_signal::resolve_match_text(&info, signal.as_ref(), Instant::now())
    };

    let (project, activity) = if match_intent == MatchIntent::Skip {
        (None, None)
    } else {
        let text: &str = match &match_intent {
            MatchIntent::UseText(text) => text,
            _ => &info.window_title,
        };
        let matcher = state.matcher.lock().unwrap();
        let activity_enabled = *state.activity_detection_enabled.lock().unwrap();
        (
            matcher.match_project(text, &info.process_name),
            activity_enabled
                .then(|| matcher.match_activity(text, &info.process_name))
                .flatten(),
        )
    };
    Some((Suggestion { project, activity }, info))
}

/// Minutes since local midnight on `date` → that instant in UTC.
fn local_minute_to_utc(date: chrono::NaiveDate, minute: u32) -> Option<DateTime<Utc>> {
    let naive = date.and_hms_opt(minute / 60, minute % 60, 0)?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|local| local.with_timezone(&Utc))
}

fn format_minute(minute: u32) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

/// A pause that began this long before the break window still counts as
/// "taken for the break" and gets resumed when it ends.
const BREAK_EARLY_PAUSE_MINUTES: i64 = 30;

/// Enters/leaves the user's scheduled break. Entering pauses whatever is
/// being tracked and asks "continue working?" (for the days with extra
/// work); leaving resumes a pause taken for the break — whether Pulse or the
/// user started it — so forgetting to un-pause after lunch never costs time.
fn handle_break_schedule(app: &AppHandle, state: &AppState, detector: &mut DetectorState) {
    let local = Local::now();
    let date = local.date_naive();
    let event = detector.break_tracker.update(
        &detector.break_schedule,
        date,
        local.weekday().num_days_from_monday(),
        local.hour() * 60 + local.minute(),
    );
    let has_tracking = detector.stable_project.is_some() || detector.stable_activity.is_some();

    match event {
        BreakEvent::None => {}
        BreakEvent::Started { end_minute } => {
            if !has_tracking || detector.is_paused {
                return;
            }
            let now = Utc::now();
            let conn = state.db.lock().unwrap();
            if !detector.is_idle {
                if let Err(err) = db::close_open_segment(&conn, now) {
                    log::error!("failed to close segment for scheduled break: {err}");
                }
            }
            enter_pause(detector, now);
            detector.break_prompt = Some(end_minute);
            let tracking_state = build_tracking_state(&conn, detector);
            drop(conn);
            let _ = app.emit("state-changed", &tracking_state);
        }
        BreakEvent::Ended { start_minute } => {
            let had_prompt = detector.break_prompt.take().is_some();
            let break_start = local_minute_to_utc(date, start_minute);
            let paused_for_break = match (detector.paused_at, break_start) {
                (Some(paused_at), Some(start)) => {
                    paused_at >= start - chrono::Duration::minutes(BREAK_EARLY_PAUSE_MINUTES)
                }
                _ => false,
            };
            if detector.is_paused && paused_for_break && has_tracking {
                resume_after_break(app, state, detector);
            } else if had_prompt {
                let conn = state.db.lock().unwrap();
                let tracking_state = build_tracking_state(&conn, detector);
                drop(conn);
                let _ = app.emit("state-changed", &tracking_state);
            }
        }
    }
}

fn resume_after_break(app: &AppHandle, state: &AppState, detector: &mut DetectorState) {
    detector.is_paused = false;
    clear_prompts(detector);
    let conn = state.db.lock().unwrap();
    let label = detection_label(&conn, detector.stable_project, detector.stable_activity);

    // Still away from the desk: go straight to idle rather than opening a
    // segment the idle check would then close *before* its own start. The
    // usual idle path reopens tracking the moment input comes back.
    if !detector.idle_lock && win::system_idle_seconds() >= detector.idle_timeout_secs {
        detector.is_idle = true;
        let tracking_state = build_tracking_state(&conn, detector);
        drop(conn);
        let _ = app.emit("state-changed", &tracking_state);
        emit_toast(app, &format!("Pausa finita · riprendo appena torni ({label})"));
        return;
    }

    let (project, activity, source) = (detector.stable_project, detector.stable_activity, detector.source);
    commit(app, detector, &conn, project, activity, source, None, None, Utc::now());
    drop(conn);
    emit_toast(app, &format!("Pausa finita · {label}"));
}

/// While paused, keeps watching the foreground: steady work on one project
/// for a few minutes means the user most likely forgot to resume, so Pulse
/// offers to — backdated to when that work started.
fn watch_forgotten_work(
    app: &AppHandle,
    state: &AppState,
    detector: &mut DetectorState,
    idle_seconds: u64,
    now: DateTime<Utc>,
) {
    let user_active = idle_seconds < detector.idle_timeout_secs;
    let detected = if user_active {
        detect_foreground(state)
            .map(|(suggestion, _)| suggestion)
            .filter(|suggestion| suggestion.project.is_some() || suggestion.activity.is_some())
    } else {
        None
    };
    let offer = detector.forgotten_work.observe(
        detected.map(|suggestion| (suggestion.project, suggestion.activity)),
        user_active,
        now,
    );
    if let Some(((project, activity), since)) = offer {
        detector.break_prompt = None;
        detector.resume_offer = Some((Suggestion { project, activity }, since));
        let conn = state.db.lock().unwrap();
        let tracking_state = build_tracking_state(&conn, detector);
        drop(conn);
        let _ = app.emit("state-changed", &tracking_state);
    }
}

/// "Rivedi la giornata": once per working day, at the configured time and
/// only while the user is at the desk to see it, sums today per project and
/// hands it to the toast window.
fn maybe_show_day_recap(
    app: &AppHandle,
    state: &AppState,
    detector: &mut DetectorState,
    now: DateTime<Utc>,
) {
    let local = Local::now();
    let date = local.date_naive();
    let settings = detector.day_recap.clone();
    if !settings.due(
        &mut detector.recap_shown_on,
        date,
        local.weekday().num_days_from_monday(),
        local.hour() * 60 + local.minute(),
    ) {
        return;
    }
    emit_day_recap(app, state, now);
}

/// The recap on demand (Settings → "Mostra ora"). False when nothing has
/// been tracked today, so there's nothing to show.
pub fn show_day_recap_now(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    emit_day_recap(app, &state, Utc::now())
}

/// Sums today per project and hands it to the toast window. False when
/// today is still empty.
fn emit_day_recap(app: &AppHandle, state: &AppState, now: DateTime<Utc>) -> bool {
    let Some(midnight) = local_minute_to_utc(Local::now().date_naive(), 0) else {
        return false;
    };
    let conn = state.db.lock().unwrap();
    let totals = match db::project_totals_since(&conn, midnight, now) {
        Ok(totals) => totals,
        Err(err) => {
            log::error!("failed to build day recap: {err}");
            return false;
        }
    };
    let total_seconds: i64 = totals.iter().map(|(_, seconds)| seconds).sum();
    if total_seconds <= 0 {
        return false;
    }
    let projects = totals
        .into_iter()
        .filter_map(|(project_id, seconds)| {
            let project = db::get_project(&conn, project_id?).ok().flatten()?;
            Some(crate::models::BreakdownEntry {
                id: project.id,
                name: project.name,
                color: project.color,
                seconds,
            })
        })
        .collect();
    drop(conn);
    let _ = app.emit(
        "day-recap",
        &crate::models::DayRecapDto {
            total_seconds,
            projects,
        },
    );
    true
}

pub fn day_recap_settings(app: &AppHandle) -> DayRecapSettings {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    detector.day_recap.clone()
}

/// Updates the live settings. Persistence is the caller's job.
pub fn set_day_recap_settings(app: &AppHandle, settings: DayRecapSettings) {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.day_recap = settings;
}

fn enter_pause(detector: &mut DetectorState, at: DateTime<Utc>) {
    detector.is_paused = true;
    detector.is_idle = false;
    detector.paused_at = Some(at);
    detector.pending = None;
    detector.candidate = None;
    clear_prompts(detector);
}

/// Any change of tracking the user makes themselves answers every
/// outstanding break/forgotten-work prompt.
fn clear_prompts(detector: &mut DetectorState) {
    detector.break_prompt = None;
    detector.resume_offer = None;
    detector.forgotten_work.reset();
}

fn tick(app: &AppHandle) {
    reassert_always_on_top(app);

    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();

    handle_break_schedule(app, &state, &mut detector);

    let idle_seconds = win::system_idle_seconds();
    let now = Utc::now();

    if idle_seconds < detector.idle_timeout_secs {
        maybe_show_day_recap(app, &state, &mut detector, now);
    }

    if detector.is_paused {
        watch_forgotten_work(app, &state, &mut detector, idle_seconds, now);
        return;
    }

    // The idle lock (meeting/thinking mode) suppresses the whole idle branch:
    // no matter how long the system stays untouched, the open segment is left
    // running. Falling through to the reopen branch below also means a lock
    // engaged *after* the app had already gone idle resumes tracking here on
    // the next tick, without waiting for real input.
    if !detector.idle_lock && idle_seconds >= detector.idle_timeout_secs {
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
                log::error!("failed to close segment on idle: {err}");
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

    let Some((detected, info)) = detect_foreground(&state) else {
        return;
    };

    if detector.suppressed.as_ref() != Some(&detected) {
        detector.suppressed = None;
    }

    // Already surfaced this exact suggestion and it's awaiting a decision via
    // the toast — nothing new to do until the user confirms/denies it or the
    // foreground detection changes to something else.
    if detector.pending.as_ref() == Some(&detected) {
        return;
    }

    if detected.project == detector.stable_project && detected.activity == detector.stable_activity
    {
        detector.candidate = None;
        // The foreground window drifted back to the manually-pinned
        // project/activity before the pending suggestion was acted on — drop
        // it and let the toast auto-dismiss instead of leaving a stale
        // confirm prompt around.
        if detector.pending.is_some() {
            let newly_muted = detector.abandon_pending();
            let conn = state.db.lock().unwrap();
            let tracking_state = build_tracking_state(&conn, &detector);
            let _ = app.emit("state-changed", &tracking_state);
            if let Some(muted) = newly_muted {
                emit_muted_toast(app, &conn, &muted);
            }
        }
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

    log::debug!(
        "window_title={:?} process_name={:?} -> project={:?} activity={:?}",
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
    // commit to that moment is what keeps the ~2-4s debounce wait from
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

    if detector.muted.contains(&detected) {
        return;
    }

    // A different prompt still on screen was never answered — it lapses and
    // counts toward muting that suggestion.
    let newly_muted = detector.abandon_pending();

    // A manually-pinned project/activity stays maximum priority: keep
    // tracking it uninterrupted and only surface the switch as a suggestion
    // — the timer must not stop just because a confirmation is pending.
    detector.pending = Some(detected.clone());

    let conn = state.db.lock().unwrap();
    let tracking_state = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &tracking_state);
    if let Some(muted) = newly_muted {
        emit_muted_toast(app, &conn, &muted);
    }
    if let Some(pending) = &tracking_state.pending {
        let _ = app.emit("suggestion-pending", pending);
    }
}

fn emit_muted_toast(app: &AppHandle, conn: &Connection, suggestion: &Suggestion) {
    let label = detection_label(conn, suggestion.project, suggestion.activity);
    emit_toast(app, &format!("Suggerimento disattivato · {label}"));
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

/// Called both internally (always after setup() has run) and directly from
/// the frontend's very first IPC call on mount — which can arrive before
/// `app.manage(AppState)` finishes on a slow first run (fresh install,
/// migrations running for the first time). `app.state()` panics in that
/// case, and a panic here (inside an IPC command handler, which is an FFI
/// callback from the webview) can't unwind and hard-crashes the whole
/// process instead of surfacing a normal error — so this uses the
/// non-panicking `try_state` and returns a plain "nothing tracked yet"
/// default instead, which the frontend already renders correctly on its own
/// (the "state-changed" event fills in the real state moments later).
pub fn get_current_state(app: &AppHandle) -> TrackingState {
    let Some(state) = app.try_state::<AppState>() else {
        return TrackingState {
            project: None,
            activity_type: None,
            source: Source::Auto,
            is_paused: false,
            is_idle: false,
            is_idle_locked: false,
            segment_started_at: Utc::now().to_rfc3339(),
            today_seconds_before_segment: 0,
            pending: None,
            resume_offer: None,
            break_prompt: None,
        };
    };
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
    let company = crate::commands::settings::company_terms(app);
    let mut matcher = state.matcher.lock().unwrap();
    *matcher = Matcher::build(&projects, &rules, &company);
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
    clear_prompts(&mut detector);
    detector.unmute_matching(project_id, None);
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
    clear_prompts(&mut detector);
    detector.unmute_matching(None, activity_type_id);
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

/// Stops the clock without discarding which project/activity was active —
/// only the open segment is closed (mirroring the idle handling in `tick`),
/// so the widget keeps showing that project, just paused, instead of
/// dropping to "no project" and losing the pin.
pub fn pause(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    let now = Utc::now();
    enter_pause(&mut detector, now);
    let conn = state.db.lock().unwrap();
    if let Err(err) = db::close_open_segment(&conn, now) {
        log::error!("failed to close segment on pause: {err}");
    }
    let result = build_tracking_state(&conn, &detector);
    drop(conn);
    let _ = app.emit("state-changed", &result);
    emit_toast(app, "Tracciamento in pausa");
    result
}

/// Resuming reopens tracking on whatever project/activity/source was frozen
/// at pause time, starting now — it does not re-run auto-detection, so a
/// manually-pinned project comes back exactly as it was left instead of
/// being replaced by whatever the foreground window happens to be now.
pub fn resume(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.is_paused = false;
    detector.is_idle = false;
    detector.pending = None;
    detector.suppressed = None;
    clear_prompts(&mut detector);

    let project_id = detector.stable_project;
    let activity_type_id = detector.stable_activity;
    let source = detector.source;

    let conn = state.db.lock().unwrap();
    let result = commit(
        app,
        &mut detector,
        &conn,
        project_id,
        activity_type_id,
        source,
        None,
        None,
        Utc::now(),
    );
    emit_toast(app, "Tracciamento ripreso");
    result
}

/// "Pausa pranzo — continua a lavorare": the user is doing extra time, so
/// tracking picks up again right away. The day's break doesn't fire again.
pub fn continue_through_break(app: &AppHandle) -> TrackingState {
    resume(app)
}

/// Acknowledges the break prompt without resuming — the pause stays.
pub fn dismiss_break_prompt(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.break_prompt = None;
    let conn = state.db.lock().unwrap();
    let result = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &result);
    result
}

/// Resumes the offered forgotten work from when it actually started — the
/// minutes spent working while still paused are credited, not lost.
pub fn accept_resume_offer(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    let Some((suggestion, since)) = detector.resume_offer.take() else {
        let conn = state.db.lock().unwrap();
        return build_tracking_state(&conn, &detector);
    };
    detector.is_paused = false;
    detector.is_idle = false;
    detector.pending = None;
    clear_prompts(&mut detector);
    let conn = state.db.lock().unwrap();
    let label = detection_label(&conn, suggestion.project, suggestion.activity);
    let result = commit(
        app,
        &mut detector,
        &conn,
        suggestion.project,
        suggestion.activity,
        Source::Auto,
        None,
        None,
        since,
    );
    drop(conn);
    let since_local = since.with_timezone(&Local);
    emit_toast(
        app,
        &format!("Ripreso dalle {} · {label}", format_minute(since_local.hour() * 60 + since_local.minute())),
    );
    result
}

/// "No" to the forgotten-work offer: stay paused, and don't offer that same
/// project again during this pause.
pub fn decline_resume_offer(app: &AppHandle) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    if let Some((suggestion, _)) = detector.resume_offer.take() {
        detector
            .forgotten_work
            .decline((suggestion.project, suggestion.activity));
    }
    let conn = state.db.lock().unwrap();
    let result = build_tracking_state(&conn, &detector);
    let _ = app.emit("state-changed", &result);
    result
}

/// Recomputes "already tracked today" for the current project after the
/// history was edited by hand, and pushes it to the widget.
pub fn refresh_today_total(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    let conn = state.db.lock().unwrap();
    let at = detector.segment_started_at;
    let today_start = at
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| DateTime::from_naive_utc_and_offset(naive, Utc))
        .unwrap_or(at);
    detector.today_seconds_before_segment = db::seconds_tracked_since(
        &conn,
        detector.stable_project,
        detector.stable_activity,
        today_start,
    )
    .unwrap_or(0);
    let tracking_state = build_tracking_state(&conn, &detector);
    drop(conn);
    let _ = app.emit("state-changed", &tracking_state);
}

pub fn break_schedule(app: &AppHandle) -> BreakSchedule {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    detector.break_schedule.clone()
}

/// Updates the live schedule. Persistence is the caller's job.
pub fn set_break_schedule(app: &AppHandle, schedule: BreakSchedule) {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.break_schedule = schedule;
}

/// Engages or releases the idle lock (see `DetectorState::idle_lock`).
///
/// Engaging while the app is already idle immediately reopens tracking on
/// whatever was current, so the lock retroactively rescues the moment it's
/// turned on rather than only stopping *future* idling.
///
/// Releasing while the system is *already* past the idle threshold closes the
/// open segment at `now` and enters idle here, rather than leaving it for the
/// next tick — which would backdate the close to when input actually stopped
/// (see the idle branch in `tick`) and erase exactly the stretch the lock was
/// protecting.
pub fn set_idle_lock(app: &AppHandle, enabled: bool) -> TrackingState {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.idle_lock = enabled;

    let has_tracking = detector.stable_project.is_some() || detector.stable_activity.is_some();
    let conn = state.db.lock().unwrap();
    let result = if enabled && detector.is_idle {
        detector.is_idle = false;
        let project_id = detector.stable_project;
        let activity_type_id = detector.stable_activity;
        let source = detector.source;
        commit(
            app,
            &mut detector,
            &conn,
            project_id,
            activity_type_id,
            source,
            None,
            None,
            Utc::now(),
        )
    } else {
        if !enabled
            && !detector.is_idle
            && has_tracking
            && win::system_idle_seconds() >= detector.idle_timeout_secs
        {
            if let Err(err) = db::close_open_segment(&conn, Utc::now()) {
                log::error!("failed to close segment on lock release: {err}");
            }
            detector.is_idle = true;
            detector.candidate = None;
        }
        let tracking_state = build_tracking_state(&conn, &detector);
        let _ = app.emit("state-changed", &tracking_state);
        tracking_state
    };
    drop(conn);
    emit_toast(
        app,
        if enabled {
            "Blocco inattività attivo"
        } else {
            "Blocco inattività disattivato"
        },
    );
    result
}

/// Flips the idle lock — the entry point for the global lock shortcut, which
/// only knows "the user pressed it", not which way to move.
pub fn toggle_idle_lock(app: &AppHandle) {
    let current = {
        let state = app.state::<AppState>();
        let detector = state.detector.lock().unwrap();
        detector.idle_lock
    };
    let _ = set_idle_lock(app, !current);
}

pub fn is_idle_locked(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    detector.idle_lock
}

pub fn idle_timeout_secs(app: &AppHandle) -> u64 {
    let state = app.state::<AppState>();
    let detector = state.detector.lock().unwrap();
    detector.idle_timeout_secs
}

/// Sets the live idle threshold (seconds). Persistence to the settings store
/// is the caller's job — this only updates the in-memory poller state.
pub fn set_idle_timeout_secs(app: &AppHandle, seconds: u64) {
    let state = app.state::<AppState>();
    let mut detector = state.detector.lock().unwrap();
    detector.idle_timeout_secs = seconds;
}

/// The entry point for the system-wide confirm triggers (global keyboard
/// shortcut, mouse side-button hook): those fire on *every* press of their
/// binding, whatever the user is doing, and the common case by far is
/// "nothing to confirm" — so that path must exit after one in-memory check,
/// without ever touching the database the way `confirm_pending_suggestion`'s
/// state rebuild does.
pub fn confirm_pending_if_any(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let (has_offer, has_break_prompt, has_pending) = {
        let detector = state.detector.lock().unwrap();
        (
            detector.resume_offer.is_some(),
            detector.break_prompt.is_some(),
            detector.pending.is_some(),
        )
    };
    if has_offer {
        let _ = accept_resume_offer(app);
        return;
    }
    if has_break_prompt {
        let _ = continue_through_break(app);
        return;
    }
    if !has_pending {
        return;
    }
    // Tiny race window between the check and this call is harmless:
    // confirm_pending_suggestion re-checks `pending` under the same lock.
    let _ = confirm_pending_suggestion(app);
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

    detector.forget_ignored(&suggestion);
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
        detector.forget_ignored(&suggestion);
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
        log::error!("failed to write time segment: {err}");
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

/// Closes whatever segment is currently open, without starting a new one —
/// call this right before the app actually quits (tray "Esci", the quit
/// command) so the stretch while the app is closed is never later absorbed
/// into whatever project happens to resume at next launch. Uses `try_state`
/// since quitting can in principle race very early startup before
/// `AppState` is managed.
pub fn close_for_shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let conn = state.db.lock().unwrap();
    if let Err(err) = db::close_open_segment(&conn, Utc::now()) {
        log::error!("failed to close segment on shutdown: {err}");
    }
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
    detector.ignored_counts.clear();
    detector.muted.clear();
    detector.is_paused = false;
    clear_prompts(&mut detector);

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
        is_idle_locked: detector.idle_lock,
        segment_started_at: detector.segment_started_at.to_rfc3339(),
        today_seconds_before_segment: detector.today_seconds_before_segment,
        pending,
        resume_offer: detector.resume_offer.as_ref().map(|(suggestion, since)| ResumeOfferDto {
            project: suggestion
                .project
                .and_then(|id| db::get_project(conn, id).ok().flatten()),
            activity_type: suggestion
                .activity
                .and_then(|id| db::get_activity_type(conn, id).ok().flatten()),
            since: since.to_rfc3339(),
        }),
        break_prompt: detector.break_prompt.map(|end_minute| BreakPromptDto {
            ends_at: format_minute(end_minute),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suggestion(project: i64) -> Suggestion {
        Suggestion { project: Some(project), activity: None }
    }

    #[test]
    fn suggestion_is_muted_after_limit_of_unanswered_prompts() {
        let mut state = DetectorState::initial(Utc::now());
        for round in 1..=IGNORED_SUGGESTION_LIMIT {
            state.pending = Some(suggestion(7));
            let muted = state.abandon_pending();
            assert_eq!(muted.is_some(), round == IGNORED_SUGGESTION_LIMIT);
        }
        assert!(state.muted.contains(&suggestion(7)));
        assert!(state.pending.is_none());
    }

    #[test]
    fn answering_resets_the_streak() {
        let mut state = DetectorState::initial(Utc::now());
        for _ in 1..IGNORED_SUGGESTION_LIMIT {
            state.pending = Some(suggestion(7));
            state.abandon_pending();
        }
        state.forget_ignored(&suggestion(7));
        state.pending = Some(suggestion(7));
        assert!(state.abandon_pending().is_none());
    }

    #[test]
    fn picking_the_project_by_hand_unmutes_it() {
        let mut state = DetectorState::initial(Utc::now());
        state.muted.insert(suggestion(7));
        state.muted.insert(suggestion(8));
        state.unmute_matching(Some(7), None);
        assert!(!state.muted.contains(&suggestion(7)));
        assert!(state.muted.contains(&suggestion(8)));
    }
}
