mod database;
mod commands;

use database::Database;
use commands::*;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, WebviewWindowExt};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(NoteFastPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
fn setup_macos_panel(app: &tauri::App) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;

    let window = app.get_webview_window("main").unwrap();
    let panel = window.to_panel::<NoteFastPanel>().expect("failed to convert window to panel");

    // Configure low-level Cocoa properties on the NSPanel
    let ns_window_ptr = window.ns_window().unwrap() as *mut AnyObject;

    unsafe {
        if let Some(ns_panel) = ns_window_ptr.as_ref() {
            // Restore native frame position and size if saved
            if let Ok(app_dir) = app.path().app_data_dir() {
                let state_file = app_dir.join("window_state.json");
                let mut restored = false;
                if let Ok(content) = std::fs::read_to_string(&state_file) {
                    if let Ok(saved) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let (Some(x), Some(y), Some(w), Some(h)) = (
                            saved["x"].as_f64(),
                            saved["y"].as_f64(),
                            saved["width"].as_f64(),
                            saved["height"].as_f64(),
                        ) {
                            if w >= 320.0 && h >= 400.0 {
                                use tauri_nspanel::objc2_foundation::{NSPoint, NSSize, NSRect};
                                let frame = NSRect {
                                    origin: NSPoint { x, y },
                                    size: NSSize { width: w, height: h },
                                };
                                let _: () = msg_send![ns_panel, setFrame: frame, display: true];
                                restored = true;
                            }
                        }
                    }
                }

                if !restored {
                    let size_file = app_dir.join("window_size.json");
                    if let Ok(content) = std::fs::read_to_string(&size_file) {
                        if let Ok(saved) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let (Some(w), Some(h)) = (saved["width"].as_f64(), saved["height"].as_f64()) {
                                if w >= 320.0 && h >= 400.0 {
                                    use tauri_nspanel::objc2_foundation::NSRect;
                                    let mut frame: NSRect = msg_send![ns_panel, frame];
                                    let diff_h = h - frame.size.height;
                                    frame.origin.y -= diff_h;
                                    frame.size.width = w;
                                    frame.size.height = h;
                                    let _: () = msg_send![ns_panel, setFrame: frame, display: true];
                                }
                            }
                        }
                    }
                }
            }

            // Level 1000 = kCGScreenSaverWindowLevel / NSScreenSaverWindowLevel
            // Guarantees NoteFast stays strictly ABOVE native fullscreen apps, auxiliary overlays, and spaces
            let level: isize = 1000;
            let _: () = msg_send![ns_panel, setLevel: level];

            // NSWindowCollectionBehavior:
            // 1 << 0 = CanJoinAllSpaces (persists across all desktops and fullscreen spaces)
            // 1 << 6 = IgnoresCycle (excludes from Cmd+Tab cycle)
            // 1 << 8 = FullScreenAuxiliary (officially permitted by Window Server inside fullscreen spaces)
            let behavior: usize = (1 << 0) | (1 << 6) | (1 << 8);
            let _: () = msg_send![ns_panel, setCollectionBehavior: behavior];

            // NSWindowStyleMaskNonactivatingPanel (1 << 7 = 128)
            // Crucial: prevents clicks on NoteFast from deactivating the fullscreen space or switching away
            let current_mask: usize = msg_send![ns_panel, styleMask];
            let non_activating_mask: usize = current_mask | (1 << 7);
            let _: () = msg_send![ns_panel, setStyleMask: non_activating_mask];

            // Do not hide when user interacts with fullscreen apps or deactivates NoteFast
            let _: () = msg_send![ns_panel, setHidesOnDeactivate: false];

            // Allow transparent backing so the rounded corners clip smoothly
            let _: () = msg_send![ns_panel, setOpaque: false];

            // Order window to the very front regardless of the active space
            let _: () = msg_send![ns_panel, orderFrontRegardless];
        }
    }

    let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::IgnoresCycle;

    panel.set_collection_behavior(behavior);
    panel.set_level(1000);
    panel.show_and_make_key();

    #[cfg(debug_assertions)]
    unsafe {
        if let Some(ns_panel) = ns_window_ptr.as_ref() {
            let current_behavior: usize = msg_send![ns_panel, collectionBehavior];
            let current_level: isize = msg_send![ns_panel, level];
            let current_mask: usize = msg_send![ns_panel, styleMask];
            let is_visible: bool = msg_send![ns_panel, isVisible];
            let is_panel: bool = msg_send![ns_panel, isKindOfClass: objc2::class!(NSPanel)];
            let frame: NSRect = msg_send![ns_panel, frame];
            eprintln!("=== NoteFast Diagnostics: is_panel={}, level={}, behavior={:#x}, styleMask={:#x}, is_visible={}, frame=({:.1}, {:.1}) {:.1}x{:.1} ===", is_panel, current_level, current_behavior, current_mask, is_visible, frame.origin.x, frame.origin.y, frame.size.width, frame.size.height);
        }
    }
}

pub fn show_and_focus_main_panel<R: tauri::Runtime>(manager: &impl Manager<R>) {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        if let Ok(panel) = manager.get_webview_panel("main") {
            panel.show_and_make_key();
        }

        if let Some(win) = manager.get_webview_window("main") {
            if let Ok(ptr) = win.ns_window() {
                unsafe {
                    let app_class = objc2::class!(NSApplication);
                    let shared_app: *mut AnyObject = msg_send![app_class, sharedApplication];
                    let _: () = msg_send![shared_app, activateIgnoringOtherApps: true];

                    if let Some(ns_panel) = (ptr as *mut AnyObject).as_ref() {
                        let _: () = msg_send![ns_panel, orderFrontRegardless];
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = manager.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_and_focus_main_panel(app);
        }));

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    let app = builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        #[cfg(target_os = "macos")]
                        {
                            use tauri_nspanel::ManagerExt;

                            if let Ok(panel) = app.get_webview_panel("main") {
                                if panel.is_visible() {
                                    panel.hide();
                                } else {
                                    show_and_focus_main_panel(app);
                                }
                            }
                        }

                        #[cfg(not(target_os = "macos"))]
                        {
                            if let Some(window) = app.get_webview_window("main") {
                                if let Ok(is_visible) = window.is_visible() {
                                    if is_visible {
                                        let _ = window.hide();
                                    } else {
                                        show_and_focus_main_panel(app);
                                    }
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Initialize database
            let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let db = Database::new(app_dir.clone()).expect("Failed to initialize database");
            app.manage(db);

            // Restore window size if previously saved
            let state_file = app_dir.join("window_state.json");
            let size_file = app_dir.join("window_size.json");
            let content_opt = std::fs::read_to_string(&state_file)
                .or_else(|_| std::fs::read_to_string(&size_file));

            if let Ok(content) = content_opt {
                if let Ok(saved) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let (Some(w), Some(h)) = (saved["width"].as_f64(), saved["height"].as_f64()) {
                        if w >= 320.0 && h >= 400.0 {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.set_size(tauri::Size::Logical(tauri::LogicalSize {
                                    width: w,
                                    height: h,
                                }));
                            }
                        }
                    }
                }
            }

            // Window event listener to save size on native resize events as well
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                let app_dir_clone = app_dir.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(physical_size) = event {
                        if physical_size.width > 0 && physical_size.height > 0 {
                            let scale = win_clone.scale_factor().unwrap_or(1.0);
                            let logical_w = (physical_size.width as f64) / scale;
                            let logical_h = (physical_size.height as f64) / scale;
                            if logical_w >= 320.0 && logical_h >= 400.0 {
                                let state_file = app_dir_clone.join("window_state.json");
                                if let Ok(state_str) = std::fs::read_to_string(&state_file) {
                                    if let Ok(mut state_json) = serde_json::from_str::<serde_json::Value>(&state_str) {
                                        state_json["width"] = serde_json::json!(logical_w);
                                        state_json["height"] = serde_json::json!(logical_h);
                                        let _ = std::fs::write(&state_file, state_json.to_string());
                                    }
                                }
                                let size_file = app_dir_clone.join("window_size.json");
                                let json = serde_json::json!({
                                    "width": logical_w,
                                    "height": logical_h
                                });
                                let _ = std::fs::write(size_file, json.to_string());
                            }
                        }
                    }
                });
            }

            // Register global shortcuts to toggle NoteFast window (both Phase 4 ⌘⇧Space and ⌘⇧N)
            let _ = app.global_shortcut().register("CommandOrControl+Shift+Space");
            let _ = app.global_shortcut().register("CommandOrControl+Shift+N");

            // Set macOS-specific window behavior and subclass to NSPanel
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                setup_macos_panel(app);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_notes,
            get_note,
            create_note,
            update_note,
            delete_note,
            toggle_pin,
            start_native_drag,
            get_drag_diagnostics,
            hide_window,
            save_window_size,
            quit_app,
            open_settings_window,
            close_settings_window,
            open_app_data_folder,
            get_storage_stats,
            set_always_on_top
        ])
        .build(tauri::generate_context!())
        .expect("error while building NoteFast");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::Reopen { .. } => {
                show_and_focus_main_panel(app_handle);
            }
            _ => {}
        }
    });
}
