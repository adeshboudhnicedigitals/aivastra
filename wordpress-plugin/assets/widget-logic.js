// Universal module: usable as a plain <script> (attaches to window) or via
// require() in a Node test, with no build step either way.
((root, factory) => {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AivastraWidgetLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, () => {
  /**
   * WooCommerce's variation form fires found_variation/show_variation with the
   * selected variation's data, including an `image.src`. Falls back to the
   * parent product image before any selection, for a simple product, or when
   * a variation has no image of its own. Getting this wrong sends the wrong
   * garment into the try-on job. See docs/wordpress-plugin-design.md §4.3.
   */
  function resolveVariationImage(fallbackImage, foundVariationPayload) {
    const variationSrc = foundVariationPayload?.image?.src;
    return variationSrc ? variationSrc : fallbackImage;
  }

  /**
   * Normalizes a /v1/dev/tryon or /v1/dev/jobs/:id response into a single UI
   * state. 401/403 map to 'unavailable' with no retry loop — a widget key can
   * be revoked out from under a live storefront at any time. See
   * docs/wordpress-plugin-design.md §4.3.
   */
  function classifyJobResponse(status, body) {
    if (status === 401 || status === 403) {
      return { state: 'unavailable' };
    }
    if ((status === 202 || status === 200) && body && body.status === 'QUEUED') {
      return { state: 'queued' };
    }
    if (status === 200 && body && body.status === 'RUNNING') {
      return { state: 'running' };
    }
    if (status === 200 && body && body.status === 'COMPLETED') {
      return { state: 'completed', imageUrl: body.imageUrl };
    }
    if (status === 200 && body && body.status === 'FAILED') {
      return { state: 'failed', error: body.error };
    }
    return { state: 'unavailable' };
  }

  return { resolveVariationImage, classifyJobResponse };
});
