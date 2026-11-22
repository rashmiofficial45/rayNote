import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { DOMSerializer } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { isMermaidLanguage, mountMermaidPreview } from "./mermaidPreview";

export const MermaidCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      // Keep the existing markup and update behavior for regular code blocks.
      const { dom: pre, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));
      if (!isMermaidLanguage(node.attrs.language)) {
        return {
          dom: pre, contentDOM,
          update: next => !isMermaidLanguage(next.attrs.language) && next.sameMarkup(node),
        };
      }

      const dom = document.createElement("div");
      dom.className = "mermaid-block";
      const controls = document.createElement("div");
      controls.className = "mermaid-controls";
      controls.contentEditable = "false";
      const toggle = document.createElement("button");
      toggle.type = "button";
      controls.append(toggle);
      const preview = document.createElement("div");
      preview.contentEditable = "false";
      dom.append(controls, preview, pre);

      const sourceBlock = pre as HTMLElement;
      let source = node.textContent;
      let editing = !source.trim() && editor.isEditable;
      let unmountPreview: (() => void) | undefined;

      const syncView = () => {
        sourceBlock.hidden = !editing;
        controls.hidden = !editor.isEditable;
        preview.hidden = editing;
        toggle.setAttribute("aria-expanded", String(editing));
        toggle.textContent = editing ? "Show diagram" : "Edit Mermaid";
        unmountPreview?.();
        unmountPreview = editing ? undefined : mountMermaidPreview(preview, source);
      };

      toggle.onclick = () => {
        editing = !editing;
        syncView();
        const position = getPos();
        if (editing && typeof position === "number") editor.commands.focus(position + 1);
        else toggle.focus();
      };

      preview.onclick = event => {
        if (!editor.isEditable || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
        const position = getPos();
        if (typeof position !== "number") return;
        const { view } = editor;
        view.focus();
        const { state } = view;
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, position)));
      };

      syncView();
      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type !== node.type || !isMermaidLanguage(next.attrs.language)) return false;
          if (source !== next.textContent) {
            source = next.textContent;
            if (!editing) syncView();
          }
          return true;
        },
        stopEvent: event => controls.contains(event.target as Node),
        ignoreMutation: mutation => mutation.type !== "selection" && !contentDOM?.contains(mutation.target),
        destroy: () => unmountPreview?.(),
      };
    };
  },
});
