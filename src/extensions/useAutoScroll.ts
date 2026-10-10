export interface AutoScrollConfig {
  zoneSize?: number; // default 60px
  maxSpeed?: number; // default 18px/frame
}

/**
 * Calculates auto-scroll speed based on pointer proximity to container edges.
 * Uses a quadratic ease: speed = maxSpeed * (depth / zoneSize)^2.
 * Respects top boundary (scrollTop = 0) and bottom boundary (scrollHeight).
 */
export function calculateAutoScrollSpeed(
  clientY: number,
  container: HTMLElement,
  config: AutoScrollConfig = {}
): number {
  const zoneSize = config.zoneSize ?? 60;
  const maxSpeed = config.maxSpeed ?? 18;

  const rect = container.getBoundingClientRect();
  const topEdge = rect.top + zoneSize;
  const bottomEdge = rect.bottom - zoneSize;

  // Top zone (scrolling upwards)
  if (clientY < topEdge) {
    // If already at or past the top, cannot scroll up further
    if (container.scrollTop <= 0) {
      return 0;
    }
    const depth = topEdge - clientY;
    const ratio = Math.min(1, Math.max(0, depth / zoneSize));
    const eased = ratio * ratio; // quadratic ease
    return -Math.max(1, Math.round(maxSpeed * eased));
  }

  // Bottom zone (scrolling downwards)
  if (clientY > bottomEdge) {
    const maxScroll = container.scrollHeight - container.clientHeight;
    // If already at or past the bottom, cannot scroll down further
    if (container.scrollTop >= maxScroll) {
      return 0;
    }
    const depth = clientY - bottomEdge;
    const ratio = Math.min(1, Math.max(0, depth / zoneSize));
    const eased = ratio * ratio; // quadratic ease
    return Math.max(1, Math.round(maxSpeed * eased));
  }

  return 0;
}
