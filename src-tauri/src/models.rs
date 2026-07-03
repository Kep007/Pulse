use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDto {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActivityTypeDto {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Auto,
    Manual,
}

impl Source {
    pub fn as_str(&self) -> &'static str {
        match self {
            Source::Auto => "auto",
            Source::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingSuggestion {
    pub project: Option<ProjectDto>,
    pub activity_type: Option<ActivityTypeDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingState {
    pub project: Option<ProjectDto>,
    pub activity_type: Option<ActivityTypeDto>,
    pub source: Source,
    pub is_paused: bool,
    pub segment_started_at: String,
    pub pending: Option<PendingSuggestion>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToastMessage {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BreakdownEntry {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBucket {
    pub date: String,
    pub total_seconds: i64,
    pub by_project: Vec<BreakdownEntry>,
    pub by_activity: Vec<BreakdownEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthBucket {
    pub month: String,
    pub total_seconds: i64,
    pub by_project: Vec<BreakdownEntry>,
    pub by_activity: Vec<BreakdownEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentDto {
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_seconds: i64,
    pub project: Option<ProjectDto>,
    pub activity_type: Option<ActivityTypeDto>,
}
