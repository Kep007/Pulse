//! Pure logic for the scheduled break (e.g. lunch) and for spotting work the
//! user forgot to resume after a pause. No I/O here — `detector::tick` feeds
//! in the clock and the foreground detection and acts on what comes back.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakDay {
    pub enabled: bool,
    /// "HH:MM", local time.
    pub start: String,
    pub end: String,
}

/// One entry per weekday, Monday first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakSchedule {
    pub enabled: bool,
    pub days: Vec<BreakDay>,
}

impl Default for BreakSchedule {
    fn default() -> Self {
        let day = |enabled| BreakDay {
            enabled,
            start: "13:00".to_string(),
            end: "14:00".to_string(),
        };
        BreakSchedule {
            enabled: false,
            days: vec![day(true), day(true), day(true), day(true), day(true), day(false), day(false)],
        }
    }
}

pub fn parse_hhmm(value: &str) -> Option<u32> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let (hours, minutes): (u32, u32) = (hours.parse().ok()?, minutes.parse().ok()?);
    (hours < 24 && minutes < 60).then_some(hours * 60 + minutes)
}

impl BreakSchedule {
    /// Always seven days, each with a valid `start < end` — anything stored by
    /// an older/hand-edited settings file is repaired instead of trusted.
    pub fn normalized(mut self) -> Self {
        let defaults = BreakSchedule::default().days;
        self.days.truncate(7);
        while self.days.len() < 7 {
            self.days.push(defaults[self.days.len()].clone());
        }
        for (day, fallback) in self.days.iter_mut().zip(defaults) {
            match (parse_hhmm(&day.start), parse_hhmm(&day.end)) {
                (Some(start), Some(end)) if start < end => {}
                _ => {
                    day.start = fallback.start;
                    day.end = fallback.end;
                }
            }
        }
        self
    }

    /// (start, end) in minutes since local midnight, if that weekday has a
    /// break. `weekday` is 0 = Monday.
    pub fn window_on(&self, weekday: u32) -> Option<(u32, u32)> {
        if !self.enabled {
            return None;
        }
        let day = self.days.get(weekday as usize).filter(|day| day.enabled)?;
        Some((parse_hhmm(&day.start)?, parse_hhmm(&day.end)?))
    }
}

#[derive(Debug, PartialEq)]
pub enum BreakEvent {
    None,
    Started { end_minute: u32 },
    Ended { start_minute: u32 },
}

#[derive(Debug, Default)]
pub struct BreakTracker {
    active: Option<(NaiveDate, u32, u32)>,
    /// A day's break fires at most once — resuming by hand mid-break (extra
    /// work) must not get paused again on the next tick.
    handled_on: Option<NaiveDate>,
}

impl BreakTracker {
    pub fn update(
        &mut self,
        schedule: &BreakSchedule,
        date: NaiveDate,
        weekday: u32,
        minute: u32,
    ) -> BreakEvent {
        if let Some((active_date, start, end)) = self.active {
            if active_date != date || minute >= end {
                self.active = None;
                return BreakEvent::Ended { start_minute: start };
            }
            return BreakEvent::None;
        }
        if self.handled_on == Some(date) {
            return BreakEvent::None;
        }
        match schedule.window_on(weekday) {
            Some((start, end)) if (start..end).contains(&minute) => {
                self.handled_on = Some(date);
                self.active = Some((date, start, end));
                BreakEvent::Started { end_minute: end }
            }
            _ => BreakEvent::None,
        }
    }
}

/// End-of-day recap ("Rivedi la giornata"): shown once per working day at
/// `time`, so the day can be checked and fixed while it's still fresh.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayRecapSettings {
    pub enabled: bool,
    /// "HH:MM", local time.
    pub time: String,
}

impl Default for DayRecapSettings {
    fn default() -> Self {
        DayRecapSettings {
            enabled: true,
            time: "18:00".to_string(),
        }
    }
}

impl DayRecapSettings {
    pub fn normalized(mut self) -> Self {
        if parse_hhmm(&self.time).is_none() {
            self.time = DayRecapSettings::default().time;
        }
        self
    }

    /// Whether the recap is due now: past its time on a weekday (Mon–Fri)
    /// and not shown yet today. Marks it shown when it returns true.
    pub fn due(&self, shown_on: &mut Option<NaiveDate>, date: NaiveDate, weekday: u32, minute: u32) -> bool {
        let Some(at) = parse_hhmm(&self.time) else {
            return false;
        };
        if !self.enabled || weekday >= 5 || minute < at || *shown_on == Some(date) {
            return false;
        }
        *shown_on = Some(date);
        true
    }
}

/// How long the user has to keep working on one project, while paused,
/// before Pulse offers to resume it.
pub const FORGOTTEN_WORK_AFTER_SECS: i64 = 180;

type Key = (Option<i64>, Option<i64>);

#[derive(Debug, Default)]
pub struct ForgottenWork {
    candidate: Option<(Key, DateTime<Utc>)>,
    declined: Vec<Key>,
    offered: bool,
}

impl ForgottenWork {
    /// A fresh pause (or a resume) starts over: earlier "no"s don't carry
    /// into the next pause.
    pub fn reset(&mut self) {
        *self = ForgottenWork::default();
    }

    /// Feeds one tick while paused. `detected` is None for a window that
    /// matches no project (ignored, like normal detection does); an idle
    /// user resets the streak. Returns the project and since-when to offer.
    pub fn observe(
        &mut self,
        detected: Option<Key>,
        user_active: bool,
        now: DateTime<Utc>,
    ) -> Option<(Key, DateTime<Utc>)> {
        if self.offered {
            return None;
        }
        if !user_active {
            self.candidate = None;
            return None;
        }
        let key = detected?;
        if self.declined.contains(&key) {
            self.candidate = None;
            return None;
        }
        match self.candidate {
            Some((current, since)) if current == key => {
                if (now - since).num_seconds() >= FORGOTTEN_WORK_AFTER_SECS {
                    self.offered = true;
                    return Some((key, since));
                }
            }
            _ => self.candidate = Some((key, now)),
        }
        None
    }

    pub fn decline(&mut self, key: Key) {
        self.declined.push(key);
        self.candidate = None;
        self.offered = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn schedule() -> BreakSchedule {
        let day = |start: &str, end: &str| BreakDay {
            enabled: true,
            start: start.into(),
            end: end.into(),
        };
        BreakSchedule {
            enabled: true,
            days: vec![
                day("13:00", "14:30"),
                day("13:00", "15:00"),
                day("13:00", "14:30"),
                day("13:00", "15:00"),
                day("13:00", "14:30"),
                BreakDay { enabled: false, ..day("13:00", "14:00") },
                BreakDay { enabled: false, ..day("13:00", "14:00") },
            ],
        }
    }

    #[test]
    fn break_starts_once_and_ends_at_that_days_time() {
        let mut tracker = BreakTracker::default();
        let tuesday = NaiveDate::from_ymd_opt(2026, 9, 29).unwrap();
        let s = schedule();
        assert_eq!(tracker.update(&s, tuesday, 1, 12 * 60 + 59), BreakEvent::None);
        assert_eq!(tracker.update(&s, tuesday, 1, 13 * 60), BreakEvent::Started { end_minute: 15 * 60 });
        assert_eq!(tracker.update(&s, tuesday, 1, 14 * 60 + 30), BreakEvent::None, "Tuesday runs to 15:00");
        assert_eq!(tracker.update(&s, tuesday, 1, 15 * 60), BreakEvent::Ended { start_minute: 13 * 60 });
        assert_eq!(tracker.update(&s, tuesday, 1, 15 * 60 + 1), BreakEvent::None);
    }

    #[test]
    fn launching_mid_break_still_starts_it_but_only_once_per_day() {
        let mut tracker = BreakTracker::default();
        let monday = NaiveDate::from_ymd_opt(2026, 9, 28).unwrap();
        let s = schedule();
        assert_eq!(tracker.update(&s, monday, 0, 14 * 60), BreakEvent::Started { end_minute: 14 * 60 + 30 });
        assert_eq!(tracker.update(&s, monday, 0, 14 * 60 + 30), BreakEvent::Ended { start_minute: 13 * 60 });
        assert_eq!(tracker.update(&s, monday, 0, 14 * 60 + 29), BreakEvent::None);
    }

    #[test]
    fn disabled_schedule_or_day_never_fires() {
        let mut tracker = BreakTracker::default();
        let saturday = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();
        assert_eq!(tracker.update(&schedule(), saturday, 5, 13 * 60 + 10), BreakEvent::None);
        let off = BreakSchedule { enabled: false, ..schedule() };
        let monday = NaiveDate::from_ymd_opt(2026, 9, 28).unwrap();
        assert_eq!(tracker.update(&off, monday, 0, 13 * 60 + 10), BreakEvent::None);
    }

    #[test]
    fn normalized_repairs_bad_entries() {
        let broken = BreakSchedule {
            enabled: true,
            days: vec![BreakDay { enabled: true, start: "15:00".into(), end: "13:00".into() }],
        }
        .normalized();
        assert_eq!(broken.days.len(), 7);
        assert_eq!(broken.window_on(0), Some((13 * 60, 14 * 60)));
    }

    #[test]
    fn forgotten_work_is_offered_after_steady_work_backdated_to_its_start() {
        let mut work = ForgottenWork::default();
        let t0 = Utc::now();
        let project = (Some(4), None);
        assert!(work.observe(Some(project), true, t0).is_none());
        // An unmatched window (a quick look at mail) doesn't break the streak.
        assert!(work.observe(None, true, t0 + Duration::seconds(60)).is_none());
        let offer = work.observe(Some(project), true, t0 + Duration::seconds(FORGOTTEN_WORK_AFTER_SECS));
        assert_eq!(offer, Some((project, t0)));
        assert!(work.observe(Some(project), true, t0 + Duration::seconds(400)).is_none(), "offered once");
    }

    #[test]
    fn switching_project_or_going_idle_restarts_the_streak() {
        let mut work = ForgottenWork::default();
        let t0 = Utc::now();
        work.observe(Some((Some(1), None)), true, t0);
        work.observe(Some((Some(2), None)), true, t0 + Duration::seconds(100));
        assert!(work.observe(Some((Some(2), None)), true, t0 + Duration::seconds(200)).is_none());
        work.observe(Some((Some(2), None)), false, t0 + Duration::seconds(250));
        assert!(work.observe(Some((Some(2), None)), true, t0 + Duration::seconds(300)).is_none());
    }

    #[test]
    fn day_recap_is_due_once_per_weekday_after_its_time() {
        let recap = DayRecapSettings::default();
        let mut shown = None;
        let friday = NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        assert!(!recap.due(&mut shown, friday, 4, 17 * 60 + 59));
        assert!(recap.due(&mut shown, friday, 4, 18 * 60));
        assert!(!recap.due(&mut shown, friday, 4, 19 * 60), "only once a day");
        let saturday = NaiveDate::from_ymd_opt(2026, 10, 3).unwrap();
        assert!(!recap.due(&mut shown, saturday, 5, 18 * 60), "not on weekends");
    }

    #[test]
    fn declined_project_is_not_offered_again_this_pause() {
        let mut work = ForgottenWork::default();
        let t0 = Utc::now();
        let project = (Some(4), None);
        work.observe(Some(project), true, t0);
        assert!(work.observe(Some(project), true, t0 + Duration::seconds(200)).is_some());
        work.decline(project);
        work.observe(Some(project), true, t0 + Duration::seconds(300));
        assert!(work.observe(Some(project), true, t0 + Duration::seconds(900)).is_none());
    }
}
