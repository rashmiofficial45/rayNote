export function nextMenuIndex(index: number, count: number, direction: -1 | 1, repeat: boolean): number {
  if (count === 0) return index;
  const next = index < 0 ? (direction === 1 ? 0 : count - 1) : index + direction;
  if (next >= 0 && next < count) return next;
  if (repeat) return direction === 1 ? count - 1 : 0;
  return direction === 1 ? 0 : count - 1;
}

export function revealMenuItem(list: HTMLElement, item: HTMLElement | undefined | null): void {
  if (!item) return;

  const { top } = list.getBoundingClientRect();
  const row = item.getBoundingClientRect();
  const viewportTop = top + list.clientTop;
  const viewportBottom = viewportTop + list.clientHeight;

  if (row.top < viewportTop) {
    list.scrollTop += row.top - viewportTop;
  } else if (row.bottom > viewportBottom) {
    list.scrollTop += row.bottom - viewportBottom;
  }
}
