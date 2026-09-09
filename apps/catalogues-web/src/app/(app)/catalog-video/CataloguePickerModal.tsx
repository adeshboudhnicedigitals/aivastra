'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';

import { C } from '@/components/tokens';
import { api } from '@/lib/api';
import { type CatalogueResponse, JobThumbnail } from './JobThumbnail';

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
  const { data: catalogues, isLoading } = useQuery<CatalogueResponse>({
    queryKey: ['catalogues'],
    queryFn: () => api.get('/v1/catalogues'),
  });

  const imageOptions = (catalogues ?? []).flatMap((catalogue) =>
    catalogue.jobs
      .filter((job) => job.status === 'COMPLETED')
      .map((job) => ({ jobId: job.id, catalogueId: catalogue.catalogueId })),
  );

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
          </div>
        </section>
      </div>
    </>
  );
}
