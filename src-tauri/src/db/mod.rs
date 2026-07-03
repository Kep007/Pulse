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
];

pub fn open(app: &AppHandle) -> rusqlite::Result<Connection> {
    let dir = app
        .path()
        .app_data_dir()
        .expect("resolve app data dir");
    std::fs::create_dir_all(&dir).expect("create app data dir");

    let conn = Connection::open(dir.join("pulse.db"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", true)?;
    run_migrations(&conn)?;
    close_dangling_segments(&conn, Utc::now())?;

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

/// Closes any segment left open by an unclean previous shutdown, so a crash
/// never silently keeps accumulating time against a stale project.
fn close_dangling_segments(conn: &Connection, ended_at: DateTime<Utc>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE time_entries
         SET ended_at = ?1,
             duration_seconds = CAST((julianday(?1) - julianday(started_at)) * 86400 AS INTEGER)
         WHERE ended_at IS NULL",
        [ended_at.to_rfc3339()],
    )?;
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

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<ProjectDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, slug, name, color FROM projects WHERE archived_at IS NULL ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectDto {
                id: row.get(0)?,
                slug: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
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
            })
        },
    )
    .optional()
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
