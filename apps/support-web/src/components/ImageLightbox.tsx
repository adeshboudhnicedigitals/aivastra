import { useEffect } from 'react';
import { isVideoUrl } from '../lib/media';

// Shared full-image popup used everywhere an admin-panel thumbnail is clicked,
// so images preview in place instead of navigating to a new tab. Also handles
// a catalog-video job's .mp4 output — same popup, a <video> instead of an
// <img> when the url is one.
export function ImageLightbox({
  url,
  images,
  index = 0,
  onIndexChange,
  onClose,
}: {
  url?: string;
  images?: { url: string; label: string }[];
  index?: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}) {
  const active = images?.[index];
  const activeUrl = active?.url ?? url ?? '';

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (!images || !onIndexChange || images.length < 2) return;
      if (e.key === 'ArrowLeft') onIndexChange((index + images.length - 1) % images.length);
      if (e.key === 'ArrowRight') onIndexChange((index + 1) % images.length);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [images, index, onIndexChange, onClose]);

  const video = isVideoUrl(activeUrl);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        cursor: video ? 'default' : 'zoom-out',
      }}
    >
      {video ? (
        <video
          src={activeUrl}
          controls
          autoPlay
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            borderRadius: 8,
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <track kind="captions" />
        </video>
      ) : (
        // biome-ignore lint/performance/noImgElement: admin panel
        <img
          src={activeUrl}
          alt={active?.label ?? 'preview'}
          decoding="async"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            borderRadius: 8,
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {images && images.length > 1 && onIndexChange && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + images.length - 1) % images.length);
            }}
            style={{ position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)' }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % images.length);
            }}
            style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)' }}
          >
            ›
          </button>
          <span style={{ position: 'absolute', bottom: 20, color: 'white', fontSize: 13 }}>
            {active?.label} · {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}
