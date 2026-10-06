import { detectProduct } from './detect.js';
import { mountWidget } from './widget.js';

// Small delay so SPA product pages (React/Vue storefronts) have a chance to
// render their images before we measure naturalWidth/naturalHeight in the
// heuristic detection tier.
const DETECT_DELAY_MS = 600;

function init() {
  const product = detectProduct();
  if (!product) return; // No button injected — avoids false positives on non-product pages.
  void mountWidget(product);
}

function schedule() {
  setTimeout(init, DETECT_DELAY_MS);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  schedule();
} else {
  window.addEventListener('DOMContentLoaded', schedule);
}
