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
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::UpdaterExt;

/// Checks the GitHub Releases endpoint configured in tauri.conf.json for a
/// newer version; if one exists, downloads and installs it, then relaunches
/// so it takes effect. Tracked history is untouched either way — it lives in
/// the per-user app data dir, not the install directory a new version
/// overwrites. Runs once at startup, not on a timer, so an update can only
/// land in the first few seconds after launch rather than interrupting an
/// active session later.
async fn check_for_update(app: AppHandle) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) => {
            eprintln!("Pulse: updater unavailable: {err}");
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(err) => {
            eprintln!("Pulse: update check failed: {err}");
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
        eprintln!("Pulse: update install failed: {err}");
        return;
    }

    app.restart();
}

fn show_widget(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_home(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("home") {
        let _ = window.show();
        let _ = window.set_focus();
    }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_widget(app);
        }))
        .plugin(tauri_plugin_opener::init())
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
                        let _ = detector::confirm_pending_suggestion(app);
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
            commands::window::is_ctrl_pressed,
            commands::settings::set_autostart,
            commands::settings::get_autostart_status,
            commands::settings::reset_all_data,
            commands::settings::get_confirm_shortcut,
            commands::settings::set_confirm_shortcut,
            commands::settings::get_activity_detection_enabled,
            commands::settings::set_activity_detection_enabled,
            commands::stats::get_daily_summary,
            commands::stats::get_monthly_summary,
            commands::stats::get_day_detail,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::archive_project,
            commands::projects::reorder_projects,
            commands::projects::set_project_aliases,
        ])
        .setup(|app| {
            let conn = db::open(app.handle())?;
            let state = AppState::new(conn)?;
            app.manage(state);
            detector::spawn_polling(app.handle().clone());

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                check_for_update(update_handle).await;
            });

            let confirm_shortcut = {
                let store = app.store("settings.json")?;
                store
                    .get("confirmShortcut")
                    .and_then(|value| value.as_str().map(str::to_string))
                    .unwrap_or_else(|| {
                        commands::settings::DEFAULT_CONFIRM_SHORTCUT.to_string()
                    })
            };
            if let Err(err) = app.global_shortcut().register(confirm_shortcut.as_str()) {
                eprintln!("Pulse: failed to register confirm shortcut: {err}");
            }

            let activity_detection_enabled = {
                let store = app.store("settings.json")?;
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
                    "quit" => app.exit(0),
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
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
