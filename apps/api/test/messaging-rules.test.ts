import { describe, expect, it } from 'vitest';
import {
  buildTryonBody,
  eligibleLooks,
  firstMissingSlot,
  maxCount,
  requiredPhotoSlots,
} from '../src/modules/messaging/engine/rules';
import type {
  GarmentTypeOption,
  Session,
  TemplateLook,
} from '../src/modules/messaging/engine/types';

const GT: GarmentTypeOption = {
  id: 'gt-1',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: 'shoe-default',
};

const look = (id: string, roles: Partial<TemplateLook> = {}): TemplateLook => ({
  id,
  poseId: `pose-${id}`,
  backgroundId: `bg-${id}`,
  label: id,
  imageUrl: `https://img/${id}.jpg`,
  hasUpper: true,
  hasLower: false,
  hasShoes: false,
  ...roles,
});
const UPPER = look('up');
const COMBINED = look('comb', { hasLower: true });
const SHOES = look('shoes', { hasShoes: true });
const LOWER_ONLY = look('lo', { hasUpper: false, hasLower: true });

function session(over: Partial<Session> = {}): Session {
  return {
    v: 1,
    state: 'PICK_LOOKS',
    nonce: 'n',
    page: 0,
    aspectRatio: '3:4',
    resolution: 'HD',
    gender: 'women',
    garmentType: GT,
    garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    photos: {},
    faceId: 'face-1',
    template: { id: 't', mappingId: 'map-1', lowerOnly: false, looks: [UPPER, COMBINED, SHOES] },
    picked: ['up'],
    ...over,
  };
}

describe('eligibleLooks', () => {
  it('keeps every look the type has defaults for', () => {
    expect(eligibleLooks(GT, [UPPER, COMBINED, SHOES]).looks.map((l) => l.id)).toEqual([
      'up',
      'comb',
      'shoes',
    ]);
  });
  it('drops a shoe look when the type has no default shoe', () => {
    const r = eligibleLooks({ ...GT, defaultShoeCatalogId: null }, [UPPER, SHOES]);
    expect(r.looks.map((l) => l.id)).toEqual(['up']);
  });
  it('drops a combined look when there is no default lower and no lower photo', () => {
    const r = eligibleLooks({ ...GT, defaultLowerCatalogId: null }, [UPPER, COMBINED]);
    expect(r.looks.map((l) => l.id)).toEqual(['up']);
  });
  it('keeps a combined look without a default when the type takes a lower photo', () => {
    const gt = { ...GT, defaultLowerCatalogId: null, requiresLowerUpload: true };
    expect(eligibleLooks(gt, [COMBINED]).looks).toHaveLength(1);
  });
  it('an all-lower-only template is a lower-only garment', () => {
    const r = eligibleLooks(GT, [LOWER_ONLY, look('lo2', { hasUpper: false, hasLower: true })]);
    expect(r).toMatchObject({ lowerOnly: true });
    expect(r.looks).toHaveLength(2);
  });
  it('drops a lower-only look from a mixed template unless the type takes a lower photo', () => {
    expect(eligibleLooks(GT, [UPPER, LOWER_ONLY]).looks.map((l) => l.id)).toEqual(['up']);
    const gt = { ...GT, requiresLowerUpload: true };
    expect(eligibleLooks(gt, [UPPER, LOWER_ONLY]).looks).toHaveLength(2);
  });
});

describe('extra photos', () => {
  it('asks only for uploads the type requires, lower first', () => {
    expect(requiredPhotoSlots(GT)).toEqual([]);
    expect(
      requiredPhotoSlots({ ...GT, requiresLowerUpload: true, requiresThirdUpload: true }),
    ).toEqual(['lowerFront', 'third']);
  });
  it('firstMissingSlot walks the slots in order', () => {
    const gt = { ...GT, requiresLowerUpload: true, requiresThirdUpload: true };
    expect(firstMissingSlot(session({ garmentType: gt }))).toBe('lowerFront');
    expect(firstMissingSlot(session({ garmentType: gt, photos: { lowerFront: 'L' } }))).toBe(
      'third',
    );
    expect(
      firstMissingSlot(session({ garmentType: gt, photos: { lowerFront: 'L', third: 'T' } })),
    ).toBeNull();
  });
});

describe('maxCount', () => {
  it('is the eligible look count, capped at 9', () => {
    expect(maxCount(session())).toBe(3);
    const many = Array.from({ length: 12 }, (_, i) => look(`l${i}`));
    expect(
      maxCount(session({ template: { id: 't', mappingId: 'm', lowerOnly: false, looks: many } })),
    ).toBe(9);
  });
});

describe('buildTryonBody', () => {
  it('sends the picked looks with the mapping id, defaults only where a slot needs one, no platform', () => {
    const body = buildTryonBody(session({ picked: ['shoes', 'up'] }));
    expect(body).toEqual({
      aspectRatio: '3:4',
      resolution: 'HD',
      inputs: {
        upperGarmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
        faceId: 'face-1',
        garmentTypeId: 'gt-1',
        looks: [
          { poseId: 'pose-shoes', backgroundId: 'bg-shoes' },
          { poseId: 'pose-up', backgroundId: 'bg-up' },
        ],
        catalogueTemplateMappingId: 'map-1',
        shoeCatalogId: 'shoe-default',
      },
    });
    expect(body).not.toHaveProperty('platform');
    expect(body.inputs).not.toHaveProperty('backgroundId');
    expect(body.inputs).not.toHaveProperty('poseIds');
  });
  it('a combined look gets the default lower', () => {
    expect(buildTryonBody(session({ picked: ['comb'] })).inputs.lowerCatalogId).toBe(
      'lower-default',
    );
  });
  it('lower-only: the one photo is sent as both upper and lower, no lower item', () => {
    const body = buildTryonBody(
      session({
        template: { id: 't', mappingId: 'm', lowerOnly: true, looks: [LOWER_ONLY] },
        picked: ['lo'],
      }),
    );
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('a lower-photo type sends that photo and no lower item', () => {
    const body = buildTryonBody(
      session({
        garmentType: { ...GT, requiresLowerUpload: true },
        photos: { lowerFront: 'inputs/l/garment.jpg' },
        picked: ['comb'],
      }),
    );
    expect(body.inputs.lowerGarmentKey).toBe('inputs/l/garment.jpg');
    expect(body.inputs).not.toHaveProperty('lowerCatalogId');
  });
  it('the third photo goes to thirdGarmentKey', () => {
    const body = buildTryonBody(
      session({ garmentType: { ...GT, requiresThirdUpload: true }, photos: { third: 'T' } }),
    );
    expect(body.inputs.thirdGarmentKey).toBe('T');
  });
  it('explicit look ids (retry) override the picks and unknown ids are ignored', () => {
    const body = buildTryonBody(session({ picked: ['up', 'comb'] }), ['comb', 'gone']);
    expect(body.inputs.looks).toEqual([{ poseId: 'pose-comb', backgroundId: 'bg-comb' }]);
  });
});
