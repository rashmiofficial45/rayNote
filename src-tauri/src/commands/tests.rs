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

#[test]
fn audit_fix_native_list_paragraphs_remain_separate() {
    for (list_type, item_type, prefix, indent) in [
        ("bulletList", "listItem", "- ", "  "),
        ("orderedList", "listItem", "1. ", "   "),
        ("taskList", "taskItem", "- [ ] ", "  "),
    ] {
        let doc = serde_json::json!({"type":"doc","content":[{
            "type":list_type,"content":[{"type":item_type,"attrs":{"checked":false},"content":[
                {"type":"paragraph","content":[{"type":"text","text":"First paragraph"}]},
                {"type":"paragraph","content":[{"type":"text","text":"Second paragraph"}]}
            ]}]
        }]}).to_string();
        let md = note_content_to_markdown_clean(&doc, "");
        assert_eq!(md, format!("{prefix}First paragraph\n\n{indent}Second paragraph"),
            "{list_type} must retain both paragraphs in the same list item");
    }
}

#[test]
fn audit_fix_native_literal_list_prefixes_are_escaped() {
    for (literal, escaped) in [
        ("- not a list", r"\- not a list"),
        ("+ not a list", r"\+ not a list"),
        ("1. not a list", r"1\. not a list"),
        ("1) not a list", r"1\) not a list"),
    ] {
        let doc = serde_json::json!({"type":"doc","content":[{
            "type":"paragraph","content":[{"type":"text","text":literal}]
        }]}).to_string();
        assert_eq!(note_content_to_markdown_clean(&doc, ""), escaped,
            "literal paragraph must not become a Markdown list");
    }
}
