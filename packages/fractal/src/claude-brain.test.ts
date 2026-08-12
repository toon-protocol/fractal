import { describe, expect, it, vi } from 'vitest';
import {
  ClaudeBrain,
  hasHeadlessClaudeCredentials,
  MAX_SPEC_ATTEMPTS,
} from './claude-brain.js';
import type { HeadlessQuery, HeadlessQueryResult } from './headless-claude.js';
import type { DimensionSpec } from './domain/spec.js';
import type { Seed } from './domain/seed.js';

const SEED: Seed = {
  id: 'pubkey-1',
  utterance: 'indie game dev scene',
  plantedAt: '2026-01-01T00:00:00.000Z',
};

const VALID_SPEC: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

function ok(text: string): HeadlessQueryResult {
  return { ok: true, text };
}

function err(error: string): HeadlessQueryResult {
  return { ok: false, error };
}

const CREDENTIALED_ENV = { ANTHROPIC_API_KEY: 'sk-test' };

describe('ClaudeBrain', () => {
  describe('compile', () => {
    it('returns the spec on the first valid reply — one query call', async () => {
      const query = vi.fn<HeadlessQuery>(async () =>
        ok(JSON.stringify(VALID_SPEC))
      );
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      const spec = await brain.compile({ seed: SEED });

      expect(spec).toEqual(VALID_SPEC);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('retries once on an invalid reply, then succeeds — kicked back with the validation reasons', async () => {
      const query = vi
        .fn<HeadlessQuery>()
        .mockResolvedValueOnce(
          ok(JSON.stringify({ ...VALID_SPEC, sources: [] }))
        )
        .mockResolvedValueOnce(ok(JSON.stringify(VALID_SPEC)));
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      const spec = await brain.compile({ seed: SEED });

      expect(spec).toEqual(VALID_SPEC);
      expect(query).toHaveBeenCalledTimes(2);
      const secondPrompt = query.mock.calls[1]?.[0].prompt;
      expect(secondPrompt).toMatch(/spec:invalid-sources/);
    });

    it('retries on unparseable JSON the same as an invalid spec', async () => {
      const query = vi
        .fn<HeadlessQuery>()
        .mockResolvedValueOnce(ok('not json'))
        .mockResolvedValueOnce(ok(JSON.stringify(VALID_SPEC)));
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      const spec = await brain.compile({ seed: SEED });

      expect(spec).toEqual(VALID_SPEC);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('gives up after the bounded number of attempts, throws a clear error, and never returns an invalid spec', async () => {
      const query = vi.fn<HeadlessQuery>(async () =>
        ok(JSON.stringify({ ...VALID_SPEC, sources: [] }))
      );
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      await expect(brain.compile({ seed: SEED })).rejects.toThrow(
        /gave up after 3 attempt/i
      );
      expect(query).toHaveBeenCalledTimes(MAX_SPEC_ATTEMPTS);
    });

    it('honours a custom maxAttempts bound', async () => {
      const query = vi.fn<HeadlessQuery>(async () => err('rate_limit'));
      const brain = new ClaudeBrain({
        query,
        env: CREDENTIALED_ENV,
        maxAttempts: 1,
      });

      await expect(brain.compile({ seed: SEED })).rejects.toThrow(
        /gave up after 1 attempt/i
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('never calls the model without credentials, and says exactly what is missing', async () => {
      const query = vi.fn<HeadlessQuery>(async () =>
        ok(JSON.stringify(VALID_SPEC))
      );
      const brain = new ClaudeBrain({ query, env: {} });

      await expect(brain.compile({ seed: SEED })).rejects.toThrow(
        /no Claude credentials.*ANTHROPIC_API_KEY.*CLAUDE_CODE_OAUTH_TOKEN/s
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('adapt', () => {
    it('shares the same bounded-retry validation as compile', async () => {
      const query = vi
        .fn<HeadlessQuery>()
        .mockResolvedValueOnce(
          ok(JSON.stringify({ ...VALID_SPEC, budgetCap: -1 }))
        )
        .mockResolvedValueOnce(ok(JSON.stringify(VALID_SPEC)));
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      const spec = await brain.adapt({
        spec: VALID_SPEC,
        reason: 'source drifted',
      });

      expect(spec).toEqual(VALID_SPEC);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('requires credentials, same as compile', async () => {
      const query = vi.fn<HeadlessQuery>(async () =>
        ok(JSON.stringify(VALID_SPEC))
      );
      const brain = new ClaudeBrain({ query, env: {} });

      await expect(
        brain.adapt({ spec: VALID_SPEC, reason: 'source drifted' })
      ).rejects.toThrow(/no Claude credentials/i);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('interpret', () => {
    it('returns the model text as-is — free text, nothing to validate', async () => {
      const query = vi.fn<HeadlessQuery>(async () =>
        ok('a lively week for indie devs')
      );
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      const commentary = await brain.interpret({ dittos: [] });

      expect(commentary).toBe('a lively week for indie devs');
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('throws a clear error when the query fails, without retrying', async () => {
      const query = vi.fn<HeadlessQuery>(async () => err('overloaded'));
      const brain = new ClaudeBrain({ query, env: CREDENTIALED_ENV });

      await expect(brain.interpret({ dittos: [] })).rejects.toThrow(
        /overloaded/
      );
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('never calls the model without credentials', async () => {
      const query = vi.fn<HeadlessQuery>(async () => ok('commentary'));
      const brain = new ClaudeBrain({ query, env: {} });

      await expect(brain.interpret({ dittos: [] })).rejects.toThrow(
        /no Claude credentials/i
      );
      expect(query).not.toHaveBeenCalled();
    });
  });
});

describe('hasHeadlessClaudeCredentials', () => {
  it('accepts either supported credential', () => {
    expect(hasHeadlessClaudeCredentials({ ANTHROPIC_API_KEY: 'sk-test' })).toBe(
      true
    );
    expect(
      hasHeadlessClaudeCredentials({ CLAUDE_CODE_OAUTH_TOKEN: 'token' })
    ).toBe(true);
  });

  it('rejects an environment with neither, or with an empty value', () => {
    expect(hasHeadlessClaudeCredentials({})).toBe(false);
    expect(hasHeadlessClaudeCredentials({ ANTHROPIC_API_KEY: '' })).toBe(false);
  });
});
