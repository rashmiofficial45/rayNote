/**
 * Generates realistic markdown and ProseMirror document fixtures containing:
 * - Headings (H1, H2, H3)
 * - Bold, italic, and inline code marks
 * - Bullet lists and task lists with checked/unchecked items
 * - Multi-line syntax-highlighted code blocks
 * - Emoji characters (Unicode astral plane UTF-16 surrogates: 🚀, ⚡️, 📝, 💡)
 * - Indic Devanagari script (Complex UTF-8 multi-byte glyphs: नमस्ते, समवर्ती, कार्य, संपादन)
 * - Tables with headers and formatted cells
 */

export function buildRealisticMarkdown(targetBytes: number): string {
  const sections = [
    `# Chapter: High-Performance Architecture 🚀\n\n` +
    `Modern desktop notes applications require **instant response times** (*< 16 ms*) to remain fluid under heavy typing bursts. ` +
    `When interacting with SQLite storage layers, *Write-Ahead Logging* (\`WAL\`) ensures read-write concurrency.\n\n` +
    `मुख्य अवधारणाएँ: डेटाबेस स्थिरता, स्मृति प्रबंधन और समवर्ती नियंत्रण (Database reliability, memory governance, and concurrency control).\n\n`,

    `## System Engineering Tasks 📝\n\n` +
    `- [x] Verify covering index scan on \`idx_notes_covering\`\n` +
    `- [x] Eliminate unpinned/pinned cache inverted sort bug\n` +
    `- [ ] Profile 1 MB TipTap document with realistic multi-byte characters ⚡️\n` +
    `- [ ] Ensure 0ms keystroke frame-drop guarantee\n\n`,

    `### Algorithmic Highlights 💡\n\n` +
    `* Keyset seek via direct composite index lookup\n` +
    `* Non-blocking \`useSyncExternalStore\` title synchronization\n` +
    `* Zero heap-allocation typo tolerance with fixed-buffer Damerau-Levenshtein\n\n`,

    `\`\`\`rust\n` +
    `pub fn keyset_seek(conn: &Connection, is_pinned: i32, updated_at: &str, id: &str) -> Result<Option<String>> {\n` +
    `    let mut stmt = conn.prepare_cached(\n` +
    `        "SELECT id FROM notes WHERE is_pinned = ?1 AND updated_at < ?2 ORDER BY is_pinned DESC, updated_at DESC, id ASC LIMIT 1"\n` +
    `    )?;\n` +
    `    stmt.query_row(params![is_pinned, updated_at, id], |r| r.get(0)).optional()\n` +
    `}\n` +
    `\`\`\`\n\n`,

    `| Scale | Target Query Latency | Measured (Release) |\n` +
    `| --- | --- | --- |\n` +
    `| 1,000 notes | < 1.0 ms | 0.0038 ms |\n` +
    `| 10,000 notes | < 5.0 ms | 0.0137 ms |\n` +
    `| 50,000 notes | < 10.0 ms | 0.0224 ms |\n\n`,

    `> "Simplicity is prerequisite for reliability." — Edsger W. Dijkstra\n\n` +
    `टिप्पणी: प्रत्येक संपादन सत्र में पाठ की अखंडता संरक्षित रहनी चाहिए। UTF-8 सीमाओं का सटीक प्रबंधन अनिवार्य है।\n\n` +
    `---\n\n`
  ];

  let result = "";
  let sectionIdx = 0;
  while (new TextEncoder().encode(result).length < targetBytes) {
    result += sections[sectionIdx % sections.length];
    sectionIdx++;
  }
  return result;
}
