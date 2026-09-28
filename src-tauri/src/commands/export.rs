use crate::commands::stats::{activity_lookup, parse_boundary, project_lookup};
use crate::db;
use crate::detector::AppState;
use chrono::{DateTime, Datelike, Local, Utc};
use rust_xlsxwriter::{Format, FormatAlign, Workbook, XlsxError};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Writes the PDF built by the frontend (jsPDF) to the path the user picked
/// in the save dialog, then opens it with the system's default PDF viewer —
/// the immediate "here's your report" feedback for the Esporta PDF button.
#[tauri::command]
pub fn save_report_pdf(app: AppHandle, path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|err| err.to_string())?;
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|err| err.to_string())?;
    Ok(())
}

const WEEKDAYS_IT: [&str; 7] = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];

/// One tracked session, already in the user's local time.
struct SessionRow {
    start: DateTime<Local>,
    end: Option<DateTime<Local>>,
    project: String,
    activity: String,
    seconds: i64,
}

impl SessionRow {
    fn date(&self) -> String {
        self.start.format("%d/%m/%Y").to_string()
    }
    fn weekday(&self) -> &'static str {
        WEEKDAYS_IT[self.start.weekday().num_days_from_monday() as usize]
    }
    fn start_time(&self) -> String {
        self.start.format("%H:%M").to_string()
    }
    fn end_time(&self) -> String {
        self.end
            .map(|end| end.format("%H:%M").to_string())
            .unwrap_or_else(|| "in corso".to_string())
    }
    fn hours(&self) -> f64 {
        (self.seconds as f64 / 3600.0 * 100.0).round() / 100.0
    }
    fn month(&self) -> String {
        self.start.format("%Y-%m").to_string()
    }
}

fn hh_mm(seconds: i64) -> String {
    format!("{}:{:02}", seconds / 3600, (seconds % 3600) / 60)
}

const HEADERS: [&str; 8] = [
    "Data",
    "Giorno",
    "Inizio",
    "Fine",
    "Progetto",
    "Attività",
    "Ore",
    "Durata (h:mm)",
];

fn csv_field(value: &str) -> String {
    if value.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Semicolon-separated with decimal commas and a UTF-8 BOM — the dialect an
/// Italian-locale Excel opens directly, accents included, without an import
/// wizard.
fn write_csv(path: &str, rows: &[SessionRow]) -> Result<(), String> {
    let mut out = String::from("\u{FEFF}");
    out.push_str(&HEADERS.join(";"));
    out.push_str("\r\n");
    for row in rows {
        let fields = [
            row.date(),
            row.weekday().to_string(),
            row.start_time(),
            row.end_time(),
            row.project.clone(),
            row.activity.clone(),
            format!("{:.2}", row.hours()).replace('.', ","),
            hh_mm(row.seconds),
        ];
        let line: Vec<String> = fields.iter().map(|field| csv_field(field)).collect();
        out.push_str(&line.join(";"));
        out.push_str("\r\n");
    }
    std::fs::write(path, out).map_err(|err| err.to_string())
}

fn write_xlsx(path: &str, rows: &[SessionRow]) -> Result<(), XlsxError> {
    let mut workbook = Workbook::new();
    let header = Format::new()
        .set_bold()
        .set_background_color("#F2F4F7")
        .set_align(FormatAlign::Left);
    let hours = Format::new().set_num_format("0.00");

    // Sessions: the raw timesheet.
    let sheet = workbook.add_worksheet().set_name("Sessioni")?;
    for (col, title) in HEADERS.iter().enumerate() {
        sheet.write_with_format(0, col as u16, *title, &header)?;
    }
    for (index, row) in rows.iter().enumerate() {
        let r = index as u32 + 1;
        sheet.write(r, 0, row.date())?;
        sheet.write(r, 1, row.weekday())?;
        sheet.write(r, 2, row.start_time())?;
        sheet.write(r, 3, row.end_time())?;
        sheet.write(r, 4, row.project.as_str())?;
        sheet.write(r, 5, row.activity.as_str())?;
        sheet.write_with_format(r, 6, row.hours(), &hours)?;
        sheet.write(r, 7, hh_mm(row.seconds))?;
    }
    for (col, width) in [12, 11, 8, 9, 28, 18, 8, 13].iter().enumerate() {
        sheet.set_column_width(col as u16, *width)?;
    }
    sheet.set_freeze_panes(1, 0)?;
    sheet.autofilter(0, 0, rows.len() as u32, (HEADERS.len() - 1) as u16)?;

    // Month × project hours: the "how much did each client take" view.
    let projects: BTreeSet<&str> = rows.iter().map(|row| row.project.as_str()).collect();
    let mut by_month: BTreeMap<String, HashMap<&str, i64>> = BTreeMap::new();
    for row in rows {
        *by_month
            .entry(row.month())
            .or_default()
            .entry(row.project.as_str())
            .or_default() += row.seconds;
    }
    let sheet = workbook.add_worksheet().set_name("Riepilogo mensile")?;
    sheet.write_with_format(0, 0, "Mese", &header)?;
    for (col, project) in projects.iter().enumerate() {
        sheet.write_with_format(0, col as u16 + 1, *project, &header)?;
    }
    let total_col = projects.len() as u16 + 1;
    sheet.write_with_format(0, total_col, "Totale", &header)?;
    for (index, (month, totals)) in by_month.iter().enumerate() {
        let r = index as u32 + 1;
        sheet.write(r, 0, month.as_str())?;
        let mut month_total = 0;
        for (col, project) in projects.iter().enumerate() {
            let seconds = totals.get(project).copied().unwrap_or(0);
            month_total += seconds;
            sheet.write_with_format(r, col as u16 + 1, seconds as f64 / 3600.0, &hours)?;
        }
        sheet.write_with_format(r, total_col, month_total as f64 / 3600.0, &hours)?;
    }
    sheet.set_column_width(0, 10)?;
    for col in 1..=total_col {
        sheet.set_column_width(col, 16)?;
    }
    sheet.set_freeze_panes(1, 1)?;

    // Per-project totals.
    let mut per_project: BTreeMap<&str, (i64, i64, BTreeSet<String>)> = BTreeMap::new();
    for row in rows {
        let entry = per_project.entry(row.project.as_str()).or_default();
        entry.0 += row.seconds;
        entry.1 += 1;
        entry.2.insert(row.date());
    }
    let sheet = workbook.add_worksheet().set_name("Progetti")?;
    for (col, title) in ["Progetto", "Ore totali", "Sessioni", "Giorni attivi"].iter().enumerate() {
        sheet.write_with_format(0, col as u16, *title, &header)?;
    }
    for (index, (project, (seconds, sessions, days))) in per_project.iter().enumerate() {
        let r = index as u32 + 1;
        sheet.write(r, 0, *project)?;
        sheet.write_with_format(r, 1, *seconds as f64 / 3600.0, &hours)?;
        sheet.write(r, 2, *sessions as f64)?;
        sheet.write(r, 3, days.len() as f64)?;
    }
    sheet.set_column_width(0, 28)?;
    for col in 1..=3 {
        sheet.set_column_width(col, 14)?;
    }

    workbook.save(path)
}

/// CSV / Excel export of every session in the period (optionally one
/// project), written to `path` and opened. Returns false when there was
/// nothing to export (no file written).
#[tauri::command]
pub fn export_sessions(
    app: AppHandle,
    path: String,
    format: String,
    from: Option<String>,
    to: Option<String>,
    project_id: Option<i64>,
) -> Result<bool, String> {
    let from_dt = parse_boundary(from.as_deref().unwrap_or("2000-01-01"), false)?;
    let to_dt = match to.as_deref() {
        Some(to) => parse_boundary(to, true)?,
        None => Utc::now() + chrono::Duration::days(1),
    };
    let now = Utc::now();

    let rows: Vec<SessionRow> = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().unwrap();
        let raw = db::segments_between(&conn, from_dt, to_dt).map_err(|err| err.to_string())?;
        let projects = project_lookup(&conn).map_err(|err| err.to_string())?;
        let activities = activity_lookup(&conn).map_err(|err| err.to_string())?;
        raw.into_iter()
            .filter(|segment| project_id.is_none() || segment.project_id == project_id)
            .filter_map(|segment| {
                let start = DateTime::parse_from_rfc3339(&segment.started_at).ok()?.with_timezone(&Utc);
                let end = segment
                    .ended_at
                    .as_deref()
                    .and_then(|end| DateTime::parse_from_rfc3339(end).ok())
                    .map(|end| end.with_timezone(&Local));
                let seconds = segment
                    .duration_seconds
                    .unwrap_or_else(|| (now - start).num_seconds().max(0));
                if seconds <= 0 {
                    return None;
                }
                Some(SessionRow {
                    start: start.with_timezone(&Local),
                    end,
                    project: segment
                        .project_id
                        .and_then(|id| projects.get(&id))
                        .map(|project| project.name.clone())
                        .unwrap_or_else(|| "Nessun progetto".to_string()),
                    activity: segment
                        .activity_type_id
                        .and_then(|id| activities.get(&id))
                        .map(|activity| activity.name.clone())
                        .unwrap_or_default(),
                    seconds,
                })
            })
            .collect()
    };
    if rows.is_empty() {
        return Ok(false);
    }

    match format.as_str() {
        "csv" => write_csv(&path, &rows)?,
        "xlsx" => write_xlsx(&path, &rows).map_err(|err| err.to_string())?,
        other => return Err(format!("Formato non supportato: {other}")),
    }
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|err| err.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_fields_with_separators_are_quoted() {
        assert_eq!(csv_field("Cliente A"), "Cliente A");
        assert_eq!(csv_field("A; B"), "\"A; B\"");
        assert_eq!(csv_field("Il \"logo\""), "\"Il \"\"logo\"\"\"");
    }

    #[test]
    fn durations_format_as_hours_and_minutes() {
        assert_eq!(hh_mm(3 * 3600 + 5 * 60 + 59), "3:05");
        assert_eq!(hh_mm(59), "0:00");
    }
}
