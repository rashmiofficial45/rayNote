import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { createLowlight } from "lowlight";
import { isMermaidLanguage } from "./mermaidPreview";

export function incrementalCodeHighlight(
  name: string,
  lowlight: ReturnType<typeof createLowlight>,
  defaultLanguage: string | null | undefined,
) {
  const key = new PluginKey<DecorationSet>("raynoteCodeHighlight");

  function codeBlocksBetween(doc: Node, from: number, to: number, visit: (block: Node, pos: number) => void) {
    if (from >= to) return;
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === name) {
        visit(node, pos);
        return false;
      }
      return !node.isTextblock;
    });
  }

  function highlightBetween(doc: Node, from: number, to: number): Decoration[] {
    const result: Decoration[] = [];
    codeBlocksBetween(doc, from, to, (block, pos) => {
      const language = block.attrs.language || defaultLanguage;
      if (!block.content.size || isMermaidLanguage(language) || /^(?:text|plaintext|txt)$/i.test(language ?? "")) return;
      const tree = language && lowlight.registered(language)
        ? lowlight.highlight(language, block.textContent)
        : lowlight.highlightAuto(block.textContent);
      let offset = pos + 1;
      function visit(node: (typeof tree.children)[number], classes: string[]) {
        if (node.type === "text") {
          const end = offset + node.value.length;
          if (classes.length && offset < end) result.push(Decoration.inline(offset, end, { class: classes.join(" ") }));
          offset = end;
        } else if (node.type === "element") {
          const ownClasses = node.properties?.className;
          const merged = Array.isArray(ownClasses) ? [...classes, ...ownClasses.map(String)] : classes;
          node.children.forEach(child => visit(child, merged));
        }
      }
      tree.children.forEach(child => visit(child, []));
    });
    return result;
  }

  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, { doc }) => DecorationSet.create(doc, highlightBetween(doc, 0, doc.content.size)),
      apply: (tr, decorations, oldState, newState) => {
        if (!tr.docChanged) return decorations;
        const before = oldState.doc;
        const after = newState.doc;
        const start = before.content.findDiffStart(after.content);
        // The loader may replace the document with identical content after
        // registering its grammars. Refresh existing tokens in that case.
        if (start === null) return DecorationSet.create(after, highlightBetween(after, 0, after.content.size));

        const end = before.content.findDiffEnd(after.content);
        // Include both sides of an edit boundary to cover joining or splitting blocks.
        const from = Math.max(0, start - 1);
        const oldEnd = Math.min(before.content.size, Math.max(start, end?.a ?? start) + 1);
        const newEnd = Math.min(after.content.size, Math.max(start, end?.b ?? start) + 1);
        const stale: Decoration[] = [];
        codeBlocksBetween(before, from, oldEnd, (block, pos) => {
          stale.push(...decorations.find(pos + 1, pos + block.nodeSize - 1));
        });

        const fresh = highlightBetween(after, from, newEnd);
        return decorations.remove(stale).map(tr.mapping, after).add(after, fresh);
      },
    },
    props: {
      decorations: state => key.getState(state),
    },
  });
}
