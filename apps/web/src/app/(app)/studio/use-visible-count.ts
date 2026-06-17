import { useCallback, useRef, useState } from 'react';

export function useVisibleCount(cardWidth: number, gap: number) {
  const [visibleCount, setVisibleCount] = useState(6);
  const roRef = useRef<ResizeObserver | null>(null);
  const rowRef = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        const w = entry?.contentRect.width ?? 0;
        const count = Math.max(1, Math.floor((w + gap) / (cardWidth + gap)));
        setVisibleCount(count);
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [cardWidth, gap],
  );
  return { visibleCount, rowRef };
}
