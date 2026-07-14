mod commands;
mod db;
mod detector;
mod models;

use detector::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::UpdaterExt;

/// Writes crashes to a plain file directly, independent of the log plugin —
/// so a panic during startup (before that plugin has finished initializing,
/// e.g. inside `db::open`'s `.expect()` calls) still leaves a trace. This is
/// the file to check first when the app "just crashes" with no other clue.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Matches tauri_plugin_log's LogDir target (dirs::data_local_dir,
        // i.e. %LOCALAPPDATA% on Windows, not %APPDATA%) so both land in the
        // same folder the user is told to check.
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            let path = std::path::Path::new(&local_app_data)
                .join("app.pulse.desktop")
                .join("logs")
                .join("crash.log");
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                use std::io::Write;
                let _ = writeln!(file, "[{}] {info}", chrono::Utc::now().to_rfc3339());
            }
        }
        default_hook(info);
    }));
}

/// Moves the database and settings file from the pre-2.0.2 locations
/// (`app_data_dir`, i.e. roaming `%APPDATA%\app.pulse.desktop\`) into the
/// unified local data dir (`db::data_dir`, `%LOCALAPPDATA%\app.pulse.desktop\`)
/// that already held `logs\`. Runs once at startup, before anything opens
/// either file. Best-effort: a failed move (e.g. an old file somehow already
/// gone) just leaves that one file where it was rather than aborting startup
/// — the app already knows how to create fresh files in the new location.
fn migrate_legacy_data_dir(app: &AppHandle) {
    let Ok(old_dir) = app.path().app_data_dir() else {
        return;
    };
    if !old_dir.exists() {
        return;
    }
    let new_dir = db::data_dir(app);
    if old_dir == new_dir {
        return;
    }
    if std::fs::create_dir_all(&new_dir).is_err() {
        return;
    }

    for file_name in ["pulse.db", "pulse.db-wal", "pulse.db-shm", "settings.json"] {
        let old_path = old_dir.join(file_name);
        let new_path = new_dir.join(file_name);
        if old_path.exists() && !new_path.exists() {
            match std::fs::rename(&old_path, &new_path) {
                Ok(()) => log::info!("migrated {file_name} to unified data dir"),
                Err(err) => log::error!("failed to migrate {file_name}: {err}"),
            }
        }
    }

    // Best-effort cleanup: only succeeds if the old folder is now empty.
    let _ = std::fs::remove_dir(&old_dir);
}

/// Checks the GitHub Releases endpoint configured in tauri.conf.json for a
/// newer version; if one exists, downloads and installs it, then relaunches
/// so it takes effect. Tracked history is untouched either way — it lives in
/// the per-user app data dir, not the install directory a new version
/// overwrites. Runs once at startup, not on a timer, so an update can only
/// land in the first few seconds after launch rather than interrupting an
/// active session later.
async fn check_for_update(app: AppHandle) {
    // Dev builds must never self-update. The updater installs into
    // %LOCALAPPDATA%\Programs\Pulse but can't touch the running dev exe in
    // target\ — its version stays old forever, so every launch would
    // re-download and re-install the same update. Combined with the restart
    // below, that was a literal infinite loop (app closes, reinstalls,
    // reopens...) on any machine whose autostart entry pointed at a dev
    // build. Customers always run the installed exe, which the installer
    // does update, so this gate changes nothing for them.
    if cfg!(debug_assertions) {
        return;
    }

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            log::error!("updater unavailable: {err}");
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(err) => {
            log::error!("update check failed: {err}");
            return;
        }
    };

    let _ = app.emit(
        "toast-message",
        &models::ToastMessage {
            text: format!("Aggiornamento a v{} in corso...", update.version),
        },
    );

    if let Err(err) = update.download_and_install(|_, _| {}, || {}).await {
        log::error!("update install failed: {err}");
        return;
    }

    // Exit, never restart. On Windows the NSIS updater normally kills the
    // process itself and relaunches the *installed* copy, so this line is
    // rarely even reached — but when download_and_install does return,
    // restarting relaunches the exe currently running, and if that exe is
    // not the installed one (a build launched from target\, an old copy)
    // its version is still old after the install: it would check again,
    // install again, restart again — the reopen-after-quit loop the
    // autostart setting got blamed for. Exiting instead always breaks that
    // cycle; the freshly installed copy is one click (or one logon) away.
    detector::close_for_shutdown(&app);
    app.exit(0);
}

fn show_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_home(app: &AppHandle) {
    // The tray menu's "Dashboard" entry — same create-or-show logic as the
    // widget's Home button.
    commands::window::open_or_create_home(app);
}

/// Shows or hides the widget and keeps the tray menu label in sync, so the
/// menu always reflects the action it's about to perform rather than a
/// static "Mostra Widget" that does nothing when the widget is already shown.
fn toggle_widget(app: &AppHandle, toggle_item: &MenuItem<tauri::Wry>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let is_visible = window.is_visible().unwrap_or(true);
    if is_visible {
        let _ = window.hide();
        let _ = toggle_item.set_text("Mostra Widget");
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = toggle_item.set_text("Nascondi Widget");
    }
}

pub fn run() {
    install_panic_hook();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(Target::new(TargetKind::LogDir { file_name: None }))
                .target(Target::new(TargetKind::Stdout))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_widget(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        detector::confirm_pending_if_any(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::tracking::get_current_state,
            commands::tracking::list_projects,
            commands::tracking::list_activity_types,
            commands::tracking::set_active_project,
            commands::tracking::set_active_activity,
            commands::tracking::pause_tracking,
            commands::tracking::resume_tracking,
            commands::tracking::confirm_pending_suggestion,
            commands::tracking::deny_pending_suggestion,
            commands::window::open_home_window,
            commands::window::quit_app,
            commands::window::poll_widget_hover,
            commands::window::reveal_extension_folder,
            commands::settings::set_autostart,
            commands::settings::get_autostart_status,
            commands::settings::reset_all_data,
            commands::settings::get_confirm_shortcut,
            commands::settings::set_confirm_shortcut,
            commands::settings::get_activity_detection_enabled,
            commands::settings::set_activity_detection_enabled,
            commands::settings::get_company,
            commands::settings::set_company,
            commands::stats::get_daily_summary,
            commands::stats::get_monthly_summary,
            commands::stats::get_day_detail,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::archive_project,
            commands::projects::reorder_projects,
            commands::projects::set_project_aliases,
            commands::projects::set_project_colors,
            commands::export::save_report_pdf,
        ])
        .setup(|app| {
            log::info!("Pulse {} starting up", app.package_info().version);
            // The toast window must never intercept mouse input before the
            // frontend takes over managing it (ToastWindow.tsx flips this
            // off only for the confirm toast, which has clickable buttons) —
            // it's transparent and always-on-top, so any stretch where it's
            // visible without click-through is an invisible dead zone.
            if let Some(toast) = app.get_webview_window("toast") {
                let _ = toast.set_ignore_cursor_events(true);
            }
            migrate_legacy_data_dir(app.handle());
            let conn = db::open(app.handle())?;
            // Company terms feed the matcher's priority rule (see
            // Matcher::match_project) and live in the settings store, so
            // they're read before the state is built.
            let company_terms = commands::settings::company_terms(app.handle());
            let state = AppState::new(conn, &company_terms)?;
            app.manage(state);
            // Bring the mirrored company project into existence for anyone who
            // configured a company before it synced to the catalog. Only
            // (re)creates a missing project — never clobbers Projects-table
            // edits — and any fresh project it makes is folded into the matcher
            // by the refresh right after.
            if let Err(err) = commands::settings::sync_company_project(app.handle(), false) {
                log::error!("failed to sync company project on startup: {err}");
            } else if let Err(err) = detector::refresh_matcher(app.handle()) {
                log::error!("failed to refresh matcher after company sync: {err}");
            }
            detector::spawn_polling(app.handle().clone());
            detector::browser_signal::spawn_server(app.handle().clone());

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                check_for_update(update_handle).await;
            });

            let confirm_shortcut = {
                let store = app.store(db::data_dir(app.handle()).join("settings.json"))?;
                store
                    .get("confirmShortcut")
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_else(|| {
                        commands::settings::DEFAULT_CONFIRM_SHORTCUT.to_string()
                    })
            };
            detector::mouse_hook::install(app.handle().clone());
            if let Some(button) = detector::mouse_hook::MouseButton::parse(&confirm_shortcut) {
                detector::mouse_hook::set_trigger(Some(button));
            } else {
                match commands::settings::parse_accelerator(&confirm_shortcut) {
                    Ok(hotkey) => {
                        if let Err(err) = app.global_shortcut().register(hotkey) {
                            log::error!("failed to register confirm shortcut: {err}");
                        }
                    }
                    Err(err) => log::error!("failed to parse confirm shortcut: {err}"),
                }
            }

            let activity_detection_enabled = {
                let store = app.store(db::data_dir(app.handle()).join("settings.json"))?;
                store
                    .get("activityDetectionEnabled")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false)
            };
            *app.state::<AppState>()
                .activity_detection_enabled
                .lock()
                .unwrap() = activity_detection_enabled;

            let widget_visible = app
                .get_webview_window("main")
                .map(|w| w.is_visible().unwrap_or(true))
                .unwrap_or(true);
            let toggle_label = if widget_visible {
                "Nascondi Widget"
            } else {
                "Mostra Widget"
            };
            let toggle = MenuItem::with_id(app, "toggle", toggle_label, true, None::<&str>)?;
            let dashboard =
                MenuItem::with_id(app, "dashboard", "Apri Dashboard", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &dashboard, &quit])?;

            let mut tray_builder = TrayIconBuilder::new().tooltip("Pulse").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let toggle_for_menu = toggle.clone();
            let _tray = tray_builder
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle" => toggle_widget(app, &toggle_for_menu),
                    "dashboard" => show_home(app),
                    "quit" => {
                        detector::close_for_shutdown(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_widget(tray.app_handle());
                        let _ = toggle.set_text("Nascondi Widget");
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Widget and toast only ever hide — the app lives in the
                // tray. The home window instead really closes, freeing its
                // WebView2 renderer; open_home_window recreates it (with
                // fresh dashboard data) on the next open.
                if window.label() != "home" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
