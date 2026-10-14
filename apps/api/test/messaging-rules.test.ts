import { describe, expect, it } from 'vitest';
import {
  buildPool,
  buildTryonBody,
  groupByTemplate,
  MAX_PICKS,
  retryLookIds,
} from '../src/modules/messaging/engine/rules';
import type { Session, TemplateOption } from '../src/modules/messaging/engine/types';
import { GT_SHIRT, look, TEMPLATE, TEMPLATE_2 } from './helpers/engine-fakes';

const LOWER_ONLY: TemplateOption = {
  id: 'tpl-3',
  mappingId: 'map-3',
  looks: [look('j', { hasUpper: false, hasLower: true })],
};

const session = (over: Partial<Session> = {}): Session => ({
  v: 1,
  state: 'PICK_LOOKS',
  nonce: 'n1',
  page: 0,
  aspectRatio: '3:4',
  resolution: '2K',
  photos: {},
  picked: [],
  garmentKey: 'inputs/x/garment.jpg',
  faceId: 'face-1',
  garmentType: GT_SHIRT,
  ...over,
});

describe('buildPool', () => {
  it('joins every template, in order, keeping only looks the bot can generate', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);
    expect(templates.map((t) => t.id)).toEqual(['tpl-1', 'tpl-2']);
    // 'd' needs shoes and GT_SHIRT has no default shoe (D49).
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c', 'e', 'f']);
  });

  it('shows a pose + background pair that appears twice once, under the first template', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);
    expect(cards.map((c) => c.id)).not.toContain('a2');
    expect(templates[1].looks.map((l) => l.id)).toEqual(['e', 'f']);
  });

  it('decides lowerOnly per template', () => {
    const { templates } = buildPool(GT_SHIRT, [TEMPLATE, LOWER_ONLY]);
    expect(templates.map((t) => [t.id, t.lowerOnly])).toEqual([
      ['tpl-1', false],
      ['tpl-3', true],
    ]);
  });

  it('drops a template with no eligible look', () => {
    const shoeOnly: TemplateOption = {
      id: 'tpl-4',
      mappingId: 'map-4',
      looks: [look('s', { hasShoes: true })],
    };
    const { templates } = buildPool(GT_SHIRT, [shoeOnly, TEMPLATE]);
    expect(templates.map((t) => t.id)).toEqual(['tpl-1']);
  });

  it('keeps ids and flags only in the session pool, and label + image in the cards', () => {
    const { templates, cards } = buildPool(GT_SHIRT, [TEMPLATE]);
    expect(templates[0].looks[1]).toEqual({
      id: 'b',
      poseId: 'pose-b',
      backgroundId: 'bg-b',
      hasLower: true,
      hasShoes: false,
    });
    expect(cards[0]).toEqual({ id: 'a', label: 'Pose a', imageUrl: 'https://img/a.jpg' });
  });
});

describe('groupByTemplate', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('groups picks by template, in template order, keeping tap order inside a group', () => {
    expect(
      groupByTemplate(templates, ['f', 'c', 'e', 'a']).map((g) => [g.template.id, g.lookIds]),
    ).toEqual([
      ['tpl-1', ['c', 'a']],
      ['tpl-2', ['f', 'e']],
    ]);
  });

  it('ignores ids that are in no template and skips templates with no pick', () => {
    expect(groupByTemplate(templates, ['e', 'zzz']).map((g) => g.template.id)).toEqual(['tpl-2']);
  });
});

describe('buildTryonBody', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('uses the given template mapping and only its looks', () => {
    const body = buildTryonBody(session(), templates[1], ['f', 'e']);
    expect(body.inputs).toMatchObject({
      catalogueTemplateMappingId: 'map-2',
      looks: [
        { poseId: 'pose-f', backgroundId: 'bg-f' },
        { poseId: 'pose-e', backgroundId: 'bg-e' },
      ],
    });
    expect(body.aspectRatio).toBe('3:4');
    expect(body.resolution).toBe('2K');
  });

  it('sends the default lower only when a chosen look has a lower slot', () => {
    expect(buildTryonBody(session(), templates[0], ['a']).inputs).not.toHaveProperty(
      'lowerCatalogId',
    );
    expect(buildTryonBody(session(), templates[0], ['b']).inputs.lowerCatalogId).toBe(
      'lower-default',
    );
  });

  it('sends the photo as the lower garment for a lower-only template', () => {
    const { templates: t } = buildPool(GT_SHIRT, [LOWER_ONLY]);
    const body = buildTryonBody(session(), t[0], ['j']);
    expect(body.inputs.lowerGarmentKey).toBe(body.inputs.upperGarmentKey);
  });

  it('throws when the session lacks the garment or face', () => {
    expect(() => buildTryonBody(session({ garmentKey: undefined }), templates[0], ['a'])).toThrow(
      'session incomplete',
    );
  });
});

describe('retryLookIds', () => {
  const { templates } = buildPool(GT_SHIRT, [TEMPLATE, TEMPLATE_2]);

  it('is the picked looks whose pose failed, plus the unstarted ones, in tap order', () => {
    const s = session({
      templates,
      picked: ['a', 'e', 'c'],
      runs: [
        { runId: 'run-1', images: 2, finished: true, failedPoseIds: ['pose-c'] },
        { runId: 'run-2', images: 1, finished: true },
      ],
      unstarted: ['e'],
    });
    expect(retryLookIds(s)).toEqual(['e', 'c']);
  });

  it('is empty when nothing failed and nothing is unstarted', () => {
    expect(
      retryLookIds(session({ templates, picked: ['a'], runs: [{ runId: 'r', images: 1 }] })),
    ).toEqual([]);
  });
});

describe('MAX_PICKS', () => {
  it('is 20', () => expect(MAX_PICKS).toBe(20));
});
