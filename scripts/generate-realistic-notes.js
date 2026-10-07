import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DB_PATH = '/Users/rashmipersonal/Library/Application Support/com.raynote.desktop/raynote.db';

function generateMarkdownText(targetBytes, title) {
  let content = `# ${title}\n\n`;
  content += `> Automatic realistic test document generated for rayNote benchmark verification.\n\n`;
  content += `## Overview\nThis document contains structured markdown content mimicking real-world knowledge bases.\n\n`;
  
  const sampleParagraphs = [
    `Software architecture involves high-level decisions that are costly to change once implemented. System designers must balance trade-offs between throughput, latency, memory consumption, developer ergonomic velocity, and operational maintainability.\n\n`,
    `Database persistence strategies dictate the overall responsiveness of desktop clients. Embedded solutions like SQLite paired with Write-Ahead Logging (WAL) and memory temp stores provide near-zero overhead without network latency penalties.\n\n`,
    `ProseMirror and Tiptap represent structured document editors maintaining synchronized DOM representations, transactional history trees, and immutable document state nodes. Recreating editor instances on note switches causes noticeable layout reflows and memory thrashing.\n\n`,
    `Memory caching strategies using Least Recently Used (LRU) algorithms bound client footprint while delivering instantaneous retrieval for frequently navigated resources. Tracking both entry counts and byte budgets prevents pathological out-of-memory states.\n\n`
  ];

  const sampleCode = "```typescript\nfunction processItem<T>(item: T): Promise<T> {\n  return new Promise((resolve) => {\n    setTimeout(() => resolve(item), 16);\n  });\n}\n```\n\n";
  const sampleTable = "| Key | Value | Description |\n| :--- | :--- | :--- |\n| LRU_MAX | 25 | Maximum entries retained |\n| RAM_BUDGET | 8MB | Hard memory ceiling |\n| CACHE_HIT | 0ms | Instant retrieval |\n\n";

  let i = 0;
  while (Buffer.byteLength(content, 'utf8') < targetBytes) {
    const p = sampleParagraphs[i % sampleParagraphs.length];
    content += `### Section ${Math.floor(i / 4) + 1}.${(i % 4) + 1}\n\n`;
    content += p;
    if (i % 3 === 0) content += sampleCode;
    if (i % 5 === 0) content += sampleTable;
    i++;
  }

  return content.slice(0, targetBytes);
}

const noteConfigs = [
  // 5 small notes (20 KB each)
  { prefix: 'small', count: 5, targetSize: 20 * 1024, label: 'Small (20 KB)' },
  // 5 medium notes (100 KB each)
  { prefix: 'medium', count: 5, targetSize: 100 * 1024, label: 'Medium (100 KB)' },
  // 5 large notes (250 KB each)
  { prefix: 'large', count: 5, targetSize: 250 * 1024, label: 'Large (250 KB)' },
  // 5 very large notes (500 KB each)
  { prefix: 'xlarge', count: 5, targetSize: 500 * 1024, label: 'Very Large (500 KB)' },
  // 5 mixed/giant notes (1 MB each)
  { prefix: 'giant', count: 5, targetSize: 1024 * 1024, label: 'Giant (1 MB)' },
];

console.log('Generating 25 realistic benchmark notes...');

const sqlStatements = [];
// Clean benchmark notes first
sqlStatements.push(`DELETE FROM notes WHERE id LIKE 'bench-%';`);

let totalGeneratedBytes = 0;
let noteIndex = 1;

for (const cat of noteConfigs) {
  for (let c = 1; c <= cat.count; c++) {
    const id = `bench-${cat.prefix}-${c}`;
    const title = `[Benchmark ${noteIndex}] ${cat.label} Note ${c}`;
    const content = generateMarkdownText(cat.targetSize, title);
    const byteSize = Buffer.byteLength(content, 'utf8');
    totalGeneratedBytes += byteSize;

    const preview = content.slice(0, 150).replace(/['"\n\r#]/g, ' ').trim();
    const now = new Date(Date.now() - (25 - noteIndex) * 60000).toISOString();

    // Escape single quotes for SQL
    const safeContent = content.replace(/'/g, "''");
    const safeTitle = title.replace(/'/g, "''");
    const safePreview = preview.replace(/'/g, "''");

    sqlStatements.push(
      `INSERT INTO notes (id, title, content, preview, created_at, updated_at, is_pinned) ` +
      `VALUES ('${id}', '${safeTitle}', '${safeContent}', '${safePreview}', '${now}', '${now}', 0);`
    );

    noteIndex++;
  }
}

const sqlScriptPath = path.join(process.cwd(), 'scripts', 'seed_benchmarks.sql');
fs.writeFileSync(sqlScriptPath, sqlStatements.join('\n'), 'utf8');

console.log(`Generated SQL script at ${sqlScriptPath} (${(totalGeneratedBytes / (1024 * 1024)).toFixed(2)} MB total text)`);
console.log('Executing SQL migration into SQLite...');
execSync(`/usr/bin/sqlite3 "${DB_PATH}" < "${sqlScriptPath}"`);

console.log('✅ 25 Realistic Benchmark Notes successfully seeded into raynote.db!');
