export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.trim().toLowerCase() === "mermaid";
}

let nextDiagramId = 0;

export function mountMermaidPreview(container: HTMLElement, source: string): () => void {
  container.classList.add("mermaid-preview");
  const status = document.createElement("span");
  status.className = "mermaid-preview-status";
  status.setAttribute("role", "status");
  container.replaceChildren(status);

  let revision = 0;
  const render = async () => {
    const current = ++revision;
    if (!source.trim()) {
      status.textContent = "Empty Mermaid diagram.";
      return;
    }

    status.textContent = "Rendering diagram…";
    container.replaceChildren(status);
    try {
      const { default: mermaid } = await import("mermaid");
      if (current !== revision) return;
      const { svg } = await renderMermaid(
        mermaid,
        source,
        document.documentElement.dataset.resolvedTheme === "dark"
      );
      if (current !== revision) return;

      const diagram = document.createElement("img");
      diagram.draggable = false;
      const svgRoot = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      const [, , width, height] = (svgRoot.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number);
      if (width > 0 && height > 0) {
        diagram.width = Math.ceil(width);
        diagram.height = Math.ceil(height);
      }
      diagram.alt = svgRoot.querySelector("title")?.textContent?.trim() || "Mermaid diagram";
      // Use SVG as an image so diagram links, scripts and external resources stay inactive.
      diagram.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      container.replaceChildren(diagram);
    } catch {
      if (current === revision) status.textContent = "Could not render this Mermaid diagram. Check its syntax.";
    }
  };

  const theme = new MutationObserver(() => void render());
  theme.observe(document.documentElement, { attributeFilter: ["data-resolved-theme"] });
  void render();
  return () => {
    revision++;
    theme.disconnect();
  };
}

type Mermaid = typeof import("mermaid").default;

// Mermaid configuration is shared across render calls. Apply each theme and
// finish its render before switching configuration for another diagram.
let renderQueue: Promise<unknown> = Promise.resolve();
function renderMermaid(mermaid: Mermaid, source: string, dark: boolean) {
  const render = renderQueue.then(() => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      theme: dark ? "dark" : "default",
      secure: [
        "secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges",
        "suppressErrorRendering", "dompurifyConfig", "themeCSS", "htmlLabels",
      ],
    });
    return mermaid.render(`raynote-mermaid-${++nextDiagramId}`, source);
  });
  renderQueue = render.catch(() => {});
  return render;
}
