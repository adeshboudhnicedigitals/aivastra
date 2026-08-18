import { ArrowRight, Image, ImagePlus, Shirt } from 'lucide-react';
import { Fragment } from 'react';
import { CheckIcon, ChevronDown, ChevronRight } from '@/components/icons';
import { SupportModal } from '@/components/SupportModal';
import { C, grad } from '@/components/tokens';
import { TopBar } from '@/components/topbar';
import { Tooltip } from '@/components/ui/tooltip';
import { CouponModal } from '../CouponModal';
import { GstinConfirmModal } from '../GstinConfirmModal';
import { PaymentResultModal } from '../PaymentResultModal';
import {
  COUNTRIES,
  FLAGS,
  PER_PHOTO_PRICE,
  PLAN_FEATURES,
  PLAN_IMAGE_COUNT,
  PLAN_META,
} from '../use-pricing-data';
import type { PricingLayoutProps } from './types';

export function Desktop(props: PricingLayoutProps): React.ReactElement {
  const {
    paymentResult,
    setPaymentResult,
    buying,
    activeTab,
    setActiveTab,
    salesModal,
    setSalesModal,
    country,
    setCountry,
    showCountry,
    setShowCountry,
    countryRef,
    ratesLoading,
    isNonIn,
    visiblePlans,
    plansLoading,
    firstPurchaseBonusPercent,
    displayBase,
    displayTax,
    displayTotal,
    startBuy,
    couponModalPlan,
    couponCode,
    setCouponCode,
    couponApplying,
    couponError,
    couponApplied,
    couponBonusPercent,
    applyCoupon,
    closeCouponModal,
    continueFromCouponModal,
    gstinModalPlan,
    checkoutGstin,
    setCheckoutGstin,
    closeGstinModal,
    confirmGstinAndPay,
    banner,
  } = props;

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.bg }}>
      {/* Topbar with country selector */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <TopBar
          title="Pricing & Plan"
          subtitle="Create professional fashion catalogues without photoshoots, models, or editing headaches."
          right={
            <div ref={countryRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowCountry(!showCountry)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: 8,
                  width: 130,
                  height: 40,
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.white,
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 500,
                  color: C.text,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>{FLAGS[country]}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.mid }}>
                    {COUNTRIES.find((c) => c.code === country)?.name}
                  </span>
                </span>
                <ChevronDown size={14} />
              </button>
              {showCountry && (
                <div
                  style={{
                    position: 'absolute',
                    top: 44,
                    right: 0,
                    width: 200,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    overflow: 'hidden',
                    zIndex: 10,
                  }}
                >
                  {COUNTRIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        setCountry(c.code);
                        setShowCountry(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        fontSize: 13,
                        fontWeight: 500,
                        color: country === c.code ? C.pink : C.mid,
                        cursor: 'pointer',
                        background: country === c.code ? 'rgba(245,92,122,0.06)' : 'transparent',
                        border: 'none',
                        width: '100%',
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      {FLAGS[c.code]} {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />
      </div>

      {/* Current Plan Banner */}
      {(() => {
        const { planName, balance, planCredits, pct, activatedDate } = banner;

        return (
          <div
            style={{
              margin: '24px auto 0',
              width: 'calc(100% - 48px)',
              maxWidth: 1080,
              borderRadius: 16,
              background: grad,
              display: 'flex',
              alignItems: 'stretch',
              overflow: 'hidden',
              minHeight: 160,
            }}
          >
            {/* Left — plan info */}
            <div
              style={{
                flex: 1,
                padding: '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 12px',
                    borderRadius: 20,
                    background: 'rgba(255,255,255,0.25)',
                    color: C.white,
                    fontSize: 11,
                    fontWeight: 700,
                    marginBottom: 12,
                    letterSpacing: '0.3px',
                  }}
                >
                  Current Plan
                </span>
                <div
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    color: '#ffffff',
                    lineHeight: 1.2,
                    marginBottom: 8,
                  }}
                >
                  {planName}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.82)',
                    lineHeight: '20px',
                    maxWidth: 480,
                  }}
                >
                  Designed for growing brands creating AI powered fashion catalogues and virtual
                  tryons at scale.
                </div>
                {activatedDate && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 6 }}>
                    Plan Activated on {activatedDate}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('catalogue')}
                style={{
                  marginTop: 20,
                  alignSelf: 'flex-start',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#ffffff',
                  color: '#141414',
                  fontFamily: 'inherit',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Upgrade Plan <ChevronRight />
              </button>
            </div>

            {/* Divider */}
            <div style={{ width: 1, background: 'rgba(255,255,255,0.2)', margin: '24px 0' }} />

            {/* Right — credits */}
            <div
              style={{
                width: 300,
                padding: '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.7)',
                  fontWeight: 600,
                  letterSpacing: '0.3px',
                }}
              >
                Credits Remaining
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: '#ffffff', lineHeight: 1 }}>
                  {balance.toLocaleString('en-IN')}
                </span>
                {planCredits !== null && (
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)', marginLeft: 2 }}>
                    /{planCredits.toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              {/* Progress bar — only shown when on a paid plan */}
              {planCredits !== null && (
                <div
                  style={{
                    height: 8,
                    borderRadius: 100,
                    background: 'rgba(255,255,255,0.25)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      borderRadius: 100,
                      background: C.white,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              )}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: '16px' }}>
                Credits are shared across AI Catalogue Generation and AI Virtual Tryon.
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tab toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 24px 32px' }}>
        <div
          style={{
            display: 'grid',
            // Single column while the Virtual Try-On tab below is commented out.
            gridTemplateColumns: '1fr',
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            background: C.white,
            padding: 4,
            gap: 4,
          }}
        >
          {(
            [
              {
                key: 'catalogue',
                label: 'AI Catalogue Generation',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M14.6668 7.33337L13.8028 6.46937C13.6541 6.31941 13.4771 6.20037 13.2822 6.11914C13.0872 6.03791 12.878 5.99609 12.6668 5.99609C12.4556 5.99609 12.2465 6.03791 12.0515 6.11914C11.8565 6.20037 11.6796 6.31941 11.5308 6.46937L7.3335 10.6667"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M2.66683 5.33325C2.31321 5.33325 1.97407 5.47373 1.72402 5.72378C1.47397 5.97382 1.3335 6.31296 1.3335 6.66659V13.3333C1.3335 13.6869 1.47397 14.026 1.72402 14.2761C1.97407 14.5261 2.31321 14.6666 2.66683 14.6666H9.3335C9.68712 14.6666 10.0263 14.5261 10.2763 14.2761C10.5264 14.026 10.6668 13.6869 10.6668 13.3333"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8.66667 5.33333C9.03486 5.33333 9.33333 5.03486 9.33333 4.66667C9.33333 4.29848 9.03486 4 8.66667 4C8.29848 4 8 4.29848 8 4.66667C8 5.03486 8.29848 5.33333 8.66667 5.33333Z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M13.3335 1.33325H6.66683C5.93045 1.33325 5.3335 1.93021 5.3335 2.66659V9.33325C5.3335 10.0696 5.93045 10.6666 6.66683 10.6666H13.3335C14.0699 10.6666 14.6668 10.0696 14.6668 9.33325V2.66659C14.6668 1.93021 14.0699 1.33325 13.3335 1.33325Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ),
              },
              /* AI Virtual Try-On Offline tab — hidden for now, keep for later re-enable.
              {
                key: 'tryon',
                label: 'AI Virtual Try-On Offline',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9.53589 3.90909C9.53589 2.85473 10.4868 2 11.6599 2C12.8329 2 13.7839 2.85473 13.7839 3.90909C13.7839 4.40532 13.6046 4.85733 13.2925 5.19682C12.6948 5.84706 11.8015 6.50197 11.8015 7.34545V7.6299M11.8015 7.6299C12.533 7.6214 13.2674 7.82458 13.8845 8.24056L21.317 13.2509C22.6234 14.1315 21.9305 16 20.2975 16H18M11.8015 7.6299C11.076 7.63834 10.3534 7.85497 9.751 8.27872L2.65531 13.27C1.38322 14.1648 2.08721 16 3.70254 16H6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6 18C6 16.1144 6 15.1716 6.58579 14.5858C7.17157 14 8.11438 14 10 14H14C15.8856 14 16.8284 14 17.4142 14.5858C18 15.1716 18 16.1144 18 18C18 19.8856 18 20.8284 17.4142 21.4142C16.8284 22 15.8856 22 14 22H10C8.11438 22 7.17157 22 6.58579 21.4142C6 20.8284 6 19.8856 6 18Z"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                ),
              },
              */
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 20px',
                  borderRadius: 10,
                  border: 'none',
                  background: isActive ? C.dark : 'transparent',
                  color: isActive ? C.onDark : C.mid,
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  transition: 'background 0.18s, color 0.18s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pricing cards */}
      <div style={{ background: C.bg }}>
        {/* AI Virtual Try-On Offline pricing cards — hidden for now (gated to false), keep for later re-enable. */}
        {false && activeTab === 'tryon' && (
          <div style={{ padding: '0 10px 48px', maxWidth: 1320, margin: '0 auto' }}>
            {/* Two option cards */}
            <div
              style={{
                display: 'flex',
                gap: 20,
                alignItems: 'stretch',
                justifyContent: 'center',
              }}
            >
              {/* Option 2 — Only Try-On */}
              <div
                style={{
                  width: 410,
                  flex: '0 0 auto',
                  background: C.card,
                  border: `2px solid color-mix(in srgb, ${C.mid} 30%, transparent)`,
                  borderRadius: 20,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 14px',
                    borderRadius: 6,
                    background: C.field,
                    border: `1px solid color-mix(in srgb, ${C.mid} 35%, transparent)`,
                    color: C.text,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  Offline
                </span>

                <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
                  Virtual Try-On Platform
                </div>

                {/* Price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 900,
                      color: C.text,
                      letterSpacing: '-1.5px',
                    }}
                  >
                    ₹30,000
                  </span>
                  <span style={{ fontSize: 13, color: C.mid }}>/month + GST</span>
                </div>

                {/* Key stat */}
                <div
                  style={{
                    background: C.field,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '12px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 64,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Shirt size={16} color={C.text} />
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: C.text,
                        lineHeight: '20px',
                        letterSpacing: 0,
                      }}
                    >
                      Up to 30,000
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: C.mid,
                        lineHeight: '16px',
                        letterSpacing: 0,
                      }}
                    >
                      Virtual Try-On Sessions
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 361.33 }}>
                  {[
                    'Unlimited AI Models',
                    'Unlimited Backgrounds Library',
                    'White-Label Integration',
                    'Priority Support',
                    'Regular Feature Updates',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: 361.33,
                        height: 18,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: C.field,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CheckIcon size={10} color={C.text} />
                      </span>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{f}</span>
                    </div>
                  ))}
                </div>

                {/* Catalogue note — below features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Need AI Catalogue Images?
                  </div>
                  <div
                    style={{
                      background: C.field,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      height: 64,
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <ImagePlus size={14} color={C.text} />
                    </span>
                    <div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color: C.text,
                          lineHeight: '20px',
                          letterSpacing: 0,
                        }}
                      >
                        ₹15 per Image
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: C.mid,
                          lineHeight: '16px',
                          letterSpacing: 0,
                        }}
                      >
                        Generate additional AI catalogue images
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-hover-opacity"
                  onClick={() =>
                    setSalesModal(
                      "Hi, I'm interested in the Virtual Try-On Only plan (Option 2 — ₹30,000/month). Please get in touch with more details.",
                    )
                  }
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: 11,
                    borderRadius: 10,
                    border: 'none',
                    background: C.text,
                    color: C.card,
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  Contact Sales <ArrowRight size={14} />
                </button>
              </div>

              {/* Option 1 — Virtual Try-On + Catalogue */}
              <div
                style={{
                  width: 410,
                  flex: '0 0 auto',
                  background: C.card,
                  border: `2px solid color-mix(in srgb, ${C.pink} 40%, transparent)`,
                  borderRadius: 20,
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    alignSelf: 'flex-start',
                    padding: '4px 14px',
                    borderRadius: 6,
                    background: `color-mix(in srgb, ${C.pink} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${C.pink} 40%, transparent)`,
                    color: C.text,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.5px',
                  }}
                >
                  Offline
                </span>

                <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
                  Virtual Try-On + Catalogue Studio
                </div>

                {/* Price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 36,
                      fontWeight: 900,
                      color: C.text,
                      letterSpacing: '-1.5px',
                    }}
                  >
                    ₹49,999
                  </span>
                  <span style={{ fontSize: 13, color: C.mid }}>/month + GST</span>
                </div>

                {/* Key stats */}
                <div
                  style={{
                    display: 'flex',
                    background:
                      'linear-gradient(90deg, rgba(245,92,122,0.05) 0%, rgba(246,181,83,0.05) 100%)',
                    border: `1px solid color-mix(in srgb, ${C.pink} 20%, transparent)`,
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  {[
                    {
                      icon: <Image size={14} color="#fff" />,
                      iconBg: grad,
                      count: '2,500',
                      label: 'AI Catalogue Images',
                    },
                    {
                      icon: <Shirt size={14} color="#fff" />,
                      iconBg: grad,
                      count: '25,000',
                      label: 'Virtual Try-On Sessions',
                    },
                  ].map((s, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reorder
                    <Fragment key={i}>
                      {i > 0 && (
                        <div
                          style={{
                            width: 1,
                            background: `color-mix(in srgb, ${C.pink} 20%, transparent)`,
                            margin: '8px 0',
                          }}
                        />
                      )}
                      <div
                        key={s.label}
                        style={{
                          flex: 1,
                          padding: '8px 6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          height: 64,
                        }}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 6,
                            background: s.iconBg,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {s.icon}
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 600,
                              color: C.text,
                              lineHeight: '20px',
                              letterSpacing: 0,
                            }}
                          >
                            {s.count}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 500,
                              color: C.mid,
                              lineHeight: '16px',
                              letterSpacing: 0,
                            }}
                          >
                            {s.label}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                </div>

                {/* Features */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 361.33 }}>
                  {[
                    'AI Catalogue Generation & Virtual Try-On',
                    'Unlimited AI Models',
                    'Unlimited Backgrounds Library',
                    'White-Label Branding',
                    'Priority Technical Support',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: 361.33,
                        height: 18,
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: `color-mix(in srgb, ${C.amber} 18%, transparent)`,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <CheckIcon size={10} color={C.pink} />
                      </span>
                      <span style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{f}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Add-on label */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Pay ₹5,000 Extra and Get
                  </div>

                  {/* Add-on box */}
                  <div
                    style={{
                      background: C.field,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10 }}>
                      {(
                        [
                          {
                            icon: <ImagePlus size={14} color={C.text} />,
                            val: '+500',
                            label: 'AI Catalogue Creation',
                          },
                          {
                            icon: <Shirt size={14} color={C.text} />,
                            val: '+5,000',
                            label: 'Virtual Try-On Sessions',
                          },
                        ] as const
                      ).map((a) => (
                        <div
                          key={a.label}
                          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <span
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              border: `1px solid ${C.border}`,
                              background: C.card,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {a.icon}
                          </span>
                          <div>
                            <div
                              style={{
                                fontSize: 16,
                                fontWeight: 600,
                                color: C.text,
                                lineHeight: '20px',
                                letterSpacing: 0,
                              }}
                            >
                              {a.val}
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 500,
                                color: C.mid,
                                lineHeight: '16px',
                                letterSpacing: 0,
                              }}
                            >
                              {a.label}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="hover-brightness"
                  onClick={() =>
                    setSalesModal(
                      "Hi, I'm interested in the Virtual Try-On + Catalogue Creation plan (Option 1 — ₹49,999/month). Please get in touch with more details.",
                    )
                  }
                  style={{
                    marginTop: 'auto',
                    width: '100%',
                    padding: 11,
                    borderRadius: 10,
                    border: 'none',
                    background:
                      'linear-gradient(91.84deg, #521D9C 0.33%, #BD2587 50.77%, #F96657 99.67%)',
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  Contact Sales <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'catalogue' && (
          <div
            style={{
              display: 'flex',
              gap: 20,
              justifyContent: 'center',
              alignItems: 'stretch',
              flexWrap: 'wrap',
              maxWidth: 1080,
              margin: '0 auto',
              padding: '0 24px',
            }}
          >
            {plansLoading
              ? [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 320,
                      minHeight: 560,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 16,
                    }}
                  />
                ))
              : visiblePlans.map((plan, idx) => {
                  // biome-ignore lint/style/noNonNullAssertion: PLAN_META has entries for every plan index
                  const meta = PLAN_META[idx] ?? PLAN_META[0]!;
                  const features = PLAN_FEATURES[idx] ?? PLAN_FEATURES[0];
                  const accent = meta.accent;
                  const highlighted = plan.isHighlighted;

                  const cardContent = (
                    // biome-ignore lint/correctness/useJsxKeyInIterable: cardContent is wrapped by keyed parent in the map return below
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        background: C.card,
                        borderRadius: highlighted ? 14 : 16,
                        flex: 1,
                        position: 'relative',
                      }}
                    >
                      {/* Card header */}
                      <div style={{ padding: '24px 24px 0' }}>
                        {/* Most Popular badge — absolutely positioned so it doesn't shift card height */}
                        {highlighted && plan.badge && (
                          <span
                            style={{
                              position: 'absolute',
                              top: -14,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '5px 14px',
                              borderRadius: 20,
                              background: grad,
                              color: C.white,
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              boxShadow: '0 2px 10px rgba(245,92,122,0.35)',
                            }}
                          >
                            ⭐ {plan.badge}
                          </span>
                        )}

                        {/* Plan name row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            marginBottom: 22,
                          }}
                        >
                          <span
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              background: `color-mix(in srgb, ${meta.iconBg} 14%, transparent)`,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 22,
                              flexShrink: 0,
                            }}
                          >
                            {meta.iconSrc ? (
                              // biome-ignore lint/performance/noImgElement: local SVG asset
                              <img
                                src={meta.iconSrc}
                                alt=""
                                width={22}
                                height={22}
                                style={
                                  meta.invertUsage ? { filter: 'var(--icon-invert)' } : undefined
                                }
                              />
                            ) : (
                              <meta.Icon size={22} color={meta.iconColor ?? accent} />
                            )}
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontSize: 22, fontWeight: 700, color: C.text }}>
                              {plan.name}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: C.mid }}>
                              {meta.subtext}
                            </span>
                          </span>
                        </div>

                        {/* Price */}
                        <div style={{ marginBottom: 20 }}>
                          <span
                            style={{
                              fontSize: 40,
                              fontWeight: 800,
                              color: C.text,
                              letterSpacing: '-1.5px',
                              opacity: ratesLoading && isNonIn ? 0.5 : 1,
                              transition: 'opacity 0.2s',
                            }}
                          >
                            {displayBase(plan.basePaise)}
                          </span>
                          {PLAN_IMAGE_COUNT[plan.slug] && (
                            <span style={{ fontSize: 14, color: C.mid, marginLeft: 4 }}>
                              / {PLAN_IMAGE_COUNT[plan.slug]}
                            </span>
                          )}
                        </div>
                        {PER_PHOTO_PRICE[plan.slug] && (
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: C.text,
                              marginBottom: 20,
                            }}
                          >
                            {PER_PHOTO_PRICE[plan.slug]}
                          </div>
                        )}
                      </div>

                      {/* Divider */}
                      <div style={{ height: 1, background: C.border, margin: '0 24px' }} />

                      {/* Feature list */}
                      <div style={{ padding: '16px 24px', flex: 1 }}>
                        <div
                          style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}
                        >
                          Included Features
                        </div>

                        {firstPurchaseBonusPercent ? (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '3px 10px',
                              borderRadius: 999,
                              background: grad,
                              marginBottom: 12,
                            }}
                          >
                            <span style={{ fontSize: 12, color: '#fff', fontWeight: 700 }}>
                              +{firstPurchaseBonusPercent}% bonus credits on this purchase
                            </span>
                          </div>
                        ) : null}

                        {features.map((feat) => (
                          <div
                            key={feat}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              marginBottom: 12,
                            }}
                          >
                            <span
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: '50%',
                                background: meta.checkGrad
                                  ? grad
                                  : `color-mix(in srgb, ${accent} 16%, transparent)`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <CheckIcon size={11} color={meta.checkGrad ? '#fff' : accent} />
                            </span>
                            <span style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>
                              {feat}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* CTA button */}
                      <div style={{ padding: '4px 24px 24px' }}>
                        <Tooltip
                          tip={
                            buying && buying !== plan.slug
                              ? 'Another payment is in progress'
                              : undefined
                          }
                          position="bottom"
                        >
                          <button
                            type="button"
                            className={
                              highlighted ? 'upgrade-plan-btn highlighted' : 'upgrade-plan-btn'
                            }
                            onClick={() => startBuy(plan)}
                            disabled={!!buying}
                            style={{
                              width: '100%',
                              padding: '13px 20px',
                              borderRadius: 10,
                              border: 'none',
                              background: highlighted ? grad : '#141414',
                              color: '#fff',
                              fontFamily: 'inherit',
                              fontWeight: 700,
                              fontSize: 15,
                              cursor: buying ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 8,
                              opacity: buying && buying !== plan.slug ? 0.45 : 1,
                            }}
                          >
                            {buying === plan.slug ? 'Processing…' : 'Buy Now'}
                            {buying !== plan.slug && <ArrowRight size={18} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );

                  return highlighted ? (
                    <div
                      key={plan.slug}
                      style={{
                        width: 320,
                        paddingTop: 16,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          padding: 2,
                          borderRadius: 18,
                          background: grad,
                          display: 'flex',
                          flexDirection: 'column',
                          flex: 1,
                          boxShadow: '0 6px 28px rgba(245,92,122,0.22)',
                        }}
                      >
                        {cardContent}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={plan.slug}
                      style={{
                        width: 320,
                        paddingTop: 16,
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          borderRadius: 16,
                          border: `1px solid ${C.border}`,
                          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
                        }}
                      >
                        {cardContent}
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {isNonIn && (
          <div
            style={{
              textAlign: 'center',
              fontSize: 11,
              color: C.light,
              padding: '12px 24px 0',
            }}
          >
            💳 Payment processed via Razorpay (India). International cards may not be supported.
          </div>
        )}

        <div style={{ height: 48 }} />
      </div>

      {salesModal !== null && (
        <SupportModal initialMessage={salesModal} onClose={() => setSalesModal(null)} />
      )}

      {paymentResult && (
        <PaymentResultModal result={paymentResult} onClose={() => setPaymentResult(null)} />
      )}

      {couponModalPlan && (
        <CouponModal
          plan={couponModalPlan}
          couponCode={couponCode}
          setCouponCode={setCouponCode}
          couponApplying={couponApplying}
          couponError={couponError}
          couponApplied={couponApplied}
          couponBonusPercent={couponBonusPercent}
          displayBase={displayBase}
          displayTax={displayTax}
          displayTotal={displayTotal}
          onApply={() => void applyCoupon()}
          onClose={closeCouponModal}
          onContinue={continueFromCouponModal}
        />
      )}

      {gstinModalPlan && (
        <GstinConfirmModal
          plan={gstinModalPlan}
          gstin={checkoutGstin}
          setGstin={setCheckoutGstin}
          displayBase={displayBase}
          displayTax={displayTax}
          displayTotal={displayTotal}
          onClose={closeGstinModal}
          onPay={confirmGstinAndPay}
        />
      )}
    </div>
  );
}
