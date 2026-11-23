// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { getExtensions } from "../extensions";

describe("table column resizing", () => {
  it("installs the resize plugin when the editor starts read-only and becomes editable", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({ element, extensions: getExtensions(), editable: false });
    editor.setEditable(true);
    expect(columnResizingPluginKey.getState(editor.state)).toBeDefined();
    editor.destroy();
    element.remove();
  });
});
