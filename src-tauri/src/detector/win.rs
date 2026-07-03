use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
};

#[derive(Debug, Clone)]
pub struct ForegroundInfo {
    pub window_title: String,
    pub process_name: String,
}

/// Reads the title and executable name of the current foreground window.
/// Returns `None` when there is no foreground window (e.g. the desktop
/// itself) or the process's information can't be queried.
pub fn read_foreground_info() -> Option<ForegroundInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let window_title = read_window_title(hwnd);

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }

        let exe_path = read_process_exe_path(pid)?;
        let process_name = process_name_from_path(&exe_path);

        Some(ForegroundInfo {
            window_title,
            process_name,
        })
    }
}

unsafe fn read_window_title(hwnd: HWND) -> String {
    let mut buffer = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buffer);
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buffer[..len as usize])
}

unsafe fn read_process_exe_path(pid: u32) -> Option<String> {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

    let mut buffer = [0u16; 1024];
    let mut size = buffer.len() as u32;
    let query_result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        windows::core::PWSTR(buffer.as_mut_ptr()),
        &mut size,
    );

    let _ = CloseHandle(handle);
    query_result.ok()?;

    Some(String::from_utf16_lossy(&buffer[..size as usize]))
}

fn process_name_from_path(exe_path: &str) -> String {
    std::path::Path::new(exe_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(exe_path)
        .to_string()
}
