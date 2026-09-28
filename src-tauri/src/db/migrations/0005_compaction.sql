-- Small key/value store for internal bookkeeping (e.g. how far history
-- compaction has progressed), kept out of the user-facing settings store.
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Covering index for the dashboard's GROUP BY summaries (stats.rs): every
-- column they read lives in the index, so an all-time summary never touches
-- the table rows. Its leading column makes the plain started_at index
-- redundant.
CREATE INDEX IF NOT EXISTS idx_time_entries_summary
  ON time_entries(started_at, project_id, activity_type_id, duration_seconds);
DROP INDEX IF EXISTS idx_time_entries_started_at;
