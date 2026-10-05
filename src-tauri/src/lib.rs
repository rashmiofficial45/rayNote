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
    panel!(RayNotePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
thread_local! {
    static LAST_GRAB: std::cell::Cell<Option<std::time::Instant>> = std::cell::Cell::new(None);
}

/// Main thread, every 100ms. Panel visible + mouse is over the panel + not key => take keyboard focus.
/// This ensures clicking on the rayNote panel gives it keyboard focus, while clicking on
/// other apps (even fullscreen ones) correctly lets those apps keep focus.
#[cfg(target_os = "macos")]
fn hover_focus_tick(app: &tauri::AppHandle) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(ptr) = win.ns_window() else { return };

    unsafe {
        let Some(ns_win) = (ptr as *mut AnyObject).as_ref() else { return };

        let visible: bool = msg_send![ns_win, isVisible];
        let level: isize = msg_send![ns_win, level];

        // "Always on top" is on when the panel sits at a floating level or higher.
        // NOTE: set_always_on_top ends with setFloatingPanel:, which resets the level to 3
        // (NSFloatingWindowLevel), so checking for 1000 here would never pass. Off = level 0.
        if !visible || level < 3 {
            return;
        }

        let is_key: bool = msg_send![ns_win, isKeyWindow];

        // Already has focus — nothing to do
        if is_key {
            return;
        }

        // Don't steal mid-click or mid-drag
        let buttons: usize = msg_send![objc2::class!(NSEvent), pressedMouseButtons];
        if buttons != 0 {
            return;
        }

        // --- Core fix: only grab focus if the mouse cursor is inside the panel's frame ---
        // This means clicking on another app's input field won't be interrupted.
        let mouse_loc: tauri_nspanel::objc2_foundation::NSPoint =
            msg_send![objc2::class!(NSEvent), mouseLocation];
        let frame: tauri_nspanel::objc2_foundation::NSRect = msg_send![ns_win, frame];
        let mouse_inside = mouse_loc.x >= frame.origin.x
            && mouse_loc.x <= frame.origin.x + frame.size.width
            && mouse_loc.y >= frame.origin.y
            && mouse_loc.y <= frame.origin.y + frame.size.height;

        if !mouse_inside {
            return;
        }

        // Cooldown to avoid spamming focus grabs
        let cooling = LAST_GRAB.with(|c| {
            c.get().map_or(false, |t| t.elapsed() < Duration::from_millis(250))
        });
        if cooling {
            return;
        }
        LAST_GRAB.with(|c| c.set(Some(Instant::now())));

        // Grab focus: makeKeyAndOrderFront: honors the non-activating panel tag
        let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
        let mut key_now: bool = msg_send![ns_win, isKeyWindow];
        if !key_now {
            // Last resort: activate the app, then try again
            let shared_app: *mut AnyObject = msg_send![objc2::class!(NSApplication), sharedApplication];
            let _: () = msg_send![shared_app, activateIgnoringOtherApps: true];
            let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
            key_now = msg_send![ns_win, isKeyWindow];
        }

        // Make the web view the first responder so typing reaches the editor
        if key_now {
            let content_view: *mut AnyObject = msg_send![ns_win, contentView];
            if !content_view.is_null() {
                let subviews: *mut AnyObject = msg_send![content_view, subviews];
                let count: usize = msg_send![subviews, count];
                let target: *mut AnyObject = if count > 0 {
                    msg_send![subviews, objectAtIndex: 0usize]
                } else {
                    content_view
                };
                let _: bool = msg_send![ns_win, makeFirstResponder: target];
            }
        }
    }

    let _ = win.emit("app-focused", ());
}

#[cfg(target_os = "macos")]
fn start_hover_focus_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let a = app.clone();
        let _ = app.run_on_main_thread(move || hover_focus_tick(&a));
    });
}

#[cfg(target_os = "macos")]
fn setup_macos_panel(app: &tauri::App) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;

    let window = app.get_webview_window("main").unwrap();
    let panel = window.to_panel::<RayNotePanel>().expect("failed to convert window to panel");

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

            // NSWindowStyleMaskResizable (1 << 3 = 8) & NSWindowStyleMaskNonactivatingPanel (1 << 7 = 128)
            // Crucial: ensures native Cocoa window border resize handles work and WindowServer allows panel in fullscreen spaces
            let current_mask: usize = msg_send![ns_panel, styleMask];
            let resizable_panel_mask: usize = current_mask | (1 << 3) | (1 << 7);
            let _: () = msg_send![ns_panel, setStyleMask: resizable_panel_mask];

            // Sync the WindowServer tag with the nonactivating mask.
            // NSPanel only does this at creation; setStyleMask later does NOT.
            let sel = objc2::sel!(_setPreventsActivation:);
            let responds: bool = msg_send![ns_panel, respondsToSelector: sel];
            if responds {
                let _: () = msg_send![ns_panel, _setPreventsActivation: true];
            }
            eprintln!("[rayNote focus] preventsActivation call available: {}", responds);

            // Crucial for keyboard & click focus: make panel become key on ANY interaction, not only when clicking text
            let _: () = msg_send![ns_panel, setBecomesKeyOnlyIfNeeded: false];

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

    #[cfg(target_os = "macos")]
    unsafe {
        let app_class = objc2::class!(NSApplication);
        let shared_app: *mut AnyObject = msg_send![app_class, sharedApplication];
        let _: () = msg_send![shared_app, activateIgnoringOtherApps: true];

        if let Some(ns_panel) = ns_window_ptr.as_ref() {
            let _: () = msg_send![ns_panel, orderFrontRegardless];
            let _: () = msg_send![ns_panel, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
            let content_view: *mut AnyObject = msg_send![ns_panel, contentView];
            if !content_view.is_null() {
                let subviews: *mut AnyObject = msg_send![content_view, subviews];
                let count: usize = msg_send![subviews, count];
                if count > 0 {
                    let first_sub: *mut AnyObject = msg_send![subviews, objectAtIndex: 0usize];
                    let _: () = msg_send![ns_panel, makeFirstResponder: first_sub];
                } else {
                    let _: () = msg_send![ns_panel, makeFirstResponder: content_view];
                }
            }
        }
    }

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

        let app_class = objc2::class!(NSApplication);
        let shared_app: *mut AnyObject = unsafe { msg_send![app_class, sharedApplication] };
        let _: () = unsafe { msg_send![shared_app, activateIgnoringOtherApps: true] };

        if let Ok(panel) = manager.get_webview_panel("main") {
            panel.show_and_make_key();
        }

        if let Some(win) = manager.get_webview_window("main") {
            if let Ok(ptr) = win.ns_window() {
                unsafe {
                    if let Some(ns_panel) = (ptr as *mut AnyObject).as_ref() {
                        let behavior: usize = (1 << 0) | (1 << 6) | (1 << 8);
                        let _: () = msg_send![ns_panel, setCollectionBehavior: behavior];
                        let level: isize = 1000;
                        let _: () = msg_send![ns_panel, setLevel: level];
                        let _: () = msg_send![ns_panel, orderFrontRegardless];
                        let _: () = msg_send![ns_panel, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
                        let content_view: *mut AnyObject = msg_send![ns_panel, contentView];
                        if !content_view.is_null() {
                            let subviews: *mut AnyObject = msg_send![content_view, subviews];
                            let count: usize = msg_send![subviews, count];
                            if count > 0 {
                                let first_sub: *mut AnyObject = msg_send![subviews, objectAtIndex: 0usize];
                                let _: () = msg_send![ns_panel, makeFirstResponder: first_sub];
                            } else {
                                let _: () = msg_send![ns_panel, makeFirstResponder: content_view];
                            }
                        }
                    }
                }
            }
            let _ = win.set_focus();
            use tauri::Emitter;
            let _ = win.emit("app-focused", ());
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = manager.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            use tauri::Emitter;
            let _ = window.emit("app-focused", ());
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
                start_hover_focus_watcher(app.handle().clone());
            }

            // Initialize Menu Bar status item if preference is enabled (default true)
            let mut show_menu_bar = true;
            if let Ok(app_dir) = app.path().app_data_dir() {
                let pref_file = app_dir.join("menubar_preference.json");
                if let Ok(content) = std::fs::read_to_string(&pref_file) {
                    if content.trim() == "false" {
                        show_menu_bar = false;
                    }
                }
            }
            if show_menu_bar {
                let _ = set_menu_bar_visible(app.handle().clone(), true);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_notes,
            search_notes,
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
            set_always_on_top,
            set_menu_bar_visible,
            export_notes_to_folder,
            export_all_notes_from_db,
        ])
        .build(tauri::generate_context!())
        .expect("error while building rayNote");

    app.run(|app_handle, event| {
        match event {
            tauri::RunEvent::Reopen { .. } => {
                show_and_focus_main_panel(app_handle);
            }
            _ => {}
        }
    });
}