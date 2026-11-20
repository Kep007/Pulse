//! Full path of the document open in Adobe/Office apps. Their window titles
//! show only the file name ("Menuaggiornato.ai @ 50 %"), which rarely names
//! the client — the folder does (`E:\SOFLY\Grafiche\Menuaggiornato.ai`). In
//! the detection study Illustrator alone was 7.6h with no project matched.
//!
//! The path comes from the app's own COM automation object (the same one
//! its scripting uses), asked through PowerShell on a background thread and
//! cached per window title, so the 2s detection tick never waits on it: the
//! first tick on a new title matches on the title alone, the next ones also
//! on the path.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

/// Running-app COM ProgID and the property chain that yields the active
/// document's full path.
fn automation_for(process_name: &str) -> Option<(&'static str, &'static str)> {
    let process = process_name.to_ascii_lowercase();
    Some(match process.as_str() {
        "illustrator" => ("Illustrator.Application", "ActiveDocument.FullName"),
        "photoshop" => ("Photoshop.Application", "ActiveDocument.FullName"),
        "indesign" => ("InDesign.Application", "ActiveDocument.FullName"),
        "winword" => ("Word.Application", "ActiveDocument.FullName"),
        "excel" => ("Excel.Application", "ActiveWorkbook.FullName"),
        "powerpnt" => ("PowerPoint.Application", "ActivePresentation.FullName"),
        _ => return None,
    })
}

const MAX_CACHED: usize = 500;

#[derive(Default)]
struct Cache {
    paths: HashMap<String, Option<String>>,
    in_flight: HashSet<String>,
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// The document path for this window if already known; otherwise starts
/// looking it up in the background and returns None for now.
pub fn document_path(process_name: &str, window_title: &str) -> Option<String> {
    let (prog_id, property) = automation_for(process_name)?;
    if window_title.trim().is_empty() {
        return None;
    }
    let key = format!("{process_name}\u{1}{window_title}");
    {
        let mut cache = cache().lock().unwrap();
        if let Some(path) = cache.paths.get(&key) {
            return path.clone();
        }
        if !cache.in_flight.insert(key.clone()) {
            return None;
        }
    }
    std::thread::spawn(move || {
        let path = query_active_document(prog_id, property);
        let mut cache = cache().lock().unwrap();
        cache.in_flight.remove(&key);
        if cache.paths.len() >= MAX_CACHED {
            cache.paths.clear();
        }
        cache.paths.insert(key, path);
    });
    None
}

/// GetActiveObject only attaches to an already-running app (never starts
/// one) and fails quietly for unsaved documents — both just yield None.
fn query_active_document(prog_id: &str, property: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = format!(
        "$ErrorActionPreference='Stop'; try {{ $app=[Runtime.InteropServices.Marshal]::GetActiveObject('{prog_id}'); [Console]::Out.Write([string]$app.{property}) }} catch {{}}"
    );
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // A real path, not an app's "Untitled-1" placeholder.
    (path.contains('\\') || path.contains('/')).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_document_apps_are_queried() {
        assert!(automation_for("Illustrator").is_some());
        assert!(automation_for("WINWORD").is_some());
        assert!(automation_for("chrome").is_none());
        assert_eq!(document_path("chrome", "Qualcosa"), None);
    }
}
