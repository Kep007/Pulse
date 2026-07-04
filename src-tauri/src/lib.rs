mod commands;
mod db;
mod detector;
mod models;

use detector::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
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
            commands::stats::get_daily_summary,
            commands::stats::get_monthly_summary,
            commands::stats::get_day_detail,
            commands::projects::create_project,
            commands::projects::update_project,
            commands::projects::archive_project,
            commands::projects::reorder_projects,
        ])
        .setup(|app| {
            let conn = db::open(app.handle())?;
            let state = AppState::new(conn)?;
            app.manage(state);
            detector::spawn_polling(app.handle().clone());

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

            let show = MenuItem::with_id(app, "show", "Mostra Pulse", true, None::<&str>)?;
            let dashboard =
                MenuItem::with_id(app, "dashboard", "Apri Dashboard", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &dashboard, &quit])?;

            let mut tray_builder = TrayIconBuilder::new().tooltip("Pulse").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_widget(app),
                    "dashboard" => show_home(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_widget(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "home" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
