//! Database side of the sync: turning local history into per-day files and
//! importing the other PCs' files into `remote_entries`. No network here.

use crate::db;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireEntry {
    pub project: Option<String>,
    pub project_color: Option<String>,
    pub activity: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayFile {
    pub version: u32,
    pub device_id: String,
    pub device_name: String,
    pub day: String,
    pub entries: Vec<WireEntry>,
}

/// `devices/<device>/<yyyy>/<yyyy-mm-dd>.json`
pub fn day_path(device_id: &str, day: &str) -> String {
    format!("devices/{device_id}/{}/{day}.json", &day[..4])
}

/// (device, day) back out of a day file's path.
pub fn parse_day_path(path: &str) -> Option<(&str, &str)> {
    let rest = path.strip_prefix("devices/")?;
    let (device, rest) = rest.split_once('/')?;
    let (_, file) = rest.split_once('/')?;
    let day = file.strip_suffix(".json")?;
    (day.len() == 10 && !device.is_empty()).then_some((device, day))
}

/// Every closed local session grouped by (UTC) day — what this PC publishes.
/// The running session is left out until it closes.
pub fn local_days(conn: &Connection) -> rusqlite::Result<BTreeMap<String, Vec<WireEntry>>> {
    let mut stmt = conn.prepare(
        "SELECT substr(t.started_at, 1, 10), p.name, p.color, a.name,
                t.started_at, t.ended_at, t.duration_seconds
         FROM time_entries t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN activity_types a ON a.id = t.activity_type_id
         WHERE t.ended_at IS NOT NULL AND t.duration_seconds > 0
         ORDER BY t.started_at, t.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            WireEntry {
                project: row.get(1)?,
                project_color: row.get(2)?,
                activity: row.get(3)?,
                started_at: row.get(4)?,
                ended_at: row.get(5)?,
                seconds: row.get(6)?,
            },
        ))
    })?;
    let mut days: BTreeMap<String, Vec<WireEntry>> = BTreeMap::new();
    for row in rows {
        let (day, entry) = row?;
        days.entry(day).or_default().push(entry);
    }
    Ok(days)
}

/// A project named like the remote one — archived ones included, so an
/// archived project doesn't get resurrected as a duplicate — or a new one.
fn resolve_project(
    conn: &Connection,
    cache: &mut HashMap<String, i64>,
    name: &str,
    color: Option<&str>,
    created: &mut bool,
) -> rusqlite::Result<i64> {
    let key = name.to_lowercase();
    if let Some(id) = cache.get(&key) {
        return Ok(*id);
    }
    let existing: Option<i64> = conn
        .query_row(
            "SELECT id FROM projects WHERE name = ?1 COLLATE NOCASE
             ORDER BY archived_at IS NOT NULL, id LIMIT 1",
            [name],
            |row| row.get(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => id,
        None => {
            *created = true;
            db::create_project(conn, name, color)?.id
        }
    };
    cache.insert(key, id);
    Ok(id)
}

fn resolve_activity(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM activity_types WHERE name = ?1 COLLATE NOCASE LIMIT 1",
        [name],
        |row| row.get(0),
    )
    .optional()
}

/// Replaces everything held for one remote (device, day) with the file's
/// content. Returns whether a new project had to be created.
pub fn import_day(conn: &Connection, file: &DayFile, path: &str, sha: &str) -> rusqlite::Result<bool> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM remote_entries WHERE device_id = ?1 AND day = ?2",
        [&file.device_id, &file.day],
    )?;
    let mut cache = HashMap::new();
    let mut created = false;
    for entry in &file.entries {
        let project_id = match &entry.project {
            Some(name) => Some(resolve_project(
                &tx,
                &mut cache,
                name,
                entry.project_color.as_deref(),
                &mut created,
            )?),
            None => None,
        };
        let activity_id = match &entry.activity {
            Some(name) => resolve_activity(&tx, name)?,
            None => None,
        };
        tx.execute(
            "INSERT INTO remote_entries
                (device_id, day, project_id, activity_type_id, started_at, ended_at, duration_seconds)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                file.device_id,
                file.day,
                project_id,
                activity_id,
                entry.started_at,
                entry.ended_at,
                entry.seconds,
            ],
        )?;
    }
    tx.execute(
        "INSERT INTO sync_files (path, sha) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET sha = excluded.sha",
        [path, sha],
    )?;
    tx.commit()?;
    Ok(created)
}

pub fn imported_shas(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT path, sha FROM sync_files")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Drops remote days whose file no longer exists upstream (deleted on the
/// other PC, e.g. after a reset there).
pub fn forget_missing(conn: &Connection, present: &[String]) -> rusqlite::Result<usize> {
    let known: Vec<String> = imported_shas(conn)?.into_keys().collect();
    let tx = conn.unchecked_transaction()?;
    let mut removed = 0;
    for path in known.iter().filter(|path| !present.contains(path)) {
        if let Some((device, day)) = parse_day_path(path) {
            removed += tx.execute(
                "DELETE FROM remote_entries WHERE device_id = ?1 AND day = ?2",
                [device, day],
            )?;
        }
        tx.execute("DELETE FROM sync_files WHERE path = ?1", [path])?;
    }
    tx.commit()?;
    Ok(removed)
}

/// Git's blob id for `content` — lets a sync skip days whose file upstream is
/// already byte-for-byte what it would upload.
pub fn git_blob_sha(content: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", content.len()).as_bytes());
    hasher.update(content);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Source;
    use chrono::{Duration, TimeZone, Utc};

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::run_migrations(&conn).unwrap();
        conn
    }

    fn remote_file(device: &str, day: &str, project: &str, seconds: i64) -> DayFile {
        DayFile {
            version: FORMAT_VERSION,
            device_id: device.into(),
            device_name: "Fisso".into(),
            day: day.into(),
            entries: vec![WireEntry {
                project: Some(project.into()),
                project_color: Some("#ff0000".into()),
                activity: None,
                started_at: format!("{day}T09:00:00+00:00"),
                ended_at: format!("{day}T10:00:00+00:00"),
                seconds,
            }],
        }
    }

    #[test]
    fn paths_round_trip() {
        let path = day_path("abc", "2026-09-28");
        assert_eq!(path, "devices/abc/2026/2026-09-28.json");
        assert_eq!(parse_day_path(&path), Some(("abc", "2026-09-28")));
        assert_eq!(parse_day_path("README.md"), None);
    }

    #[test]
    fn git_blob_sha_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(git_blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
    }

    #[test]
    fn local_days_skip_the_running_session() {
        let conn = test_conn();
        let t0 = Utc.with_ymd_and_hms(2026, 9, 28, 9, 0, 0).unwrap();
        let project = db::create_project(&conn, "Cliente A", None).unwrap();
        db::transition_segment(&conn, Some(project.id), None, Source::Manual, t0, None, None).unwrap();
        db::transition_segment(&conn, None, None, Source::Manual, t0 + Duration::hours(1), None, None)
            .unwrap();
        let days = local_days(&conn).unwrap();
        assert_eq!(days.len(), 1);
        let entries = &days["2026-09-28"];
        assert_eq!(entries.len(), 1, "open segment not published");
        assert_eq!(entries[0].project.as_deref(), Some("Cliente A"));
        // julianday() arithmetic can land a second short (see stats tests).
        assert!((3599..=3600).contains(&entries[0].seconds));
    }

    #[test]
    fn importing_counts_in_totals_and_reimport_replaces_instead_of_doubling() {
        let conn = test_conn();
        let existing = db::create_project(&conn, "Cliente A", None).unwrap();
        let path = day_path("pc2", "2026-09-28");

        import_day(&conn, &remote_file("pc2", "2026-09-28", "cliente a", 3600), &path, "sha1").unwrap();
        import_day(&conn, &remote_file("pc2", "2026-09-28", "cliente a", 1800), &path, "sha2").unwrap();

        let since = Utc.with_ymd_and_hms(2026, 9, 28, 0, 0, 0).unwrap();
        let totals = db::project_totals_since(&conn, since, since + Duration::days(1)).unwrap();
        assert_eq!(totals, vec![(Some(existing.id), 1800)], "matched by name, replaced not added");

        let segments = db::segments_between(&conn, since, since + Duration::days(1)).unwrap();
        assert!(segments[0].id < 0, "remote rows are marked by a negative id");
        assert_eq!(imported_shas(&conn).unwrap()[&path], "sha2");
    }

    #[test]
    fn unknown_project_is_created_and_missing_files_are_forgotten() {
        let conn = test_conn();
        let path = day_path("pc2", "2026-09-28");
        let created = import_day(&conn, &remote_file("pc2", "2026-09-28", "Nuovo", 600), &path, "s").unwrap();
        assert!(created);
        assert!(db::find_active_project_id_by_name(&conn, "Nuovo").unwrap().is_some());

        forget_missing(&conn, &[]).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM remote_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        assert!(imported_shas(&conn).unwrap().is_empty());
    }
}
