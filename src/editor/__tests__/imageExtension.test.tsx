// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ImageExtension } from "../ImageExtension";
import { ImageComponent, ImageFullscreenContext } from "../ImageComponent";
import { markdownToTipTapHtml } from "../markdownUtils";
import { noteContentToMarkdown } from "../../lib/utils";

import { ALL_COMMAND_ITEMS } from "../SlashCommand";
import { getExtensions } from "../extensions";

describe("ImageExtension and Resizable Image Support", () => {
  it("includes ImageExtension in the default getExtensions() bundle", () => {
    const extensions = getExtensions();
    const hasImage = extensions.some((ext: any) => ext.name === "image");
    expect(hasImage).toBe(true);
  });

  it("provides an /image command in SlashCommand menu items", () => {
    const imageCmd = ALL_COMMAND_ITEMS.find((item) => item.id === "image");
    expect(imageCmd).toBeDefined();
    expect(imageCmd?.aliases).toContain("screenshot");
    expect(imageCmd?.aliases).toContain("img");
  });
  it("registers image node and inserts an image with setImage command", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ImageExtension,
      ],
      content: "<p>Hello</p>",
    });

    expect(editor.schema.nodes.image).toBeDefined();

    editor.commands.setImage({
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      alt: "Pasted Screenshot",
      width: "50%",
      alignment: "center",
    });

    const json = editor.getJSON();
    const imageNode = json.content?.find((node) => node.type === "image");
    expect(imageNode).toBeDefined();
    expect(imageNode?.attrs?.src).toContain("data:image/png;base64,");
    expect(imageNode?.attrs?.alt).toBe("Pasted Screenshot");
    expect(imageNode?.attrs?.width).toBe("50%");
    expect(imageNode?.attrs?.alignment).toBe("center");
  });

  it("types after a selected image without replacing it", () => {
    const editor = new Editor({ extensions: [StarterKit, ImageExtension], content: '<img src="https://example.com/a.png"><p>After</p>' });
    editor.commands.setNodeSelection(0);
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, from, to, "X", () => editor.state.tr.insertText("X", from, to))
    );
    expect(handled).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe("image");
    expect(editor.state.doc.child(1).textContent).toBe("XAfter");
    editor.destroy();
  });

  it("updates image width and alignment attributes for resizing", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ImageExtension,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              src: "https://example.com/test.png",
              width: "100%",
              alignment: "center",
            },
          },
        ],
      },
    });

    const imgPos = 0; // block at root pos 0
    editor.commands.setNodeSelection(imgPos);
    editor.commands.updateAttributes("image", { width: "350px", alignment: "left" });

    const json = editor.getJSON();
    const img = json.content?.[0];
    expect(img?.attrs?.width).toBe("350px");
    expect(img?.attrs?.alignment).toBe("left");
  });

  it("roundtrips images through markdown conversion", () => {
    const originalDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Note with Image" }],
        },
        {
          type: "image",
          attrs: {
            src: "data:image/png;base64,sampleScreenshotData",
            alt: "Screenshot 2026",
          },
        },
      ],
    };

    const md = noteContentToMarkdown(JSON.stringify(originalDoc));
    expect(md).toContain("![Screenshot 2026](data:image/png;base64,sampleScreenshotData)");

    const html = markdownToTipTapHtml(md);
    expect(html).toContain("<img");
    expect(html).toContain('src="data:image/png;base64,sampleScreenshotData"');
  });

  it("parses image width style or attribute from HTML", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ImageExtension,
      ],
      content: '<p>Intro</p><img src="https://example.com/photo.jpg" alt="Photo" style="width: 450px;" data-alignment="right" />',
    });

    const json = editor.getJSON();
    const imageNode = json.content?.find((node) => node.type === "image");
    expect(imageNode).toBeDefined();
    expect(imageNode?.attrs?.src).toBe("https://example.com/photo.jpg");
    expect(imageNode?.attrs?.alt).toBe("Photo");
    expect(imageNode?.attrs?.width).toBe("450px");
    expect(imageNode?.attrs?.alignment).toBe("right");
  });

  it("handles image file paste and inserts an image node into document", async () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        ImageExtension,
      ],
      content: "<p>Note text</p>",
    });

    // Simulate pasting an image screenshot
    const fakeBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    
    // Call setImage directly as the paste handler does
    editor.chain().focus().setImage({
      src: fakeBase64,
      alt: "Screenshot 2026-11-16 at 21.00.png",
      width: "100%",
      alignment: "center",
    }).run();

    const json = editor.getJSON();
    const imageNode = json.content?.find((n) => n.type === "image");
    expect(imageNode).toBeDefined();
    expect(imageNode?.attrs?.src).toBe(fakeBase64);
    expect(imageNode?.attrs?.alt).toBe("Screenshot 2026-11-16 at 21.00.png");
    expect(imageNode?.attrs?.width).toBe("100%");
    expect(imageNode?.attrs?.alignment).toBe("center");
  });

  it("renders ImageComponent with resize handles and action buttons", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const node: any = {
      attrs: {
        src: "https://example.com/test.png",
        alt: "Screenshot 2026",
        width: "75%",
        alignment: "center",
      },
    };
    const updateAttributes = vi.fn();
    const deleteNode = vi.fn();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ImageFullscreenContext.Provider value={true}>
          <ImageComponent
            node={node}
            updateAttributes={updateAttributes}
            deleteNode={deleteNode}
            selected={true}
            editor={null as any}
            getPos={() => 0}
            decorations={[]}
            innerDecorations={[] as any}
            HTMLAttributes={{}}
            view={{} as any}
            extension={null as any}
          />
        </ImageFullscreenContext.Provider>
      );
    });

    const imgTag = host.querySelector("img");
    expect(imgTag).not.toBeNull();
    expect(imgTag?.getAttribute("src")).toBe("https://example.com/test.png");
    expect(imgTag?.getAttribute("alt")).toBe("Screenshot 2026");

    // Check that Notion-style Crop and action buttons are rendered
    const buttons = Array.from(host.querySelectorAll("button"));
    const cropBtn = buttons.find((b) => b.textContent?.includes("Crop"));
    expect(cropBtn).toBeDefined();
    expect(host.querySelectorAll('[title="Drag to resize image"]')).toHaveLength(2);

    const box = imgTag!.parentElement!;
    const imageBlock = box.parentElement!;
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="right"]')!;
    vi.spyOn(box, "offsetWidth", "get").mockReturnValue(300);
    vi.spyOn(imageBlock, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(box, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 600, 400));
    handle.setPointerCapture = vi.fn();
    const drag = (type: string, clientX: number) => act(() => {
      handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX }));
    });
    drag("pointerdown", 600);
    drag("pointermove", 640);
    expect(box.style.width).toBe("340px");
    expect(host.textContent).not.toContain("340 px");
    drag("pointerup", 640);
    expect(updateAttributes).toHaveBeenCalledWith({ width: "340px" });

    const cropAfterResize = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Crop"));

    // Verify Download button is NOT present in inline bar
    const inlineDownloadBtn = buttons.find((b) => b.getAttribute("title")?.includes("Download"));
    expect(inlineDownloadBtn).toBeUndefined();

    // Click Crop button to open Fullscreen Modal
    await act(async () => {
      cropAfterResize?.click();
    });

    // Check that the Crop Modal opened in portal and includes the Download button in full screen
    const modalDownloadBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Download")
    );
    expect(modalDownloadBtn).toBeDefined();

    act(() => root.unmount());
    host.remove();
  });

  it("renders only delete button on smaller image or small viewport", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const smallNode: any = {
      attrs: {
        src: "https://example.com/tiny.png",
        alt: "Tiny Image",
        width: "180px",
        alignment: "center",
      },
    };
    const updateAttributes = vi.fn();
    const deleteNode = vi.fn();

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <ImageComponent
          node={smallNode}
          updateAttributes={updateAttributes}
          deleteNode={deleteNode}
          selected={true}
          editor={null as any}
          getPos={() => 0}
          decorations={[]}
          innerDecorations={[] as any}
          HTMLAttributes={{}}
          view={{} as any}
          extension={null as any}
        />
      );
    });

    const buttons = Array.from(host.querySelectorAll("button"));
    // On small screen, ONLY the delete button is rendered
    expect(buttons.length).toBe(1);
    expect(host.querySelector('[title="Drag to resize image"]')).toBeNull();
    expect(buttons[0].getAttribute("title")).toBe("Delete image");

    // Crop button should not exist on small screen
    const cropBtn = buttons.find((b) => b.textContent?.includes("Crop"));
    expect(cropBtn).toBeUndefined();

    act(() => root.unmount());
    host.remove();
  });
});
