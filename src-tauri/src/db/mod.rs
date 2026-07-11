use crate::models::{ActivityTypeDto, ProjectDto, Source};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use tauri::{AppHandle, Manager};

const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_init", include_str!("migrations/0001_init.sql")),
    (
        "0002_seed_projects",
        include_str!("migrations/0002_seed_projects.sql"),
    ),
    (
        "0003_seed_activity",
        include_str!("migrations/0003_seed_activity.sql"),
    ),
    (
        "0004_project_sort_order",
        include_str!("migrations/0004_project_sort_order.sql"),
    ),
];

/// Single folder all of Pulse's per-user data (database, settings) lives in
/// — the same `%LOCALAPPDATA%\<identifier>\` root `tauri-plugin-log` already
/// uses for the `logs\` subfolder, chosen over the roaming `app_data_dir`
/// (`%APPDATA%`) so a tracking database with WAL files isn't a candidate for
/// profile roaming/sync. Kept separate from the NSIS install directory
/// (`%LOCALAPPDATA%\Programs\Pulse\`) so an app update, which overwrites that
/// directory, can never touch live user data.
pub fn data_dir(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_local_data_dir()
        .expect("resolve app local data dir")
}

pub fn open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = data_dir(app);
    std::fs::create_dir_all(&dir).expect("create app data dir");

    let conn = Connection::open(dir.join("pulse.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", true)?;
    run_migrations(&conn)?;
    close_dangling_segments(&conn)?;

    Ok(conn)
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );",
    )?;

    for (name, sql) in MIGRATIONS {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name = ?1)",
            [name],
            |row| row.get(0),
        )?;

        if already_applied {
            continue;
        }

        conn.execute_batch(sql)?;
        conn.execute("INSERT INTO schema_migrations (name) VALUES (?1)", [name])?;
    }

    Ok(())
}

/// Discards any segment left open by an unclean previous shutdown (crash,
/// force-kill, power loss). A clean quit always closes its open segment
/// itself (see `detector::close_for_shutdown`) before the process exits, so
/// by the time this runs at the next startup a leftover open row only means
/// the real end time was never recorded — there's no reliable timestamp to
/// close it with, so rather than stamping it with this restart's time (which
/// would silently bill the entire closed-app stretch to that project) the
/// ambiguous segment is dropped.
fn close_dangling_segments(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM time_entries WHERE ended_at IS NULL", [])?;
    Ok(())
}

pub fn project_match_terms(conn: &Connection) -> rusqlite::Result<Vec<(i64, Vec<String>)>> {
    let mut stmt = conn.prepare(
        "SELECT id, name FROM projects WHERE archived_at IS NULL ORDER BY id",
    )?;
    let projects: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    let mut alias_stmt = conn.prepare("SELECT alias FROM project_aliases WHERE project_id = ?1")?;

    let mut result = Vec::with_capacity(projects.len());
    for (id, name) in projects {
        let mut terms = vec![name];
        let aliases: Vec<String> = alias_stmt
            .query_map([id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        terms.extend(aliases);
        result.push((id, terms));
    }

    Ok(result)
}

pub fn activity_rules(conn: &Connection) -> rusqlite::Result<Vec<(i64, String, String, i32)>> {
    let mut stmt = conn.prepare(
        "SELECT activity_type_id, match_field, pattern, priority FROM activity_rules",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn project_aliases_for(conn: &Connection, project_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT alias FROM project_aliases WHERE project_id = ?1 ORDER BY id")?;
    let aliases = stmt
        .query_map([project_id], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(aliases)
}

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<ProjectDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, name, color FROM projects WHERE archived_at IS NULL ORDER BY sort_order",
    )?;
    let base: Vec<(i64, String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut result = Vec::with_capacity(base.len());
    for (id, slug, name, color) in base {
        let aliases = project_aliases_for(conn, id)?;
        result.push(ProjectDto { id, slug, name, color, aliases });
    }
    Ok(result)
}

pub fn list_activity_types(conn: &Connection) -> rusqlite::Result<Vec<ActivityTypeDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, name, color FROM activity_types ORDER BY sort_order",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ActivityTypeDto {
                id: row.get(0)?,
                slug: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Aliases come back empty here — this is used for name/color lookups
/// (toast labels, tracking state) where the caller never looks at them, not
/// for the Progetti tab (which goes through list_projects instead).
pub fn get_project(conn: &Connection, id: i64) -> rusqlite::Result<Option<ProjectDto>> {
    conn.query_row(
        "SELECT id, slug, name, color FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(ProjectDto {
                id: row.get(0)?,
                slug: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
                aliases: Vec::new(),
            })
        },
    )
    .optional()
}

fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug.push_str("project");
    }
    slug
}

fn unique_slug(conn: &Connection, base: &str) -> rusqlite::Result<String> {
    let mut candidate = base.to_string();
    let mut suffix = 2;
    loop {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE slug = ?1)",
            [&candidate],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(candidate);
        }
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
}

pub fn create_project(
    conn: &Connection,
    name: &str,
    color: Option<&str>,
) -> rusqlite::Result<ProjectDto> {
    let slug = unique_slug(conn, &slugify(name))?;
    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
        [],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO projects (slug, name, color, sort_order) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![slug, name, color, next_order],
    )?;
    Ok(ProjectDto {
        id: conn.last_insert_rowid(),
        slug,
        name: name.to_string(),
        color: color.map(str::to_string),
        aliases: Vec::new(),
    })
}

pub fn update_project(
    conn: &Connection,
    id: i64,
    name: &str,
    color: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET name = ?1, color = ?2 WHERE id = ?3",
        rusqlite::params![name, color, id],
    )?;
    Ok(())
}

/// Archives rather than deletes: keeps historical time_entries attributed to
/// a real project name instead of silently losing that context, while
/// hiding the project from the picker and management table going forward.
pub fn archive_project(conn: &Connection, id: i64, at: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE projects SET archived_at = ?1 WHERE id = ?2",
        rusqlite::params![at.to_rfc3339(), id],
    )?;
    Ok(())
}

/// Batch color update in one transaction — the "randomize colors" button
/// recolors every project at once, and a single write path means a single
/// catalog-changed event instead of one refresh storm per project.
pub fn set_project_colors(conn: &Connection, colors: &[(i64, String)]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (project_id, color) in colors {
        tx.execute(
            "UPDATE projects SET color = ?1 WHERE id = ?2",
            rusqlite::params![color, project_id],
        )?;
    }
    tx.commit()
}

pub fn reorder_projects(conn: &Connection, ordered_ids: &[i64]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (index, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![index as i64, id],
        )?;
    }
    tx.commit()
}

/// Replaces this project's whole alias list in one transaction — the row's
/// "Modifica" now edits name and aliases (comma-separated) together, so the
/// natural write shape is "here's the full list now", not one add/remove at
/// a time. Blank entries (from stray commas) are dropped; duplicates aren't
/// de-duped here since the matcher treats them identically either way.
pub fn set_project_aliases(conn: &Connection, project_id: i64, aliases: &[String]) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM project_aliases WHERE project_id = ?1", [project_id])?;
    for alias in aliases {
        let trimmed = alias.trim();
        if trimmed.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO project_aliases (project_id, alias) VALUES (?1, ?2)",
            rusqlite::params![project_id, trimmed],
        )?;
    }
    tx.commit()
}

pub fn get_activity_type(conn: &Connection, id: i64) -> rusqlite::Result<Option<ActivityTypeDto>> {
    conn.query_row(
        "SELECT id, slug, name, color FROM activity_types WHERE id = ?1",
        [id],
        |row| {
            Ok(ActivityTypeDto {
                id: row.get(0)?,
                slug: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        },
    )
    .optional()
}

/// An auto-detected open segment younger than this when the next transition
/// arrives is treated as an accidental glance — the user landed on the
/// wrong window while hunting for the one they actually wanted (outlasting
/// the detector's ~5s debounce, e.g. pausing to read something) — and is
/// absorbed rather than kept: deleted, with its time span inherited by the
/// incoming segment. Nothing under a minute is ever worth billing to the
/// wrong client, while the destination segment keeping the span means no
/// tracked time is lost and the daily timeline stays gap-free. Manual
/// segments are never absorbed: an explicit user choice stays recorded no
/// matter how brief.
const ABSORB_AUTO_SEGMENT_UNDER_SECS: i64 = 60;

/// Closes the current open segment (if any) and opens a new one, all in one
/// transaction — this is the single write path for every project/activity/
/// source transition, whether auto-detected or manually chosen.
pub fn transition_segment(
    conn: &Connection,
    project_id: Option<i64>,
    activity_type_id: Option<i64>,
    source: Source,
    at: DateTime<Utc>,
    window_title: Option<&str>,
    process_name: Option<&str>,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Micro-segment absorption (see ABSORB_AUTO_SEGMENT_UNDER_SECS). `at`
    // moving back to the absorbed segment's start is what makes a chain of
    // quick glances collapse into the segment the user finally settles on.
    let mut at = at;
    let open: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT id, started_at, source FROM time_entries WHERE ended_at IS NULL",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((id, started_at, open_source)) = open {
        if open_source == Source::Auto.as_str() {
            if let Ok(started) = DateTime::parse_from_rfc3339(&started_at) {
                let started = started.with_timezone(&Utc);
                let age = (at - started).num_seconds();
                if (0..ABSORB_AUTO_SEGMENT_UNDER_SECS).contains(&age) {
                    tx.execute("DELETE FROM time_entries WHERE id = ?1", [id])?;
                    at = started;
                }
            }
        }
    }

    tx.execute(
        "UPDATE time_entries
         SET ended_at = ?1,
             duration_seconds = CAST((julianday(?1) - julianday(started_at)) * 86400 AS INTEGER)
         WHERE ended_at IS NULL",
        [at.to_rfc3339()],
    )?;

    tx.execute(
        "INSERT INTO time_entries
            (project_id, activity_type_id, source, started_at, window_title, process_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            project_id,
            activity_type_id,
            source.as_str(),
            at.to_rfc3339(),
            window_title,
            process_name,
        ],
    )?;

    tx.commit()
}

/// Sums the already-closed segments for a project (or, if no project,
/// activity-only entries) since `since` — the widget's live timer adds this
/// to its own running count so re-entering a project already worked on
/// today continues from where it left off instead of restarting at zero.
/// The segment about to be opened is never included: it has no
/// `duration_seconds` yet at the point this is called.
pub fn seconds_tracked_since(
    conn: &Connection,
    project_id: Option<i64>,
    activity_type_id: Option<i64>,
    since: DateTime<Utc>,
) -> rusqlite::Result<i64> {
    match (project_id, activity_type_id) {
        (None, None) => Ok(0),
        (Some(project_id), _) => conn.query_row(
            "SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
             WHERE project_id = ?1 AND started_at >= ?2 AND duration_seconds IS NOT NULL",
            rusqlite::params![project_id, since.to_rfc3339()],
            |row| row.get(0),
        ),
        (None, Some(activity_type_id)) => conn.query_row(
            "SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
             WHERE project_id IS NULL AND activity_type_id = ?1
               AND started_at >= ?2 AND duration_seconds IS NOT NULL",
            rusqlite::params![activity_type_id, since.to_rfc3339()],
            |row| row.get(0),
        ),
    }
}

/// Closes the current open segment (if any) without opening a new one —
/// used when the system goes idle, so the idle stretch is excluded from
/// every project's tracked time instead of either the previous project
/// silently absorbing it or the idle gap being backfilled after the fact.
pub fn close_open_segment(conn: &Connection, at: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE time_entries
         SET ended_at = ?1,
             duration_seconds = CAST((julianday(?1) - julianday(started_at)) * 86400 AS INTEGER)
         WHERE ended_at IS NULL",
        [at.to_rfc3339()],
    )?;
    Ok(())
}

pub struct RawSegment {
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_seconds: Option<i64>,
    pub project_id: Option<i64>,
    pub activity_type_id: Option<i64>,
}

/// Segments starting in `[from, to)`. A segment spanning midnight is
/// bucketed entirely under the day/month it started in — an accepted
/// simplification for the heatmap this powers.
pub fn segments_between(
    conn: &Connection,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> rusqlite::Result<Vec<RawSegment>> {
    let mut stmt = conn.prepare(
        "SELECT started_at, ended_at, duration_seconds, project_id, activity_type_id
         FROM time_entries
         WHERE started_at >= ?1 AND started_at < ?2
         ORDER BY started_at",
    )?;
    let rows = stmt
        .query_map(
            rusqlite::params![from.to_rfc3339(), to.to_rfc3339()],
            |row| {
                Ok(RawSegment {
                    started_at: row.get(0)?,
                    ended_at: row.get(1)?,
                    duration_seconds: row.get(2)?,
                    project_id: row.get(3)?,
                    activity_type_id: row.get(4)?,
                })
            },
        )?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn reset_all_data(conn: &Connection, at: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM time_entries", [])?;
    conn.execute(
        "INSERT INTO time_entries (project_id, activity_type_id, source, started_at)
         VALUES (NULL, NULL, 'auto', ?1)",
        [at.to_rfc3339()],
    )?;
    conn.execute("VACUUM", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn segments(conn: &Connection) -> Vec<(Option<i64>, String, Option<String>, String)> {
        let mut stmt = conn
            .prepare("SELECT project_id, started_at, ended_at, source FROM time_entries ORDER BY started_at")
            .unwrap();
        stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    }

    #[test]
    fn micro_auto_segment_is_absorbed_by_next_transition() {
        let conn = test_conn();
        let t0 = Utc::now();
        transition_segment(&conn, Some(1), None, Source::Auto, t0, None, None).unwrap();
        transition_segment(
            &conn,
            Some(2),
            None,
            Source::Auto,
            t0 + Duration::seconds(30),
            None,
            None,
        )
        .unwrap();

        let rows = segments(&conn);
        assert_eq!(rows.len(), 1, "glance segment should be deleted");
        let (project, started_at, ended_at, _) = &rows[0];
        assert_eq!(*project, Some(2));
        assert_eq!(*started_at, t0.to_rfc3339(), "new segment inherits the absorbed span");
        assert!(ended_at.is_none());
    }

    #[test]
    fn chained_glances_collapse_into_final_segment() {
        let conn = test_conn();
        let t0 = Utc::now();
        transition_segment(&conn, Some(1), None, Source::Auto, t0, None, None).unwrap();
        transition_segment(&conn, Some(2), None, Source::Auto, t0 + Duration::seconds(10), None, None).unwrap();
        transition_segment(&conn, Some(3), None, Source::Auto, t0 + Duration::seconds(25), None, None).unwrap();

        let rows = segments(&conn);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, Some(3));
        assert_eq!(rows[0].1, t0.to_rfc3339());
    }

    #[test]
    fn auto_segment_at_least_a_minute_old_is_kept() {
        let conn = test_conn();
        let t0 = Utc::now();
        transition_segment(&conn, Some(1), None, Source::Auto, t0, None, None).unwrap();
        transition_segment(
            &conn,
            Some(2),
            None,
            Source::Auto,
            t0 + Duration::seconds(60),
            None,
            None,
        )
        .unwrap();

        let rows = segments(&conn);
        assert_eq!(rows.len(), 2, "a full minute of work is not a glance");
        assert_eq!(rows[0].0, Some(1));
        assert_eq!(rows[0].2, Some((t0 + Duration::seconds(60)).to_rfc3339()));
    }

    #[test]
    fn manual_segment_is_never_absorbed() {
        let conn = test_conn();
        let t0 = Utc::now();
        transition_segment(&conn, Some(1), None, Source::Manual, t0, None, None).unwrap();
        transition_segment(
            &conn,
            Some(2),
            None,
            Source::Auto,
            t0 + Duration::seconds(5),
            None,
            None,
        )
        .unwrap();

        let rows = segments(&conn);
        assert_eq!(rows.len(), 2, "an explicit user choice stays recorded however brief");
        assert_eq!(rows[0].0, Some(1));
        assert_eq!(rows[0].3, "manual");
    }
}
