# rayNote Build Provenance & Working-Tree Analysis

> **Audit Follow-up Date:** October 30, 2026
> **Auditor Role:** Principal Systems & Performance Engineering Specialist
> **Target Executable:** `/Applications/rayNote.app/Contents/MacOS/raynote`
> **Target Release Artifact:** `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/rayNote.app/Contents/MacOS/raynote`

---

## 1. Executive Summary & Provenance Verdict

| Provenance Property | Value / Status | Verification Method |
| :--- | :--- | :--- |
| **Git Commit Reference** | `dff544900680a1d91e4aa347b5dadfb641f6d00f` | `git rev-parse HEAD` |
| **Commit Timestamp** | `Thu Oct 29 23:58:23 2026 +0530` | `git log -1 --format=%cd` |
| **Installed Binary Build Timestamp**| `Fri Oct 30 00:37:23 2026 +0530` | `stat -f "%Sm" /Applications/rayNote.app/...` |
| **Release Bundle Timestamp** | `Fri Oct 30 00:37:16 2026 +0530` | `stat -f "%Sm" src-tauri/target/.../release/raynote` |
| **Working-Tree Status at Build Time**| **DIRTY (Uncommitted modifications present)** | Timestamp ordering & bundle inspection |
| **Installed Binary Checksum (MD5)** | `f9bead6106e9acaabbef527677ad4824` | Exact match with target release bundle |
| **Tested Build Provenance Classification** | **`v0.1.0-dff5449-dirty`** | Empirical provenance established |

---

## 2. Chronological Timeline of Source vs. Binary Build

An empirical audit of file modification timestamps on the host APFS filesystem reveals the exact sequence of events:

```
2026-10-29 23:58:23 +0530  ───  Git Commit dff5449 created on branch main
2026-10-30 00:26:04 +0530  ───  src/editor/extensions.ts modified in working directory
2026-10-30 00:26:20 +0530  ───  src/index.css modified in working directory
2026-10-30 00:36:00 +0530  ───  pnpm build runs (dist/ regenerated)
2026-10-30 00:37:16 +0530  ───  Cargo builds release binary (src-tauri/target/.../raynote)
2026-10-30 00:37:23 +0530  ───  Application bundle assembled (/Applications/rayNote.app)
```

### Analysis
1. `src/editor/extensions.ts` was modified at **00:26:04**, exactly **27 minutes and 41 seconds after commit `dff5449`**.
2. `src/index.css` was modified at **00:26:20**, exactly **27 minutes and 57 seconds after commit `dff5449`**.
3. The application binary in `/Applications/rayNote.app` was compiled and linked at **00:37:23**, exactly **11 minutes after the working-tree files were modified**.
4. Tauri v2 packs the contents of `frontendDist: "../dist"` directly into the embedded executable. Because `dist/` was built from the dirty working tree, the uncommitted changes in `extensions.ts` (specifically `showOnlyCurrent: true` and `includeChildren: false` for the TipTap Placeholder plugin) and `index.css` were compiled into the tested binary.

---

## 3. Working-Tree Modifications Diff

The exact uncommitted working-tree modifications present in the tested application build are:

### `src/editor/extensions.ts`
```diff
@@ -283,18 +283,19 @@ export function getExtensions(
     ShortcutsExtension,
     SearchExtension,
     Placeholder.configure({
-      placeholder: ({ pos, hasAnchor }) => {
+      placeholder: ({ pos, node }) => {
         // First node in the document → always show "Note Title"
         if (pos === 0) {
           return "Note Title";
         }
-        // Only show "Type '/' for commands…" on the current active line where the cursor is
-        if (hasAnchor) {
+        // Top-level empty paragraph where the cursor is
+        if (node.type.name === "paragraph") {
           return "Type '/' for commands…";
         }
         return "";
       },
-      showOnlyCurrent: false,
+      showOnlyCurrent: true,
+      includeChildren: false,
       emptyEditorClass: "is-editor-empty",
     }),
     TaskList,
```

### `src/index.css`
```diff
@@ -868,24 +868,36 @@ html[data-smooth-caret="false"] .tiptap {
   margin-bottom: 0.95em !important;
 }

+.tiptap > .is-empty {
+  position: relative;
+}
+
 /* Placeholder for empty first node (title placeholder) */
 .tiptap > .is-empty:first-child::before {
   content: attr(data-placeholder);
-  float: left;
+  position: absolute;
+  left: 0;
+  top: 0;
   color: var(--placeholder);
   pointer-events: none;
-  height: 0;
   font-style: normal;
+  line-height: inherit;
+  font-size: inherit;
+  font-weight: inherit;
 }

 /* Placeholder for empty nodes after the first */
 .tiptap > .is-empty:not(:first-child)::before {
   content: attr(data-placeholder);
-  float: left;
+  position: absolute;
+  left: 0;
+  top: 0;
   color: var(--placeholder);
   pointer-events: none;
-  height: 0;
   font-style: normal;
+  line-height: inherit;
+  font-size: inherit;
+  font-weight: inherit;
 }

 .tiptap [data-placeholder=""]::before {
```

---

## 4. Architectural Impact of the Uncommitted Changes
1. **Placeholder Plugin Decoration Optimization**:
   The change to `showOnlyCurrent: true` and `includeChildren: false` optimizes the TipTap `Placeholder` extension so that it only decorates the current active paragraph rather than scanning every empty paragraph in large documents. This change directly benefits typing latency and reduces ProseMirror decoration mapping overhead during document hydration.
2. **Provenance Labeling**:
   Because the tested binary contains these working tree optimizations that are not present in commit `dff5449`, the binary must be strictly labeled as:
   **`rayNote 0.1.0 (build dff5449-dirty)`**.

