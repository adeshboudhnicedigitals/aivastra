export interface DetectedProduct {
  imageUrl: string;
}

/** Tiered, cheapest/most-reliable first — see PLAN.md's "Detection
 * heuristics" section. Returns null (no button injected) if nothing matches,
 * rather than guessing on a non-product page. */
export function detectProduct(): DetectedProduct | null {
  return detectFromJsonLd() ?? detectFromOpenGraph() ?? detectFromHeuristic();
}

function resolveUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function imageFromJsonLdNode(node: Record<string, unknown>): string | null {
  const image = node.image;
  if (typeof image === 'string') return resolveUrl(image);
  if (Array.isArray(image) && typeof image[0] === 'string') return resolveUrl(image[0]);
  if (image && typeof image === 'object' && typeof (image as { url?: unknown }).url === 'string') {
    return resolveUrl((image as { url: string }).url);
  }
  return null;
}

function isProductNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === 'Product';
  if (Array.isArray(type)) return type.includes('Product');
  return false;
}

function detectFromJsonLd(): DetectedProduct | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const graph = (item as Record<string, unknown>)['@graph'];
      const candidates = Array.isArray(graph) ? graph : [item];
      for (const node of candidates) {
        if (node && typeof node === 'object' && isProductNode(node as Record<string, unknown>)) {
          const imageUrl = imageFromJsonLdNode(node as Record<string, unknown>);
          if (imageUrl) return { imageUrl };
        }
      }
    }
  }
  return null;
}

function detectFromOpenGraph(): DetectedProduct | null {
  const ogType = document.querySelector('meta[property="og:type"]')?.getAttribute('content');
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (ogType?.toLowerCase().includes('product') && ogImage) {
    return { imageUrl: resolveUrl(ogImage) };
  }
  return null;
}

const BUY_TEXT = /add to (cart|bag|basket)|buy now/i;
const MIN_IMAGE_AREA = 100 * 100;

function elementText(el: Element): string {
  if (el instanceof HTMLInputElement) return el.value;
  return el.textContent ?? '';
}

function detectFromHeuristic(): DetectedProduct | null {
  const buyEl = Array.from(document.querySelectorAll('button, a, input[type="submit"]')).find(
    (el) => BUY_TEXT.test(elementText(el)),
  );
  if (!buyEl) return null;

  let scope: Element | null = buyEl;
  for (let i = 0; i < 5 && scope?.parentElement; i++) scope = scope.parentElement;
  const root = scope ?? document.body;

  let best: { src: string; area: number } | null = null;
  for (const img of root.querySelectorAll('img')) {
    const area = img.naturalWidth * img.naturalHeight;
    if (area > 0 && (!best || area > best.area)) best = { src: img.src, area };
  }
  if (!best || best.area < MIN_IMAGE_AREA) return null;
  return { imageUrl: resolveUrl(best.src) };
}
