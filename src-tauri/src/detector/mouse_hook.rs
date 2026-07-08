use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, SetWindowsHookExW, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_XBUTTONDOWN,
};

/// The confirm action can be bound to a mouse side button instead of a
/// keyboard combo. `RegisterHotKey` (used for the keyboard path in
/// `commands::settings`) only understands keyboard virtual keys, so mouse
/// buttons need this separate low-level hook to work system-wide.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Mouse4,
    Mouse5,
}

impl MouseButton {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "Mouse4" => Some(MouseButton::Mouse4),
            "Mouse5" => Some(MouseButton::Mouse5),
            _ => None,
        }
    }
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static TRIGGER: Mutex<Option<MouseButton>> = Mutex::new(None);
static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Which mouse button (if any) currently confirms a pending suggestion.
pub fn set_trigger(trigger: Option<MouseButton>) {
    *TRIGGER.lock().unwrap() = trigger;
}

/// Installs a process-wide low-level mouse hook once at startup. Left
/// installed for the app's lifetime regardless of whether the confirm
/// trigger is currently a mouse button or a keyboard combo — `TRIGGER`
/// (updated via `set_trigger`), not the hook's presence, decides whether a
/// side-button press actually does anything. Never swallows the click: the
/// button keeps working normally everywhere else (e.g. browser back/
/// forward) exactly as if this hook didn't exist, it just *also* confirms a
/// pending suggestion when one exists. The returned `HHOOK` is intentionally
/// dropped rather than stored — it stays valid until the process exits,
/// which is exactly the hook's intended lifetime here, and the handle
/// itself isn't `Send`/`Sync` so keeping it around would need its own
/// (needless) unsafe wrapper.
pub fn install(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Err(err) = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), None, 0) } {
        log::error!("failed to install mouse hook: {err}");
        INSTALLED.store(false, Ordering::SeqCst);
    }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && wparam.0 as u32 == WM_XBUTTONDOWN {
        if let Some(trigger) = *TRIGGER.lock().unwrap() {
            let data = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            // High word of mouseData: 1 = XBUTTON1 (back/Mouse4), 2 = XBUTTON2
            // (forward/Mouse5).
            let xbutton = (data.mouseData >> 16) & 0xFFFF;
            let matches = match trigger {
                MouseButton::Mouse4 => xbutton == 1,
                MouseButton::Mouse5 => xbutton == 2,
            };
            if matches {
                if let Some(app) = APP_HANDLE.get() {
                    let _ = crate::detector::confirm_pending_suggestion(app);
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
