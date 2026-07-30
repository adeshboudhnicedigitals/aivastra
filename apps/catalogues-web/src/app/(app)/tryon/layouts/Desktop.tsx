'use client';

import React from 'react';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GarmentCatalogModal, UploadZone } from '../components/TryOnHelpers';
import type { TryOnLayoutProps } from './types';

export function DesktopLayout(props: TryOnLayoutProps) {
  const {
    personFile,
    setPersonFile,
    personPreview,
    setPersonPreview,
    personProgress,
    generating,
    resultUrl,
    downloadingResult,
    sharingResult,
    resultActionFeedback,
    error,
    selectedGarmentJob,
    showGarmentPicker,
    setShowGarmentPicker,
    previewPanelRef,
    isPreviewFullscreen,
    togglePreviewFullscreen,
    personSampleUrl,
    creditsCost,
    credits,
    pickFile,
    handleGenerate,
    handleSelectGarment,
    handleDownloadResult,
    handleShareResult,
    canGenerate,
    canUseResultActions,
  } = props;

  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar
          title="AI Virtual Try On"
          subtitle="Create Stunning try on images in seconds with AI"
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '20px 24px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            backgroundColor: C.bg,
          }}
        >
          {/* Steps Indicator */}
          <div
            style={{
              background: C.white,
              padding: '16px',
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            {[
              {
                num: '01',
                title: 'Select Garment',
                desc: 'Choose your outfit',
                color: '#7C3AED',
                lightColor: 'var(--tryon-step-bg-1)',
              },
              {
                num: '02',
                title: 'Upload Person',
                desc: 'Front-facing photo',
                color: '#EC4899',
                lightColor: 'var(--tryon-step-bg-2)',
              },
              {
                num: '03',
                title: 'AI Generate',
                desc: '10-15 seconds',
                color: '#F97316',
                lightColor: 'var(--tryon-step-bg-3)',
              },
              {
                num: '04',
                title: 'Download',
                desc: 'Save & share',
                color: '#10B981',
                lightColor: 'var(--tryon-step-bg-4)',
              },
            ].map((step, idx, arr) => (
              <div
                key={step.num}
                style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}
              >
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    background: C.white,
                    padding: '12px 20px',
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: step.lightColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: step.color,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {step.num}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{step.title}</div>
                    <div style={{ fontSize: 12, color: C.mid, fontWeight: 500 }}>{step.desc}</div>
                  </div>
                </div>
                {idx < arr.length - 1 && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#9CA3AF"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0 }}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.22fr', gap: 24 }}>
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Select Garment & Upload Person Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* 1. Select Garment */}
                <div
                  style={{
                    background: C.white,
                    borderRadius: 16,
                    border: 'none',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                      1. Select Image from Catalogues
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => !generating && setShowGarmentPicker(true)}
                    style={{
                      flex: 1,
                      minHeight: 260,
                      borderRadius: 12,
                      border: `2px dashed ${selectedGarmentJob ? 'transparent' : 'var(--tryon-garment-dashed)'}`,
                      outlineOffset: -2,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      padding: 16,
                      boxSizing: 'border-box',
                      cursor: generating ? 'default' : 'pointer',
                      overflow: 'hidden',
                      background: 'transparent',
                      font: 'inherit',
                      textAlign: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    {selectedGarmentJob?.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      // biome-ignore lint/performance/noImgElement: selected garment thumbnail
                      <img
                        src={selectedGarmentJob.thumbnailUrl}
                        alt={selectedGarmentJob.garmentTypeName}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <>
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            background: 'var(--tryon-garment-icon-bg)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M3 7L7 4H9.5C9.5 5.38 10.62 6.5 12 6.5C13.38 6.5 14.5 5.38 14.5 4H17L21 7L18.5 9.5L17 8V20H7V8L5.5 9.5L3 7Z"
                              stroke="#818CF8"
                              strokeWidth="1.5"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            textAlign: 'center',
                            color: C.mid,
                            lineHeight: 1.6,
                          }}
                        >
                          Drag and drop an image here &middot; JPG, PNG &middot; Max 10MB
                        </span>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: C.white,
                            border: `1px solid ${C.border}`,
                            padding: '8px 18px',
                            borderRadius: 10,
                            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#6366F1"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                            Browse from Catalogues
                          </span>
                        </div>
                      </>
                    )}
                  </button>
                </div>

                {/* 2. Upload Person */}
                <div
                  style={{
                    background: C.white,
                    borderRadius: 16,
                    border: 'none',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                      2. Upload Person Image
                    </span>
                  </div>

                  <UploadZone
                    file={personFile}
                    preview={personPreview}
                    progress={personProgress}
                    label=""
                    tip=""
                    disabled={generating}
                    sampleUrl={personSampleUrl}
                    onFile={(f) => pickFile(f, setPersonFile, setPersonPreview)}
                    icon={
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="8" r="3.5" stroke="#EC4899" strokeWidth="1.5" />
                        <path
                          d="M5 20C5 17 8 15 12 15C16 15 19 17 19 20"
                          stroke="#EC4899"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    }
                  />

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    {['Front Facing', 'Good Lighting', 'Clear Image'].map((badge) => (
                      <div
                        key={badge}
                        style={{
                          background: C.bg,
                          color: C.text,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '5px 12px',
                          borderRadius: 20,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#818CF8"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                        {badge}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Try-On Settings + Credits + Generate — single unified card */}
              <div
                style={{
                  background: C.white,
                  borderRadius: 16,
                  border: 'none',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                }}
              >
                {/* Tips row */}
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    marginTop: 16,
                    alignItems: 'center',
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    padding: '10px 16px',
                    borderRadius: 8,
                  }}
                >
                  <img
                    src="/assets/bulb.svg"
                    width={12}
                    height={14}
                    alt=""
                    style={{ filter: 'var(--icon-invert)', opacity: 0.8 }}
                  />
                  <span style={{ fontSize: 11, color: '#818CF8', fontWeight: 600 }}>Tips:</span>
                  <span style={{ fontSize: 11, color: C.mid }}>
                    For best results, use front-facing images with good lighting and clear outfit
                    details.
                  </span>
                </div>

                {/* Error */}
                {error && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#f87171',
                      padding: '10px 14px',
                      background: 'rgba(220,38,38,0.12)',
                      borderRadius: 8,
                      marginTop: 12,
                    }}
                  >
                    {error}
                  </div>
                )}

                {/* Divider */}
                <div
                  style={{
                    height: 1,
                    background: C.border,
                    marginTop: 16,
                    marginBottom: 16,
                    marginInline: -20,
                  }}
                />

                {/* Credits + Generate button row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: '#FDF2F8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img src="/assets/credit.png" width={20} height={20} alt="" />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                        {creditsCost} credits required
                      </div>
                      <div style={{ fontSize: 12, color: C.mid }}>
                        You have {credits?.balance ?? 0} credits (
                        {Math.floor((credits?.balance ?? 0) / creditsCost)} generations)
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      style={{
                        height: 48,
                        paddingInline: 32,
                        borderRadius: 12,
                        background: canGenerate ? grad : C.border,
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        cursor: canGenerate ? 'pointer' : 'not-allowed',
                        boxShadow: canGenerate ? '0 6px 18px rgba(245,92,122,0.28)' : 'none',
                        transition: 'opacity .15s',
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src="/assets/generate-icon.svg"
                        alt=""
                        width={20}
                        height={20}
                        style={{
                          filter: 'brightness(0) invert(1)',
                          opacity: canGenerate ? 1 : 0.4,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: canGenerate ? '#fff' : C.light,
                        }}
                      >
                        {generating ? 'Generating…' : 'Generate Try On'}
                      </span>
                    </button>
                    {!generating && (
                      <div style={{ fontSize: 11, color: C.mid }}>Estimated Time:~ 25 seconds</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (Preview) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div
                ref={previewPanelRef}
                style={{
                  flex: 1,
                  background: C.white,
                  borderRadius: isPreviewFullscreen ? 0 : 16,
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 20,
                  minHeight: isPreviewFullscreen ? '100vh' : 500,
                  height: isPreviewFullscreen ? '100vh' : undefined,
                  width: '100%',
                  boxSizing: 'border-box',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
                    Your Try On Preview
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.text,
                        cursor: 'pointer',
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
                        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <line x1="12" y1="3" x2="12" y2="21" />
                      </svg>
                      Compare
                    </button>
                    <button
                      type="button"
                      onClick={() => void togglePreviewFullscreen()}
                      aria-pressed={isPreviewFullscreen}
                      title={isPreviewFullscreen ? 'Exit full screen' : 'Enter full screen'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        padding: '6px 12px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.text,
                        cursor: 'pointer',
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
                        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                      </svg>
                      {isPreviewFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    </button>
                  </div>
                </div>

                <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>
                  {resultUrl ? (
                    <>
                      <div
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: C.border,
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            left: 12,
                            background: 'rgba(0,0,0,0.4)',
                            color: '#fff',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            zIndex: 10,
                          }}
                        >
                          Before
                        </div>
                        {personPreview && (
                          <img
                            src={personPreview}
                            alt="Before"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          position: 'relative',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: C.border,
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: 12,
                            right: 12,
                            background: '#818CF8',
                            color: '#fff',
                            padding: '4px 10px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            zIndex: 10,
                          }}
                        >
                          After AI
                        </div>
                        <img
                          src={resultUrl}
                          alt="After AI"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        borderRadius: 8,
                        background: C.bg,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 16,
                      }}
                    >
                      {generating ? (
                        <>
                          <svg
                            aria-hidden="true"
                            width="40"
                            height="40"
                            viewBox="0 0 40 40"
                            fill="none"
                          >
                            <circle cx="20" cy="20" r="16" stroke={C.border2} strokeWidth="3" />
                            <path
                              d="M20 4 A16 16 0 0 1 36 20"
                              stroke={C.pink}
                              strokeWidth="3"
                              strokeLinecap="round"
                            >
                              <animateTransform
                                attributeName="transform"
                                type="rotate"
                                from="0 20 20"
                                to="360 20 20"
                                dur="1s"
                                repeatCount="indefinite"
                              />
                            </path>
                          </svg>
                          <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
                            Generating your try on...
                          </span>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              width: 80,
                              height: 80,
                              borderRadius: '50%',
                              background: C.white,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            }}
                          >
                            <svg
                              width="32"
                              height="32"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#D1D5DB"
                              strokeWidth="2"
                            >
                              <circle cx="12" cy="8" r="5" />
                              <path d="M20 21a8 8 0 0 0-16 0" />
                            </svg>
                          </div>
                          <span style={{ fontSize: 14, color: C.mid }}>
                            Your preview will appear here
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 12,
                    marginTop: 16,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleDownloadResult}
                    disabled={!canUseResultActions}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      height: 40,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      cursor: canUseResultActions ? 'pointer' : 'not-allowed',
                      opacity: canUseResultActions ? 1 : 0.55,
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
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {downloadingResult ? 'Downloading...' : 'Download'}
                  </button>
                  <button
                    type="button"
                    onClick={handleShareResult}
                    disabled={!canUseResultActions}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      height: 40,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      cursor: canUseResultActions ? 'pointer' : 'not-allowed',
                      opacity: canUseResultActions ? 1 : 0.55,
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
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                    {sharingResult ? 'Sharing...' : 'Share'}
                  </button>
                </div>
                {resultActionFeedback && (
                  <div
                    role={resultActionFeedback.tone === 'error' ? 'alert' : 'status'}
                    style={{
                      marginTop: 8,
                      color: resultActionFeedback.tone === 'error' ? '#DC2626' : '#059669',
                      fontSize: 12,
                      fontWeight: 500,
                      textAlign: 'center',
                    }}
                  >
                    {resultActionFeedback.message}
                  </div>
                )}

                {/* Badges */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 16,
                    marginTop: 16,
                    border: `1px solid ${C.border}`,
                    padding: '16px',
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>AI Powered</div>
                      <div style={{ fontSize: 11, color: C.mid }}>High Accuracy</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        Private & Secure
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>Your data is safe</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        Commercial Use
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>100% Allowed</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'var(--tryon-badge-icon-bg)',
                        color: '#6366F1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                        No Watermark
                      </div>
                      <div style={{ fontSize: 11, color: C.mid }}>Clean Output</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Garment catalog picker modal */}
      {showGarmentPicker && (
        <GarmentCatalogModal
          onSelect={handleSelectGarment}
          onClose={() => setShowGarmentPicker(false)}
        />
      )}
    </>
  );
}
