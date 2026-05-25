import { cookies } from 'next/headers';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Ai Vastra — AI catalogues for fashion brands',
};

export default async function Home() {
  const cookieStore = await cookies();
  const isLoggedIn = !!cookieStore.get('access_token');

  return (
    <>
      <style>{`
        :root {
          --nav-bg: rgba(251,248,243,0.78);
          --nav-bg-scrolled: rgba(251,248,243,0.95);
        }
        .lp-body { background: var(--bg); }
        .lp-nav-wrap {
          position: sticky; top: 0; z-index: 50;
          backdrop-filter: saturate(1.2) blur(14px);
          border-bottom: 1px solid transparent;
          background: var(--nav-bg);
        }
        .lp-nav { height: 72px; display: flex; align-items: center; justify-content: space-between; max-width: 1240px; margin: 0 auto; padding: 0 32px; }
        .lp-logo { display: flex; align-items: center; gap: 10px; }
        .lp-logo-mark { width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg,#F55C7A 0%,#F6B553 100%); display: grid; place-items: center; color: white; font-weight: 800; font-size: 16px; letter-spacing: -0.04em; }
        .lp-logo-name { font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
        .lp-nav-links { display: flex; gap: 4px; }
        .lp-nav-links a { padding: 8px 14px; font-size: 14px; font-weight: 500; color: var(--ink-2); border-radius: 8px; transition: background .15s,color .15s; }
        .lp-nav-links a:hover { background: rgba(20,20,20,0.04); color: var(--ink); }
        .lp-nav-cta { display: flex; align-items: center; gap: 10px; }
        .lp-signin { font-size: 14px; font-weight: 500; color: var(--ink-2); padding: 8px 12px; border-radius: 8px; transition: background .15s; }
        .lp-signin:hover { background: rgba(20,20,20,0.04); }
        .lp-btn-primary { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 18px; border-radius: 11px; font-size: 14px; font-weight: 600; background: var(--ink); color: var(--surface); box-shadow: 0 8px 18px -8px rgba(20,20,20,.4); transition: all .15s; }
        .lp-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 24px -10px rgba(20,20,20,.5); }
        .lp-btn-primary-lg { height: 50px; padding: 0 22px; font-size: 14.5px; border-radius: 12px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; background: var(--ink); color: var(--surface); box-shadow: 0 8px 18px -8px rgba(20,20,20,.4); transition: all .15s; }
        .lp-btn-primary-lg:hover { transform: translateY(-1px); }
        .lp-btn-ghost-lg { height: 50px; padding: 0 22px; font-size: 14.5px; border-radius: 12px; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; background: var(--surface); border: 1px solid var(--line); color: var(--ink-2); transition: all .15s; }
        .lp-btn-ghost-lg:hover { background: var(--surface-2); transform: translateY(-1px); }
        .lp-container { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
        /* Hero */
        .lp-hero { position: relative; padding: 56px 0 96px; overflow: hidden; }
        .lp-hero-bg { position: absolute; inset: -40px 0 0 0; z-index: 0; pointer-events: none; background: radial-gradient(1100px 600px at 92% 0%,rgba(246,181,83,0.20),transparent 55%), radial-gradient(900px 500px at 0% 30%,rgba(245,92,122,0.10),transparent 60%); }
        .lp-hero-inner { position: relative; z-index: 1; display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
        .lp-eyebrow { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 99px; padding: 6px 14px 6px 6px; font-size: 12px; font-weight: 600; color: var(--ink-2); box-shadow: var(--shadow-card); }
        .lp-eyebrow-tag { background: linear-gradient(135deg,#F55C7A,#F6B553); color: white; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; letter-spacing: .02em; }
        .lp-title { font-weight: 700; font-size: 60px; line-height: 1.04; letter-spacing: -0.025em; margin: 24px 0 18px; color: var(--ink); }
        .lp-title-grad { background: linear-gradient(135deg,#F55C7A,#F6B553); background-clip: text; -webkit-background-clip: text; color: transparent; }
        .lp-lede { font-size: 17px; line-height: 1.55; color: var(--mute); max-width: 540px; }
        .lp-hero-cta { margin-top: 32px; display: flex; gap: 12px; align-items: center; }
        .lp-hero-meta { margin-top: 22px; display: flex; gap: 18px; align-items: center; font-size: 12.5px; color: var(--mute); }
        .lp-pip { width: 6px; height: 6px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 8px var(--mint); display: inline-block; margin-right: 6px; }
        /* Stage (hero showcase) */
        .lp-stage { position: relative; aspect-ratio: 1/1; border-radius: 28px; background: radial-gradient(80% 80% at 50% 30%,rgba(255,255,255,0.85),rgba(255,255,255,0.4)), var(--grad-soft); border: 1px solid rgba(246,181,83,0.20); box-shadow: var(--shadow-hi); overflow: hidden; padding: 28px; }
        .lp-stage-cards { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; gap: 28px; }
        .lp-input-card { background: white; border-radius: 18px; box-shadow: var(--shadow-hi); overflow: hidden; display: flex; flex-direction: column; width: 36%; transform: rotate(-3deg) translateY(8px); transition: transform .4s cubic-bezier(.2,.7,.2,1); }
        .lp-output-card { background: white; border-radius: 18px; box-shadow: var(--shadow-hi); overflow: hidden; display: flex; flex-direction: column; width: 52%; transform: rotate(2deg) translateY(-4px); transition: transform .4s cubic-bezier(.2,.7,.2,1); }
        .lp-stage:hover .lp-input-card { transform: rotate(-4deg) translateY(2px); }
        .lp-stage:hover .lp-output-card { transform: rotate(3deg) translateY(-12px); }
        .lp-card-img { aspect-ratio: 4/5; overflow: hidden; background: var(--surface-2); }
        .lp-card-img img { width: 100%; height: 100%; object-fit: cover; }
        .lp-card-caption { padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--mute); border-top: 1px solid var(--line); }
        .lp-card-lab { font-family: var(--font-mono,'JetBrains Mono',monospace); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--mute-2); }
        .lp-card-dot { width: 6px; height: 6px; border-radius: 50%; }
        .lp-dot-ai { background: var(--mint); box-shadow: 0 0 6px var(--mint); }
        .lp-float { position: absolute; background: white; border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; font-size: 12px; font-weight: 600; box-shadow: var(--shadow-card); display: inline-flex; align-items: center; gap: 8px; z-index: 2; }
        .lp-float-badge { width: 6px; height: 6px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 6px var(--mint); }
        .lp-f1 { top: 26px; left: -22px; }
        .lp-f2 { bottom: 50px; right: -16px; }
        .lp-f3 { top: 50%; right: -28px; transform: translateY(-50%); padding: 6px 10px; font-size: 11px; }
        /* Render frame */
        .lp-render-frame { position: relative; aspect-ratio: 4/5; background: linear-gradient(180deg,#F8F0E2,#F1E1C8); overflow: hidden; }
        .lp-render-caption { position: absolute; left: 14px; bottom: 14px; font-family: var(--font-mono,'JetBrains Mono',monospace); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: rgba(20,20,20,0.6); background: rgba(255,255,255,0.85); padding: 4px 8px; border-radius: 6px; }
        /* Logos */
        .lp-logos { padding: 36px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.4); }
        .lp-logos-row { display: flex; align-items: center; justify-content: space-between; gap: 32px; flex-wrap: wrap; }
        .lp-logos-label { font-size: 12.5px; color: var(--mute); font-weight: 500; }
        .lp-logos-list { display: flex; align-items: center; gap: 36px; flex-wrap: wrap; }
        .lp-logo-pill { font-weight: 600; font-size: 18px; color: var(--mute); transition: color .2s; }
        .lp-logo-pill:hover { color: var(--ink); }
        /* Sections */
        .lp-section { padding: 96px 0; position: relative; }
        .lp-section-head { max-width: 720px; margin: 0 auto 48px; text-align: center; }
        .lp-section-tag { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--line); color: var(--ink-2); padding: 6px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .lp-section-title { font-weight: 700; font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; margin: 16px 0 14px; }
        .lp-section-sub { font-size: 16px; color: var(--mute); max-width: 580px; margin: 0 auto; }
        /* Steps */
        .lp-steps-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 18px; }
        .lp-step-card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 22px; box-shadow: var(--shadow-card); transition: transform .2s,box-shadow .2s; }
        .lp-step-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-hi); }
        .lp-step-num { width: 36px; height: 36px; border-radius: 50%; background: var(--surface-2); border: 1.5px solid var(--line); display: grid; place-items: center; font-weight: 700; font-size: 14px; color: var(--ink); margin-bottom: 18px; }
        .lp-step-card:first-child .lp-step-num { background: linear-gradient(180deg,rgba(245,92,122,0.10),rgba(246,181,83,0.06)); border-color: rgba(246,181,83,0.30); color: var(--peach); }
        .lp-step-card h3 { font-size: 16px; font-weight: 600; margin: 0 0 8px; letter-spacing: -.01em; }
        .lp-step-card p { font-size: 13.5px; color: var(--mute); margin: 0; line-height: 1.55; }
        .lp-step-art { margin-top: 18px; height: 88px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); display: grid; place-items: center; color: var(--mute-2); font-family: var(--font-mono,monospace); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
        /* Features */
        .lp-features { background: radial-gradient(800px 400px at 80% 0%,rgba(246,181,83,0.08),transparent 60%), var(--bg); }
        .lp-feature-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 18px; grid-auto-rows: minmax(280px,auto); }
        .lp-feature { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 28px; box-shadow: var(--shadow-card); display: flex; flex-direction: column; position: relative; overflow: hidden; transition: transform .25s,box-shadow .25s; }
        .lp-feature:hover { transform: translateY(-4px); box-shadow: var(--shadow-hi); }
        .lp-feature.dark { background: #141414; color: #FBFAF6; border-color: #141414; }
        .lp-feature.span-2 { grid-column: span 2; }
        .lp-feat-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); }
        .lp-feature.dark .lp-feat-eyebrow { color: #B5B1A8; }
        .lp-feature h3 { font-size: 22px; font-weight: 700; margin: 10px 0 10px; letter-spacing: -.015em; line-height: 1.2; }
        .lp-feat-body { font-size: 14px; color: var(--mute); line-height: 1.6; flex: 1; }
        .lp-feature.dark .lp-feat-body { color: #B5B1A8; }
        .lp-feat-visual { margin-top: 20px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--line); overflow: hidden; min-height: 140px; position: relative; }
        .lp-feat-list { margin-top: 14px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
        .lp-feat-list li { display: flex; gap: 8px; font-size: 13px; color: var(--mute); }
        .lp-feature.dark .lp-feat-list li { color: #B5B1A8; }
        .lp-counter { display: flex; align-items: baseline; gap: 6px; font-weight: 700; padding: 24px; height: 100%; }
        .lp-counter-num { font-size: 64px; letter-spacing: -0.04em; background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
        .lp-counter-unit { font-size: 16px; color: #B5B1A8; font-weight: 500; }
        /* Gallery */
        .lp-gallery-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; }
        .lp-gal { position: relative; aspect-ratio: 3/4; border-radius: 18px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--line); box-shadow: var(--shadow-card); transition: transform .25s,box-shadow .25s; }
        .lp-gal:hover { transform: translateY(-4px); box-shadow: var(--shadow-hi); }
        .lp-gal img { width: 100%; height: 100%; object-fit: cover; }
        .lp-gal-meta { position: absolute; left: 12px; bottom: 12px; background: rgba(255,255,255,0.94); backdrop-filter: blur(4px); border-radius: 8px; padding: 6px 10px; font-family: var(--font-mono,monospace); font-size: 10px; letter-spacing: .06em; color: var(--ink-2); text-transform: uppercase; }
        .lp-badge-ai { position: absolute; top: 12px; right: 12px; background: linear-gradient(135deg,#F55C7A,#F6B553); color: white; border-radius: 99px; padding: 4px 9px; font-size: 10px; font-weight: 700; letter-spacing: .04em; display: inline-flex; align-items: center; gap: 4px; }
        /* Pricing */
        .lp-pricing { background: var(--surface); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
        .lp-price-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 18px; }
        .lp-price-card { background: var(--bg); border: 1px solid var(--line); border-radius: 18px; padding: 28px; display: flex; flex-direction: column; transition: transform .2s,box-shadow .2s; }
        .lp-price-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-hi); }
        .lp-price-card.popular { background: #141414; color: #FBFAF6; border-color: #141414; position: relative; box-shadow: var(--shadow-hi); }
        .lp-price-card.popular::before { content: 'Most popular'; position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg,#F55C7A,#F6B553); color: white; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
        .lp-plan-name { font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--mute); }
        .lp-price-card.popular .lp-plan-name { color: var(--amber); }
        .lp-plan-price { display: flex; align-items: baseline; gap: 6px; margin-top: 16px; }
        .lp-plan-amt { font-weight: 700; font-size: 44px; letter-spacing: -0.02em; }
        .lp-plan-per { font-size: 14px; color: var(--mute); }
        .lp-price-card.popular .lp-plan-per { color: #B5B1A8; }
        .lp-plan-desc { font-size: 13.5px; color: var(--mute); margin: 10px 0 18px; min-height: 40px; }
        .lp-price-card.popular .lp-plan-desc { color: #B5B1A8; }
        .lp-plan-cta { height: 42px; border-radius: 11px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); font-size: 13.5px; font-weight: 600; width: 100%; cursor: pointer; font-family: inherit; transition: all .15s; }
        .lp-plan-cta:hover { background: var(--surface-2); transform: translateY(-1px); }
        .lp-price-card.popular .lp-plan-cta { background: #FBFAF6; color: #141414; border-color: transparent; }
        .lp-plan-list { margin-top: 22px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
        .lp-plan-list li { font-size: 13.5px; display: flex; gap: 10px; color: var(--ink-2); }
        .lp-price-card.popular .lp-plan-list li { color: #FBFAF6; }
        /* CTA band */
        .lp-cta-band { margin: 40px 0; background: #141414; color: #FBFAF6; border: 1px solid #141414; border-radius: 28px; padding: 64px 56px; position: relative; overflow: hidden; text-align: center; }
        .lp-cta-band::before { content: ''; position: absolute; inset: 0; background: radial-gradient(600px 300px at 90% 0%,rgba(246,181,83,0.20),transparent 60%), radial-gradient(600px 300px at 10% 100%,rgba(245,92,122,0.18),transparent 60%); pointer-events: none; }
        .lp-cta-band h2 { position: relative; font-size: 44px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 14px; line-height: 1.1; }
        .lp-cta-band p { position: relative; color: #B5B1A8; margin: 0 0 28px; font-size: 16px; }
        .lp-cta-band .lp-ctas { position: relative; display: inline-flex; gap: 12px; }
        .lp-cta-btn-p { display: inline-flex; align-items: center; gap: 8px; height: 50px; padding: 0 22px; font-size: 14.5px; border-radius: 12px; font-weight: 600; background: #FBFAF6; color: #141414; transition: all .15s; }
        .lp-cta-btn-p:hover { background: white; }
        .lp-cta-btn-g { display: inline-flex; align-items: center; gap: 8px; height: 50px; padding: 0 22px; font-size: 14.5px; border-radius: 12px; font-weight: 600; background: transparent; border: 1px solid rgba(255,255,255,0.18); color: #FBFAF6; transition: all .15s; }
        .lp-cta-btn-g:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.3); }
        /* Footer */
        footer.lp-footer { padding: 56px 0 36px; border-top: 1px solid var(--line); }
        .lp-footer-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr; gap: 32px; }
        .lp-footer-col h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--mute); margin: 0 0 14px; font-weight: 700; }
        .lp-footer-col a { display: block; padding: 4px 0; font-size: 13.5px; color: var(--ink-2); transition: color .15s; }
        .lp-footer-col a:hover { color: var(--peach); }
        .lp-footer-brand p { font-size: 13.5px; color: var(--mute); margin: 12px 0 16px; max-width: 280px; line-height: 1.55; }
        .lp-copy { margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; font-size: 12.5px; color: var(--mute); }
        .lp-copy-links { display: flex; gap: 18px; }
        /* Responsive */
        @media (max-width: 1100px) {
          .lp-hero-inner { grid-template-columns: 1fr; }
          .lp-title { font-size: 48px; }
          .lp-feature-grid { grid-template-columns: 1fr 1fr; }
          .lp-feature.span-2 { grid-column: span 2; }
          .lp-gallery-grid { grid-template-columns: repeat(3,1fr); }
          .lp-steps-grid { grid-template-columns: 1fr 1fr; }
          .lp-price-grid { grid-template-columns: 1fr; max-width: 540px; margin: 0 auto; }
          .lp-footer-grid { grid-template-columns: 1fr 1fr 1fr; }
        }
        @media (max-width: 720px) {
          .lp-container { padding: 0 20px; }
          .lp-nav-links { display: none; }
          .lp-title { font-size: 36px; }
          .lp-hero { padding: 40px 0 64px; }
          .lp-section { padding: 64px 0; }
          .lp-section-title { font-size: 28px; }
          .lp-feature-grid { grid-template-columns: 1fr; }
          .lp-feature.span-2 { grid-column: auto; }
          .lp-gallery-grid { grid-template-columns: repeat(2,1fr); }
          .lp-steps-grid { grid-template-columns: 1fr; }
          .lp-footer-grid { grid-template-columns: 1fr 1fr; gap: 28px; }
          .lp-cta-band { padding: 40px 28px; }
          .lp-cta-band h2 { font-size: 28px; }
          .lp-float { display: none; }
          .lp-signin { display: none; }
        }
      `}</style>

      {/* NAV */}
      <div className="lp-nav-wrap">
        <div className="lp-nav">
          <div className="lp-logo">
            <div className="lp-logo-mark">Av</div>
            <span className="lp-logo-name">Ai Vastra</span>
          </div>
          <nav className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#gallery">Gallery</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="lp-nav-cta">
            {isLoggedIn ? (
              <Link className="lp-btn-primary" href="/dashboard">
                Go to Dashboard
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </Link>
            ) : (
              <>
                <Link className="lp-signin" href="/login">Sign in</Link>
                <Link className="lp-btn-primary" href="/register">
                  Open Studio
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* HERO */}
      <header className="lp-hero">
        <div className="lp-hero-bg" />
        <div className="lp-container lp-hero-inner">
          <div>
            <span className="lp-eyebrow">
              <span className="lp-eyebrow-tag">NEW</span>
              4K outputs and 18 new model styles
            </span>
            <h1 className="lp-title">
              Turn flat lays into{' '}
              <span className="lp-title-grad">runway-ready</span>{' '}
              catalogues.
            </h1>
            <p className="lp-lede">
              Ai Vastra generates premium ecommerce model shoots from your garment photos — model, background, pose and platform-perfect crops, all in minutes. No studio, no shoot day, no rework.
            </p>
            <div className="lp-hero-cta">
              <Link className="lp-btn-primary-lg" href={isLoggedIn ? '/tryon' : '/register'}>
                {isLoggedIn ? 'Open Studio' : "Start creating — it's free"}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </Link>
              <a className="lp-btn-ghost-lg" href="#how">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                Watch demo
              </a>
            </div>
            <div className="lp-hero-meta">
              <span><span className="lp-pip" />500 free credits</span>
              <span>·</span>
              <span>No credit card</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </div>

          <div className="lp-stage" aria-hidden="true">
            <div className="lp-float lp-f1"><span className="lp-float-badge" />Generated · 1:1 · 4K</div>
            <div className="lp-float lp-f2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              38 sec
            </div>
            <div className="lp-float lp-f3">Amazon ready ✓</div>
            <div className="lp-stage-cards">
              <div className="lp-input-card">
                <div className="lp-card-img">
                  <Image src={`${BASE}/samples/sample-1.png`} alt="Input garment" width={200} height={250} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div className="lp-card-caption">
                  <span className="lp-card-lab">Input · Flat lay</span>
                  <span className="lp-card-dot" style={{ background: 'var(--mute-2)' }} />
                </div>
              </div>
              <div className="lp-output-card">
                <div className="lp-render-frame">
                  <svg viewBox="0 0 200 280" preserveAspectRatio="xMidYMax meet" style={{ position: 'absolute', left: '50%', bottom: '-2%', transform: 'translateX(-50%)', width: '76%', height: '88%' }}>
                    <defs><linearGradient id="silh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(20,20,20,0.10)"/><stop offset="1" stopColor="rgba(20,20,20,0.18)"/></linearGradient></defs>
                    <ellipse cx="100" cy="38" rx="22" ry="26" fill="url(#silh)"/>
                    <path d="M 50 90 Q 60 76 100 76 Q 140 76 150 90 L 162 168 Q 130 178 100 178 Q 70 178 38 168 Z" fill="url(#silh)"/>
                    <path d="M 62 178 L 78 280 L 100 280 L 102 178 Z" fill="url(#silh)"/>
                    <path d="M 100 178 L 102 280 L 124 280 L 138 178 Z" fill="url(#silh)"/>
                  </svg>
                  <span className="lp-render-caption">AI MODEL · PINK TOP</span>
                </div>
                <div className="lp-card-caption">
                  <span className="lp-card-lab">Output · Catalogue shot</span>
                  <span className="lp-card-dot lp-dot-ai" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* LOGOS */}
      <div className="lp-logos">
        <div className="lp-container lp-logos-row">
          <span className="lp-logos-label">Catalogues that ship to</span>
          <div className="lp-logos-list">
            {['amazon', 'Myntra', 'Flipkart', 'Ajio', 'Shopify', 'Meesho'].map((l) => (
              <span key={l} className="lp-logo-pill">{l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how" className="lp-section">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
              Four steps, zero studio
            </span>
            <h2 className="lp-section-title">From flat lay to listing in minutes</h2>
            <p className="lp-section-sub">The same wizard that powers our Studio — preview every choice and generate when you&apos;re ready.</p>
          </div>
          <div className="lp-steps-grid">
            {[
              { n: '1', h: 'Setup your catalogue', p: 'Pick category, outfit type, platform, aspect ratio and resolution. Upload a flat lay or use a sample.', art: 'UPLOAD · SETUP' },
              { n: '2', h: 'Select AI models', p: 'Choose body type, ethnicity, hair and pose. Save custom model profiles for consistent brand looks.', art: '12 MODELS · 8 POSES' },
              { n: '3', h: 'Select backgrounds', p: 'Curated studio, lifestyle and seasonal sets — or upload your own backdrop reference.', art: '40 BACKGROUNDS' },
              { n: '4', h: 'Choose templates & generate', p: 'Pick a layout, queue variations and export marketplace-ready files at 2K or 4K.', art: 'EXPORT · 2K / 4K' },
            ].map((s) => (
              <div key={s.n} className="lp-step-card">
                <div className="lp-step-num">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
                <div className="lp-step-art">{s.art}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="lp-section lp-features">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
              Built for fashion teams
            </span>
            <h2 className="lp-section-title">Everything your studio does — without the studio.</h2>
            <p className="lp-section-sub">Models, backdrops, crops, retouching and per-platform delivery, on tap.</p>
          </div>
          <div className="lp-feature-grid">
            <div className="lp-feature span-2 dark">
              <span className="lp-feat-eyebrow">Catalogue at scale</span>
              <h3>Hundreds of model shoots from a single flat lay.</h3>
              <p className="lp-feat-body">Generate a full size, color and pose run from one garment photo — every output retouched, color-graded and platform-cropped to spec.</p>
              <ul className="lp-feat-list">
                {['Consistent lighting across SKUs', 'Pose variants without re-shooting', 'Batch export to any channel'].map((li) => (
                  <li key={li}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                    {li}
                  </li>
                ))}
              </ul>
              <div className="lp-feat-visual">
                <div className="lp-counter">
                  <span className="lp-counter-num">120×</span>
                  <span className="lp-counter-unit">faster than a studio day</span>
                </div>
              </div>
            </div>
            <div className="lp-feature">
              <span className="lp-feat-eyebrow">Speed</span>
              <h3>Renders in under a minute.</h3>
              <p className="lp-feat-body">A typical 4K catalogue shot lands in 38 seconds. Queue dozens at once.</p>
              <div className="lp-feat-visual" style={{ display: 'grid', placeItems: 'center' }}>
                <div className="lp-counter" style={{ padding: '0 24px' }}>
                  <span className="lp-counter-num" style={{ fontSize: 56 }}>38s</span>
                  <span style={{ fontSize: 14, color: 'var(--mute)', fontWeight: 500 }}>per shot · 4K</span>
                </div>
              </div>
            </div>
            <div className="lp-feature">
              <span className="lp-feat-eyebrow">Brand control</span>
              <h3>Locked-in model identity.</h3>
              <p className="lp-feat-body">Save custom AI models so every drop stays on-brand across categories and seasons.</p>
              <ul className="lp-feat-list">
                {['Reusable model profiles', 'Pose & expression library'].map((li) => (
                  <li key={li}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
                    {li}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* GALLERY */}
      <section id="gallery" className="lp-section">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-tag">Recently generated</span>
            <h2 className="lp-section-title">Real flat lays. Catalogue-ready outputs.</h2>
            <p className="lp-section-sub">A glimpse of the source material teams bring in — Ai Vastra handles the rest.</p>
          </div>
          <div className="lp-gallery-grid">
            {[
              { src: `${BASE}/samples/sample-1.png`, meta: 'PINK · TOP · WOMEN' },
              { src: `${BASE}/samples/sample-2.png`, meta: 'IVORY · WRAP · WOMEN' },
              { src: `${BASE}/samples/sample-3.png`, meta: 'SAREE · WOMEN' },
              { src: `${BASE}/samples/sample-4.png`, meta: 'KURTA · WOMEN' },
            ].map((g) => (
              <div key={g.meta} className="lp-gal">
                <Image src={g.src} alt={g.meta} fill style={{ objectFit: 'cover' }} sizes="300px" />
                <span className="lp-badge-ai">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
                  AI READY
                </span>
                <span className="lp-gal-meta">{g.meta}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="lp-section lp-pricing">
        <div className="lp-container">
          <div className="lp-section-head">
            <span className="lp-section-tag">Simple, credit-based pricing</span>
            <h2 className="lp-section-title">Pay only for the shots you ship.</h2>
            <p className="lp-section-sub">Credits roll over. Cancel anytime. Custom plans for teams pushing 10k+ SKUs.</p>
          </div>
          <div className="lp-price-grid">
            <div className="lp-price-card">
              <span className="lp-plan-name">Starter</span>
              <div className="lp-plan-price"><span className="lp-plan-amt">₹0</span><span className="lp-plan-per">/mo</span></div>
              <p className="lp-plan-desc">500 free credits to try the studio.</p>
              <button className="lp-plan-cta">Start free</button>
              <ul className="lp-plan-list">
                {['500 credits · ~120 shots at 2K', '12 AI models · 40 backgrounds', 'Watermarked exports'].map((li) => (
                  <li key={li}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>{li}</li>
                ))}
              </ul>
            </div>
            <div className="lp-price-card popular">
              <span className="lp-plan-name">Studio</span>
              <div className="lp-plan-price"><span className="lp-plan-amt">₹4,999</span><span className="lp-plan-per">/mo</span></div>
              <p className="lp-plan-desc">For growing brands shipping weekly drops.</p>
              <button className="lp-plan-cta">Choose Studio</button>
              <ul className="lp-plan-list">
                {['2,500 credits · ~625 shots at 2K', 'All models, backgrounds, templates', '4K exports · no watermark', 'Reusable model & brand profiles'].map((li) => (
                  <li key={li}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>{li}</li>
                ))}
              </ul>
            </div>
            <div className="lp-price-card">
              <span className="lp-plan-name">Scale</span>
              <div className="lp-plan-price"><span className="lp-plan-amt">Custom</span></div>
              <p className="lp-plan-desc">Volume rates, dedicated GPUs and SSO.</p>
              <button className="lp-plan-cta">Talk to sales</button>
              <ul className="lp-plan-list">
                {['Unlimited team seats', 'API access & batch pipeline', 'Dedicated success manager'].map((li) => (
                  <li key={li}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>{li}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-section" style={{ padding: '16px 0 96px' }}>
        <div className="lp-container">
          <div className="lp-cta-band">
            <h2>Ship your next drop without booking a studio.</h2>
            <p>500 free credits. Start in 30 seconds. No card needed.</p>
            <div className="lp-ctas">
              <Link className="lp-cta-btn-p" href={isLoggedIn ? '/tryon' : '/register'}>
                {isLoggedIn ? 'Open the Studio' : 'Start for free'}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
              </Link>
              <a className="lp-cta-btn-g" href="#pricing">See pricing</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-grid">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <div className="lp-logo-mark">Av</div>
              <span className="lp-logo-name">Ai Vastra</span>
            </div>
            <p>AI catalogue studio for fashion brands. Made in India for sellers worldwide.</p>
          </div>
          <div className="lp-footer-col"><h4>Product</h4><a href="#how">How it works</a><a href="#features">Features</a><a href="#gallery">Gallery</a></div>
          <div className="lp-footer-col"><h4>Channels</h4><a href="#">Amazon</a><a href="#">Myntra</a><a href="#">Flipkart</a><a href="#">Shopify</a></div>
          <div className="lp-footer-col"><h4>Company</h4><a href="#">About</a><a href="#">Careers</a><a href="#">Contact</a></div>
          <div className="lp-footer-col"><h4>Resources</h4><a href="#">Help center</a><a href="#">API docs</a><a href="#">Status</a></div>
        </div>
        <div className="lp-container lp-copy">
          <span>© 2026 Ai Vastra Labs. All rights reserved.</span>
          <span className="lp-copy-links"><a href="#">Privacy</a><a href="#">Terms</a><a href="#">Cookies</a></span>
        </div>
      </footer>
    </>
  );
}
