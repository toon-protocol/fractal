import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintAppToken } from './mint-app-token.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const ORIGINAL_ENV = { ...process.env };

describe('mintAppToken', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.APP_ID;
    delete process.env.APP_PRIVATE_KEY;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('falls back to the ambient GH_TOKEN when APP_ID/APP_PRIVATE_KEY are absent', async () => {
    process.env.GH_TOKEN = 'ghs_ambient123';

    const result = await mintAppToken();

    expect(result).toEqual({ token: 'ghs_ambient123', source: 'ambient' });
  });

  it('throws when neither an App credential nor GH_TOKEN is available', async () => {
    await expect(mintAppToken()).rejects.toThrow(/no GH_TOKEN to fall back to/);
  });

  it('mints a fresh installation token via the App JWT flow', async () => {
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_REPOSITORY = 'toon-protocol/fractal';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 999 }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'ghs_freshlyMinted' }), {
          status: 201,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await mintAppToken();

    expect(result).toEqual({ token: 'ghs_freshlyMinted', source: 'app' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/toon-protocol/fractal/installation'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/app/installations/999/access_tokens'
    );
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((firstInit.headers as Record<string, string>).Authorization).toMatch(
      /^Bearer /
    );
  });

  it('throws when GitHub returns no installation id', async () => {
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_REPOSITORY = 'toon-protocol/fractal';

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), { status: 200 })
        )
    );

    await expect(mintAppToken()).rejects.toThrow(/no installation id/);
  });

  it('throws when the access-token response carries no token', async () => {
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_REPOSITORY = 'toon-protocol/fractal';

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 999 }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), { status: 201 })
        )
    );

    await expect(mintAppToken()).rejects.toThrow(/no `token` field/);
  });

  it('surfaces a failed GitHub API call with status and body', async () => {
    process.env.APP_ID = '12345';
    process.env.APP_PRIVATE_KEY = privateKey;
    process.env.GITHUB_REPOSITORY = 'toon-protocol/fractal';

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('not found', { status: 404, statusText: 'Not Found' })
        )
    );

    await expect(mintAppToken()).rejects.toThrow(/404/);
  });
});
