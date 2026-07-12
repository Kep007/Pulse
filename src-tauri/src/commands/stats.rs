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

/// Buckets tracked seconds by day ("YYYY-MM-DD", key_len 10) or month
/// ("YYYY-MM", key_len 7), summing total/per-project/per-activity seconds
/// entirely inside SQLite — the history grows without bound over the years,
/// and the previous shape (load every raw segment in range into a Vec,
/// parse each RFC3339 timestamp in Rust, sum in HashMaps) made every
/// dashboard open linearly slower with the size of the whole DB. A GROUP BY
/// returns at most (buckets × projects) rows however many segments exist.
///
/// The still-open segment (no stored `duration_seconds`) contributes its
/// live duration — the same julianday arithmetic `db::close_open_segment`
/// already uses on these timestamps — so today's bucket isn't stuck at zero
/// until the next transition. MAX(0, …) mirrors the old `.max(0)` guard
/// against a start timestamp in the future (clock adjustments).
fn grouped_totals(
    conn: &Connection,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    now: DateTime<Utc>,
    key_len: u32,
) -> rusqlite::Result<BTreeMap<String, Accumulator>> {
    let mut buckets: BTreeMap<String, Accumulator> = BTreeMap::new();
    let params = rusqlite::params![
        from.to_rfc3339(),
        to.to_rfc3339(),
        now.to_rfc3339(),
        key_len
    ];

    // Grouped by project, NULL group included: every segment lands in
    // exactly one row here, so these rows also carry the bucket totals.
    let mut stmt = conn.prepare(
        "SELECT substr(started_at, 1, ?4), project_id,
                SUM(COALESCE(duration_seconds,
                    MAX(0, CAST((julianday(?3) - julianday(started_at)) * 86400 AS INTEGER))))
         FROM time_entries
         WHERE started_at >= ?1 AND started_at < ?2
         GROUP BY 1, 2",
    )?;
    let rows = stmt.query_map(params, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, i64>(2)?))
    })?;
    for row in rows {
        let (key, project_id, seconds) = row?;
        let bucket = buckets.entry(key).or_default();
        bucket.total += seconds;
        if let Some(id) = project_id {
            bucket.by_project.insert(id, seconds);
        }
    }

    let mut stmt = conn.prepare(
        "SELECT substr(started_at, 1, ?4), activity_type_id,
                SUM(COALESCE(duration_seconds,
                    MAX(0, CAST((julianday(?3) - julianday(started_at)) * 86400 AS INTEGER))))
         FROM time_entries
         WHERE started_at >= ?1 AND started_at < ?2 AND activity_type_id IS NOT NULL
         GROUP BY 1, 2",
    )?;
    let rows = stmt.query_map(params, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
    })?;
    for row in rows {
        let (key, activity_id, seconds) = row?;
        buckets.entry(key).or_default().by_activity.insert(activity_id, seconds);
    }

    Ok(buckets)
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
    let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
    let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;

    let buckets =
        grouped_totals(&conn, from_dt, to_dt, Utc::now(), 10).map_err(|err| err.to_string())?;

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
    let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
    let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;

    let buckets =
        grouped_totals(&conn, from_dt, to_dt, Utc::now(), 7).map_err(|err| err.to_string())?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn insert(
        conn: &Connection,
        project_id: Option<i64>,
        activity_id: Option<i64>,
        started_at: DateTime<Utc>,
        duration_seconds: Option<i64>,
    ) {
        let ended_at = duration_seconds.map(|secs| (started_at + Duration::seconds(secs)).to_rfc3339());
        conn.execute(
            "INSERT INTO time_entries (project_id, activity_type_id, source, started_at, ended_at, duration_seconds)
             VALUES (?1, ?2, 'auto', ?3, ?4, ?5)",
            rusqlite::params![project_id, activity_id, started_at.to_rfc3339(), ended_at, duration_seconds],
        )
        .unwrap();
    }

    #[test]
    fn groups_by_day_project_and_activity_matching_old_in_memory_shape() {
        let conn = test_conn();
        let day1 = Utc.with_ymd_and_hms(2026, 7, 1, 9, 0, 0).unwrap();
        let day2 = Utc.with_ymd_and_hms(2026, 7, 2, 9, 0, 0).unwrap();
        insert(&conn, Some(1), Some(3), day1, Some(600));
        insert(&conn, Some(1), None, day1 + Duration::hours(1), Some(300));
        insert(&conn, Some(2), None, day1 + Duration::hours(2), Some(100));
        insert(&conn, None, None, day1 + Duration::hours(3), Some(50)); // no project: total only
        insert(&conn, Some(1), None, day2, Some(120));

        let now = day2 + Duration::hours(5);
        let buckets = grouped_totals(
            &conn,
            Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
            now,
            10,
        )
        .unwrap();

        assert_eq!(buckets.len(), 2);
        let first = &buckets["2026-07-01"];
        assert_eq!(first.total, 1050);
        assert_eq!(first.by_project[&1], 900);
        assert_eq!(first.by_project[&2], 100);
        assert_eq!(first.by_activity[&3], 600);
        assert_eq!(buckets["2026-07-02"].total, 120);

        // Month grouping (key_len 7) folds both days into one bucket.
        let monthly = grouped_totals(
            &conn,
            Utc.with_ymd_and_hms(2026, 6, 1, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
            now,
            7,
        )
        .unwrap();
        assert_eq!(monthly["2026-07"].total, 1170);
    }

    #[test]
    fn open_segment_contributes_live_duration_up_to_now() {
        let conn = test_conn();
        let started = Utc.with_ymd_and_hms(2026, 7, 3, 8, 0, 0).unwrap();
        insert(&conn, Some(1), None, started, None);

        let now = started + Duration::seconds(90);
        let buckets = grouped_totals(
            &conn,
            Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 7, 4, 0, 0, 0).unwrap(),
            now,
            10,
        )
        .unwrap();
        // julianday arithmetic can land 1s off through float rounding —
        // the old chrono-based sum had the same tolerance-free shape only
        // because it never went through floats; a second of slack on a
        // *live, still-growing* number changes nothing user-visible.
        let total = buckets["2026-07-03"].total;
        assert!((89..=91).contains(&total), "live total was {total}");
    }

    #[test]
    fn open_segment_started_in_the_future_counts_zero_not_negative() {
        let conn = test_conn();
        let started = Utc.with_ymd_and_hms(2026, 7, 3, 8, 0, 0).unwrap();
        insert(&conn, Some(1), None, started, None);

        let now = started - Duration::hours(2); // clock moved back
        let buckets = grouped_totals(
            &conn,
            Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 7, 4, 0, 0, 0).unwrap(),
            now,
            10,
        )
        .unwrap();
        assert_eq!(buckets["2026-07-03"].total, 0);
    }
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
