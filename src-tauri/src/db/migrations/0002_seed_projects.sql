INSERT OR IGNORE INTO projects (slug, name) VALUES
  ('gpt', 'GPT'),
  ('fpt', 'FPT'),
  ('og', 'OG'),
  ('ifo', 'IFO'),
  ('sofly', 'SOFLY'),
  ('mammma', 'MAMMMA'),
  ('sidial', 'SIDIAL'),
  ('general', 'GENERAL'),
  ('lt-finance', 'LT FINANCE'),
  ('sol-gru', 'SOL GRU'),
  ('manna', 'MANNA'),
  ('lt', 'LT');

INSERT INTO project_aliases (project_id, alias)
SELECT id, alias FROM projects
JOIN (
  SELECT 'gpt' AS slug, 'Gerardo PT' AS alias
  UNION ALL SELECT 'fpt', 'Francesco PT'
  UNION ALL SELECT 'og', 'OG Motors'
  UNION ALL SELECT 'ifo', 'IFO Wellness Club'
  UNION ALL SELECT 'sofly', 'Simple Operator Fly'
  UNION ALL SELECT 'mammma', 'MAMMMA'
  UNION ALL SELECT 'mammma', 'MAMMMÀ'
  UNION ALL SELECT 'general', 'General Impresa'
  UNION ALL SELECT 'sol-gru', 'Sol Gru Martelli'
  UNION ALL SELECT 'manna', 'MANNA PUBBLICITÀ'
  UNION ALL SELECT 'lt', 'LT Consulting'
) AS seed ON seed.slug = projects.slug;
