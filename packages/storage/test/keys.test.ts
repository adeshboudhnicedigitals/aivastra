import { describe, expect, it } from 'vitest';
import { keys } from '../src/keys.js';

describe('keys', () => {
  it('builds input garment key', () => {
    expect(keys.inputGarment('abc-123')).toBe('inputs/abc-123/garment.jpg');
  });
  it('builds output result key', () => {
    expect(keys.output('abc-123')).toBe('outputs/abc-123/result.png');
  });
  it('builds output result key in webp format when requested', () => {
    expect(keys.output('abc-123', 'webp')).toBe('outputs/abc-123/result.webp');
  });
  it('builds catalog item key with type and id', () => {
    expect(keys.catalogItem('models', 'uuid-1')).toBe('catalog/models/uuid-1.jpg');
  });
  it('builds catalog thumb key', () => {
    expect(keys.catalogThumb('poses', 'uuid-2')).toBe('catalog/poses/uuid-2.thumb.jpg');
  });
  it('builds model face key', () => {
    expect(keys.modelFace('uuid-1')).toBe('models/faces/uuid-1.jpg');
  });
  it('builds model face thumb key', () => {
    expect(keys.modelFaceThumb('uuid-1')).toBe('models/faces/uuid-1.thumb.jpg');
  });
  it('builds model background key', () => {
    expect(keys.modelBackground('uuid-1')).toBe('models/backgrounds/uuid-1.jpg');
  });
  it('builds model background thumb key', () => {
    expect(keys.modelBackgroundThumb('uuid-1')).toBe('models/backgrounds/uuid-1.thumb.jpg');
  });
  it('builds model pose key', () => {
    expect(keys.modelPose('uuid-1')).toBe('models/poses/uuid-1.jpg');
  });
  it('builds model pose thumb key', () => {
    expect(keys.modelPoseThumb('uuid-1')).toBe('models/poses/uuid-1.thumb.jpg');
  });
});

// These shapes were previously built inline at their call sites and are pinned
// here verbatim: production objects already exist at these paths, so a builder
// that drifts from the old string would orphan them.
describe('keys formerly built inline', () => {
  it('builds widget output key', () => {
    expect(keys.widgetOutput('job-1', 'webp')).toBe('widget-outputs/job-1/result.webp');
    expect(keys.widgetOutput('job-1')).toBe('widget-outputs/job-1/result.png');
  });
  it('builds merchant kiosk shopper photo keys', () => {
    expect(keys.merchantTryonInput('m-1', 'u-1', 'png')).toBe('merchant-inputs/m-1/u-1/photo.png');
    expect(keys.merchantQrUploadInput('m-1', 's-1')).toBe('merchant-inputs/m-1/qr/s-1/photo.jpg');
  });
  it('builds an extensionless Shopify customer photo key', () => {
    expect(keys.shopifyCustomerPhoto('st-1', 'u-1')).toBe('shopify-inputs/st-1/u-1/photo');
  });
  it('builds Shopify product garment keys', () => {
    expect(keys.shopifyProductGarment('st-1', 42)).toBe('shopify-garments/st-1/42/garment.jpg');
    expect(keys.shopifyProductGarmentOverride('st-1', '42', 'u-1')).toBe(
      'shopify-garments/st-1/42/garment-u-1.jpg',
    );
  });
});

// Each prefix backs an ownership `startsWith` guard, so it must cover every key
// its builders produce for the same owner — and no other owner's keys.
describe('key prefixes', () => {
  const cases: [string, string[], string][] = [
    [keys.inputGarmentPrefix(), [keys.inputGarment('t-1')], 'outputs/t-1/result.png'],
    [
      keys.merchantInputPrefix('m-1'),
      [keys.merchantTryonInput('m-1', 'u-1', 'jpeg'), keys.merchantQrUploadInput('m-1', 's-1')],
      keys.merchantTryonInput('m-10', 'u-1', 'jpeg'),
    ],
    [
      keys.merchantCatalogPrefix('m-1'),
      [
        keys.merchantCatalogItem('m-1', 'a-1'),
        keys.merchantCatalogItemThumb('m-1', 'a-1'),
        keys.merchantCatalogFlatGarment('m-1', 'a-1'),
      ],
      keys.merchantCatalogItem('m-10', 'a-1'),
    ],
    [
      keys.demoCatalogPrefix(),
      [keys.demoCatalogItem('a-1'), keys.demoCatalogItemThumb('a-1')],
      keys.merchantCatalogItem('m-1', 'a-1'),
    ],
    [
      keys.devUploadPrefix('m-1'),
      [keys.devUpload('m-1', 'u-1', 'jpg')],
      keys.devUpload('m-10', 'u-1', 'jpg'),
    ],
    [
      keys.shopifyCustomerPhotoPrefix('st-1'),
      [keys.shopifyCustomerPhoto('st-1', 'u-1')],
      keys.shopifyCustomerPhoto('st-10', 'u-1'),
    ],
  ];
  it.each(cases)('%s covers its own keys and rejects others', (prefix, owned, foreign) => {
    for (const key of owned) expect(key.startsWith(prefix)).toBe(true);
    expect(foreign.startsWith(prefix)).toBe(false);
  });
});
