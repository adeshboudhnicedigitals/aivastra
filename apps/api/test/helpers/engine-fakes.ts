import { AppError } from '../../src/lib/errors';
import type {
  EngineContext,
  EngineDeps,
  GarmentTypeOption,
  TemplateLook,
  TemplateOption,
  TryonBody,
} from '../../src/modules/messaging/engine/types';

export const CTX: EngineContext = { userId: 'user-1', accountId: 'acct-1', messageId: 'wamid.1' };

export const GT_SHIRT: GarmentTypeOption = {
  id: 'gt-shirt',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: null,
};

export const look = (id: string, roles: Partial<TemplateLook> = {}): TemplateLook => ({
  id,
  poseId: `pose-${id}`,
  backgroundId: `bg-${id}`,
  label: `Pose ${id}`,
  imageUrl: `https://img/${id}.jpg`,
  hasUpper: true,
  hasLower: false,
  hasShoes: false,
  ...roles,
});

// 'd' has a shoe slot and GT_SHIRT has no default shoe → not offered (D49).
export const TEMPLATE: TemplateOption = {
  id: 'tpl-1',
  mappingId: 'map-1',
  looks: [look('a'), look('b', { hasLower: true }), look('c'), look('d', { hasShoes: true })],
};

const lookCount = (body: TryonBody) => body.inputs.looks?.length ?? 0;

export function fakeDeps(over: Partial<EngineDeps> = {}) {
  let n = 0;
  const calls = {
    quote: [] as TryonBody[],
    createRun: [] as TryonBody[],
    recognize: [] as { garmentKey: string; gender: string }[],
    corrected: 0,
  };
  const deps: EngineDeps = {
    newNonce: () => `n${++n}`,
    getUserDefaults: async () => ({ aspectRatio: '3:4', resolution: 'HD' }),
    getBalance: async () => 50,
    listGarmentTypes: async () => [GT_SHIRT],
    recognizeGarment: async (garmentKey, gender) => {
      calls.recognize.push({ garmentKey, gender });
      return null;
    },
    recordRecognitionCorrected: () => {
      calls.corrected++;
    },
    getTemplate: async () => TEMPLATE,
    getDefaultFaceId: async () => 'face-1',
    quote: async (_u, body) => {
      calls.quote.push(body);
      const images = lookCount(body);
      return { images, perImage: 5, total: images * 5, balance: 50 };
    },
    createRun: async (_ctx, body) => {
      calls.createRun.push(body);
      return { runId: 'run-1', images: lookCount(body) };
    },
    runProgress: async () => ({ finished: 1, total: 2 }),
    links: {
      pricing: 'https://app.test/pricing',
      help: 'https://app.test/contact-us',
      studio: 'https://app.test/studio',
    },
    ...over,
  };
  return { deps, calls };
}

export const insufficient = () => new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
