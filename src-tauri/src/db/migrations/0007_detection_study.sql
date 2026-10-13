-- Detection study (see src/study.rs): what the detector saw and decided,
-- one row per stretch on the same window, plus the user's corrections.
-- Kept 35 days, local only unless the user exports/uploads it.
CREATE TABLE IF NOT EXISTS detection_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  process TEXT NOT NULL,
  title TEXT NOT NULL,
  -- Exactly what was handed to the matcher (title + folder path / domain /
  -- PDF path / WhatsApp contact).
  matched_text TEXT NOT NULL,
  detected_project_id INTEGER,
  matched_term TEXT,
  tracked_project_id INTEGER,
  -- tracking | paused
  state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_detection_log_started ON detection_log(started_at);

CREATE TABLE IF NOT EXISTS detection_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  -- manual_project | manual_activity | confirm | deny | resume_accept |
  -- resume_decline | timeline_edit | timeline_delete
  kind TEXT NOT NULL,
  project_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_detection_events_at ON detection_events(at);
