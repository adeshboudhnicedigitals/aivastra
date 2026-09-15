import { useEffect } from 'react';

// Shared full-image popup used everywhere an admin-panel thumbnail is clicked,
// so images preview in place instead of navigating to a new tab.
export function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
        cursor: 'zoom-out',
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: admin panel */}
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
    </div>
  );
}
