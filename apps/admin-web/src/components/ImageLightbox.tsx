import { useEffect } from 'react';
import { isVideoUrl } from '../lib/media';

// Shared full-image popup used everywhere an admin-panel thumbnail is clicked,
// so images preview in place instead of navigating to a new tab. Also handles
// a catalog-video job's .mp4 output — same popup, a <video> instead of an
// <img> when the url is one.
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const video = isVideoUrl(url);

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
          src={url}
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
          src={url}
          alt="preview"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            borderRadius: 8,
            boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
