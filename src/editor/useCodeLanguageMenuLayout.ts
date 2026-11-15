import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

interface CodeLanguageMenuLayout {
  upward: boolean;
  style: CSSProperties;
}

export function useCodeLanguageMenuLayout(open: boolean, anchorRef: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState<CodeLanguageMenuLayout>();

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;

    const updateLayout = (event?: Event) => {
      if (event?.type === "scroll" && event.target instanceof Element && !event.target.contains(anchor)) return;

      const rect = anchor.getBoundingClientRect();
      const zoom = (rect.width / anchor.offsetWidth) || 1;
      const gap = 8;
      const width = Math.min(216, (window.innerWidth - 2 * gap) / zoom);
      const rightEdge = Math.min(window.innerWidth - gap, Math.max(rect.right, width * zoom + gap));
      const above = rect.top - gap - 6 * zoom;
      const below = window.innerHeight - rect.bottom - gap - 4 * zoom;
      const upward = below < 220 * zoom && above > below;
      const maxHeight = Math.max(0, (upward ? above : below) / zoom);
      const right = (rect.right - rightEdge) / zoom;

      setLayout((previous) => {
        if (previous?.upward === upward && previous.style.width === width &&
            previous.style.maxHeight === maxHeight && previous.style.right === right) return previous;
        return { upward, style: { width, maxHeight, right } };
      });
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    return () => {
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [open, anchorRef]);

  return layout;
}
