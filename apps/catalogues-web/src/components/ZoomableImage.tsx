'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { C } from '@/components/tokens';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_CLICK_SCALE = 2.5;
// Exponential wheel-to-scale mapping so zoom feels consistent regardless of deltaY
// magnitude across trackpads/mice (linear mapping over/under-shoots on fast wheels).
const WHEEL_ZOOM_SPEED = 0.0016;

interface Point {
  x: number;
  y: number;
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Distance between the two active touch points — callers only invoke this once size===2 is confirmed. */
const pinchDistance = (pointers: Map<number, Point>): number => {
  const [a, b] = [...pointers.values()] as [Point, Point];
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/**
 * Fullscreen-lightbox image with scroll/pinch/button zoom and drag-to-pan once
 * zoomed. Used inside the existing "Image preview" dialogs in studio, the
 * catalog detail page, and my-products — those own the dialog chrome (backdrop,
 * close button, entrance animation trigger via `visible`, footer actions); this
 * owns only the image + its zoom/pan interaction and the floating zoom controls.
 *
 * Callers previously rendered a plain <img> with pointerEvents:'none' so any
 * click anywhere (including on the image) closed the dialog. That's
 * incompatible with wheel/drag interaction, so this component stops click
 * propagation on the image itself — closing now happens via the backdrop, the
 * X button, or Escape, same as any standard image lightbox.
 */
export function ZoomableImage({
  src,
  alt = '',
  visible,
  variant = 'scale',
}: {
  src: string;
  alt?: string;
  /** Drives the entrance transition, same trigger the callers already use. */
  visible: boolean;
  /** 'scale' fades+scales in (studio); 'slide' slides in from the right (catalog/my-products). */
  variant?: 'scale' | 'slide';
}) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: Point; origin: Point } | null>(null);
  // Active pointers for pinch-to-zoom, keyed by pointerId.
  const pinchPointers = useRef<Map<number, Point>>(new Map());
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const [dragging, setDragging] = useState(false);

  // A new image (regenerate producing a fresh zoomUrl) or a fresh mount should
  // always start at fit-to-screen, never carry over the previous image's zoom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-runs only on src, not on scale/pan setters
  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setScale((prev) => {
      const next = clampScale(prev * factor);
      if (next === prev) return prev;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && clientX !== undefined && clientY !== undefined) {
        // Keep the point under the cursor/pinch-midpoint stationary while scaling,
        // rather than always zooming toward the image's center.
        const originX = clientX - rect.left - rect.width / 2;
        const originY = clientY - rect.top - rect.height / 2;
        setPan((p) => ({
          x: p.x - originX * (next / prev - 1),
          y: p.y - originY * (next / prev - 1),
        }));
      }
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Keyboard zoom while this image is the one showing — mirrors the +/-/0
  // convention of image viewers and maps apps.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomAt(1.3);
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.3);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomAt, reset]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
    zoomAt(factor, e.clientX, e.clientY);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) reset();
    else zoomAt(DOUBLE_CLICK_SCALE, e.clientX, e.clientY);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pinchPointers.current.size === 2) {
      pinchStartDist.current = pinchDistance(pinchPointers.current);
      pinchStartScale.current = scale;
      dragRef.current = null;
    } else if (scale > 1) {
      dragRef.current = { start: { x: e.clientX, y: e.clientY }, origin: pan };
      setDragging(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pinchPointers.current.has(e.pointerId)) {
      pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchPointers.current.size === 2) {
      e.stopPropagation();
      const dist = pinchDistance(pinchPointers.current);
      if (pinchStartDist.current > 0) {
        const next = clampScale(pinchStartScale.current * (dist / pinchStartDist.current));
        setScale(next);
        if (next === 1) setPan({ x: 0, y: 0 });
      }
      return;
    }
    if (!dragRef.current) return;
    e.stopPropagation();
    setPan({
      x: dragRef.current.origin.x + (e.clientX - dragRef.current.start.x),
      y: dragRef.current.origin.y + (e.clientY - dragRef.current.start.y),
    });
  };

  const endPointer = (e: React.PointerEvent) => {
    pinchPointers.current.delete(e.pointerId);
    if (pinchPointers.current.size < 2) pinchStartDist.current = 0;
    dragRef.current = null;
    setDragging(false);
  };

  const entranceTransform =
    variant === 'scale'
      ? visible
        ? 'scale(1)'
        : 'scale(0.95)'
      : visible
        ? 'translateX(0)'
        : 'translateX(100%)';

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop click-through and hosts wheel/pointer zoom-pan; keyboard users get the same zoom via the global +/-/0 listener above */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops the backdrop click from bubbling, not a real click action */}
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          overflow: 'hidden',
          transform: entranceTransform,
          opacity: variant === 'scale' ? (visible ? 1 : 0) : 1,
          transition: 'transform 300ms ease-out, opacity 300ms ease-out',
          touchAction: 'none',
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* biome-ignore lint/performance/noImgElement: presigned R2 URL, Next/Image incompatible */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            borderRadius: 8,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition:
              dragRef.current || pinchPointers.current.size > 0
                ? 'none'
                : 'transform 150ms ease-out',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
        />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop click-through, not itself interactive content — the buttons inside carry the actual interactivity */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops the backdrop click from bubbling, not a real click action */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          zIndex: 1001,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(0,0,0,0.55)',
          border: `1px solid ${C.border}`,
          borderRadius: 999,
          padding: 4,
          opacity: visible ? 1 : 0,
          transition: 'opacity 300ms ease-out',
        }}
      >
        <ZoomControlButton
          label="Zoom out"
          onClick={() => zoomAt(1 / 1.3)}
          disabled={scale <= MIN_SCALE}
        >
          −
        </ZoomControlButton>
        <span
          style={{
            minWidth: 44,
            textAlign: 'center',
            fontSize: 12,
            color: C.white,
            userSelect: 'none',
          }}
        >
          {Math.round(scale * 100)}%
        </span>
        <ZoomControlButton
          label="Zoom in"
          onClick={() => zoomAt(1.3)}
          disabled={scale >= MAX_SCALE}
        >
          +
        </ZoomControlButton>
        {scale > 1 && (
          <ZoomControlButton label="Reset zoom" onClick={reset}>
            ⤾
          </ZoomControlButton>
        )}
      </div>
    </>
  );
}

function ZoomControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        color: disabled ? 'rgba(255,255,255,0.35)' : C.white,
        fontSize: 18,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}
