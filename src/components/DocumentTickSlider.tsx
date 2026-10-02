import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

interface DocumentTickSliderProps {
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  className?: string;
}

export function DocumentTickSlider({
  scrollContainerRef,
  className = "",
}: DocumentTickSliderProps) {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrollable, setIsScrollable] = useState(false);
  const [isCompact, setIsCompact] = useState(() => {
    return typeof window !== "undefined" ? window.innerWidth < 520 : false;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [trackHeight, setTrackHeight] = useState(300);

  const trackRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);
  const dragRafId = useRef<number | null>(null);

  // Responsive: hide on compact / narrow window size (< 520px)
  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 520 || window.innerHeight < 320);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Update scroll metrics and progress (0.0 to 1.0)
  const updateScrollProgress = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const maxScroll = scrollHeight - clientHeight;
    const scrollable = maxScroll > 25;
    setIsScrollable(scrollable);

    if (maxScroll > 0) {
      const progress = Math.max(0, Math.min(1, scrollTop / maxScroll));
      setScrollProgress(progress);
    } else {
      setScrollProgress(0);
    }

    if (trackRef.current) {
      const h = trackRef.current.clientHeight;
      if (h > 0 && Math.abs(h - trackHeight) > 4) {
        setTrackHeight(h);
      }
    }
  }, [scrollContainerRef, trackHeight]);

  // Attach scroll & resize observers
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        updateScrollProgress();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      updateScrollProgress();
    });
    observer.observe(container);

    updateScrollProgress();

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [scrollContainerRef, updateScrollProgress]);

  // Generate discrete tick marks representing sections / parts of the document with big and small bars
  const ticks = useMemo(() => {
    const count = Math.min(36, Math.max(16, Math.floor(trackHeight / 14)));
    return Array.from({ length: count }, (_, id) => {
      // Big and small bar pattern matching the document spine in screenshot
      const isBig = id === 0 || id === 2 || (id > 2 && (id % 7 === 0 || id % 11 === 0));
      return { id, isBig };
    });
  }, [trackHeight]);

  // Determine which discrete tick part is currently active / crossed
  const activeIndex = useMemo(() => {
    if (ticks.length === 0) return 0;
    return Math.min(ticks.length - 1, Math.max(0, Math.round(scrollProgress * (ticks.length - 1))));
  }, [scrollProgress, ticks.length]);

  // Smoothly scroll to a specific tick part or ratio
  const scrollToRatio = useCallback(
    (ratio: number, smooth: boolean = false) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const maxScroll = container.scrollHeight - container.clientHeight;
      const targetY = clampedRatio * maxScroll;

      if (smooth) {
        container.scrollTo({
          top: targetY,
          behavior: "smooth",
        });
      } else {
        container.scrollTop = targetY;
      }
    },
    [scrollContainerRef]
  );

  const getRatioFromClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const relativeY = clientY - rect.top;
    return Math.max(0, Math.min(1, relativeY / rect.height));
  }, []);

  // Pointer drag directly on the right bars
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);

    const ratio = getRatioFromClientY(e.clientY);
    scrollToRatio(ratio, false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();

    if (dragRafId.current) cancelAnimationFrame(dragRafId.current);
    const clientY = e.clientY;
    dragRafId.current = requestAnimationFrame(() => {
      const ratio = getRatioFromClientY(clientY);
      scrollToRatio(ratio, false);
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      if (dragRafId.current) cancelAnimationFrame(dragRafId.current);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Safe release
      }
    }
  };

  // Clicking an individual bar smoothly scrolls to that part
  const handleTickClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (ticks.length <= 1) return;
    const ratio = index / (ticks.length - 1);
    scrollToRatio(ratio, true);
  };

  // Do not render on compact window or when not scrollable
  if (isCompact || !isScrollable) {
    return null;
  }

  return (
    <div
      className={`doc-tick-slider-wrapper ${isDragging ? "is-dragging" : ""} ${className}`}
      title="Document parts indicator (drag or click bars to scroll)"
    >
      <div
        ref={trackRef}
        className="doc-tick-slider-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="doc-tick-column">
          {ticks.map((tick, index) => {
            const isActive = index === activeIndex;
            const isCrossed = index <= activeIndex;

            return (
              <div
                key={tick.id}
                onClick={(e) => handleTickClick(index, e)}
                className={`doc-tick-item ${tick.isBig ? "is-big" : "is-small"} ${
                  isActive ? "is-active" : ""
                } ${isCrossed ? "is-crossed" : ""}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
