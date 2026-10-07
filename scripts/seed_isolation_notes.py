import sqlite3
import os
from datetime import datetime

db_path = os.path.expanduser('~/Library/Application Support/com.raynote.desktop/raynote.db')
print('Seeding isolation benchmark notes into:', db_path)

TARGET_SIZE = 1024 * 1024  # 1 MB

def generate_plain_note(title):
    content = f"# {title}\n\n> Plain 1 MB text document with 0 code blocks and 0 tables.\n\n"
    paragraphs = [
        "Software architecture involves high-level decisions that are costly to change once implemented. System designers must balance trade-offs between throughput, latency, memory consumption, developer ergonomic velocity, and operational maintainability. Over time, architectures evolve to support changing requirements and higher operational scale.",
        "Database persistence strategies dictate the overall responsiveness of desktop clients. Embedded solutions like SQLite paired with Write-Ahead Logging (WAL) and memory temp stores provide near-zero overhead without network latency penalties. Proper indexing and query normalization prevent full table scans and keep execution times below one millisecond.",
        "ProseMirror and Tiptap represent structured document editors maintaining synchronized DOM representations, transactional history trees, and immutable document state nodes. Recreating editor instances on note switches causes noticeable layout reflows and memory thrashing, making in-place document updates essential for native desktop fluidity.",
        "Memory caching strategies using Least Recently Used (LRU) algorithms bound client footprint while delivering instantaneous retrieval for frequently navigated resources. Tracking both entry counts and byte budgets prevents pathological out-of-memory states during sustained usage sessions."
    ]
    p_idx = 0
    while len(content.encode('utf-8')) < TARGET_SIZE:
        content += f"## Section {p_idx // 4 + 1}.{p_idx % 4 + 1}\n\n"
        content += paragraphs[p_idx % len(paragraphs)] + "\n\n"
        content += paragraphs[(p_idx + 1) % len(paragraphs)] + "\n\n"
        p_idx += 1
    return content[:TARGET_SIZE]

def generate_code_heavy_note(title):
    content = f"# {title}\n\n> Code-heavy 1 MB document with ~968 code blocks and 0 tables.\n\n"
    code_block = "```typescript\nfunction processItem<T>(item: T): Promise<T> {\n  return new Promise((resolve) => {\n    setTimeout(() => resolve(item), 16);\n  });\n}\n```\n\n"
    text = "System architecture principles require robust separation of concerns.\n\n"
    count = 0
    while len(content.encode('utf-8')) < TARGET_SIZE:
        content += f"### Function Block {count + 1}\n\n"
        content += text
        content += code_block
        count += 1
    return content[:TARGET_SIZE]

def generate_table_heavy_note(title):
    content = f"# {title}\n\n> Table-heavy 1 MB document with ~581 tables and 0 code blocks.\n\n"
    table = "| Key | Value | Description |\n| :--- | :--- | :--- |\n| LRU_MAX | 25 | Maximum entries retained |\n| RAM_BUDGET | 8MB | Hard memory ceiling |\n| CACHE_HIT | 0ms | Instant retrieval |\n\n"
    text = "Configuration parameters must be verified prior to runtime deployment.\n\n"
    count = 0
    while len(content.encode('utf-8')) < TARGET_SIZE:
        content += f"### Parameter Table {count + 1}\n\n"
        content += text
        content += table
        count += 1
    return content[:TARGET_SIZE]

def generate_realistic_note(title):
    content = f"# {title}\n\n> Realistic 1 MB document with normal density: 10 code blocks, 5 tables, and extensive markdown prose.\n\n"
    paragraphs = [
        "Enterprise note-taking platforms require strict balance between rich visual capability and memory efficiency. Unlike typical web applications that unmount entire views across route transitions, desktop productivity tools are expected to maintain instant response times with zero layout flickering.",
        "When processing markdown files, parsing pipelines must handle inline formatting, nested blockquotes, ordered and unordered lists, task checkboxes, and tabular structures without generating unbounded DOM element cascades.",
        "In native desktop wrappers such as Tauri, the system webview is managed by WebKit WebCore on macOS. Because WebCore delegates allocation to bmalloc and thread-local caches, high-frequency DOM replacement can cause transient virtual memory inflation unless document lifecycle boundaries are carefully enforced."
    ]
    p_idx = 0
    code_count = 0
    table_count = 0
    while len(content.encode('utf-8')) < TARGET_SIZE:
        content += f"## Section {p_idx + 1}\n\n"
        content += paragraphs[p_idx % len(paragraphs)] + "\n\n"
        if code_count < 10 and p_idx % 15 == 3:
            content += "```typescript\nexport interface NoteMetadata {\n  id: string;\n  title: string;\n  byteSize: number;\n}\n```\n\n"
            code_count += 1
        if table_count < 5 and p_idx % 30 == 7:
            content += "| Setting | Default | Range |\n| :--- | :--- | :--- |\n| fontSize | 14px | 10-24px |\n| autoSave | 300ms | 100-2000ms |\n| history | 50 | 10-200 |\n\n"
            table_count += 1
        content += paragraphs[(p_idx + 1) % len(paragraphs)] + "\n\n"
        p_idx += 1
    return content[:TARGET_SIZE]

now = datetime.utcnow().isoformat() + "Z"

notes_to_insert = [
    ('iso-plain-1', '[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note A', generate_plain_note('[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note A')),
    ('iso-plain-2', '[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note B', generate_plain_note('[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note B')),
    
    ('iso-code-1', '[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note A', generate_code_heavy_note('[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note A')),
    ('iso-code-2', '[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note B', generate_code_heavy_note('[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note B')),
    
    ('iso-table-1', '[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note A', generate_table_heavy_note('[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note A')),
    ('iso-table-2', '[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note B', generate_table_heavy_note('[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note B')),
    
    ('iso-realistic-1', '[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note A', generate_realistic_note('[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note A')),
    ('iso-realistic-2', '[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note B', generate_realistic_note('[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note B')),
]

conn = sqlite3.connect(db_path)
cur = conn.cursor()

for note_id, title, content in notes_to_insert:
    preview = title[:80]
    cur.execute("""
        INSERT OR REPLACE INTO notes (id, title, content, created_at, updated_at, is_pinned, preview)
        VALUES (?, ?, ?, ?, ?, 1, ?)
    """, (note_id, title, content, now, now, preview))
    print(f"✓ Inserted {note_id} ({len(content.encode('utf-8'))} bytes)")

conn.commit()
conn.close()
print("Seeding completed successfully!")
