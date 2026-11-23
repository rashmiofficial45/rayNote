import { CodeBlock, type CodeBlockOptions } from "@tiptap/extension-code-block";
import type { createLowlight } from "lowlight";
import { incrementalCodeHighlight } from "./incrementalCodeHighlight";
import { DOMSerializer } from "@tiptap/pm/model";
import { copyToClipboard } from "../lib/clipboard";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { isMermaidLanguage, mountMermaidPreview } from "./mermaidPreview";

const icons = {
  edit: "M12 20h9 M16 4l4 4 M4 16 16 4a2.8 2.8 0 0 1 4 4L8 20l-5 1z",
  preview: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  copy: "M9 9h11v12H9z M15 6V3H4v12h2",
  delete: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
};

function setAction(button: HTMLButtonElement, label: string, icon: keyof typeof icons) {
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS(svg.namespaceURI, "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  path.setAttribute("d", icons[icon]);
  svg.append(path);
  button.replaceChildren(svg);
}

function actionButton(label: string, icon: keyof typeof icons) {
  const button = document.createElement("button");
  button.type = "button";
  setAction(button, label, icon);
  return button;
}

export const MermaidCodeBlock = CodeBlock.extend<CodeBlockOptions & { lowlight: ReturnType<typeof createLowlight> }>({
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      incrementalCodeHighlight(this.name, this.options.lowlight, this.options.defaultLanguage),
    ];
  },

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
      controls.className = "image-action-glass mermaid-controls";
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Mermaid diagram actions");
      controls.contentEditable = "false";
      const toggle = actionButton("Edit Mermaid code", "edit");
      const copy = actionButton("Copy Mermaid code", "copy");
      const remove = actionButton("Delete Mermaid diagram", "delete");
      remove.className = "image-delete-action";
      const status = document.createElement("span");
      status.className = "sr-only";
      status.setAttribute("role", "status");
      controls.append(toggle, copy, remove, status);
      const preview = document.createElement("div");
      preview.contentEditable = "false";
      dom.append(controls, preview, pre);

      const sourceBlock = pre as HTMLElement;
      let source = node.textContent;
      let editing = !source.trim() && editor.isEditable;
      let unmountPreview: (() => void) | undefined;

      const syncView = () => {
        sourceBlock.hidden = !editing;
        dom.classList.toggle("mermaid-editing", editing);
        preview.hidden = editing;
        toggle.setAttribute("aria-expanded", String(editing));
        setAction(toggle, editing ? "Show diagram" : "Edit Mermaid code", editing ? "preview" : "edit");
        unmountPreview?.();
        unmountPreview = editing ? undefined : mountMermaidPreview(preview, source);
      };

      const selectPreview = (position: number) => {
        const { view } = editor;
        const { state } = view;
        view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, position)));
        view.focus();
      };

      // Keep pointer actions from focusing a button before the editor selection is updated.
      controls.onmousedown = event => {
        if (event.button === 0) event.preventDefault();
      };

      toggle.onclick = () => {
        const position = getPos();
        if (!editor.isEditable || typeof position !== "number") return;
        editing = !editing;
        syncView();
        if (editing) {
          const { view } = editor;
          const { state } = view;
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, position + 1)));
          view.focus();
        } else {
          selectPreview(position);
        }
      };

      copy.onclick = async () => {
        status.textContent = "";
        const copied = await copyToClipboard(source);
        status.textContent = copied ? "Mermaid code copied" : "Could not copy Mermaid code";
        copy.dataset.copyResult = copied ? "copied" : "failed";
      };
      copy.onblur = () => { delete copy.dataset.copyResult; };

      remove.onclick = event => {
        // Deletion detaches the toolbar during the click. Keep the event from
        // reaching the note's background handler, which would focus the end.
        event.stopPropagation();
        const position = getPos();
        if (!editor.isEditable || typeof position !== "number") return;
        const current = editor.state.doc.nodeAt(position);
        if (current?.type === node.type && isMermaidLanguage(current.attrs.language)) {
          const { view } = editor;
          const tr = view.state.tr.delete(position, position + current.nodeSize);
          tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(position))));
          view.dispatch(tr);
          view.focus();
        }
      };

      preview.onclick = event => {
        if (!editor.isEditable || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        const position = getPos();
        if (typeof position !== "number") return;
        selectPreview(position);
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
