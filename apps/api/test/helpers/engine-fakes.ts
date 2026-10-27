import { AppError } from '../../src/lib/errors';
import type {
  EngineContext,
  EngineDeps,
  GarmentTypeOption,
  PoseLook,
  TryonBody,
  UnavailableReport,
} from '../../src/modules/messaging/engine/types';

export const CTX: EngineContext = { userId: 'user-1', accountId: 'acct-1', messageId: 'wamid.1' };

export const GT_SHIRT: GarmentTypeOption = {
  id: 'gt-shirt',
  label: 'Shirt',
  requiresLowerUpload: false,
  requiresThirdUpload: false,
  upperUploadLabel: null,
  lowerUploadLabel: null,
  thirdUploadLabel: null,
  defaultLowerCatalogId: 'lower-default',
  defaultShoeCatalogId: null,
};

export const look = (id: string, roles: Partial<PoseLook> = {}): PoseLook => ({
  id,
  label: `Pose ${id}`,
  imageUrl: `https://img/${id}.jpg`,
  hasUpper: true,
  hasLower: false,
  hasShoes: false,
  ...roles,
});

// 'd' has a shoe slot and GT_SHIRT has no default shoe → not offered (D49).
export const POSES: PoseLook[] = [
  look('a'),
  look('b', { hasLower: true }),
  look('c'),
  look('d', { hasShoes: true }),
];

const lookCount = (body: TryonBody) => body.inputs.looks?.length ?? 0;

export function fakeDeps(over: Partial<EngineDeps> = {}) {
  let n = 0;
  const calls = {
    quote: [] as TryonBody[],
    createRun: [] as TryonBody[],
    // The idempotency key each createRun call was given (ctx.messageId).
    createRunKeys: [] as string[],
    recognize: [] as { garmentKey: string; gender: string }[],
    basketTypes: [] as { gender: string; key: string }[],
    corrected: 0,
    unavailable: [] as UnavailableReport[],
  };
  const deps: EngineDeps = {
    newNonce: () => `n${++n}`,
    getUserDefaults: async () => ({ aspectRatio: '3:4', resolution: 'HD' }),
    getBalance: async () => 50,
    shuffle: (ids) => ids,
    listGarmentTypes: async () => [GT_SHIRT],
    recognizeBaskets: async () => null,
    // By default every offered type is a basket of its own, as with no baskets set up.
    basketTypes: async (_g, key) =>
      key === `t:${GT_SHIRT.id}` ? [{ id: GT_SHIRT.id, label: GT_SHIRT.label }] : [],
    listBaskets: async (gender) =>
      (await deps.listGarmentTypes(gender)).map((t) => ({ key: `t:${t.id}`, name: t.label })),
    recordRecognitionCorrected: () => {
      calls.corrected++;
    },
    reportUnavailable: (r) => {
      calls.unavailable.push(r);
    },
    getReadiness: async () => ({ status: 'ready', reasons: [] }),
    createStudioDraft: async (d) => `https://app.test/studio?draft=${d.garmentKey}`,
    getLooks: async () => POSES,
    listFaceIds: async () => ['face-1'],
    listBackgroundIds: async () => ['bg-1'],
    // Lower items exist; no shoes do, so a shoe pose needs the type's own default.
    listCatalogItemIds: async (type) => (type === 'lower' ? ['lower-1'] : []),
    quote: async (_u, body) => {
      calls.quote.push(body);
      const images = lookCount(body);
      return { images, perImage: 5, total: images * 5, balance: 50 };
    },
    createRun: async (ctx, body) => {
      calls.createRun.push(body);
      calls.createRunKeys.push(ctx.messageId);
      return { runId: `run-${calls.createRun.length}`, images: lookCount(body) };
    },
    runProgress: async () => ({ finished: 1, total: 2 }),
    // Nothing is generating unless a test says so.
    activeRun: async () => null,
    links: {
      pricing: 'https://app.test/pricing',
      help: 'https://app.test/contact-us',
      studio: 'https://app.test/studio',
    },
    ...over,
  };
  // Logged around any override, so a test that supplies an answer still sees
  // what the engine asked.
  const recognizeBaskets = deps.recognizeBaskets;
  const basketTypes = deps.basketTypes;
  deps.recognizeBaskets = async (garmentKey, gender) => {
    calls.recognize.push({ garmentKey, gender });
    return recognizeBaskets(garmentKey, gender);
  };
  deps.basketTypes = async (gender, key) => {
    calls.basketTypes.push({ gender, key });
    return basketTypes(gender, key);
  };
  return { deps, calls };
}

export const insufficient = () => new AppError('INSUFFICIENT_CREDITS', 402, 'insufficient credits');
