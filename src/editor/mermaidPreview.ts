export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.trim().toLowerCase() === "mermaid";
}

let nextDiagramId = 0;
const renderedDiagrams = new Map<string, { svg: string }>();
const pendingDiagrams = new Map<string, Promise<{ svg: string }>>();
const maxCachedDiagrams = 32;
const maxCachedSvgLength = 256_000;

function getDiagram(source: string, dark: boolean) {
  const key = (dark ? "dark:" : "light:") + source;
  const cached = renderedDiagrams.get(key);
  if (cached) {
    renderedDiagrams.delete(key);
    renderedDiagrams.set(key, cached);
    return cached;
  }

  const pending = pendingDiagrams.get(key);
  if (pending) return pending;
  const render = renderMermaid(source, dark).then(({ svg }) => {
    const diagram = { svg };
    if (svg.length <= maxCachedSvgLength) {
      if (renderedDiagrams.size >= maxCachedDiagrams) {
        const oldest = renderedDiagrams.keys().next().value;
        if (oldest !== undefined) renderedDiagrams.delete(oldest);
      }
      renderedDiagrams.set(key, diagram);
    }
    return diagram;
  }).finally(() => pendingDiagrams.delete(key));
  pendingDiagrams.set(key, render);
  return render;
}

export function mountMermaidPreview(container: HTMLElement, source: string): () => void {
  container.classList.add("mermaid-preview");
  const status = document.createElement("span");
  status.className = "mermaid-preview-status";
  status.setAttribute("role", "status");
  if (!container.firstElementChild) container.replaceChildren(status);

  let revision = 0;
  const render = async () => {
    const current = ++revision;
    if (!source.trim()) {
      status.textContent = "Empty Mermaid diagram.";
      container.replaceChildren(status);
      return;
    }

    status.textContent = "Rendering diagram…";
    // Keep the existing diagram sized while a theme or source refresh is pending.
    try {
      const rendered = getDiagram(source, document.documentElement.dataset.resolvedTheme === "dark");
      const { svg } = rendered instanceof Promise ? await rendered : rendered;
      if (current !== revision) return;

      const diagram = document.createElement("div");
      diagram.className = "mermaid-diagram";
      diagram.setAttribute("role", "img");
      const svgRoot = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      const [, , width, height] = (svgRoot.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number);
      const hasSize = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
      diagram.style.width = hasSize ? `${Math.ceil(width)}px` : "100%";
      diagram.style.aspectRatio = hasSize ? `${width} / ${height}` : "2 / 1";
      diagram.setAttribute("aria-label", svgRoot.querySelector("title")?.textContent?.trim() || "Mermaid diagram");
      // Keep SVG in image mode and avoid WebKit's Live Text overlay on <img> elements.
      diagram.style.backgroundImage = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
      container.replaceChildren(diagram);
    } catch {
      if (current === revision) {
        status.textContent = "Could not render this Mermaid diagram. Check its syntax.";
        container.replaceChildren(status);
      }
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

// Mermaid configuration is shared across render calls. Apply each theme and
// finish its render before switching configuration for another diagram.
let renderQueue: Promise<unknown> = Promise.resolve();
function renderMermaid(source: string, dark: boolean) {
  const render = renderQueue.then(async () => {
    // Yield between uncached diagrams so a long note doesn't monopolize the UI.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const { default: mermaid } = await import("mermaid");
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
    const scratch = document.createElement("div");
    scratch.style.cssText = "position:fixed;inset:0 auto auto 0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
    scratch.setAttribute("aria-hidden", "true");
    document.body.append(scratch);
    try {
      return await mermaid.render(`raynote-mermaid-${++nextDiagramId}`, source, scratch);
    } finally {
      scratch.remove();
    }
  });
  renderQueue = render.catch(() => {});
  return render;
}
