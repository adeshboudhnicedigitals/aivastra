import { describe, expect, it } from 'vitest';
import { imageBasename } from './viewed-image.js';

describe('imageBasename', () => {
  it('matches the storefront and Admin API URLs of one image', () => {
    const storefront = '//shop.com/cdn/shop/files/Blue-Shirt_600x.jpg?v=1710000000';
    const admin = 'https://cdn.shopify.com/s/files/1/0001/0002/files/Blue-Shirt.jpg?v=1710000000';
    expect(imageBasename(storefront)).toBe('blue-shirt.jpg');
    expect(imageBasename(storefront)).toBe(imageBasename(admin));
  });

  it('strips crop, retina and named size suffixes', () => {
    for (const name of [
      'a_600x600_crop_center.png',
      'a_600x@2x.png',
      'a_grande.png',
      'a_x400.png',
    ]) {
      expect(imageBasename(`https://cdn.shopify.com/s/files/${name}`)).toBe('a.png');
    }
  });

  it('keeps distinct images distinct', () => {
    expect(imageBasename('https://c/s/front_1.jpg')).not.toBe(
      imageBasename('https://c/s/back_1.jpg'),
    );
  });
});
