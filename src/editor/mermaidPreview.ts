export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.trim().toLowerCase() === "mermaid";
}

let nextDiagramId = 0;
const renderedDiagrams = new Map<string, { svg: string }>();
interface PendingDiagram {
  consumers: number;
  controller: AbortController;
  result: Promise<{ svg: string }>;
}
const pendingDiagrams = new Map<string, PendingDiagram>();
const maxCachedDiagrams = 32;
const maxCachedSvgLength = 256_000;

function getDiagram(source: string, dark: boolean) {
  const key = (dark ? "dark:" : "light:") + source;
  const cached = renderedDiagrams.get(key);
  if (cached) {
    renderedDiagrams.delete(key);
    renderedDiagrams.set(key, cached);
    return { result: cached };
  }

  let pending = pendingDiagrams.get(key);
  if (!pending) {
    const controller = new AbortController();
    const result = renderMermaid(source, dark, controller.signal).then(({ svg }) => {
      const diagram = { svg };
      if (svg.length <= maxCachedSvgLength) {
        if (renderedDiagrams.size >= maxCachedDiagrams) {
          const oldest = renderedDiagrams.keys().next().value;
          if (oldest !== undefined) renderedDiagrams.delete(oldest);
        }
        renderedDiagrams.set(key, diagram);
      }
      return diagram;
    }).finally(() => {
      // A new preview may have replaced this canceled entry.
      if (pendingDiagrams.get(key)?.controller === controller) pendingDiagrams.delete(key);
    });
    pending = { consumers: 0, controller, result };
    pendingDiagrams.set(key, pending);
  }

  const job = pending;
  job.consumers++;
  return {
    result: job.result,
    release: () => {
      if (--job.consumers === 0 && pendingDiagrams.get(key) === job) {
        pendingDiagrams.delete(key);
        job.controller.abort();
      }
    },
  };
}

export function mountMermaidPreview(container: HTMLElement, source: string): () => void {
  container.classList.add("mermaid-preview");
  const status = document.createElement("span");
  status.className = "mermaid-preview-status";
  status.setAttribute("role", "status");
  if (!container.firstElementChild) container.replaceChildren(status);

  let revision = 0;
  let releaseRender: (() => void) | undefined;
  const render = async () => {
    const current = ++revision;
    releaseRender?.();
    releaseRender = undefined;
    if (!source.trim()) {
      status.textContent = "Empty Mermaid diagram.";
      container.replaceChildren(status);
      return;
    }

    status.textContent = "Rendering diagram…";
    // Keep the existing diagram sized while a theme or source refresh is pending.
    try {
      const { result, release } = getDiagram(source, document.documentElement.dataset.resolvedTheme === "dark");
      releaseRender = release;
      const { svg } = result instanceof Promise ? await result : result;
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

  let dark = document.documentElement.dataset.resolvedTheme === "dark";
  const theme = new MutationObserver(() => {
    const nextDark = document.documentElement.dataset.resolvedTheme === "dark";
    if (nextDark === dark) return;
    dark = nextDark;
    void render();
  });
  theme.observe(document.documentElement, { attributeFilter: ["data-resolved-theme"] });
  void render();
  return () => {
    revision++;
    releaseRender?.();
    releaseRender = undefined;
    theme.disconnect();
  };
}

// Mermaid configuration is shared across render calls. Apply each theme and
// finish its render before switching configuration for another diagram.
let renderQueue: Promise<unknown> = Promise.resolve();
function renderMermaid(source: string, dark: boolean, signal: AbortSignal) {
  const render = renderQueue.then(async () => {
    if (signal.aborted) throw new DOMException("Diagram preview closed", "AbortError");
    // Yield between uncached diagrams so a long note doesn't monopolize the UI.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (signal.aborted) throw new DOMException("Diagram preview closed", "AbortError");
    const { default: mermaid } = await import("mermaid");
    if (signal.aborted) throw new DOMException("Diagram preview closed", "AbortError");
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
