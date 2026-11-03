use crate::database::{Database, Note, NoteSummary};
use crate::search::SearchResult;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

static FLUSH_CONDVAR: std::sync::Condvar = std::sync::Condvar::new();
static FLUSH_DONE: std::sync::Mutex<Option<bool>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn flush_done(ok: Option<bool>) {
    let mut done = FLUSH_DONE.lock().unwrap_or_else(|e| e.into_inner());
    *done = Some(ok.unwrap_or(true));
    FLUSH_CONDVAR.notify_all();
}

pub fn begin_exit_flush() {
    *FLUSH_DONE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

pub fn wait_for_flush_done(timeout: std::time::Duration) -> bool {
    let done = FLUSH_DONE.lock().unwrap_or_else(|e| e.into_inner());
    let (done, _) = FLUSH_CONDVAR.wait_timeout_while(done, timeout, |done| done.is_none()).unwrap_or_else(|e| e.into_inner());
    *done == Some(true)
}

pub struct ToggleShortcuts(pub std::sync::Mutex<Vec<String>>);
pub struct AlwaysOnTopState(pub std::sync::atomic::AtomicBool);

#[tauri::command]
pub fn set_toggle_shortcut(app: tauri::AppHandle, shortcut: Option<String>) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let mut desired = shortcut.into_iter().collect::<Vec<_>>();
    // Keep the legacy alternate only with the unchanged default shortcut.
    if desired.first().is_some_and(|s| s == "Shift+CommandOrControl+Space") {
        desired.push("CommandOrControl+Shift+N".into());
    }
    for value in &desired { value.parse::<Shortcut>().map_err(|e| e.to_string())?; }
    let state = app.state::<ToggleShortcuts>();
    let mut current = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if *current == desired { return Ok(()); }
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    for value in &desired {
        if let Err(error) = app.global_shortcut().register(value.as_str()) {
            let _ = app.global_shortcut().unregister_all();
            for old in current.iter() { let _ = app.global_shortcut().register(old.as_str()); }
            return Err(error.to_string());
        }
    }
    *current = desired;
    Ok(())
}

static PENDING_NOTE_LINK: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn note_id_from_url(value: &str) -> Option<String> {
    let url = tauri::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "notefast" | "raynote") || url.host_str() != Some("note") { return None; }
    let id = url.path().strip_prefix('/')?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return None; }
    Some(id.to_string())
}

pub fn route_note_link(app: &tauri::AppHandle, value: &str) {
    use tauri::Emitter;
    if let Some(id) = note_id_from_url(value) {
        *PENDING_NOTE_LINK.lock().unwrap_or_else(|e| e.into_inner()) = Some(id);
        let _ = app.emit("open-note", ());
    }
}

#[tauri::command]
pub fn take_pending_note_link() -> Option<String> {
    PENDING_NOTE_LINK.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[tauri::command]
pub async fn get_all_notes(
    db: State<'_, Arc<Database>>,
    limit: Option<usize>,
) -> Result<Vec<NoteSummary>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        match limit {
            Some(lim) => db.get_recent_summaries(lim).map_err(|e| e.to_string()),
            None => {
                let all = db.get_all_notes_arc().map_err(|e| e.to_string())?;
                Ok((*all).clone())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn search_documents(
    db: State<'_, Arc<Database>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let db = db.inner().clone();
    let limit = limit.unwrap_or(30);
    tauri::async_runtime::spawn_blocking(move || {
        db.search_documents(&query, limit).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_recent_notes(
    db: State<'_, Arc<Database>>,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let db = db.inner().clone();
    let limit = limit.unwrap_or(30);
    tauri::async_runtime::spawn_blocking(move || {
        db.get_recent_notes(limit).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_adjacent_note(
    db: State<'_, Arc<Database>>,
    id: String,
    direction: String,
) -> Result<Option<String>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.get_adjacent_note(&id, &direction).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_note(db: State<'_, Arc<Database>>, id: String) -> Result<Option<Note>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.get_note(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_note(db: State<'_, Arc<Database>>) -> Result<Note, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = Utc::now().to_rfc3339();
        let note = Note {
            id: Uuid::new_v4().to_string(),
            title: String::new(),
            content: "{\"type\":\"doc\",\"content\":[{\"type\":\"heading\",\"attrs\":{\"level\":1},\"content\":[]}]}".to_string(),
            preview: String::new(),
            created_at: now.clone(),
            updated_at: now,
            is_pinned: false,
        };
        db.create_note(&note).map_err(|e| e.to_string())?;
        Ok(note)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn map_update_note_error(e: rusqlite::Error) -> String {
    if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
        "NOTE_NOT_FOUND".to_string()
    } else {
        e.to_string()
    }
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Arc<Database>>,
    id: String,
    title: String,
    content: String,
) -> Result<String, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.update_note(&id, &title, &content)
            .map_err(map_update_note_error)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_note(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.delete_note(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_pin(db: State<'_, Arc<Database>>, id: String) -> Result<bool, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        db.toggle_pin(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
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

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug)]
pub struct NativeWindowFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn get_native_window_frame(window: tauri::WebviewWindow) -> Result<NativeWindowFrame, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use tauri_nspanel::objc2_foundation::NSRect;

        let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        unsafe {
            if let Some(ns_win) = ns_window_ptr.as_ref() {
                let frame: NSRect = msg_send![ns_win, frame];
                return Ok(NativeWindowFrame {
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height,
                });
            }
        }
        Err("Failed to get NSWindow frame".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        Ok(NativeWindowFrame {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        })
    }
}

#[tauri::command]
pub fn set_native_window_frame(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    save: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        use tauri_nspanel::objc2_foundation::{NSPoint, NSSize, NSRect};

        let ns_window_ptr = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
        unsafe {
            if let Some(ns_win) = ns_window_ptr.as_ref() {
                let frame = NSRect {
                    origin: NSPoint { x, y },
                    size: NSSize { width, height },
                };
                let _: () = msg_send![ns_win, setFrame: frame, display: true];

                if save && window.label() == "main" {
                    use tauri::Manager;
                    if let Ok(app_dir) = window.app_handle().path().app_data_dir() {
                        let state_file = app_dir.join("window_state.json");
                        let size_file = app_dir.join("window_size.json");
                        let json = serde_json::json!({
                            "x": frame.origin.x,
                            "y": frame.origin.y,
                            "width": frame.size.width,
                            "height": frame.size.height
                        });
                        let _ = std::fs::write(state_file, json.to_string());
                        let size_json = serde_json::json!({
                            "width": frame.size.width,
                            "height": frame.size.height
                        });
                        let _ = std::fs::write(size_file, size_json.to_string());
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{Position, Size, PhysicalPosition, PhysicalSize};
        let _ = window.set_position(Position::Physical(PhysicalPosition { x: x as i32, y: y as i32 }));
        let _ = window.set_size(Size::Physical(PhysicalSize { width: width as u32, height: height as u32 }));
    }
    Ok(())
}


#[tauri::command]
pub fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Emitter;
    let _ = window.emit("panel-will-hide", ());

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
    if let Some(state) = app.try_state::<AlwaysOnTopState>() {
        state.0.store(always_on_top, std::sync::atomic::Ordering::SeqCst);
    }
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
            if let Ok(ptr) = win.ns_window() {
                unsafe {
                    if let Some(ns_win) = (ptr as *mut AnyObject).as_ref() {
                        let behavior: usize = (1 << 0) | (1 << 6) | (1 << 8);
                        let _: () = msg_send![ns_win, setCollectionBehavior: behavior];
                        let _: () = msg_send![ns_win, setLevel: level_isize];
                        let _: () = msg_send![ns_win, setFloatingPanel: always_on_top];
                        if !always_on_top {
                            let _: () = msg_send![ns_win, orderBack: std::ptr::null_mut::<AnyObject>()];
                        } else {
                            let _: () = msg_send![ns_win, orderFrontRegardless];
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

fn write_export_note(export_dir: &std::path::Path, title: &str, content: &str, index: usize) -> std::io::Result<std::path::PathBuf> {
    let raw_title = if title.trim().is_empty() {
        format!("Untitled_{}", index + 1)
    } else {
        title.trim().to_string()
    };
    // Leave room for a collision suffix and extension within common 255-byte limits.
    let mut safe_name = String::new();
    for c in raw_title.chars() {
        let c = match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            _ => c,
        };
        if safe_name.len() + c.len_utf8() > 200 {
            break;
        }
        safe_name.push(c);
    }
    use std::io::Write;
    for suffix in 0.. {
        let filename = if suffix == 0 {
            format!("{}.md", safe_name)
        } else {
            format!("{} ({}).md", safe_name, suffix)
        };
        let file_path = export_dir.join(filename);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&file_path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(content.as_bytes()) {
                    drop(file);
                    let _ = std::fs::remove_file(&file_path);
                    return Err(error);
                }
                return Ok(file_path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    unreachable!()

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
        write_export_note(&export_dir, &note.title, &note.content, idx).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let path_str = export_dir.to_string_lossy().to_string();
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
    }

    Ok(export_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn export_all_notes_from_db(
    app: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<String, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let download_dir = app
            .path()
            .download_dir()
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| e.to_string())?;

        let export_dir = download_dir.join("rayNote_Exports");
        std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

        let all_notes = db.get_all_notes_with_content().map_err(|e| e.to_string())?;
        for (idx, note) in all_notes.into_iter().enumerate() {
            let md = note_content_to_markdown_clean(&note.content, &note.title);
            write_export_note(&export_dir, &note.title, &md, idx).map_err(|e| e.to_string())?;
        }

        #[cfg(target_os = "macos")]
        {
            let path_str = export_dir.to_string_lossy().to_string();
            let _ = std::process::Command::new("open").arg(&path_str).spawn();
        }

        Ok(export_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn collect_text_only(node: &serde_json::Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        out.push_str(text);
    }
    if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
        for child in content {
            collect_text_only(child, out);
        }
    }
}

fn note_content_to_markdown_clean(content: &str, title: &str) -> String {
    let trimmed = content.trim();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let mut out = String::new();

            // Check if document already begins with a heading that matches the title
            let mut skip_title = title.trim().is_empty();
            if let Some(content_arr) = value.get("content").and_then(|c| c.as_array()) {
                if let Some(first) = content_arr.first() {
                    if first.get("type").and_then(|t| t.as_str()) == Some("heading") {
                        let mut first_heading_text = String::new();
                        collect_text_only(first, &mut first_heading_text);
                        if first_heading_text.trim().eq_ignore_ascii_case(title.trim()) {
                            skip_title = true;
                        }
                    }
                }
            }

            if !skip_title {
                out.push_str(&format!("# {}\n\n", title.trim()));
            }

            json_doc_to_markdown_recursive(&value, &mut out, "");
            let res = out.trim();
            if !res.is_empty() {
                return res.to_string();
            }
        }
    }

    if trimmed.starts_with("---") || trimmed.starts_with('#') {
        trimmed.to_string()
    } else if !title.trim().is_empty() {
        format!("# {}\n\n{}", title.trim(), trimmed)
    } else {
        trimmed.to_string()
    }
}

fn escape_markdown_text(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"), '<' => out.push_str("&lt;"), '>' => out.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '~' | ':' | '#' | '[' | ']' => { out.push('\\'); out.push(c); },
            _ => out.push(c),
        }
    }
    out
}

fn wrap_markdown_mark(text: &str, delimiter: &str) -> String {
    let core = text.trim();
    if core.is_empty() { return text.to_string(); }
    let leading = text.len() - text.trim_start().len();
    let trailing = text.trim_end().len();
    format!("{}{}{}{}{}", &text[..leading], delimiter, core, delimiter, &text[trailing..])
}

fn serialize_inline_json(node: &serde_json::Value) -> String {
    if node.get("type").and_then(|t| t.as_str()) == Some("hardBreak") { return "  \n".into(); }
    let raw = node.get("text").and_then(|t| t.as_str()).unwrap_or("");
    let marks = node.get("marks").and_then(|m| m.as_array());
    let code = marks.is_some_and(|m| m.iter().any(|mark| mark["type"] == "code"));
    let mut text = if code {
        let length = raw.split(|c| c != '`').map(str::len).max().unwrap_or(0) + 1;
        let fence = "`".repeat(length);
        let pad = if raw.starts_with('`') || raw.ends_with('`') || (raw.starts_with(' ') && raw.ends_with(' ') && !raw.trim().is_empty()) { " " } else { "" };
        format!("{fence}{pad}{raw}{pad}{fence}")
    } else { escape_markdown_text(raw) };
    if let Some(marks) = marks {
        for mark in marks {
            match mark.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                "bold" => text = wrap_markdown_mark(&text, "**"),
                "italic" => text = wrap_markdown_mark(&text, "*"),
                "strike" => text = wrap_markdown_mark(&text, "~~"),
                "underline" => text = format!("<u>{text}</u>"),
                "highlight" => text = format!("<mark>{text}</mark>"),
                "link" => {
                    let href = mark["attrs"]["href"].as_str().unwrap_or("");
                    let href = href.replace(' ', "%20").replace('(', "%28").replace(')', "%29").replace('<', "%3C").replace('>', "%3E").replace('\\', "%5C");
                    text = format!("[{text}]({href})");
                },
                _ => {},
            }
        }
    }
    text
}

fn escape_html_attribute(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn json_doc_to_markdown_recursive(node: &serde_json::Value, out: &mut String, indent: &str) {
    if let Some(node_type) = node.get("type").and_then(|t| t.as_str()) {
        match node_type {
            "doc" => {
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for child in content {
                        json_doc_to_markdown_recursive(child, out, indent);
                    }
                }
            }
            "paragraph" => {
                let mut p_text = String::new();
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for child in content {
                        if child.get("type").and_then(|t| t.as_str()) == Some("text") {
                            p_text.push_str(&serialize_inline_json(child));
                        } else {
                            json_doc_to_markdown_recursive(child, &mut p_text, indent);
                        }
                    }
                }
                out.push_str(indent);
                out.push_str(&p_text);
                out.push_str("\n\n");
            }
            "heading" => {
                let level = node.get("attrs").and_then(|a| a.get("level")).and_then(|l| l.as_u64()).unwrap_or(1);
                let hashes = "#".repeat(level.clamp(1, 6) as usize);
                let mut h_text = String::new();
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for child in content {
                        if child.get("type").and_then(|t| t.as_str()) == Some("text") {
                            h_text.push_str(&serialize_inline_json(child));
                        } else {
                            json_doc_to_markdown_recursive(child, &mut h_text, indent);
                        }
                    }
                }
                out.push_str(&format!("{}{} {}\n\n", indent, hashes, h_text.trim()));
            }
            "bulletList" => {
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for item in content {
                        let mut item_lines = Vec::new();
                        if let Some(item_children) = item.get("content").and_then(|c| c.as_array()) {
                            for (idx, child) in item_children.iter().enumerate() {
                                if child.get("type").and_then(|t| t.as_str()) == Some("paragraph") {
                                    let mut line_text = String::new();
                                    if let Some(inline) = child.get("content").and_then(|c| c.as_array()) {
                                        for in_node in inline {
                                            line_text.push_str(&serialize_inline_json(in_node));
                                        }
                                    }
                                    if idx == 0 {
                                        item_lines.push(format!("{}- {}", indent, line_text));
                                    } else {
                                        item_lines.push(format!("{}  {}", indent, line_text));
                                    }
                                } else {
                                    let mut sub_out = String::new();
                                    let next_indent = format!("{}  ", indent);
                                    json_doc_to_markdown_recursive(child, &mut sub_out, &next_indent);
                                    item_lines.push(sub_out.trim_end().to_string());
                                }
                            }
                        }
                        out.push_str(&item_lines.join("\n"));
                        out.push('\n');
                    }
                }
                out.push('\n');
            }
            "orderedList" => {
                let start = node.get("attrs").and_then(|a| a.get("start")).and_then(|s| s.as_u64()).unwrap_or(1);
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for (i, item) in content.iter().enumerate() {
                        let num = start + (i as u64);
                        let prefix = format!("{}. ", num);
                        let indent_prefix = " ".repeat(prefix.len());
                        let mut item_lines = Vec::new();
                        if let Some(item_children) = item.get("content").and_then(|c| c.as_array()) {
                            for (idx, child) in item_children.iter().enumerate() {
                                if child.get("type").and_then(|t| t.as_str()) == Some("paragraph") {
                                    let mut line_text = String::new();
                                    if let Some(inline) = child.get("content").and_then(|c| c.as_array()) {
                                        for in_node in inline {
                                            line_text.push_str(&serialize_inline_json(in_node));
                                        }
                                    }
                                    if idx == 0 {
                                        item_lines.push(format!("{}{}{}", indent, prefix, line_text));
                                    } else {
                                        item_lines.push(format!("{}{}{}", indent, indent_prefix, line_text));
                                    }
                                } else {
                                    let mut sub_out = String::new();
                                    let next_indent = format!("{}{}", indent, indent_prefix);
                                    json_doc_to_markdown_recursive(child, &mut sub_out, &next_indent);
                                    item_lines.push(sub_out.trim_end().to_string());
                                }
                            }
                        }
                        out.push_str(&item_lines.join("\n"));
                        out.push('\n');
                    }
                }
                out.push('\n');
            }
            "taskList" => {
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for item in content {
                        let checked = item.get("attrs").and_then(|a| a.get("checked")).and_then(|b| b.as_bool()).unwrap_or(false);
                        let box_str = if checked { "[x]" } else { "[ ]" };
                        let mut item_lines = Vec::new();
                        if let Some(item_children) = item.get("content").and_then(|c| c.as_array()) {
                            for (idx, child) in item_children.iter().enumerate() {
                                if child.get("type").and_then(|t| t.as_str()) == Some("paragraph") {
                                    let mut line_text = String::new();
                                    if let Some(inline) = child.get("content").and_then(|c| c.as_array()) {
                                        for in_node in inline {
                                            line_text.push_str(&serialize_inline_json(in_node));
                                        }
                                    }
                                    if idx == 0 {
                                        item_lines.push(format!("{}- {} {}", indent, box_str, line_text));
                                    } else {
                                        item_lines.push(format!("{}  {}", indent, line_text));
                                    }
                                } else {
                                    let mut sub_out = String::new();
                                    let next_indent = format!("{}  ", indent);
                                    json_doc_to_markdown_recursive(child, &mut sub_out, &next_indent);
                                    item_lines.push(sub_out.trim_end().to_string());
                                }
                            }
                        }
                        out.push_str(&item_lines.join("\n"));
                        out.push('\n');
                    }
                }
                out.push('\n');
            }
            "codeBlock" => {
                let lang = node.get("attrs").and_then(|a| a.get("language")).and_then(|l| l.as_str()).unwrap_or("");
                let mut code = String::new();
                collect_text_only(node, &mut code);
                let longest_run = code.split(|c| c != '`').map(str::len).max().unwrap_or(0);
                let fence = "`".repeat(longest_run.max(2) + 1);
                out.push_str(&format!("{}{}{}\n{}\n{}{}\n\n", indent, fence, lang, code, indent, fence));
            }
            "blockquote" => {
                let mut bq_text = String::new();
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for child in content {
                        json_doc_to_markdown_recursive(child, &mut bq_text, "");
                    }
                }
                for line in bq_text.trim().lines() {
                    out.push_str(&format!("{}> {}\n", indent, line));
                }
                out.push('\n');
            }
            "iframe" | "youtube" => {
                if let Some(attrs) = node.get("attrs") {
                    if let Some(src) = attrs.get("src").and_then(|value| value.as_str()) {
                        if let Ok(url) = tauri::Url::parse(src) {
                            if matches!(url.scheme(), "http" | "https") {
                                if node_type == "youtube" {
                                    out.push_str(&format!("{}<{}>\n\n", indent, url.as_str().replace('<', "%3C").replace('>', "%3E")));
                                    return;
                                }
                                let width = attrs.get("width").map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())).unwrap_or_else(|| "100%".into());
                                let height = attrs.get("height").map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())).unwrap_or_else(|| "315".into());
                                out.push_str(&format!("{}<iframe src=\"{}\" width=\"{}\" height=\"{}\" sandbox=\"allow-scripts allow-presentation\" allowfullscreen></iframe>\n\n",
                                    indent, escape_html_attribute(src), escape_html_attribute(&width), escape_html_attribute(&height)));
                            }
                        }
                    }
                }
            }
            "tableRow" | "tableCell" | "tableHeader" => {
                if let Some(content) = node.get("content").and_then(|content| content.as_array()) {
                    for child in content {
                        json_doc_to_markdown_recursive(child, out, indent);
                    }
                }
            }
            "hardBreak" => out.push_str("  \n"),
            "horizontalRule" => {
                out.push_str(&format!("{}---\n\n", indent));
            }
            "table" => {
                if let Some(rows) = node.get("content").and_then(|c| c.as_array()) {
                    for (r_idx, row) in rows.iter().enumerate() {
                        let mut cells = Vec::new();
                        if let Some(cell_nodes) = row.get("content").and_then(|c| c.as_array()) {
                            for cell in cell_nodes {
                                let mut cell_text = String::new();
                                json_doc_to_markdown_recursive(cell, &mut cell_text, "");
                                cells.push(cell_text.trim().replace('|', "\\|").replace('\n', "<br>"));
                            }
                        }
                        out.push_str(&format!("{}| {} |\n", indent, cells.join(" | ")));
                        if r_idx == 0 {
                            let sep: Vec<String> = cells.iter().map(|_| "---".to_string()).collect();
                            out.push_str(&format!("{}| {} |\n", indent, sep.join(" | ")));
                        }
                    }
                    out.push('\n');
                }
            }
            "text" => {
                out.push_str(&serialize_inline_json(node));
            }
            _ => {
                if let Some(content) = node.get("content").and_then(|c| c.as_array()) {
                    for child in content {
                        json_doc_to_markdown_recursive(child, out, indent);
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn set_menu_bar_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    use tauri::tray::TrayIconBuilder;
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::Manager;

    // Persist preference to app_data_dir/menubar_preference.json
    if let Ok(app_dir) = app.path().app_data_dir() {
        let pref_file = app_dir.join("menubar_preference.json");
        let _ = std::fs::write(pref_file, if visible { "true" } else { "false" });
    }

    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_visible(visible);
        return Ok(());
    }

    if visible {
        let toggle_i = MenuItemBuilder::with_id("toggle", "Toggle Notes")
            .accelerator("CmdOrCtrl+Shift+Space")
            .build(&app)
            .map_err(|e| e.to_string())?;
        let new_i = MenuItemBuilder::with_id("new", "New Note")
            .accelerator("CmdOrCtrl+Shift+N")
            .build(&app)
            .map_err(|e| e.to_string())?;
        let settings_i = MenuItemBuilder::with_id("settings", "Settings...")
            .accelerator("CmdOrCtrl+,")
            .build(&app)
            .map_err(|e| e.to_string())?;
        let quit_i = MenuItemBuilder::with_id("quit", "Quit rayNote")
            .accelerator("CmdOrCtrl+Q")
            .build(&app)
            .map_err(|e| e.to_string())?;

        let menu = MenuBuilder::new(&app)
            .item(&toggle_i)
            .item(&new_i)
            .separator()
            .item(&settings_i)
            .separator()
            .item(&quit_i)
            .build()
            .map_err(|e| e.to_string())?;

        let mut builder = TrayIconBuilder::with_id("main-tray")
            .tooltip("rayNote")
            .icon_as_template(true)
            .menu(&menu)
            .show_menu_on_left_click(true);

        if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png")) {
            builder = builder.icon(icon);
        } else if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder.icon(icon);
        }

        let _ = builder
            .on_menu_event(|app, event| {
                let app_handle = app.clone();
                let event_id = event.id().as_ref().to_string();
                let _ = app.run_on_main_thread(move || {
                    match event_id.as_str() {
                        "toggle" => {
                            #[cfg(target_os = "macos")]
                            {
                                use tauri_nspanel::ManagerExt;
                                if let Ok(panel) = app_handle.get_webview_panel("main") {
                                    if panel.is_visible() {
                                        use tauri::Emitter;
                                        let _ = app_handle.emit("panel-will-hide", ());
                                        panel.hide();
                                    } else {
                                        crate::show_and_focus_main_panel(&app_handle);
                                    }
                                }
                            }
                            #[cfg(not(target_os = "macos"))]
                            {
                                crate::show_and_focus_main_panel(&app_handle);
                            }
                        }
                        "new" => {
                            crate::show_and_focus_main_panel(&app_handle);
                            use tauri::Emitter;
                            if let Some(win) = app_handle.get_webview_window("main") {
                                let _ = win.emit("new-note", ());
                            }
                        }
                        "settings" => {
                            let _ = crate::commands::open_settings_window(app_handle.clone());
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                });
            })
            .build(&app)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_storage_stats(
    app: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let count = db.get_note_count().map_err(|e| e.to_string())?;
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let db_path = if app_dir.join("raynote.db").exists() {
            app_dir.join("raynote.db")
        } else {
            app_dir.join("notefast.db")
        };
        let size_bytes: u64 = [db_path.clone(), std::path::PathBuf::from(format!("{}-wal", db_path.display())), std::path::PathBuf::from(format!("{}-shm", db_path.display()))]
            .iter().filter_map(|path| std::fs::metadata(path).ok()).map(|meta| meta.len()).sum();
        Ok(serde_json::json!({
            "notes_count": count,
            "db_path": db_path.to_string_lossy(),
            "size_bytes": size_bytes,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn checkpoint_passive(db: tauri::State<'_, std::sync::Arc<Database>>) -> Result<(), String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = match db.writer.try_lock() {
            Ok(g) => g,
            Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return Ok(()),
        };
        let _ = guard.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |_| Ok(()));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_to_clipboard(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("pbcopy")
            .env_remove("LANG")
            .env_remove("LC_ALL")
            .env("LC_CTYPE", "UTF-8")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to pbcopy stdin: {}", e))?;
            drop(stdin);
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for pbcopy: {}", e))?;
        if !status.success() {
            return Err("pbcopy exited with non-zero status".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exports_support_long_unicode_titles_and_control_characters() {
        let dir = std::env::temp_dir().join(format!("raynote_long_exports_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for title in ["नमस्ते".repeat(50), "Short\0line\nend".into()] {
            let path = write_export_note(&dir, &title, "Preserved note", 0).expect("valid note titles must export even when they exceed filesystem filename limits");
            assert!(path.file_name().unwrap().as_encoded_bytes().len() <= 255);
            assert_eq!(std::fs::read_to_string(path).unwrap(), "Preserved note");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }


    #[test]
    fn test_markdown_export_preserves_embeds_with_escaped_attributes() {
        let doc = serde_json::json!({"type":"doc", "content":[
            {"type":"iframe","attrs":{"src":"https://example.com/embed?a=1&title=\"quote\"","width":"100%","height":400}},
            {"type":"youtube","attrs":{"src":"https://www.youtube.com/watch?v=abcdefghijk"}},
            {"type":"iframe","attrs":{"src":"javascript:alert(1)"}}
        ]});
        let md = note_content_to_markdown_clean(&doc.to_string(), "");
        assert!(md.contains("src=\"https://example.com/embed?a=1&amp;title=&quot;quote&quot;\""), "iframe source and attribute escaping must survive: {md:?}");
        assert!(md.contains("height=\"400\""));
        assert!(md.contains("https://www.youtube.com/watch?v=abcdefghijk"));
        assert!(!md.contains("javascript:"));
    }

    #[test]
    fn test_markdown_export_preserves_table_cell_formatting_and_paragraphs() {
        let doc = serde_json::json!({"type":"doc", "content":[
            {"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[
                {"type":"paragraph","content":[{"type":"text","text":"Bold | text","marks":[{"type":"bold"}]}]},
                {"type":"paragraph","content":[{"type":"text","text":"Second line"}]}
            ]}]}]}
        ]});
        let md = note_content_to_markdown_clean(&doc.to_string(), "");
        assert!(md.contains("**Bold \\| text**<br><br>Second line"), "table cells must keep marks, delimiters, and paragraphs: {md:?}");
    }


    #[test]
    fn test_markdown_export_preserves_hard_breaks_and_nested_code_fences() {
        let doc = serde_json::json!({"type":"doc", "content":[
            {"type":"paragraph","content":[{"type":"text","text":"First"},{"type":"hardBreak"},{"type":"text","text":"Second"}]},
            {"type":"codeBlock","attrs":{"language":"markdown"},"content":[{"type":"text","text":"```js\nconst x = 1;\n```"}]}
        ]});
        let md = note_content_to_markdown_clean(&doc.to_string(), "");
        assert!(md.contains("First  \nSecond"), "hard breaks must survive: {md:?}");
        assert!(md.contains("````markdown\n```js\nconst x = 1;\n```\n````"), "code fences must exceed embedded backtick runs: {md:?}");
    }


    #[test]
    fn test_exports_preserve_colliding_titles_and_existing_files() {
        let dir = std::env::temp_dir().join(format!("raynote_exports_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Same.md"), "Existing export").unwrap();
        let first = write_export_note(&dir, "Same", "First note", 0).unwrap();
        let second = write_export_note(&dir, "Same", "Second note", 1).unwrap();
        let sanitized_a = write_export_note(&dir, "A/B", "Slash", 2).unwrap();
        let sanitized_b = write_export_note(&dir, "A:B", "Colon", 3).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("Same.md")).unwrap(), "Existing export");
        assert_ne!(first, second);
        assert_ne!(sanitized_a, sanitized_b);
        assert_eq!(std::fs::read_to_string(first).unwrap(), "First note");
        assert_eq!(std::fs::read_to_string(second).unwrap(), "Second note");
        assert_eq!(std::fs::read_to_string(sanitized_a).unwrap(), "Slash");
        assert_eq!(std::fs::read_to_string(sanitized_b).unwrap(), "Colon");
        std::fs::remove_dir_all(dir).unwrap();
    }


    #[test]
    fn test_map_update_note_error_maps_query_returned_no_rows_to_note_not_found() {
        let err = rusqlite::Error::QueryReturnedNoRows;
        assert_eq!(map_update_note_error(err), "NOTE_NOT_FOUND");
    }

    #[test]
    fn test_map_update_note_error_preserves_other_errors() {
        let err = rusqlite::Error::ExecuteReturnedResults;
        assert_ne!(map_update_note_error(err), "NOTE_NOT_FOUND");
    }

    #[test]
    fn test_database_update_missing_row_mapped_returns_note_not_found() {
        let temp_dir: std::path::PathBuf = std::env::temp_dir().join(format!("raynote_map_test_{}", uuid::Uuid::new_v4()));
        let db: Database = Database::new(temp_dir.clone()).expect("Failed to initialize test db");
        let result: Result<String, String> = db.update_note("missing-id-999", "Title", "Content").map_err(map_update_note_error);
        assert_eq!(result, Err::<String, String>("NOTE_NOT_FOUND".to_string()));
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_pbcopy_utf8_roundtrip_with_unset_lang_and_lc_all() {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let sample = "नमस्ते 😀 你好";

        // Write via pbcopy with LANG and LC_ALL removed, and LC_CTYPE=UTF-8
        let mut child = Command::new("pbcopy")
            .env_remove("LANG")
            .env_remove("LC_ALL")
            .env("LC_CTYPE", "UTF-8")
            .stdin(Stdio::piped())
            .spawn()
            .expect("Failed to spawn pbcopy in test");

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(sample.as_bytes())
                .expect("Failed to write to pbcopy stdin");
            drop(stdin);
        }
        let status = child.wait().expect("Failed to wait on pbcopy");
        assert!(status.success(), "pbcopy failed");

        // Read back via pbpaste with LANG and LC_ALL removed, and LC_CTYPE=UTF-8
        let output = Command::new("pbpaste")
            .env_remove("LANG")
            .env_remove("LC_ALL")
            .env("LC_CTYPE", "UTF-8")
            .output()
            .expect("Failed to run pbpaste");

        assert!(output.status.success(), "pbpaste failed");
        let result = String::from_utf8(output.stdout).expect("pbpaste output was not valid UTF-8");
        assert_eq!(result, sample);
    }
    #[test]
    fn audit_native_markdown_keeps_literal_text_and_marks() {
        let doc = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"**literal** "},
            {"type":"text","text":"under","marks":[{"type":"underline"}]},
            {"type":"text","text":"lit","marks":[{"type":"highlight"}]},
            {"type":"text","text":"a`b","marks":[{"type":"code"}]}
        ]}]}).to_string();
        let md = note_content_to_markdown_clean(&doc, "");
        assert!(md.contains(r"\*\*literal\*\*"), "{md}");
        assert!(md.contains("<u>under</u>"), "{md}");
        assert!(md.contains("<mark>lit</mark>"), "{md}");
        assert!(md.contains("``a`b``"), "{md}");
    }

    #[test]
    fn audit_deeplink_identity_validation() {
        assert_eq!(note_id_from_url("notefast://note/abc-123"), Some("abc-123".into()));
        assert_eq!(note_id_from_url("raynote://note/abc-123"), Some("abc-123".into()));
        for value in ["https://note/abc", "notefast://other/abc", "notefast://note/", "notefast://note/a/b", "javascript:alert(1)"] {
            assert_eq!(note_id_from_url(value), None);
        }
    }
    #[test]
    fn audit_exit_requires_positive_flush_confirmation() {
        begin_exit_flush();
        assert!(!wait_for_flush_done(std::time::Duration::from_millis(1)));
        flush_done(Some(false));
        assert!(!wait_for_flush_done(std::time::Duration::ZERO));
        begin_exit_flush();
        flush_done(Some(true));
        assert!(wait_for_flush_done(std::time::Duration::ZERO));
        begin_exit_flush();
    }

}