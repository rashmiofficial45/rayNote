# Cursor Alignment Fix

## What was happening

Clicking the blank area between a text block and the next block could make ProseMirror create an empty text selection at the document boundary. That position is outside any text block, so the smooth-caret overlay measured it as though it were a normal text caret and drew it below the preceding text. The bug was especially visible after the final wrapped line of a heading, such as `Library` before a divider.

## What changed

The editor's selection plugin now checks each transaction for an empty `TextSelection` whose position is outside inline text content. It moves that selection to the nearest valid text position, preferring the preceding text block. Clicking after `Library` therefore places the caret at the end of the heading. Real gap selections between non-text blocks remain available.

The smooth-caret overlay also uses the browser's collapsed selection rectangle when it matches ProseMirror's current selection. This preserves the browser's visual line position around wrapped text and formatting boundaries, with ProseMirror's coordinate lookup as a fallback.

## Verification

- Added a regression test for clicking at the heading/divider boundary. It checks that the caret resolves into text and that the note content remains unchanged.
- Full frontend test suite: **533 passed**.
- TypeScript check passed.
- Rebuilt and relaunched rayNote, then repeated the click between `Library` and its divider. The caret appeared after `Library`.

## Files involved

- `src/editor/clickSelectionExtension.ts` — repairs empty text selections outside text blocks.
- `src/components/SmoothCaret.tsx` — positions the overlay from the browser's actual selection when possible.
- `src/editor/__tests__/gapCaret.test.ts` — boundary-click regression test.
- `src/components/__tests__/smoothCaretPhase5.test.tsx` — browser-selection coordinate tests.
