# rayNote Frontend Performance & Bundle Analysis Report

> **Audit Date:** October 30, 2026
> **Environment:** macOS 27.2 | Apple M3 | WebKit WKWebView (Safari 18 Engine)
> **Bundle Target:** `dist/` built via Vite 8.3.1 / Rollup

---

## 1. Production Bundle Composition

The production build comprises 2,267 transformed modules compiled into optimized ES chunks with dynamic code splitting:

| Asset File | Category | Raw Size | Gzip Size | Compression Ratio | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `index-DCVywaxP.js` | Main App Bundle | 1,098.86 KB | 332.86 KB | 3.30x | React 19, TipTap Core, ProseMirror, Lucide icons, App state |
| `index-NnUntPaw.css` | Stylesheet | 121.47 KB | 20.81 KB | 5.84x | Tailwind CSS, TipTap styling, liquid glassmorphism, animations |
| `SettingsApp-nlXA6F88.js` | Subview | 24.95 KB | 5.85 KB | 4.26x | Settings modal and preferences editor |
| `css-CunjgVpT.js` | Syntax Grammar | 11.72 KB | 4.25 KB | 2.76x | CSS Lowlight language grammar |
| `typescript-DfOdISYs.js` | Syntax Grammar | 7.50 KB | 3.04 KB | 2.47x | TypeScript Lowlight language grammar |
| `javascript-QsOaq-xI.js` | Syntax Grammar | 6.27 KB | 2.60 KB | 2.41x | JavaScript Lowlight language grammar |
| `sql-Bx3rmqu-.js` | Syntax Grammar | 5.51 KB | 2.40 KB | 2.29x | SQL Lowlight language grammar |
| `MarkdownViewerModal-gNj-Gwjt.js` | Modal | 5.40 KB | 1.88 KB | 2.88x | Readonly markdown export modal |
| `cpp-DTdHjX0h.js` | Syntax Grammar | 5.37 KB | 2.47 KB | 2.17x | C++ Lowlight language grammar |
| `c-u-r8Hv0I.js` | Syntax Grammar | 3.91 KB | 1.87 KB | 2.09x | C Lowlight language grammar |
| `csharp-CSgP9w7Z.js` | Syntax Grammar | 3.84 KB | 1.61 KB | 2.38x | C# Lowlight language grammar |
| `python-w1jWhufv.js` | Syntax Grammar | 3.25 KB | 1.47 KB | 2.21x | Python Lowlight language grammar |
| `rust-B9iKSdTg.js` | Syntax Grammar | 2.68 KB | 1.45 KB | 1.85x | Rust Lowlight language grammar |
| `java-BCnfQ6MX.js` | Syntax Grammar | 2.54 KB | 1.22 KB | 2.08x | Java Lowlight language grammar |
| `markdown-DLM988Ns.js` | Syntax Grammar | 2.10 KB | 0.91 KB | 2.31x | Markdown Lowlight language grammar |
| `xml-Hn7tkzR4.js` | Syntax Grammar | 1.92 KB | 0.81 KB | 2.37x | XML Lowlight language grammar |
| `yaml-B5dpTiHm.js` | Syntax Grammar | 1.87 KB | 0.86 KB | 2.17x | YAML Lowlight language grammar |
| `go-B5qOYZGC.js` | Syntax Grammar | 1.45 KB | 0.74 KB | 1.95x | Go Lowlight language grammar |
| `PaletteSubViews-BBskRYSz.js` | Palette Subview | 1.01 KB | 0.53 KB | 1.90x | Command palette auxiliary subviews |
| `diff-CNQ9GcjB.js` | Syntax Grammar | 0.64 KB | 0.35 KB | 1.84x | Diff Lowlight grammar |
| `json-7eZ-6Gsl.js` | Syntax Grammar | 0.64 KB | 0.46 KB | 1.40x | JSON Lowlight grammar |
| **Total JavaScript** | All JS Assets | **1,192.08 KB** | **368.51 KB** | **3.23x** | Overall JavaScript payload |
| **Total Assets (JS+CSS)** | Complete Distribution | **1,313.55 KB** | **389.32 KB** | **3.37x** | Production footprint |

---

## 2. Rendering Hot Paths & Architectural Strengths

### A. Single Persistent Editor Shell
Unlike naive React editor integrations that destroy and remount the ProseMirror editor (`useEditor` re-running on every active note ID change), rayNote maintains **one single persistent editor instance** (`Editor.tsx`). Switching notes executes via:
```typescript
editor.commands.setContent(ensureHeadingOneForDoc(docData), { emitUpdate: false });
```
This avoids:
1. Re-binding DOM event listeners on every note transition.
2. Re-creating ProseMirror plugin dispatch queues.
3. Heavy DOM reflows and style recalibration of the editor wrapper.

### B. Dynamic Code Block Syntax Highlighting Splitting
Syntax highlighters (`highlight.js` / `lowlight`) often bloat web bundles by 500 KB to 2 MB when bundled statically. rayNote implements on-demand lazy language preloading (`preloadLanguagesForContent`):
- Only the grammars actively present in the note's code blocks are downloaded and registered.
- Grammars range from 0.64 KB (`json`) to 11.72 KB (`css`), keeping initial startup lean.

### C. Glassmorphism & GPU Compositing
rayNote uses extensive macOS vibrancy styling via CSS:
- `backdrop-filter: blur(28px) saturate(190%)`
- `background: rgba(18, 18, 22, 0.65)`
- `box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45)`

**GPU Impact Observation**:
In the full footprint output, IOSurface shared memory between Tauri and WebKit accounted for **30 MB (58 regions)** of graphics surface memory. Window Server compositing handles these blur filters without CPU software rasterization overhead.

---

## 3. Bottlenecks & Optimization Opportunities

### 1. Main Bundle Size (`index-DCVywaxP.js` at 1.09 MB)
While 332 KB gzipped is reasonable for an Electron/Tauri editor, 1.09 MB uncompressed JavaScript requires ~50–80 ms of V8/JavaScriptCore parse and compile time during cold launch.
- **Lucide Icons**: Currently bundled into the main chunk. Tree-shaking should be verified to ensure unused SVG glyphs are pruned.
- **TipTap Extensions**: Multiple TipTap extensions (Table, TaskList, CodeBlockLowlight, Highlight, Link) are compiled into the main bundle. Table and complex formatting could be conditionally loaded.

### 2. Markdown vs. TipTap JSON Parsing on Note Switch
When opening a note whose content is stored as markdown rather than serialized TipTap JSON, `Editor.tsx` falls back to `markdownToTipTapHtml`:
```typescript
try {
  docData = JSON.parse(rawContent);
} catch {
  docData = markdownToTipTapHtml(rawContent, { ensureFirstLineH1: true });
}
```
For 1 MB documents, markdown regex tokenization and HTML generation takes **10–30 ms** on the JavaScript main thread. Storing pre-parsed TipTap JSON directly in the SQLite row eliminates this conversion on switch.

