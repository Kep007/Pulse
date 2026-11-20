-- Whether a project appears in the widget's quick picker. Every project
-- stays searchable by typing; this only trims the default list.
ALTER TABLE projects ADD COLUMN in_picker INTEGER NOT NULL DEFAULT 1;
