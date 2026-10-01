import { capabilityMutationError, parseCapabilities } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { readWorkerCapabilities } from './worker-capabilities.js';

const configured = {
  queuePromptIdentityValidated: true,
  queueDeleteValidated: true,
  promptScopedInterruptValidated: true,
  validatedComfyVersion: '0.37.0',
  validatedAt: '2026-10-01',
  validationReference: 'docs/progress.md#two-real-prompts',
};
const read = (value: unknown) => parseCapabilities(JSON.stringify(value));
describe('capability parsing and mutation transition table', () => {
  it.each([
    '{',
    'null',
    '[]',
    '{"queueDeleteValidated":"true"}',
    '{"queueDeleteValidated":true}',
  ])('malformed %s is unreadable, never legacy eligible', (raw) =>
    expect(parseCapabilities(raw).status).toBe('unreadable'));
  it.each([
    {},
    { queueDeleteValidated: false },
    {
      queuePromptIdentityValidated: false,
      queueDeleteValidated: false,
      promptScopedInterruptValidated: false,
    },
  ])('all false and empty are not configured', (value) =>
    expect(read(value).status).toBe('not_configured'));
  it.each([
    false,
    true,
  ])('every false to true requires gate even if already configured (draining=%s)', (draining) => {
    expect(
      capabilityMutationError(
        read({ ...configured, queueDeleteValidated: false }),
        configured,
        draining,
        false,
      ),
    ).toContain('queue gate');
    expect(
      capabilityMutationError(
        read({ ...configured, queueDeleteValidated: false }),
        configured,
        draining,
        true,
      ),
    ).toBeUndefined();
  });
  it('partial revocation and date-only update are immediately allowed', () => {
    expect(
      capabilityMutationError(
        read(configured),
        { ...configured, queueDeleteValidated: false },
        false,
        false,
      ),
    ).toBeUndefined();
    expect(
      capabilityMutationError(
        read(configured),
        { ...configured, validatedAt: '2026-10-02' },
        false,
        false,
      ),
    ).toBeUndefined();
  });
  it.each([
    null,
    {},
    {
      queuePromptIdentityValidated: false,
      queueDeleteValidated: false,
      promptScopedInterruptValidated: false,
    },
  ])('complete clear %s requires draining', (next) => {
    expect(capabilityMutationError(read(configured), next, false, true)).toBeDefined();
    expect(capabilityMutationError(read(configured), next, true, true)).toBeUndefined();
  });
  it('version change requires draining', () => {
    expect(
      capabilityMutationError(
        read(configured),
        { ...configured, validatedComfyVersion: 'new' },
        false,
        true,
      ),
    ).toBeDefined();
    expect(
      capabilityMutationError(
        read(configured),
        { ...configured, validatedComfyVersion: 'new' },
        true,
        true,
      ),
    ).toBeUndefined();
  });
  it('repair of unreadable keys requires draining', () => {
    expect(
      capabilityMutationError({ status: 'unreadable' }, configured, false, true),
    ).toBeDefined();
    expect(
      capabilityMutationError({ status: 'unreadable' }, configured, true, true),
    ).toBeUndefined();
  });
  it('unconfigured placeholder remains allowed without gate or drain', () =>
    expect(capabilityMutationError(read({}), {}, false, false)).toBeUndefined());
  it('scoped interrupt requires recorded two-real-prompts validation', () => {
    expect(
      capabilityMutationError(
        read({}),
        { ...configured, validationReference: undefined },
        true,
        true,
      ),
    ).toContain('two-real-prompts');
  });
});

it('display reads warn without emitting mutation alerts, while mutation reads emit them', async () => {
  const error = vi.fn();
  const app = {
    redis: { get: vi.fn(async () => '{') },
    log: { error },
  } as unknown as FastifyInstance;
  expect(await readWorkerCapabilities(app, 'w')).toEqual({ status: 'unreadable' });
  expect(await readWorkerCapabilities(app, 'w')).toEqual({ status: 'unreadable' });
  expect(error).not.toHaveBeenCalled();
  await readWorkerCapabilities(app, 'w', true);
  expect(error).toHaveBeenCalledTimes(1);
});
