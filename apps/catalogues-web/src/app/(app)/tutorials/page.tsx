'use client';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';

const TUTORIALS = [
  {
    id: 't1',
    title: 'Get Started with Ai Vastra and create your first Catalogue...',
    tag: 'Catalogue',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1558769132-cb1fac0840c8?auto=format&fit=crop&q=80&w=1200',
    youtubeId: 'dQw4w9WgXcQ',
  },
  {
    id: 't2',
    title: 'Get Started with Ai Vastra and create your first Try-On...',
    tag: 'Try-On',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&q=80&w=1200',
    youtubeId: 'dQw4w9WgXcQ',
  },
  {
    id: 't3',
    title: 'Create your first Try-On...',
    tag: 'Try-On',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1616469829581-73993eb86b02?auto=format&fit=crop&q=80&w=800',
    youtubeId: 'dQw4w9WgXcQ',
  },
  {
    id: 't4',
    title: 'Create your first Try-On...',
    tag: 'Try-On',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=800',
    youtubeId: 'dQw4w9WgXcQ',
  },
  {
    id: 't5',
    title: 'Create your first Try-On...',
    tag: 'Try-On',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800',
    youtubeId: 'dQw4w9WgXcQ',
  },
  {
    id: 't6',
    title: 'Create your first Try-On...',
    tag: 'Try-On',
    duration: '3 mins',
    thumbnail:
      'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=800',
    youtubeId: 'dQw4w9WgXcQ',
  },
];

const TABS = [
  'All Tutorials',
  'Get Started',
  'AI Catalogue Studio',
  'AI Virtual Try-On',
  'Best Practices',
];

export default function TutorialsPage() {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        .tutorials-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 24px;
          padding-bottom: 40px;
        }
        .tutorial-card-large {
          grid-column: span 2;
        }
        .tutorial-card-small {
          grid-column: span 1;
        }
        .filters-row {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .filters-row::-webkit-scrollbar {
          display: none;
        }
        .search-container {
          width: 320px;
          flex-shrink: 0;
        }

        /* Tablet Breakpoint */
        @media (max-width: 1024px) {
          .tutorials-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .tutorial-card-large {
            grid-column: span 2;
          }
          .filters-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 16px;
          }
          .search-container {
            width: 100%;
          }
        }

        /* Mobile Breakpoint */
        @media (max-width: 640px) {
          .tutorials-grid {
            grid-template-columns: 1fr;
          }
          .tutorial-card-large, .tutorial-card-small {
            grid-column: span 1 !important;
          }
        }
      `}</style>
      <TopBar
        title="Tutorials"
        subtitle="Manage your profile, billing, credits, subscriptions, and account activity."
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px', background: C.white }}>
        {/* Filters and Search Row */}
        <div
          className="filters-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 32,
            paddingBottom: 24,
            borderBottom: `1px solid ${C.border2}`,
          }}
        >
          <div className="filters-row">
            {TABS.map((tab, idx) => {
              const isActive = idx === 0;
              return (
                <button
                  key={tab}
                  type="button"
                  style={{
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: `1px solid ${isActive ? C.pink : C.border2}`,
                    background: C.white,
                    color: isActive ? C.pink : C.text,
                    fontWeight: 500,
                    fontSize: 14,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <div className="search-container" style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                color: C.mid,
                display: 'flex',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search tutorials..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '12px 16px 12px 42px',
                borderRadius: 8,
                border: `1px solid ${C.border2}`,
                background: C.white,
                fontSize: 14,
                color: C.text,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Grid Area */}
        <div className="tutorials-grid">
          {TUTORIALS.map((tutorial, index) => {
            const isLarge = index < 2;
            const isCatalogue = tutorial.tag === 'Catalogue';
            const isActive = activeVideoId === tutorial.id;

            return (
              <div
                key={tutorial.id}
                className={`hover-opacity ${isLarge ? 'tutorial-card-large' : 'tutorial-card-small'}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (!isActive && tutorial.youtubeId) {
                    setActiveVideoId(tutorial.id);
                  }
                }}
              >
                {/* Thumbnail / Video Player */}
                <div
                  style={{
                    position: 'relative',
                    aspectRatio: '16/9',
                    borderRadius: 12,
                    overflow: 'hidden',
                    background: C.border,
                  }}
                >
                  {isActive && tutorial.youtubeId ? (
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${tutorial.youtubeId}?autoplay=1`}
                      title={tutorial.title}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      style={{ position: 'absolute', inset: 0 }}
                    />
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={tutorial.thumbnail}
                        alt={tutorial.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(0,0,0,0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: 0,
                          transition: 'opacity 0.2s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                      >
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            background: 'rgba(0,0,0,0.6)',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={C.white}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ marginLeft: 3 }}
                          >
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                          </svg>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Meta Row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {/* Tag Pill */}
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: 100,
                      background: isCatalogue
                        ? 'rgba(245, 92, 122, 0.1)'
                        : 'rgba(245, 158, 11, 0.1)',
                      color: isCatalogue ? C.pink : '#D97706',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {tutorial.tag}
                  </span>

                  {/* Duration */}
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: C.mid,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    {tutorial.duration}
                  </span>
                </div>

                {/* Title */}
                <div style={{ fontSize: 16, fontWeight: 500, color: C.text, lineHeight: 1.4 }}>
                  {tutorial.title}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
