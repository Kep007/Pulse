use windows::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId,
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

#[derive(Debug, Clone)]
pub struct ForegroundInfo {
    pub window_title: String,
    pub process_name: String,
    /// Where the window "is", when the title alone doesn't say: the full
    /// folder path of a File Explorer window, whose title is only the last
    /// folder's name ("Ottobre"), so `E:\SOFLY\Reels\...\Ottobre` never
    /// matched project SOFLY.
    pub location: Option<String>,
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
        let location = if process_name.eq_ignore_ascii_case("explorer") {
            explorer_folder(hwnd, &window_title)
        } else {
            None
        };

        Some(ForegroundInfo {
            window_title,
            process_name,
            location,
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

/// The folder open in the File Explorer window `hwnd`, through the shell's
/// own list of open folder windows (IShellWindows). On Windows 11 every tab
/// of a window is a separate entry sharing the window's HWND; the active
/// tab is the one whose name the window title starts with. None for the
/// desktop/taskbar (also explorer.exe) and for virtual locations without a
/// file path (Questo PC, Rete).
unsafe fn explorer_folder(hwnd: HWND, title: &str) -> Option<String> {
    use windows::core::Interface;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Shell::{IShellWindows, IWebBrowser2, ShellWindows};

    // Harmless when this thread is already initialized (S_FALSE, or
    // RPC_E_CHANGED_MODE on an STA thread — COM still works there).
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let shell_windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL).ok()?;
    let count = shell_windows.Count().ok()?;
    let mut fallback = None;
    for index in 0..count {
        let Ok(dispatch) = shell_windows.Item(&VARIANT::from(index)) else {
            continue;
        };
        let Ok(browser) = dispatch.cast::<IWebBrowser2>() else {
            continue;
        };
        if browser.HWND().map(|handle| handle.0) != Ok(hwnd.0 as isize) {
            continue;
        }
        let Some(path) = browser
            .LocationURL()
            .ok()
            .and_then(|url| super::paths::file_url_to_path(&url.to_string()))
        else {
            continue;
        };
        let name = browser.LocationName().map(|name| name.to_string()).unwrap_or_default();
        if !name.is_empty() && title.starts_with(&name) {
            return Some(path);
        }
        fallback.get_or_insert(path);
    }
    fallback
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

/// Re-places a window at the top of the topmost band via SetWindowPos,
/// unconditionally. This cannot go through Tauri's `set_always_on_top`: tao
/// caches its window flags and diffs against them (`WindowFlags::apply_diff`
/// returns early when nothing changed), so once it believes a window is
/// already topmost, every further `set_always_on_top(true)` is a silent
/// no-op — while Windows itself can quietly demote the window out of the
/// topmost band (observed when opening File Explorer windows) without tao's
/// cache ever learning about it. Calling the OS directly is what makes the
/// periodic reassertion in `detector::tick` actually reach Windows each time.
pub fn force_topmost(hwnd: isize) {
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd as *mut _),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

/// Checks the live key state directly rather than relying on DOM keyboard
/// events, which never reach the widget while it's click-through (or simply
/// unfocused, which an always-on-top utility window usually is) — this
/// works regardless of which window currently has focus.
pub fn is_ctrl_pressed() -> bool {
    unsafe { (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0 }
}

/// Whether the OS cursor currently sits inside the window's on-screen rect
/// (both in physical pixels, so no DPI conversion is needed). Backs the
/// widget's 150ms hover poll as a single native read — GetCursorPos and
/// GetWindowRect are plain user32 calls, safe from any thread — where the
/// frontend used to make four separate IPC round trips (cursor position,
/// window position, window size, Ctrl state) per poll.
pub fn cursor_over_window(hwnd: isize) -> bool {
    unsafe {
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_err() {
            return false;
        }
        let mut rect = RECT::default();
        if GetWindowRect(HWND(hwnd as *mut _), &mut rect).is_err() {
            return false;
        }
        point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    }
}

/// Seconds since the last system-wide keyboard or mouse input, regardless of
/// which window (if any) currently has focus — this is what lets typing a
/// WhatsApp message count as "active" even though the browser tab title
/// never changes, without needing to know which app that input landed in.
pub fn system_idle_seconds() -> u64 {
    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            // GetTickCount wraps every ~49.7 days; wrapping_sub keeps the
            // subtraction correct across that rollover.
            (GetTickCount().wrapping_sub(info.dwTime) as u64) / 1000
        } else {
            0
        }
    }
}

fn process_name_from_path(exe_path: &str) -> String {
    std::path::Path::new(exe_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(exe_path)
        .to_string()
}

#[cfg(test)]
mod tests {
    /// Needs a File Explorer window open on a folder whose path contains
    /// `PULSE_EXPLORER_TEST_EXPECT`; run with `-- --ignored`.
    #[test]
    #[ignore]
    fn reads_the_folder_of_an_open_explorer_window() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
        let expect = std::env::var("PULSE_EXPLORER_TEST_EXPECT").unwrap();
        unsafe {
            let hwnd = FindWindowW(w!("CabinetWClass"), None).expect("an Explorer window");
            let title = super::read_window_title(hwnd);
            let path = super::explorer_folder(hwnd, &title).expect("folder path");
            println!("title={title:?} path={path:?}");
            assert!(path.contains(&expect), "{path} should contain {expect}");
        }
    }
}
