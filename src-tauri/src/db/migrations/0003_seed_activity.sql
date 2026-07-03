INSERT OR IGNORE INTO activity_types (slug, name, sort_order) VALUES
  ('sviluppo', 'Sviluppo', 1),
  ('design', 'Design', 2),
  ('riunioni', 'Riunioni', 3),
  ('comunicazioni', 'Comunicazioni', 4),
  ('navigazione', 'Navigazione', 5),
  ('altro', 'Altro', 6);

INSERT INTO activity_rules (activity_type_id, match_field, pattern, priority)
SELECT id, rule.match_field, rule.pattern, rule.priority FROM activity_types
JOIN (
  SELECT 'sviluppo' AS slug, 'process_name' AS match_field, 'code' AS pattern, 10 AS priority
  UNION ALL SELECT 'sviluppo', 'process_name', 'devenv', 10
  UNION ALL SELECT 'sviluppo', 'process_name', 'idea64', 10
  UNION ALL SELECT 'sviluppo', 'process_name', 'pycharm64', 10
  UNION ALL SELECT 'sviluppo', 'process_name', 'webstorm64', 10
  UNION ALL SELECT 'sviluppo', 'process_name', 'windowsterminal', 5
  UNION ALL SELECT 'sviluppo', 'process_name', 'cmd', 5
  UNION ALL SELECT 'sviluppo', 'process_name', 'powershell', 5
  UNION ALL SELECT 'design', 'process_name', 'figma', 10
  UNION ALL SELECT 'design', 'process_name', 'photoshop', 10
  UNION ALL SELECT 'design', 'process_name', 'illustrator', 10
  UNION ALL SELECT 'riunioni', 'process_name', 'zoom', 10
  UNION ALL SELECT 'riunioni', 'process_name', 'teams', 10
  UNION ALL SELECT 'riunioni', 'window_title', 'meet.google', 10
  UNION ALL SELECT 'riunioni', 'process_name', 'webexmta', 10
  UNION ALL SELECT 'comunicazioni', 'process_name', 'outlook', 10
  UNION ALL SELECT 'comunicazioni', 'process_name', 'slack', 10
  UNION ALL SELECT 'comunicazioni', 'process_name', 'whatsapp', 10
  UNION ALL SELECT 'comunicazioni', 'process_name', 'telegram', 10
  UNION ALL SELECT 'navigazione', 'process_name', 'chrome', 1
  UNION ALL SELECT 'navigazione', 'process_name', 'firefox', 1
  UNION ALL SELECT 'navigazione', 'process_name', 'msedge', 1
) AS rule ON rule.slug = activity_types.slug;
