'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useState } from 'react';

import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import { type CatalogueResponse, JobThumbnail } from './JobThumbnail';

// Page size for this picker — both the initial render and each "Load more"
// click reveal this many additional images. Keeping this small (rather than
// rendering every job up front) is what bounds the thumbnail-fetch burst;
// see JobThumbnail's useInView comment for why bounding the burst matters.
const IMAGE_OPTIONS_PAGE_SIZE = 10;

// Opened by SourcePanel's "Browse Catalogues" button — picks one completed
// AI Vastra job as the Motion Studio source image, as an alternative to
// SourcePanel's own "Upload Custom Image" path. Same grid/query as
// CatalogVideoWizard's former step 1 "My Catalogue Images" tab.
export function CataloguePickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (jobId: string) => void;
}): React.ReactElement {
  const [visibleCount, setVisibleCount] = useState(IMAGE_OPTIONS_PAGE_SIZE);
  const { data: catalogues, isLoading } = useQuery<CatalogueResponse>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
  });

  // Sorted newest-first so the initial page (and each "Load more" page) is
  // always the next-most-recent batch. Rendering is paginated via
  // visibleCount rather than putting every job in the DOM up front — an
  // unbounded gallery fires one thumbnail request per job as it scrolls into
  // view (JobThumbnail's useInView), and for a long-history account even
  // that lazy-loaded burst could exceed the API's per-IP rate limit if the
  // whole history were reachable at once (see docs/progress.md,
  // "catalog-video rate-limit incident"). Paging bounds how much of the
  // account's history is ever mounted, regardless of how many jobs it has.
  const allImageOptions = (catalogues ?? [])
    .flatMap((catalogue) =>
      catalogue.jobs
        .filter((job) => job.status === 'COMPLETED')
        .map((job) => ({
          jobId: job.id,
          catalogueId: catalogue.catalogueId,
          createdAt: job.createdAt,
        })),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(({ jobId, catalogueId }) => ({ jobId, catalogueId }));
  const imageOptions = allImageOptions.slice(0, visibleCount);
  const hasMoreImages = visibleCount < allImageOptions.length;

  return (
    <>
      <style>{`
        .cat-picker-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(8, 12, 24, 0.62);
        }

        .cat-picker-dialog {
          width: min(760px, calc(100vw - 40px));
          height: min(680px, calc(100vh - 40px));
          overflow: hidden;
          border: 1px solid ${C.border};
          border-radius: 8px;
          background: ${C.card};
          box-shadow: 0 20px 56px rgba(0, 0, 0, 0.32);
          display: flex;
          flex-direction: column;
        }

        .cat-picker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        .cat-picker-grid > button:hover .cat-picker-hover-hint,
        .cat-picker-grid > button:focus-visible .cat-picker-hover-hint {
          opacity: 1;
        }

        @media (max-width: 639px) {
          .cat-picker-backdrop {
            padding: 10px;
          }
          .cat-picker-dialog {
            width: calc(100vw - 20px);
            height: calc(100vh - 20px);
          }
          .cat-picker-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
        }
      `}</style>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click outside dismisses */}
      <div
        role="presentation"
        className="cat-picker-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalogue-picker-title"
          className="cat-picker-dialog"
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '18px 20px',
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <h2 id="catalogue-picker-title" style={{ margin: 0, color: C.text, fontSize: 18 }}>
              Browse Catalogues
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                background: 'transparent',
                color: C.mid,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </header>

          <div style={{ padding: 20, overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <p style={{ margin: '0 0 16px', color: C.mid, fontSize: 13 }}>
              Choose a completed catalogue image to animate.
            </p>
            {isLoading ? (
              <p style={{ color: C.mid, fontSize: 13 }}>Loading images...</p>
            ) : imageOptions.length === 0 ? (
              <p style={{ color: C.mid, fontSize: 13 }}>
                No completed catalogue images are available.
              </p>
            ) : (
              <div className="cat-picker-grid">
                {imageOptions.map((option) => (
                  <button
                    key={option.jobId}
                    type="button"
                    onClick={() => onSelect(option.jobId)}
                    style={{
                      position: 'relative',
                      aspectRatio: '3 / 4',
                      overflow: 'hidden',
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: 0,
                      background: C.lighter,
                      cursor: 'pointer',
                    }}
                  >
                    <JobThumbnail jobId={option.jobId} alt="" />
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        padding: 8,
                        opacity: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent 60%)',
                        transition: 'opacity 150ms ease',
                      }}
                      className="cat-picker-hover-hint"
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          color: C.white,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <Check size={12} />
                        Use this image
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {hasMoreImages && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + IMAGE_OPTIONS_PAGE_SIZE)}
                style={{
                  display: 'block',
                  margin: '16px auto 0',
                  padding: '8px 20px',
                  borderRadius: 999,
                  border: `1px solid ${C.border}`,
                  background: 'transparent',
                  color: C.mid,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Load more
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
