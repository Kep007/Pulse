use crate::detector;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The home window is created on demand and *really* destroyed on close
/// (see the CloseRequested handler in lib.rs) instead of living hidden from
/// startup like it used to: a whole WebView2 renderer (~100MB) is a lot to
/// keep around for a window many sessions never open — and recreating it on
/// each open also means the dashboard always mounts fresh, with current
/// data, rather than showing whatever it fetched when the app started.
///
/// `async` is load-bearing, not cosmetic: synchronous commands run on the
/// main thread, and `WebviewWindowBuilder::build` dispatches work to that
/// same thread and waits for it — calling it from a sync command deadlocks
/// the whole event loop (observed: home window stuck invisible, widget
/// frozen, every later IPC call dead). Async commands run on the runtime's
/// thread pool, where waiting on the main thread is safe.
#[tauri::command]
pub async fn open_home_window(app: AppHandle) {
    open_or_create_home(&app);
}

/// Callable directly from main-thread contexts too (the tray menu handler):
/// window creation inside menu/tray event callbacks is dispatched by the
/// event loop itself, which is the one place it doesn't self-deadlock.
pub fn open_or_create_home(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("home") {
        // show() alone doesn't restore a minimized window on Windows — it
        // stays minimized in the taskbar, so a click on "Home" in the widget
        // looked like it did nothing whenever the window had been minimized
        // rather than closed.
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // Same options the old tauri.conf.json "home" entry declared. Built
    // hidden: HomeApp shows the window itself after its first render, so
    // the user never sees the blank white flash of a booting webview.
    let built = WebviewWindowBuilder::new(app, "home", WebviewUrl::App("index.html".into()))
        .title("Pulse")
        .inner_size(820.0, 636.0)
        .center()
        .decorations(false)
        .resizable(false)
        .visible(false)
        .build();
    if let Err(err) = built {
        log::error!("failed to create home window: {err}");
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    detector::close_for_shutdown(&app);
    app.exit(0);
}

#[derive(serde::Serialize)]
pub struct WidgetHover {
    pub inside: bool,
    pub ctrl: bool,
}

/// One-shot snapshot for the widget's 150ms hover poll (see useHoverIntent
/// in the frontend): is the cursor inside the widget window, and is Ctrl
/// held. Doing all three native reads behind a single command keeps the
/// poll to one IPC round trip — it used to be four separate ones
/// (cursorPosition/outerPosition/outerSize/isCtrlPressed), which together
/// were the app's main steady-state CPU cost.
#[tauri::command]
pub fn poll_widget_hover(app: AppHandle) -> WidgetHover {
    let inside = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| detector::cursor_over_window(hwnd.0 as isize))
        .unwrap_or(false);
    WidgetHover {
        inside,
        ctrl: detector::is_ctrl_pressed(),
    }
}
