'use client';

import React from 'react';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { GarmentCatalogModal, UploadZone } from '../components/TryOnHelpers';
import type { TryOnLayoutProps } from './types';

export function TabletLayout(props: TryOnLayoutProps) {
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
    showPersonPicker,
    setShowPersonPicker,
    loadingPersonHistory,
    personFileInputRef,
    previewPanelRef,
    isPreviewFullscreen,
    togglePreviewFullscreen,
    personSampleUrl,
    creditsCost,
    credits,
    pickFile,
    handleGenerate,
    handleSelectGarment,
    handleSelectPersonFromHistory,
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
            padding: '16px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            backgroundColor: C.bg,
          }}
        >
          {/* Steps Indicator — 2x2 grid on Tablet */}
          <div
            style={{
              background: C.white,
              padding: '12px',
              borderRadius: 16,
              border: `1px solid ${C.border}`,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
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
            ].map((step) => (
              <div
                key={step.num}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: C.white,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
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
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: step.color,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {step.num}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: C.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: C.mid,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Main Content — Stacked single column flow on tablet */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Upload Cards Grid (2-col) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 16,
                minWidth: 0,
              }}
            >
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
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                  1. Select Image from Catalogues
                </span>

                <button
                  type="button"
                  onClick={() => !generating && setShowGarmentPicker(true)}
                  style={{
                    flex: 1,
                    minHeight: 240,
                    borderRadius: 12,
                    border: `2px dashed ${selectedGarmentJob ? 'transparent' : 'var(--tryon-garment-dashed)'}`,
                    outlineOffset: -2,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    padding: 14,
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
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          background: 'var(--tryon-garment-icon-bg)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
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
                          fontSize: 11,
                          fontWeight: 500,
                          textAlign: 'center',
                          color: C.mid,
                          lineHeight: 1.5,
                        }}
                      >
                        Drag & drop or browse from Catalogues
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: C.white,
                          border: `1px solid ${C.border}`,
                          padding: '6px 14px',
                          borderRadius: 8,
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
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Browse</span>
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
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                  2. Upload Person Image
                </span>

                <UploadZone
                  file={personFile}
                  preview={personPreview}
                  progress={personProgress}
                  label=""
                  tip=""
                  disabled={generating || loadingPersonHistory}
                  sampleUrl={personSampleUrl}
                  onFile={(f) => pickFile(f, setPersonFile, setPersonPreview)}
                  onBrowseClick={() => setShowPersonPicker(true)}
                  fileInputRef={personFileInputRef}
                  icon={
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
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
                    gap: 6,
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
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 16,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
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

            {/* Try-On Settings + Credits + Generate Card */}
            <div
              style={{
                background: C.white,
                borderRadius: 16,
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  padding: '8px 14px',
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
                  Use front-facing images with clear lighting for high accuracy results.
                </span>
              </div>

              {error && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#f87171',
                    padding: '10px 14px',
                    background: 'rgba(220,38,38,0.12)',
                    borderRadius: 8,
                  }}
                >
                  {error}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  paddingTop: 4,
                }}
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                      {creditsCost} credits required
                    </div>
                    <div style={{ fontSize: 11, color: C.mid }}>
                      {credits?.balance ?? 0} credits available (
                      {Math.floor((credits?.balance ?? 0) / creditsCost)} generations)
                    </div>
                  </div>
                </div>

                <div
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                >
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    style={{
                      height: 44,
                      paddingInline: 24,
                      borderRadius: 12,
                      background: canGenerate ? grad : C.border,
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: canGenerate ? 'pointer' : 'not-allowed',
                      boxShadow: canGenerate ? '0 6px 18px rgba(245,92,122,0.28)' : 'none',
                      transition: 'opacity .15s',
                    }}
                  >
                    <img
                      src="/assets/generate-icon.svg"
                      alt=""
                      width={18}
                      height={18}
                      style={{
                        filter: 'brightness(0) invert(1)',
                        opacity: canGenerate ? 1 : 0.4,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: canGenerate ? '#fff' : C.light,
                      }}
                    >
                      {generating ? 'Generating…' : 'Generate Try On'}
                    </span>
                  </button>
                  {!generating && (
                    <div style={{ fontSize: 10, color: C.mid }}>Estimated Time:~ 25s</div>
                  )}
                </div>
              </div>
            </div>

            {/* Try On Preview Card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div
                ref={previewPanelRef}
                style={{
                  background: C.white,
                  borderRadius: isPreviewFullscreen ? 0 : 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: isPreviewFullscreen ? '100vh' : 440,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.05)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
                    Your Try On Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => void togglePreviewFullscreen()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      padding: '5px 10px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.text,
                      cursor: 'pointer',
                    }}
                  >
                    {isPreviewFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                  </button>
                </div>

                <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 340 }}>
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
                            top: 8,
                            left: 8,
                            background: 'rgba(0,0,0,0.4)',
                            color: '#fff',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
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
                            style={{
                              width: '100%',
                              height: '100%',
                              maxHeight: 300,
                              objectFit: 'contain',
                            }}
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
                            top: 8,
                            right: 8,
                            background: '#818CF8',
                            color: '#fff',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            zIndex: 10,
                          }}
                        >
                          After AI
                        </div>
                        <img
                          src={resultUrl}
                          alt="After AI"
                          style={{
                            width: '100%',
                            height: '100%',
                            maxHeight: 300,
                            objectFit: 'contain',
                          }}
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
                        gap: 12,
                      }}
                    >
                      {generating ? (
                        <>
                          <svg
                            aria-hidden="true"
                            width="36"
                            height="36"
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
                          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                            Generating your try on...
                          </span>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              width: 64,
                              height: 64,
                              borderRadius: '50%',
                              background: C.white,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
                            }}
                          >
                            <svg
                              width="28"
                              height="28"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#D1D5DB"
                              strokeWidth="2"
                            >
                              <circle cx="12" cy="8" r="5" />
                              <path d="M20 21a8 8 0 0 0-16 0" />
                            </svg>
                          </div>
                          <span style={{ fontSize: 13, color: C.mid }}>
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
                    marginTop: 14,
                    width: '100%',
                    boxSizing: 'border-box',
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
                      width: '100%',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
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
                      width: '100%',
                      boxSizing: 'border-box',
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
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

                {/* Badges — fluid grid on Tablet */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 12,
                    marginTop: 14,
                    border: `1px solid ${C.border}`,
                    padding: '12px',
                    borderRadius: 12,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
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
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>AI Powered</div>
                      <div style={{ fontSize: 10, color: C.mid }}>High Accuracy</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
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
                        width="16"
                        height="16"
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
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                        Private & Secure
                      </div>
                      <div style={{ fontSize: 10, color: C.mid }}>Data is safe</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
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
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                        Commercial Use
                      </div>
                      <div style={{ fontSize: 10, color: C.mid }}>100% Allowed</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
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
                        width="16"
                        height="16"
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
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>
                        No Watermark
                      </div>
                      <div style={{ fontSize: 10, color: C.mid }}>Clean Output</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showGarmentPicker && (
        <GarmentCatalogModal
          onSelect={handleSelectGarment}
          onClose={() => setShowGarmentPicker(false)}
        />
      )}

      {showPersonPicker && (
        <GarmentCatalogModal
          title="Browse Previous Generations"
          emptyMessage="No previous generations yet — upload a new image to get started."
          onSelect={handleSelectPersonFromHistory}
          onClose={() => setShowPersonPicker(false)}
          onUploadNew={() => {
            setShowPersonPicker(false);
            personFileInputRef.current?.click();
          }}
        />
      )}
    </>
  );
}
