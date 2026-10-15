import { describe, expect, it } from 'vitest';
import { resolveUserStorageConfig } from '../src/user-storage-config.js';

const FULL = {
  USER_STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  USER_STORAGE_ACCESS_KEY_ID: 'id',
  USER_STORAGE_SECRET_ACCESS_KEY: 'secret',
  USER_STORAGE_BUCKET: 'aivastra-user',
};

describe('resolveUserStorageConfig', () => {
  it('is off when nothing is set', () => {
    expect(resolveUserStorageConfig({})).toBeUndefined();
  });

  it('treats empty strings from a .env file as unset', () => {
    expect(
      resolveUserStorageConfig({
        USER_STORAGE_ENDPOINT: '',
        USER_STORAGE_ACCESS_KEY_ID: '',
        USER_STORAGE_SECRET_ACCESS_KEY: '',
        USER_STORAGE_BUCKET: '',
      }),
    ).toBeUndefined();
  });

  it('refuses a partial config, naming what is missing', () => {
    expect(() => resolveUserStorageConfig({ ...FULL, USER_STORAGE_SECRET_ACCESS_KEY: '' })).toThrow(
      'missing USER_STORAGE_SECRET_ACCESS_KEY',
    );
  });

  it('builds a path-style R2 config with a default public URL', () => {
    expect(resolveUserStorageConfig(FULL)).toEqual({
      endpoint: FULL.USER_STORAGE_ENDPOINT,
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      bucket: 'aivastra-user',
      publicUrl: 'https://acct.r2.cloudflarestorage.com/aivastra-user',
      forcePathStyle: true,
      region: 'auto',
    });
  });

  it('uses an explicit public URL when given', () => {
    expect(
      resolveUserStorageConfig({ ...FULL, USER_STORAGE_PUBLIC_URL: 'https://cdn.example.com' })
        ?.publicUrl,
    ).toBe('https://cdn.example.com');
  });
});
