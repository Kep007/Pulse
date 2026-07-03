use crate::db;
use crate::detector::AppState;
use crate::models::{ActivityTypeDto, BreakdownEntry, DayBucket, MonthBucket, ProjectDto, SegmentDto};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use rusqlite::Connection;
use std::collections::{BTreeMap, HashMap};
use tauri::State;

#[derive(Default)]
struct Accumulator {
    total: i64,
    by_project: HashMap<i64, i64>,
    by_activity: HashMap<i64, i64>,
}

fn parse_boundary(date: &str, end_exclusive: bool) -> Result<DateTime<Utc>, String> {
    let naive_date = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|err| err.to_string())?;
    let naive_date = if end_exclusive {
        naive_date + Duration::days(1)
    } else {
        naive_date
    };
    let naive_datetime = naive_date
        .and_hms_opt(0, 0, 0)
        .expect("midnight is always a valid time");
    Ok(DateTime::from_naive_utc_and_offset(naive_datetime, Utc))
}

fn project_lookup(conn: &Connection) -> rusqlite::Result<HashMap<i64, ProjectDto>> {
    Ok(db::list_projects(conn)?
        .into_iter()
        .map(|project| (project.id, project))
        .collect())
}

fn activity_lookup(conn: &Connection) -> rusqlite::Result<HashMap<i64, ActivityTypeDto>> {
    Ok(db::list_activity_types(conn)?
        .into_iter()
        .map(|activity_type| (activity_type.id, activity_type))
        .collect())
}

fn to_breakdown<T>(
    totals: &HashMap<i64, i64>,
    lookup: &HashMap<i64, T>,
    name_of: impl Fn(&T) -> String,
    color_of: impl Fn(&T) -> Option<String>,
) -> Vec<BreakdownEntry> {
    let mut entries: Vec<BreakdownEntry> = totals
        .iter()
        .filter_map(|(id, seconds)| {
            lookup.get(id).map(|item| BreakdownEntry {
                id: *id,
                name: name_of(item),
                color: color_of(item),
                seconds: *seconds,
            })
        })
        .collect();
    entries.sort_by(|a, b| b.seconds.cmp(&a.seconds));
    entries
}

/// Buckets raw segments by a caller-provided key (day or month string),
/// summing total/per-project/per-activity seconds. The still-open segment
/// (no stored `duration_seconds`) contributes its live duration so today's
/// bucket isn't stuck at zero until the next auto/manual transition.
fn aggregate(
    raw: &[db::RawSegment],
    now: DateTime<Utc>,
    key_fn: impl Fn(NaiveDate) -> String,
) -> BTreeMap<String, Accumulator> {
    let mut buckets: BTreeMap<String, Accumulator> = BTreeMap::new();

    for segment in raw {
        let Ok(started_at) = DateTime::parse_from_rfc3339(&segment.started_at) else {
            continue;
        };
        let started_at = started_at.with_timezone(&Utc);
        let seconds = segment
            .duration_seconds
            .unwrap_or_else(|| (now - started_at).num_seconds().max(0));
        let key = key_fn(started_at.date_naive());

        let bucket = buckets.entry(key).or_default();
        bucket.total += seconds;
        if let Some(id) = segment.project_id {
            *bucket.by_project.entry(id).or_insert(0) += seconds;
        }
        if let Some(id) = segment.activity_type_id {
            *bucket.by_activity.entry(id).or_insert(0) += seconds;
        }
    }

    buckets
}

#[tauri::command]
pub fn get_daily_summary(
    state: State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<DayBucket>, String> {
    let conn = state.db.lock().unwrap();
    let from_dt = parse_boundary(&from, false)?;
    let to_dt = parse_boundary(&to, true)?;
    let raw = db::segments_between(&conn, from_dt, to_dt).map_err(|err| err.to_string())?;
    let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
    let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;

    let buckets = aggregate(&raw, Utc::now(), |date| date.format("%Y-%m-%d").to_string());

    Ok(buckets
        .into_iter()
        .map(|(date, acc)| DayBucket {
            date,
            total_seconds: acc.total,
            by_project: to_breakdown(&acc.by_project, &projects, |p| p.name.clone(), |p| p.color.clone()),
            by_activity: to_breakdown(&acc.by_activity, &activities, |a| a.name.clone(), |a| a.color.clone()),
        })
        .collect())
}

#[tauri::command]
pub fn get_monthly_summary(
    state: State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<MonthBucket>, String> {
    let conn = state.db.lock().unwrap();
    let from_dt = parse_boundary(&from, false)?;
    let to_dt = parse_boundary(&to, true)?;
    let raw = db::segments_between(&conn, from_dt, to_dt).map_err(|err| err.to_string())?;
    let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
    let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;

    let buckets = aggregate(&raw, Utc::now(), |date| date.format("%Y-%m").to_string());

    Ok(buckets
        .into_iter()
        .map(|(month, acc)| MonthBucket {
            month,
            total_seconds: acc.total,
            by_project: to_breakdown(&acc.by_project, &projects, |p| p.name.clone(), |p| p.color.clone()),
            by_activity: to_breakdown(&acc.by_activity, &activities, |a| a.name.clone(), |a| a.color.clone()),
        })
        .collect())
}

#[tauri::command]
pub fn get_day_detail(state: State<AppState>, date: String) -> Result<Vec<SegmentDto>, String> {
    let conn = state.db.lock().unwrap();
    let from_dt = parse_boundary(&date, false)?;
    let to_dt = parse_boundary(&date, true)?;
    let raw = db::segments_between(&conn, from_dt, to_dt).map_err(|err| err.to_string())?;
    let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
    let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;
    let now = Utc::now();

    Ok(raw
        .into_iter()
        .map(|segment| {
            let started_at_dt = DateTime::parse_from_rfc3339(&segment.started_at)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or(now);
            let duration_seconds = segment
                .duration_seconds
                .unwrap_or_else(|| (now - started_at_dt).num_seconds().max(0));

            SegmentDto {
                started_at: segment.started_at.clone(),
                ended_at: segment.ended_at.clone(),
                duration_seconds,
                project: segment.project_id.and_then(|id| projects.get(&id).cloned()),
                activity_type: segment
                    .activity_type_id
                    .and_then(|id| activities.get(&id).cloned()),
            }
        })
        .collect())
}
