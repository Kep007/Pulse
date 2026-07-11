use tauri::AppHandle;
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
