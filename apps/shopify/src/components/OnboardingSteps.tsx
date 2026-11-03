import { Fragment } from 'react';
import { STEP_LABELS, STEP_PAGES, type StepPage } from '../lib/onboarding';

/**
 * Pill step row at the top of every onboarding page. The welcome intro is not a
 * step, so numbering starts at the products page. Reads off STEP_PAGES so every
 * page's number stays in sync with its actual position in the wizard rather
 * than each page hand-rolling its own "Step N of 4".
 */
export function OnboardingSteps({ page }: { page: StepPage }) {
  const currentIndex = STEP_PAGES.indexOf(page);

  return (
    <ol
      className="av-steps"
      aria-label={`Getting started, step ${currentIndex + 1} of ${STEP_PAGES.length}`}
    >
      {STEP_PAGES.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <Fragment key={step}>
            {index > 0 && <li aria-hidden className="av-conn" />}
            <li
              className={`av-step${done ? ' done' : ''}${active ? ' active' : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className="n">
                {done ? (
                  // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the label names the step
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="lbl">{STEP_LABELS[step]}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
