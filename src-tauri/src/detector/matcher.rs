use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Ports the previous TS `normalizeProjectName`: NFD-decompose, drop
/// combining marks (diacritics), lowercase, and collapse whitespace.
pub fn normalize_text(value: &str) -> String {
    let decomposed: String = value.nfd().filter(|c| !is_combining_mark(*c)).collect();
    decomposed
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_combining_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F)
}

fn compile_word_boundary_regex(normalized_term: &str) -> Option<Regex> {
    Regex::new(&format!(r"\b{}\b", regex::escape(normalized_term))).ok()
}

struct ProjectTerm {
    project_id: i64,
    term_len: usize,
    pattern: Regex,
}

pub enum MatchField {
    ProcessName,
    WindowTitle,
}

struct ActivityRule {
    activity_type_id: i64,
    match_field: MatchField,
    priority: i32,
    pattern: Regex,
}

/// Rebuilt whenever the project/alias/activity-rule catalog changes.
/// Matching itself never touches SQLite — it runs against normalized text
/// already loaded into these compiled patterns.
pub struct Matcher {
    project_terms: Vec<ProjectTerm>,
    activity_rules: Vec<ActivityRule>,
}

impl Matcher {
    pub fn build(
        projects: &[(i64, Vec<String>)],
        activity_rules: &[(i64, String, String, i32)],
    ) -> Self {
        let mut project_terms = Vec::new();
        for (project_id, terms) in projects {
            for term in terms {
                let normalized = normalize_text(term);
                if normalized.is_empty() {
                    continue;
                }
                if let Some(pattern) = compile_word_boundary_regex(&normalized) {
                    project_terms.push(ProjectTerm {
                        project_id: *project_id,
                        term_len: normalized.len(),
                        pattern,
                    });
                }
            }
        }

        let mut rules = Vec::new();
        for (activity_type_id, match_field, pattern_text, priority) in activity_rules {
            let normalized = normalize_text(pattern_text);
            if normalized.is_empty() {
                continue;
            }
            let match_field = match match_field.as_str() {
                "process_name" => MatchField::ProcessName,
                _ => MatchField::WindowTitle,
            };
            if let Some(pattern) = compile_word_boundary_regex(&normalized) {
                rules.push(ActivityRule {
                    activity_type_id: *activity_type_id,
                    match_field,
                    priority: *priority,
                    pattern,
                });
            }
        }

        Matcher {
            project_terms,
            activity_rules: rules,
        }
    }

    /// Longest matching alias/name wins when more than one project matches.
    pub fn match_project(&self, window_title: &str, process_name: &str) -> Option<i64> {
        let title = normalize_text(window_title);
        let process = normalize_text(process_name);

        self.project_terms
            .iter()
            .filter(|term| term.pattern.is_match(&title) || term.pattern.is_match(&process))
            .max_by_key(|term| term.term_len)
            .map(|term| term.project_id)
    }

    /// Highest-priority matching rule wins when more than one applies.
    pub fn match_activity(&self, window_title: &str, process_name: &str) -> Option<i64> {
        let title = normalize_text(window_title);
        let process = normalize_text(process_name);

        self.activity_rules
            .iter()
            .filter(|rule| {
                let haystack = match rule.match_field {
                    MatchField::ProcessName => &process,
                    MatchField::WindowTitle => &title,
                };
                rule.pattern.is_match(haystack)
            })
            .max_by_key(|rule| rule.priority)
            .map(|rule| rule.activity_type_id)
    }
}
