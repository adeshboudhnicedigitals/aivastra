// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// tryon-widget.js is a plain browser script with no module system. Its media
// finder sits between two marker comments; evaluate just that region.
const widgetPath = resolve(
  __dirname,
  '../../../shopify-extension/extensions/tryon-theme-extension/assets/tryon-widget.js',
);
const region = readFileSync(widgetPath, 'utf8')
  .split('// <media-finder>')[1]
  ?.split('// </media-finder>')[0];
if (!region) throw new Error('media-finder markers missing from tryon-widget.js');

type Found = { el: Element; needsRelative: boolean } | null;
const findMediaContainer = new Function(`${region}\nreturn findMediaContainer;`)() as (
  doc: Document,
  win: Window,
  opts: { selector?: string; productImage?: string },
) => Found;

const find = (opts: { selector?: string; productImage?: string } = {}) =>
  findMediaContainer(document, window, opts);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findMediaContainer', () => {
  it('uses the merchant selector when it matches', () => {
    document.body.innerHTML = '<div id="mine"></div><img src="/a.jpg">';
    expect(find({ selector: '#mine' })?.el.id).toBe('mine');
  });

  it('ignores an invalid merchant selector instead of throwing', () => {
    document.body.innerHTML = '<main><img src="/a.jpg"></main>';
    expect(() => find({ selector: '###bad[' })).not.toThrow();
  });

  it('finds the featured image across size suffixes and returns its positioned ancestor', () => {
    document.body.innerHTML = `
      <div class="gallery" style="position:relative">
        <div><img src="//cdn.shopify.com/s/files/1/products/shirt_1100x.jpg?v=3"></div>
      </div>
      <img src="//cdn.shopify.com/s/files/1/products/other_1100x.jpg">`;
    const found = find({
      productImage: '//cdn.shopify.com/s/files/1/products/shirt_200x.jpg?v=3&width=200',
    });
    expect(found?.el.className).toBe('gallery');
    expect(found?.needsRelative).toBe(false);
  });

  it('skips thumbnails that share the image file name', () => {
    document.body.innerHTML = `
      <ul class="product__thumbs"><li><img src="/files/shirt_100x.jpg"></li></ul>
      <div class="product__media-wrapper"><img src="/files/shirt_900x.jpg"></div>`;
    const found = find({ productImage: '/files/shirt_200x.jpg' });
    expect(found?.el.className).toBe('product__media-wrapper');
    expect(found?.needsRelative).toBe(true);
  });

  it('falls back to the first image inside a known media wrapper', () => {
    document.body.innerHTML = `
      <header><img src="/logo.png"></header>
      <div class="product-gallery"><img src="/unrelated.jpg"></div>`;
    expect(find({ productImage: '/files/not-there.jpg' })?.el.className).toBe('product-gallery');
  });

  it('marks a static container as needing position:relative and skips <picture>', () => {
    document.body.innerHTML =
      '<main><div id="box"><picture><img src="/x.jpg"></picture></div></main>';
    const found = find();
    expect(found?.el.id).toBe('box');
    expect(found?.needsRelative).toBe(true);
  });

  it('ignores the theme zoom dialog that repeats the product image', () => {
    document.body.innerHTML = `
      <product-modal class="product-media-modal media-modal" style="position:fixed">
        <div><img src="/files/shirt_1800x.jpg"></div>
      </product-modal>
      <div class="product__media-wrapper"><img src="/files/shirt_900x.jpg"></div>`;
    const found = find({ productImage: '/files/shirt_200x.jpg' });
    expect(found?.el.className).toBe('product__media-wrapper');
  });

  it('does not treat a gallery image wrapped by a modal-opener as a dialog', () => {
    document.body.innerHTML = `
      <div class="product__media-wrapper" style="position:relative">
        <modal-opener class="product__modal-opener"><img src="/files/shirt_900x.jpg"></modal-opener>
      </div>`;
    const found = find({ productImage: '/files/shirt_200x.jpg' });
    expect(found?.el.className).toBe('product__media-wrapper');
  });

  it('returns null when the page has no usable image', () => {
    document.body.innerHTML = '<header><img src="/logo.png"></header><p>hello</p>';
    expect(find({ productImage: '/files/shirt.jpg' })).toBeNull();
  });
});
