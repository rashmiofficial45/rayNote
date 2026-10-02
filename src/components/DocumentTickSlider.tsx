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

  // Responsive detection: do not show on very small window sizes
  useEffect(() => {
    const handleResize = () => {
      setIsCompact(window.innerWidth < 520 || window.innerHeight < 320);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Update scroll metrics and progress
  const updateScrollProgress = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const maxScroll = scrollHeight - clientHeight;
    const scrollable = maxScroll > 20;
    setIsScrollable(scrollable);

    if (maxScroll > 0) {
      const progress = Math.max(0, Math.min(1, scrollTop / maxScroll));
      setScrollProgress(progress);
    } else {
      setScrollProgress(0);
    }

    if (trackRef.current) {
      const h = trackRef.current.clientHeight;
      if (h > 0 && h !== trackHeight) {
        setTrackHeight(h);
      }
    }
  }, [scrollContainerRef, trackHeight]);

  // Scroll and Resize listeners on container
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

    // Periodic check or ResizeObserver to detect content length changes
    const observer = new ResizeObserver(() => {
      updateScrollProgress();
    });
    observer.observe(container);

    // Initial measurement
    updateScrollProgress();

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [scrollContainerRef, updateScrollProgress]);

  // Generate organic tick lines matching document rhythm (varying widths like code/text minimap)
  const ticks = useMemo(() => {
    const count = Math.min(38, Math.max(16, Math.floor(trackHeight / 14)));
    const list: { id: number; width: number; isMajor: boolean }[] = [];

    for (let i = 0; i < count; i++) {
      // Subtle variations in width (like headings, body lines, and breaks in screenshot)
      let w = 11;
      let isMajor = false;
      if (i % 6 === 0) {
        w = 16;
        isMajor = true;
      } else if (i % 3 === 0) {
        w = 13;
      } else if (i % 5 === 0) {
        w = 8;
      }
      list.push({ id: i, width: w, isMajor });
    }
    return list;
  }, [trackHeight]);

  // Handle direct click or drag on the slider track
  const scrollToClientY = useCallback(
    (clientY: number, smooth: boolean = false) => {
      const container = scrollContainerRef.current;
      const track = trackRef.current;
      if (!container || !track) return;

      const rect = track.getBoundingClientRect();
      if (rect.height <= 0) return;

      const relativeY = clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, relativeY / rect.height));
      const maxScroll = container.scrollHeight - container.clientHeight;

      if (smooth) {
        container.scrollTo({
          top: ratio * maxScroll,
          behavior: "smooth",
        });
      } else {
        container.scrollTop = ratio * maxScroll;
      }
    },
    [scrollContainerRef]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollToClientY(e.clientY, false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    scrollToClientY(e.clientY, false);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture already released
      }
    }
  };

  // Do not render on small windows or when not scrollable
  if (isCompact || !isScrollable) {
    return null;
  }

  // Thumb vertical position calculation
  const indicatorHeight = 3;
  const thumbTranslateY = scrollProgress * (trackHeight - indicatorHeight);

  return (
    <div
      className={`doc-tick-slider-wrapper ${isDragging ? "is-dragging" : ""} ${className}`}
      title="Scroll indicator (drag or click to navigate)"
    >
      <div
        ref={trackRef}
        className="doc-tick-slider-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Ticks column */}
        <div className="doc-tick-column">
          {ticks.map((tick) => (
            <div
              key={tick.id}
              className={`doc-tick-item ${tick.isMajor ? "is-major" : ""}`}
              style={{ width: `${tick.width}px` }}
            />
          ))}
        </div>

        {/* Smooth gliding active thumb indicator */}
        <div
          className="doc-tick-thumb"
          style={{
            transform: `translate3d(0, ${thumbTranslateY}px, 0)`,
          }}
        />
      </div>
    </div>
  );
}
