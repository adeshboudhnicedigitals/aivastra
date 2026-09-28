import { Fragment } from 'react';
import { STEP_PAGES, type StepPage } from '../lib/onboarding';

/**
 * Numbered step row pinned to the top of every onboarding page, replacing the
 * old bottom progress bar. The welcome intro is not a step, so numbering starts at the products page. Reads directly off STEP_PAGES so every page's
 * number stays in sync with its actual position in the wizard rather than
 * each page hand-rolling its own "Step N of 5".
 */
export function OnboardingSteps({ page }: { page: StepPage }) {
  const currentIndex = STEP_PAGES.indexOf(page);

  return (
    <ol
      aria-label={`Getting started, step ${currentIndex + 1} of ${STEP_PAGES.length}`}
      style={{
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        margin: 0,
        listStyle: 'none',
        padding: 'var(--p-space-600) var(--p-space-500) 0',
      }}
    >
      {STEP_PAGES.map((step, index) => {
        const reached = index <= currentIndex;
        return (
          <Fragment key={step}>
            {index > 0 && (
              <li
                aria-hidden
                style={{ width: 64, height: 2, background: reached ? '#000' : '#e3e3e3' }}
              />
            )}
            <li
              aria-current={index === currentIndex ? 'step' : undefined}
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                fontWeight: 600,
                background: reached ? '#000' : '#fff',
                color: reached ? '#fff' : '#616161',
                border: reached ? 'none' : '1px solid #e3e3e3',
              }}
            >
              {index + 1}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
