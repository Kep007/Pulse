-- Sessions tracked on the user's other PCs, pulled by the GitHub sync.
-- Kept apart from time_entries on purpose: local history is never written
-- by a sync, and a day re-downloaded from the other PC simply replaces its
-- own rows here.
CREATE TABLE IF NOT EXISTS remote_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  day TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  activity_type_id INTEGER REFERENCES activity_types(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_entries_device_day ON remote_entries(device_id, day);
CREATE INDEX IF NOT EXISTS idx_remote_entries_summary
  ON remote_entries(started_at, project_id, activity_type_id, duration_seconds);

-- Git blob sha of every remote file already imported, so unchanged days
-- are never downloaded twice.
CREATE TABLE IF NOT EXISTS sync_files (
  path TEXT PRIMARY KEY,
  sha TEXT NOT NULL
);

-- Everything the app *reads* (charts, timeline, totals, exports) comes from
-- here; writes still go to time_entries only. Remote rows get negative ids
-- so the UI can tell them apart and keep them read-only.
CREATE VIEW IF NOT EXISTS all_entries AS
  SELECT id, project_id, activity_type_id, source, started_at, ended_at, duration_seconds
  FROM time_entries
  UNION ALL
  SELECT -id, project_id, activity_type_id, 'remote', started_at, ended_at, duration_seconds
  FROM remote_entries;
