/**
 * DEV-only frame probe module for recording requestAnimationFrame intervals.
 * Completely eliminated from production bundles via dead-code elimination (import.meta.env.DEV).
 *
 * Usage in Web Inspector Console:
 *   window.__raynote_frame_probe.start()
 *   // ... perform typing / scrolling ...
 *   window.__raynote_frame_probe.stop()
 */

interface FrameProbeStats {
  totalFrames: number;
  p50_ms: number;
  p99_ms: number;
  max_ms: number;
  countOver33ms: number;
}

export function initFrameProbe() {
  if (import.meta.env.DEV) {
    let isRunning = false;
    let lastTimestamp = 0;
    let gaps: number[] = [];
    let countOver33ms = 0;
    let rafId: number | null = null;

    const tick = (timestamp: number) => {
      if (!isRunning) return;
      if (lastTimestamp > 0) {
        const delta = timestamp - lastTimestamp;
        gaps.push(delta);
        if (delta > 33.33) {
          countOver33ms++;
        }
      }
      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (isRunning) {
        console.warn("[FrameProbe] Already running.");
        return;
      }
      isRunning = true;
      lastTimestamp = 0;
      gaps = [];
      countOver33ms = 0;
      rafId = requestAnimationFrame(tick);
      console.log("[FrameProbe] Started recording requestAnimationFrame intervals...");
    };

    const stop = (): FrameProbeStats | null => {
      if (!isRunning) {
        console.warn("[FrameProbe] Not running.");
        return null;
      }
      isRunning = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (gaps.length === 0) {
        console.log("[FrameProbe] Stopped. No frames were recorded.");
        return null;
      }

      const sorted = [...gaps].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      const max = sorted[sorted.length - 1];

      const stats: FrameProbeStats = {
        totalFrames: gaps.length,
        p50_ms: Number(p50.toFixed(2)),
        p99_ms: Number(p99.toFixed(2)),
        max_ms: Number(max.toFixed(2)),
        countOver33ms,
      };

      console.table(stats);
      return stats;
    };

    (window as any).__raynote_frame_probe = {
      start,
      stop,
      getStats: () => {
        const sorted = [...gaps].sort((a, b) => a - b);
        return {
          totalFrames: sorted.length,
          p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
          p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
          countOver33ms,
        };
      },
    };
  }
}
