// Monochrome on purpose: colours come from Polaris tokens, so the loader follows
// the light/dark theme instead of carrying brand colours.
const LOADING_CSS = `
.aivastra-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  color: var(--p-color-text, #1a1a1a);
}
.aivastra-loading__text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.aivastra-loading__dots span {
  animation: aivastra-loading-dot 1.2s ease-in-out infinite;
}
.aivastra-loading__dots span:nth-child(2) { animation-delay: 0.2s; }
.aivastra-loading__dots span:nth-child(3) { animation-delay: 0.4s; }
.aivastra-loading__line {
  position: relative;
  width: 120px;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
  background: var(--p-color-border, #d4d4d4);
}
.aivastra-loading__line::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  background: currentColor;
  animation: aivastra-loading-sweep 1.3s ease-in-out infinite;
}
@keyframes aivastra-loading-dot {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
@keyframes aivastra-loading-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .aivastra-loading__dots span,
  .aivastra-loading__line::after { animation: none; }
}`;

/** Full-viewport, centred loading state shown while the app fetches the store. */
export function LoadingScreen() {
  return (
    <div className="aivastra-loading" role="status" aria-live="polite" aria-label="Loading">
      <style>{LOADING_CSS}</style>
      <div className="aivastra-loading__text" aria-hidden="true">
        <span>
          Loading
          <span className="aivastra-loading__dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </span>
        <div className="aivastra-loading__line" />
      </div>
    </div>
  );
}
