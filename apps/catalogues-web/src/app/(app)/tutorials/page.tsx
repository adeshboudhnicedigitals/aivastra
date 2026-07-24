'use client';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { TopBar } from '@/components/topbar';

// Accepts a full YouTube URL (youtu.be/<id>, youtube.com/watch?v=<id>,
// youtube.com/embed/<id>, with or without extra query params) or a bare
// video ID, and returns just the video ID for embedding/thumbnails.
function extractYoutubeId(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1);
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v) return v;
      const embedMatch = url.pathname.match(/\/embed\/([^/?]+)/);
      if (embedMatch?.[1]) return embedMatch[1];
    }
  } catch {
    // Not a URL — assume it's already a bare video ID.
  }
  return trimmed;
}

// `category` must match one of the CATEGORY values below (or 'All Tutorials',
// which every tutorial matches) — it drives the top filter tabs. `tag` is the
// small pill shown on the card itself and is independent of `category`.
const CATEGORY = {
  ALL: 'All Tutorials',
  GET_STARTED: 'Get Started',
  CATALOGUE_STUDIO: 'AI Catalogue Studio',
  VIRTUAL_TRYON: 'AI Virtual Try-On',
  BEST_PRACTICES: 'Best Practices',
} as const;

const TUTORIALS = [
  {
    id: 't1',
    title: 'Catalogue - Women’s Full Sleeve Shirt',
    tag: 'Catalogue',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/z1w3tRf0y-o?si=jxz2oCjrdFoG-Oo8',
  },
  {
    id: 't2',
    title: 'Catalogue - Women’s Half Sleeve Shirt',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/j9-MLutMaB0?si=I0BkFIVRMuedAY-o',
  },
  {
    id: 't3',
    title: 'Catalogue - Women’s Half Sleeve T-shirt',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/OvVHS8NRgJA?si=1fQqQiF3vPo8GfC_',
  },
  {
    id: 't4',
    title: 'Catalogue - Women’s Full Sleeve Tshirt',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/E0XD7TXgdlg?si=V3X2CAIcqRoJyHUi',
  },
  {
    id: 't5',
    title: 'Catalogue - Women’s Top',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/vaXQ0nGl3bg?si=6ybIY8Q8CJO64lw0',
  },
  {
    id: 't6',
    title: 'Catalogue - Women’s Crop Top',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/zZQ-CM3iwIU?si=hrAGigj7fRhUtA8n',
  },
  {
    id: 't7',
    title: 'Catalogue - Women’s Hoodie',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/czK4DzqrN-4?si=4VyawtUruuZfopFA',
  },
  {
    id: 't8',
    title: 'Catalogue - Women’s Jacket',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/xGZOseG5Q90?si=yQuSTF91gXRofN2O',
  },
  {
    id: 't9',
    title: 'Catalogue - Women’s Mini Frock',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/ozhtfeQcQDU?si=rGEksEGIz2XRxVEG',
  },
  {
    id: 't10',
    title: 'Catalogue - Women’s Long Frock',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/KzCvKENy-qI?si=0Zj3LGBtT7hCy18x',
  },
  {
    id: 't11',
    title: 'Catalogue - Women’s Kurti',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/JGnymrFSJI8?si=aHlT1cPFsD9Lb6ke',
  },
  {
    id: 't12',
    title: 'Catalogue - Women’s Kurti & Pyjama',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/9-fE1n3Hxa4?si=GBdI5jJirvqUh-yk',
  },
  {
    id: 't13',
    title: 'Catalogue - Women’s Sweatshirt',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/ciE-fJqNwWs?si=iitOVVh8kNFUS1qJ',
  },
  {
    id: 't14',
    title: 'Catalogue - Women’s Cocktail',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/tkjdm-C1fJo?si=tdwvM4mZHn5E0bPj',
  },
  {
    id: 't15',
    title: 'Catalogue - Women’s Jumpsuit',
    tag: 'Try-On',
    category: CATEGORY.CATALOGUE_STUDIO,
    duration: '3 mins',
    youtubeUrl: 'https://youtu.be/q09adqU1gg0?si=ZvJMEL8lRjPMY1Ij',
  },
];

const TABS = [
  CATEGORY.ALL,
  CATEGORY.GET_STARTED,
  CATEGORY.CATALOGUE_STUDIO,
  CATEGORY.VIRTUAL_TRYON,
  CATEGORY.BEST_PRACTICES,
];

export default function TutorialsPage() {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(CATEGORY.ALL);

  const visibleTutorials =
    activeTab === CATEGORY.ALL
      ? TUTORIALS
      : TUTORIALS.filter((tutorial) => tutorial.category === activeTab);

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
            {TABS.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
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
                aria-hidden="true"
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
          {visibleTutorials.map((tutorial, index) => {
            const isLarge = index < 2;
            const isCatalogue = tutorial.tag === 'Catalogue';
            const isActive = activeVideoId === tutorial.id;
            const videoId = extractYoutubeId(tutorial.youtubeUrl);
            const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: tutorial card
              // biome-ignore lint/a11y/noStaticElementInteractions: tutorial card
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
                  if (!isActive && videoId) {
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
                  {isActive && videoId ? (
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
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
                        src={thumbnailUrl}
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
