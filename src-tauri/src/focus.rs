//! Focus-quality metrics built from raw segments: how long uninterrupted
//! stretches on one project last, and how often the user jumps between
//! projects. Pure — `commands::stats::get_focus_stats` feeds it.

use chrono::{DateTime, Utc};
use std::collections::HashMap;

/// A same-project gap up to this long (a glance elsewhere, a coffee) doesn't
/// end a session; anything longer (idle, pause, lunch) does.
pub const SESSION_GAP_SECS: i64 = 5 * 60;
/// Sessions at least this long count as deep work.
pub const DEEP_WORK_SECS: i64 = 25 * 60;
/// Sessions shorter than this count as interrupted.
pub const SHORT_SESSION_SECS: i64 = 10 * 60;

pub struct FocusSegment {
    pub project_id: Option<i64>,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub seconds: i64,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct FocusTotals {
    pub tracked_seconds: i64,
    pub deep_work_seconds: i64,
    pub sessions: i64,
    pub short_sessions: i64,
    /// Project changes with no real break in between.
    pub switches: i64,
}

impl FocusTotals {
    fn add_session(&mut self, seconds: i64) {
        self.tracked_seconds += seconds;
        self.sessions += 1;
        if seconds >= DEEP_WORK_SECS {
            self.deep_work_seconds += seconds;
        }
        if seconds < SHORT_SESSION_SECS {
            self.short_sessions += 1;
        }
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct FocusReport {
    pub overall: FocusTotals,
    pub by_project: HashMap<i64, FocusTotals>,
}

/// `segments` must be sorted by start. Segments without a project still
/// count toward the overall totals (as their own "project"), so time spent
/// on unassigned windows can't make the day look more focused than it was.
pub fn analyze(segments: &[FocusSegment]) -> FocusReport {
    let mut report = FocusReport::default();
    let mut current: Option<(Option<i64>, DateTime<Utc>, i64)> = None;

    let close = |report: &mut FocusReport, project: Option<i64>, seconds: i64| {
        report.overall.add_session(seconds);
        if let Some(id) = project {
            report.by_project.entry(id).or_default().add_session(seconds);
        }
    };

    for segment in segments.iter().filter(|segment| segment.seconds > 0) {
        match current.as_mut() {
            Some((project, end, seconds)) => {
                let gap = (segment.start - *end).num_seconds();
                if *project == segment.project_id && gap <= SESSION_GAP_SECS {
                    *seconds += segment.seconds;
                    *end = (*end).max(segment.end);
                    continue;
                }
                let switched = *project != segment.project_id && gap <= SESSION_GAP_SECS;
                let (finished_project, finished_seconds) = (*project, *seconds);
                close(&mut report, finished_project, finished_seconds);
                if switched {
                    report.overall.switches += 1;
                    if let Some(id) = finished_project {
                        report.by_project.entry(id).or_default().switches += 1;
                    }
                }
                current = Some((segment.project_id, segment.end, segment.seconds));
            }
            None => current = Some((segment.project_id, segment.end, segment.seconds)),
        }
    }
    if let Some((project, _, seconds)) = current {
        close(&mut report, project, seconds);
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    fn seg(project: i64, start_min: i64, minutes: i64) -> FocusSegment {
        let base = Utc.with_ymd_and_hms(2026, 9, 28, 9, 0, 0).unwrap();
        let start = base + Duration::minutes(start_min);
        FocusSegment {
            project_id: Some(project),
            start,
            end: start + Duration::minutes(minutes),
            seconds: minutes * 60,
        }
    }

    #[test]
    fn same_project_across_a_short_gap_is_one_deep_session() {
        // 20 min, 3 min gap, 20 min on the same project → one 40 min session.
        let report = analyze(&[seg(1, 0, 20), seg(1, 23, 20)]);
        assert_eq!(report.overall.sessions, 1);
        assert_eq!(report.overall.deep_work_seconds, 40 * 60);
        assert_eq!(report.overall.switches, 0);
    }

    #[test]
    fn hopping_between_projects_counts_switches_and_short_sessions() {
        let report = analyze(&[seg(1, 0, 5), seg(2, 5, 5), seg(1, 10, 30), seg(2, 40, 5)]);
        assert_eq!(report.overall.sessions, 4);
        assert_eq!(report.overall.switches, 3);
        assert_eq!(report.overall.short_sessions, 3);
        assert_eq!(report.overall.deep_work_seconds, 30 * 60);
        let project_one = &report.by_project[&1];
        assert_eq!(project_one.sessions, 2);
        assert_eq!(project_one.deep_work_seconds, 30 * 60);
        assert_eq!(project_one.switches, 2, "left project 1 twice for another project");
    }

    #[test]
    fn a_real_break_ends_a_session_without_counting_as_a_switch() {
        let report = analyze(&[seg(1, 0, 30), seg(2, 60, 30)]);
        assert_eq!(report.overall.sessions, 2);
        assert_eq!(report.overall.switches, 0);
        assert_eq!(report.overall.deep_work_seconds, 60 * 60);
    }
}
