use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Ports the previous TS `normalizeProjectName`: NFD-decompose, drop
/// combining marks (diacritics), lowercase, and collapse whitespace.
///
/// Non-alphanumeric separators (underscore, hyphen, dot, ...) are also
/// folded to spaces here, not just plain whitespace — file names (a Word
/// document's window title *is* its file name) very commonly join the
/// project name to the rest with an underscore, e.g. `SIDIAL_Preventivo.docx`.
/// `\b` in the word-boundary regex below doesn't break on `_` (it's a regex
/// word character like a letter or digit), so `SIDIAL_Preventivo` would
/// otherwise be seen as one unbroken word and never match `\bsidial\b`.
pub fn normalize_text(value: &str) -> String {
    let decomposed: String = value.nfd().filter(|c| !is_combining_mark(*c)).collect();
    decomposed
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_combining_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F)
}

/// Normalized phrases that veto project matching for the whole title. These
/// are documents *about* many projects at once — e.g. the agency's master
/// spreadsheet listing every client — whose titles inevitably contain real
/// project names ("Progetti LT Consulting" contains project "LT"), so any
/// term match inside them is a false positive by construction: the user is
/// consulting the overview, not working on the project whose name happens
/// to appear. Compared against `normalize_text(title)`, so case, accents
/// and separators don't matter.
const EXCLUDED_TITLE_PHRASES: &[&str] = &["progetti lt consulting"];

fn is_excluded_title(normalized_title: &str) -> bool {
    EXCLUDED_TITLE_PHRASES
        .iter()
        .any(|phrase| normalized_title.contains(phrase))
}

fn compile_word_boundary_regex(normalized_term: &str) -> Option<Regex> {
    Regex::new(&format!(r"\b{}\b", regex::escape(normalized_term))).ok()
}

struct ProjectTerm {
    project_id: i64,
    term_len: usize,
    /// True when this term (normalized) is also one of the configured
    /// company terms (the company's own name/aliases, set in the Progetti
    /// tab). Company terms show up in text that is *about* other projects
    /// too — WhatsApp group names like "LT TEAM / OG MOTORS" — so a match
    /// through one of them only wins when no non-company project matched
    /// the same text (see match_project).
    is_company: bool,
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
        company_terms: &[String],
    ) -> Self {
        let company: Vec<String> = company_terms
            .iter()
            .map(|term| normalize_text(term))
            .filter(|term| !term.is_empty())
            .collect();

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
                        is_company: company.contains(&normalized),
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

    /// Longest matching alias/name wins when more than one project matches —
    /// but matches through a *company* term always lose to matches through
    /// any other term. The company's name inevitably appears next to real
    /// project names ("LT TEAM / OG MOTORS", "LT CONSULTING / MANNA"): in
    /// that text the user is working on the other project, not "for the
    /// company". Only when the company is the *only* thing the text matches
    /// (e.g. the internal team chat) does the company's own project win.
    pub fn match_project(&self, window_title: &str, process_name: &str) -> Option<i64> {
        let title = normalize_text(window_title);
        let process = normalize_text(process_name);

        if is_excluded_title(&title) {
            return None;
        }

        let matched: Vec<&ProjectTerm> = self
            .project_terms
            .iter()
            .filter(|term| term.pattern.is_match(&title) || term.pattern.is_match(&process))
            .collect();

        let best_of = |company: bool| {
            matched
                .iter()
                .filter(|term| term.is_company == company)
                .max_by_key(|term| term.term_len)
                .map(|term| term.project_id)
        };
        best_of(false).or_else(|| best_of(true))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn matcher_with_lt() -> Matcher {
        Matcher::build(&[(1, vec!["LT".to_string()])], &[], &[])
    }

    /// The user's real setup: LT CONSULTING is both a project (id 1) and the
    /// company they work at; OG (id 2) and MANNA (id 3) are client projects.
    fn matcher_with_company() -> Matcher {
        Matcher::build(
            &[
                (1, vec!["LT CONSULTING".to_string(), "LT".to_string()]),
                (2, vec!["OG".to_string(), "OG Motors".to_string()]),
                (3, vec!["MANNA".to_string()]),
            ],
            &[],
            &[
                "LT".to_string(),
                "LT TEAM".to_string(),
                "LT CONSULTING".to_string(),
            ],
        )
    }

    #[test]
    fn company_term_loses_to_any_other_project_in_the_same_text() {
        let matcher = matcher_with_company();
        // WhatsApp group names that pair the company with a client.
        assert_eq!(matcher.match_project("LT TEAM/ OG MOTORS", "chrome"), Some(2));
        // Longest-term alone would pick LT CONSULTING (13 chars) over MANNA
        // (5): the company rule must override length.
        assert_eq!(matcher.match_project("LT CONSULTING/ MANNA", "chrome"), Some(3));
        // Tie on term length (LT vs OG) used to be arbitrary — company loses.
        assert_eq!(matcher.match_project("LT / OG", "chrome"), Some(2));
    }

    #[test]
    fn company_only_text_still_tracks_the_company_project() {
        let matcher = matcher_with_company();
        assert_eq!(matcher.match_project("LT TEAM", "chrome"), Some(1));
        assert_eq!(matcher.match_project("Riunione LT CONSULTING", "chrome"), Some(1));
    }

    #[test]
    fn without_company_terms_longest_term_still_wins() {
        let matcher = Matcher::build(
            &[
                (1, vec!["LT CONSULTING".to_string(), "LT".to_string()]),
                (3, vec!["MANNA".to_string()]),
            ],
            &[],
            &[],
        );
        assert_eq!(matcher.match_project("LT CONSULTING/ MANNA", "chrome"), Some(1));
    }

    #[test]
    fn excluded_title_never_matches_a_project() {
        let matcher = matcher_with_lt();
        assert_eq!(
            matcher.match_project("Progetti LT Consulting.xlsx - Excel - Google Chrome", "chrome"),
            None,
        );
        // Case/separator variations still hit the normalized exclusion.
        assert_eq!(
            matcher.match_project("PROGETTI_LT_CONSULTING - Fogli Google", "chrome"),
            None,
        );
    }

    #[test]
    fn normal_titles_still_match() {
        let matcher = matcher_with_lt();
        assert_eq!(matcher.match_project("LT - preventivo sito", "chrome"), Some(1));
    }
}
