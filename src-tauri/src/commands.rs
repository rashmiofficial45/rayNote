use crate::database::{Database, Note};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[tauri::command]
pub fn get_all_notes(db: State<'_, Database>) -> Result<Vec<Note>, String> {
    db.get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note(db: State<'_, Database>, id: String) -> Result<Option<Note>, String> {
    db.get_note(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_note(db: State<'_, Database>) -> Result<Note, String> {
    let now = Utc::now().to_rfc3339();
    let note = Note {
        id: Uuid::new_v4().to_string(),
        title: String::new(),
        content: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[]}]}".to_string(),
        created_at: now.clone(),
        updated_at: now,
        is_pinned: false,
    };
    db.create_note(&note).map_err(|e| e.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn update_note(
    db: State<'_, Database>,
    id: String,
    title: String,
    content: String,
) -> Result<(), String> {
    db.update_note(&id, &title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_note(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_pin(db: State<'_, Database>, id: String) -> Result<bool, String> {
    db.toggle_pin(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_native_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use tauri_nspanel::objc2_foundation::{NSPoint, NSRect};

        let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        unsafe {
            if let Some(ns_win) = ns_window_ptr.as_ref() {
                let screen_loc: NSPoint = msg_send![objc2::class!(NSEvent), mouseLocation];
                let window_loc: NSPoint = msg_send![ns_win, convertPointFromScreen: screen_loc];
                #[cfg(debug_assertions)]
                {
                    let frame: NSRect = msg_send![ns_win, frame];
                    let scale: f64 = msg_send![ns_win, backingScaleFactor];
                    eprintln!(
                        "=== DRAG DIAGNOSTICS: Screen=({:.1}, {:.1}), WindowLoc=({:.1}, {:.1}), Frame=({:.1}, {:.1}, {:.1}x{:.1}), Scale={:.1} ===",
                        screen_loc.x, screen_loc.y, window_loc.x, window_loc.y, frame.origin.x, frame.origin.y, frame.size.width, frame.size.height, scale
                    );
                }

                let app_class = objc2::class!(NSApplication);
                let shared_app: *mut AnyObject = msg_send![app_class, sharedApplication];
                let current_event: *mut AnyObject = msg_send![shared_app, currentEvent];

                let window_number: isize = msg_send![ns_win, windowNumber];
                let timestamp: f64 = if let Some(ev) = current_event.as_ref() {
                    msg_send![ev, timestamp]
                } else {
                    0.0
                };
                let modifier_flags: usize = if let Some(ev) = current_event.as_ref() {
                    msg_send![ev, modifierFlags]
                } else {
                    0
                };

                let event_class = objc2::class!(NSEvent);
                let drag_event: *mut AnyObject = msg_send![
                    event_class,
                    mouseEventWithType: 1usize, // LeftMouseDown
                    location: window_loc,       // Correct window-relative point!
                    modifierFlags: modifier_flags,
                    timestamp: timestamp,
                    windowNumber: window_number,
                    context: std::ptr::null_mut::<AnyObject>(),
                    eventNumber: 0isize,
                    clickCount: 1isize,
                    pressure: 1.0f32
                ];

                let _: () = msg_send![ns_win, performWindowDragWithEvent: drag_event];

                let after_frame: NSRect = msg_send![ns_win, frame];
                #[cfg(debug_assertions)]
                eprintln!(
                    "=== AFTER DRAG: Frame=({:.1}, {:.1}, {:.1}x{:.1}) ===",
                    after_frame.origin.x, after_frame.origin.y, after_frame.size.width, after_frame.size.height
                );

                use tauri::Manager;
                if window.label() == "main" {
                    if let Ok(app_dir) = window.app_handle().path().app_data_dir() {
                        let state_file = app_dir.join("window_state.json");
                        let json = serde_json::json!({
                            "x": after_frame.origin.x,
                            "y": after_frame.origin.y,
                            "width": after_frame.size.width,
                            "height": after_frame.size.height
                        });
                        let _ = std::fs::write(state_file, json.to_string());
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.start_dragging();
    }
    Ok(())
}

#[tauri::command]
pub fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::WebviewWindowExt;
        // Get the panel and hide it — app stays alive as Accessory process
        if let Ok(panel) = window.to_panel::<crate::RayNotePanel>() {
            panel.hide();
        } else {
            // Fallback: just hide the window
            window.hide().map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn save_window_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    use tauri::Manager;
    if width >= 320.0 && height >= 400.0 {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

        #[cfg(target_os = "macos")]
        {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;
            use tauri_nspanel::objc2_foundation::NSRect;

            if let Some(win) = app.get_webview_window("main") {
                if let Ok(ptr) = win.ns_window() {
                    unsafe {
                        if let Some(ns_win) = (ptr as *mut AnyObject).as_ref() {
                            let frame: NSRect = msg_send![ns_win, frame];
                            let state_file = app_dir.join("window_state.json");
                            let json = serde_json::json!({
                                "x": frame.origin.x,
                                "y": frame.origin.y,
                                "width": frame.size.width,
                                "height": frame.size.height
                            });
                            let _ = std::fs::write(state_file, json.to_string());
                        }
                    }
                }
            }
        }

        let size_file = app_dir.join("window_size.json");
        let json = serde_json::json!({
            "width": width,
            "height": height
        });
        std::fs::write(size_file, json.to_string()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_drag_diagnostics(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use tauri_nspanel::objc2_foundation::{NSPoint, NSRect};

        let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        let (screen_loc, window_loc, frame, scale) = unsafe {
            let ns_win = ns_window_ptr.as_ref().ok_or("null window")?;
            let screen_loc: NSPoint = msg_send![objc2::class!(NSEvent), mouseLocation];
            let window_loc: NSPoint = msg_send![ns_win, convertPointFromScreen: screen_loc];
            let frame: NSRect = msg_send![ns_win, frame];
            let scale: f64 = msg_send![ns_win, backingScaleFactor];
            (screen_loc, window_loc, frame, scale)
        };

        let outer_pos = window.outer_position().map_err(|e| e.to_string())?;
        let logical_pos = outer_pos.to_logical::<f64>(scale);

        Ok(serde_json::json!({
            "backing_scale_factor": scale,
            "native_frame": {
                "x": frame.origin.x,
                "y": frame.origin.y,
                "width": frame.size.width,
                "height": frame.size.height,
            },
            "screen_mouse_location": {
                "x": screen_loc.x,
                "y": screen_loc.y,
            },
            "window_relative_location": {
                "x": window_loc.x,
                "y": window_loc.y,
            },
            "tauri_physical_position": {
                "x": outer_pos.x,
                "y": outer_pos.y,
            },
            "tauri_logical_position": {
                "x": logical_pos.x,
                "y": logical_pos.y,
            }
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();

        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::msg_send;
            use objc2::runtime::AnyObject;
            let app_class = objc2::class!(NSApplication);
            let shared_app: *mut AnyObject = msg_send![app_class, sharedApplication];
            let _: () = msg_send![shared_app, activateIgnoringOtherApps: true];
            if let Ok(ptr) = win.ns_window() {
                if let Some(ns_win) = (ptr as *mut AnyObject).as_ref() {
                    let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
                }
            }
        }
        return Ok(());
    }

    let settings_window = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("rayNote Settings")
    .inner_size(580.0, 720.0)
    .min_inner_size(500.0, 520.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .accept_first_mouse(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = settings_window.show();
    let _ = settings_window.set_focus();

    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        let app_class = objc2::class!(NSApplication);
        let shared_app: *mut AnyObject = msg_send![app_class, sharedApplication];
        let _: () = msg_send![shared_app, activateIgnoringOtherApps: true];
        if let Ok(ptr) = settings_window.ns_window() {
            if let Some(ns_win) = (ptr as *mut AnyObject).as_ref() {
                let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_always_on_top(app: tauri::AppHandle, always_on_top: bool) -> Result<(), String> {
    use tauri::Manager;
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        let level_i64: i64 = if always_on_top { 1000 } else { 0 };
        let level_isize: isize = if always_on_top { 1000 } else { 0 };

        // 1. Update tauri_nspanel WebviewPanel level & floating property
        if let Ok(panel) = app.get_webview_panel("main") {
            panel.set_level(level_i64);
            panel.set_floating_panel(always_on_top);
        }

        // 2. Update NSWindow / NSPanel pointer and window manager flags
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_always_on_top(always_on_top);
            if let Ok(ptr) = win.ns_window() {
                unsafe {
                    if let Some(ns_win) = (ptr as *mut AnyObject).as_ref() {
                        let _: () = msg_send![ns_win, setLevel: level_isize];
                        let _: () = msg_send![ns_win, setFloatingPanel: always_on_top];
                        if !always_on_top {
                            let _: () = msg_send![ns_win, orderBack: std::ptr::null_mut::<AnyObject>()];
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_always_on_top(always_on_top);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn close_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.destroy();
    }
    Ok(())
}

#[tauri::command]
pub fn open_app_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&app_dir);
    let path_str = app_dir.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct ExportNoteItem {
    pub title: String,
    pub content: String,
}

#[tauri::command]
pub fn export_notes_to_folder(
    app: tauri::AppHandle,
    notes: Vec<ExportNoteItem>,
) -> Result<String, String> {
    use tauri::Manager;
    let download_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;

    let export_dir = download_dir.join("rayNote_Exports");
    std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    for (idx, note) in notes.into_iter().enumerate() {
        let raw_title = if note.title.trim().is_empty() {
            format!("Untitled_{}", idx + 1)
        } else {
            note.title.trim().to_string()
        };
        let safe_name: String = raw_title
            .chars()
            .map(|c| match c {
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
                _ => c,
            })
            .collect();
        let file_path = export_dir.join(format!("{}.md", safe_name));
        std::fs::write(&file_path, note.content).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let path_str = export_dir.to_string_lossy().to_string();
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
    }

    Ok(export_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_menu_bar_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_visible(visible);
        return Ok(());
    }

    if visible {
        let mut builder = TrayIconBuilder::with_id("main-tray").tooltip("rayNote");
        if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder.icon(icon);
        }
        let _ = builder
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let app = tray.app_handle();
                    #[cfg(target_os = "macos")]
                    {
                        use tauri_nspanel::ManagerExt;
                        if let Ok(panel) = app.get_webview_panel("main") {
                            if panel.is_visible() {
                                panel.hide();
                            } else {
                                crate::show_and_focus_main_panel(app);
                            }
                        }
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        crate::show_and_focus_main_panel(app);
                    }
                }
            })
            .build(&app)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_storage_stats(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let notes = db.get_all_notes().map_err(|e| e.to_string())?;
    let count = notes.len();
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = if app_dir.join("raynote.db").exists() {
        app_dir.join("raynote.db")
    } else {
        app_dir.join("notefast.db")
    };
    let size_bytes = if let Ok(meta) = std::fs::metadata(&db_path) {
        meta.len()
    } else {
        0
    };
    Ok(serde_json::json!({
        "notes_count": count,
        "db_path": db_path.to_string_lossy(),
        "size_bytes": size_bytes,
    }))
}

