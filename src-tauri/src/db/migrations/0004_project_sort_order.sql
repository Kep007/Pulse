ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE projects SET sort_order = id;
