use crate::database::{Database, Note, NoteSummary};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

#[tauri::command]
pub fn get_all_notes(db: State<'_, Database>) -> Result<Vec<NoteSummary>, String> {
    db.get_all_notes().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_notes(db: State<'_, Database>, query: String) -> Result<Vec<NoteSummary>, String> {
    db.search_notes(&query).map_err(|e| e.to_string())
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
        preview: String::new(),
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
pub fn export_all_notes_from_db(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<String, String> {
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
        let md = note_content_to_markdown_clean(&note.content, &note.title);
        std::fs::write(&file_path, md).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let path_str = export_dir.to_string_lossy().to_string();
        let _ = std::process::Command::new("open").arg(&path_str).spawn();
    }

    Ok(export_dir.to_string_lossy().to_string())
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

fn serialize_inline_json(node: &serde_json::Value) -> String {
    let mut text = node.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
    if let Some(marks) = node.get("marks").and_then(|m| m.as_array()) {
        for mark in marks {
            if let Some(mark_type) = mark.get("type").and_then(|t| t.as_str()) {
                match mark_type {
                    "bold" => text = format!("**{}**", text),
                    "italic" => text = format!("*{}*", text),
                    "strike" => text = format!("~~{}~~", text),
                    "code" => text = format!("`{}`", text),
                    "link" => {
                        let href = mark.get("attrs").and_then(|a| a.get("href")).and_then(|h| h.as_str()).unwrap_or("");
                        text = format!("[{}]({})", text, href);
                    }
                    _ => {}
                }
            }
        }
    }
    text
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
                out.push_str(&format!("{}```{}\n{}\n{}```\n\n", indent, lang, code, indent));
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
                                collect_text_only(cell, &mut cell_text);
                                cells.push(cell_text.replace('|', "\\|").trim().to_string());
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
                match event.id().as_ref() {
                    "toggle" => {
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
                    "new" => {
                        crate::show_and_focus_main_panel(app);
                        use tauri::Emitter;
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.emit("new-note", ());
                        }
                    }
                    "settings" => {
                        let _ = crate::commands::open_settings_window(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
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

