import { describe, expect, it } from 'vitest';
import { keys } from '../src/keys.js';
import { backendFor, type StorageBackend, UnroutableKeyError } from '../src/routing.js';

// One entry per keys.* builder. A builder added to keys.ts without an entry
// here fails the first test — deciding where a new kind of object lives is
// meant to be a deliberate choice, not a default.
const EXPECTED: Record<keyof typeof keys, StorageBackend> = {
  inputGarment: 'user',
  inputGarmentPrefix: 'user',
  output: 'user',
  widgetOutput: 'user',
  outputThumb: 'user',
  mannequinIntermediate: 'user',
  videoOutput: 'user',
  merchantTryonInput: 'user',
  merchantQrUploadInput: 'user',
  merchantInputPrefix: 'user',
  shopifyCustomerPhoto: 'user',
  shopifyCustomerPhotoPrefix: 'user',
  shopifyProductGarment: 'user',
  shopifyProductGarmentOverride: 'user',
  devUpload: 'user',
  devUploadPrefix: 'user',
  extensionUpload: 'user',
  userBackground: 'user',
  userBackgroundThumb: 'user',
  supportAttachment: 'user',
  invoice: 'user',

  merchantCatalogItem: 'asset',
  merchantCatalogItemThumb: 'asset',
  merchantCatalogFlatGarment: 'asset',
  merchantCatalogPrefix: 'asset',
  merchantLogo: 'asset',
  merchantLoadingVideo: 'asset',
  demoCatalogItem: 'asset',
  demoCatalogItemThumb: 'asset',
  demoCatalogPrefix: 'asset',
  catalogItem: 'asset',
  catalogThumb: 'asset',
  catalogCategoryThumb: 'asset',
  modelFace: 'asset',
  modelFaceThumb: 'asset',
  modelFaceSide: 'asset',
  modelBackground: 'asset',
  modelBackgroundThumb: 'asset',
  modelBackgroundComfy: 'asset',
  modelPose: 'asset',
  modelPoseThumb: 'asset',
  modelPoseFaceSide: 'asset',
  modelPoseBgComfy: 'asset',
  subcategoryThumb: 'asset',
  subcategoryInstruction: 'asset',
  subcategoryTryonLibraryInstruction: 'asset',
  shopifyBasketImage: 'asset',
  catalogueTemplateThumb: 'asset',
  subcategoryTemplate: 'asset',
  subcategoryTemplateThumb: 'asset',
  tryonSample: 'asset',
  tryonSampleThumb: 'asset',
  tryonPersonSample: 'asset',
  tryonPersonSampleThumb: 'asset',
  tryonGarmentSample: 'asset',
  tryonGarmentSampleThumb: 'asset',
  sareeModelImage: 'asset',
  sareeModelImageThumb: 'asset',
  sareeSampleImage: 'asset',
  sareeSampleImageThumb: 'asset',
  sareeStyle: 'asset',
  sampleVideo: 'asset',
  sampleVideoThumb: 'asset',
  fabricGarmentTypeThumb: 'asset',
  appVideo: 'asset',
  wordpressPluginZip: 'asset',
};

describe('backendFor', () => {
  // Builders take 0–3 string-ish args; extra args are ignored, and 'jpg' is a
  // valid value for every format/ext parameter.
  const build = (name: string) =>
    (keys as unknown as Record<string, (...a: string[]) => string>)[name]('id-1', 'id-2', 'jpg');

  it('has an expected backend for every keys.* builder', () => {
    expect(Object.keys(keys).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('routes keys.%s to %s', (name, backend) => {
    expect(backendFor(build(name))).toBe(backend);
  });

  it('keeps look-alike segments apart', () => {
    expect(backendFor(keys.shopifyBasketImage('b'))).toBe('asset');
    expect(backendFor(keys.shopifyCustomerPhoto('s', 'u'))).toBe('user');
    expect(backendFor(keys.merchantCatalogItem('m', 'a'))).toBe('asset');
    expect(backendFor(keys.merchantTryonInput('m', 'u', 'jpg'))).toBe('user');
    expect(backendFor('saree/global/model.jpg')).toBe('asset');
    expect(backendFor('saree-styles/x.jpg')).toBe('asset');
  });

  it('routes the legacy shopify-catalog-garments/ prefix still referenced in production', () => {
    expect(backendFor('shopify-catalog-garments/store/1/garment.jpg')).toBe('user');
  });

  it.each([
    'unknown/a.jpg',
    'no-slash.jpg',
    '/inputs/a.jpg',
    '',
    'Inputs/a.jpg',
    'inputs',
  ])('rejects unrouted key %j', (key) => {
    expect(() => backendFor(key)).toThrow(UnroutableKeyError);
  });

  it('does not resolve Object.prototype names', () => {
    expect(() => backendFor('constructor/x')).toThrow(UnroutableKeyError);
    expect(() => backendFor('__proto__/x')).toThrow(UnroutableKeyError);
  });
});
