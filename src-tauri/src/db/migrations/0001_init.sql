CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE project_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alias TEXT NOT NULL
);
CREATE INDEX idx_project_aliases_project ON project_aliases(project_id);

CREATE TABLE activity_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activity_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_type_id INTEGER NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE,
  match_field TEXT NOT NULL CHECK (match_field IN ('process_name','window_title')),
  pattern TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  activity_type_id INTEGER REFERENCES activity_types(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  window_title TEXT,
  process_name TEXT
);

CREATE INDEX idx_time_entries_started_at ON time_entries(started_at);
CREATE INDEX idx_time_entries_project_started ON time_entries(project_id, started_at);
CREATE INDEX idx_time_entries_activity_started ON time_entries(activity_type_id, started_at);
CREATE INDEX idx_time_entries_open ON time_entries(ended_at) WHERE ended_at IS NULL;
