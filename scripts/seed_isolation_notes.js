import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const dbPath = path.join(
  os.homedir(),
  'Library/Application Support/com.raynote.desktop/raynote.db'
);

const db = new Database(dbPath);

console.log('Seeding isolation benchmark notes into:', dbPath);

// Helper to pad/build content to exact target size (~1 MB)
const TARGET_SIZE = 1024 * 1024; // 1 MB

function generatePlainNote(title) {
  let content = `# ${title}\n\n> Plain 1 MB text document with 0 code blocks and 0 tables.\n\n`;
  const paragraphs = [
    "Software architecture involves high-level decisions that are costly to change once implemented. System designers must balance trade-offs between throughput, latency, memory consumption, developer ergonomic velocity, and operational maintainability. Over time, architectures evolve to support changing requirements and higher operational scale.",
    "Database persistence strategies dictate the overall responsiveness of desktop clients. Embedded solutions like SQLite paired with Write-Ahead Logging (WAL) and memory temp stores provide near-zero overhead without network latency penalties. Proper indexing and query normalization prevent full table scans and keep execution times below one millisecond.",
    "ProseMirror and Tiptap represent structured document editors maintaining synchronized DOM representations, transactional history trees, and immutable document state nodes. Recreating editor instances on note switches causes noticeable layout reflows and memory thrashing, making in-place document updates essential for native desktop fluidity.",
    "Memory caching strategies using Least Recently Used (LRU) algorithms bound client footprint while delivering instantaneous retrieval for frequently navigated resources. Tracking both entry counts and byte budgets prevents pathological out-of-memory states during sustained usage sessions."
  ];

  let pIdx = 0;
  while (Buffer.byteLength(content, 'utf8') < TARGET_SIZE) {
    content += `## Section ${Math.floor(pIdx / 4) + 1}.${(pIdx % 4) + 1}\n\n`;
    content += paragraphs[pIdx % paragraphs.length] + '\n\n';
    content += paragraphs[(pIdx + 1) % paragraphs.length] + '\n\n';
    pIdx++;
  }
  return content.slice(0, TARGET_SIZE);
}

function generateCodeHeavyNote(title) {
  let content = `# ${title}\n\n> Code-heavy 1 MB document with ~968 code blocks and 0 tables.\n\n`;
  const codeBlock = "```typescript\nfunction processItem<T>(item: T): Promise<T> {\n  return new Promise((resolve) => {\n    setTimeout(() => resolve(item), 16);\n  });\n}\n```\n\n";
  const text = "System architecture principles require robust separation of concerns.\n\n";

  let count = 0;
  while (Buffer.byteLength(content, 'utf8') < TARGET_SIZE) {
    content += `### Function Block ${count + 1}\n\n`;
    content += text;
    content += codeBlock;
    count++;
  }
  return content.slice(0, TARGET_SIZE);
}

function generateTableHeavyNote(title) {
  let content = `# ${title}\n\n> Table-heavy 1 MB document with ~581 tables and 0 code blocks.\n\n`;
  const table = "| Key | Value | Description |\n| :--- | :--- | :--- |\n| LRU_MAX | 25 | Maximum entries retained |\n| RAM_BUDGET | 8MB | Hard memory ceiling |\n| CACHE_HIT | 0ms | Instant retrieval |\n\n";
  const text = "Configuration parameters must be verified prior to runtime deployment.\n\n";

  let count = 0;
  while (Buffer.byteLength(content, 'utf8') < TARGET_SIZE) {
    content += `### Parameter Table ${count + 1}\n\n`;
    content += text;
    content += table;
    count++;
  }
  return content.slice(0, TARGET_SIZE);
}

function generateRealisticNote(title) {
  let content = `# ${title}\n\n> Realistic 1 MB document with normal density: 10 code blocks, 5 tables, and extensive markdown prose.\n\n`;
  const paragraphs = [
    "Enterprise note-taking platforms require strict balance between rich visual capability and memory efficiency. Unlike typical web applications that unmount entire views across route transitions, desktop productivity tools are expected to maintain instant response times with zero layout flickering.",
    "When processing markdown files, parsing pipelines must handle inline formatting, nested blockquotes, ordered and unordered lists, task checkboxes, and tabular structures without generating unbounded DOM element cascades.",
    "In native desktop wrappers such as Tauri, the system webview is managed by WebKit WebCore on macOS. Because WebCore delegates allocation to bmalloc and thread-local caches, high-frequency DOM replacement can cause transient virtual memory inflation unless document lifecycle boundaries are carefully enforced."
  ];

  let pIdx = 0;
  let codeCount = 0;
  let tableCount = 0;

  while (Buffer.byteLength(content, 'utf8') < TARGET_SIZE) {
    content += `## Section ${pIdx + 1}\n\n`;
    content += paragraphs[pIdx % paragraphs.length] + '\n\n';
    
    // Inject code blocks up to 10 total
    if (codeCount < 10 && pIdx % 15 === 3) {
      content += "```typescript\nexport interface NoteMetadata {\n  id: string;\n  title: string;\n  byteSize: number;\n}\n```\n\n";
      codeCount++;
    }

    // Inject tables up to 5 total
    if (tableCount < 5 && pIdx % 30 === 7) {
      content += "| Setting | Default | Range |\n| :--- | :--- | :--- |\n| fontSize | 14px | 10-24px |\n| autoSave | 300ms | 100-2000ms |\n| history | 50 | 10-200 |\n\n";
      tableCount++;
    }

    content += paragraphs[(pIdx + 1) % paragraphs.length] + '\n\n';
    pIdx++;
  }
  return content.slice(0, TARGET_SIZE);
}

const now = new Date().toISOString();

const notesToInsert = [
  { id: 'iso-plain-1', title: '[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note A', content: generatePlainNote('[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note A') },
  { id: 'iso-plain-2', title: '[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note B', content: generatePlainNote('[Isolation 1] Plain 1 MB (0 Code, 0 Tables) - Note B') },
  
  { id: 'iso-code-1', title: '[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note A', content: generateCodeHeavyNote('[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note A') },
  { id: 'iso-code-2', title: '[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note B', content: generateCodeHeavyNote('[Isolation 2] Code-Heavy 1 MB (968 Code, 0 Tables) - Note B') },
  
  { id: 'iso-table-1', title: '[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note A', content: generateTableHeavyNote('[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note A') },
  { id: 'iso-table-2', title: '[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note B', content: generateTableHeavyNote('[Isolation 3] Table-Heavy 1 MB (0 Code, 581 Tables) - Note B') },
  
  { id: 'iso-realistic-1', title: '[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note A', content: generateRealisticNote('[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note A') },
  { id: 'iso-realistic-2', title: '[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note B', content: generateRealisticNote('[Isolation 4] Realistic 1 MB (10 Code, 5 Tables) - Note B') },
];

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO notes (id, title, content, created_at, updated_at, is_pinned, preview)
  VALUES (@id, @title, @content, @created_at, @updated_at, @is_pinned, @preview)
`);

const tx = db.transaction(() => {
  for (const n of notesToInsert) {
    insertStmt.run({
      id: n.id,
      title: n.title,
      content: n.content,
      created_at: now,
      updated_at: now,
      is_pinned: 1, // Pinned so they appear right at the top of the list!
      preview: n.title.slice(0, 80),
    });
    console.log(`✓ Inserted ${n.id} (${Buffer.byteLength(n.content, 'utf8')} bytes)`);
  }
});

tx();

console.log('Seeding completed successfully!');
db.close();
