import { describe, expect, it } from 'vitest';
import { evaluateCandidate, MAX_CANDIDATE_CONTENT_LENGTH } from './gate.js';
import type { CandidateEvent } from './event.js';
import type { DimensionSpec } from './spec.js';

function spec(overrides: Partial<DimensionSpec> = {}): DimensionSpec {
  return {
    sources: [
      { id: 'hn', kind: 'rss', endpoint: 'https://hacker-news.example/api' },
    ],
    nipMappings: [
      { nip: 'NIP-01', kind: 1 },
      { nip: 'NIP-01', kind: 0 },
    ],
    cadence: 'hourly',
    budgetCap: 1000,
    relaySet: ['wss://relay.toon.example'],
    ...overrides,
  };
}

function noteCandidate(
  overrides: Partial<CandidateEvent> = {}
): CandidateEvent {
  return {
    kind: 1,
    content: 'Show HN: a faithful ditto of a below resource',
    tags: [['source', 'hn']],
    createdAt: 1_700_000_000,
    provenance: {
      sourceId: 'hn',
      resourceUrl: 'https://hacker-news.example/api/item/1',
      fetchedAt: '2026-07-24T00:00:00.000Z',
    },
    ...overrides,
  };
}

function profileCandidate(
  overrides: Partial<CandidateEvent> = {}
): CandidateEvent {
  return noteCandidate({
    kind: 0,
    content: JSON.stringify({
      name: 'hn-dimension',
      about: 'a fractal dimension',
    }),
    ...overrides,
  });
}

describe('evaluateCandidate', () => {
  it('passes a valid kind:1 note with intact provenance', () => {
    expect(evaluateCandidate(noteCandidate(), spec())).toEqual({ ok: true });
  });

  it('passes a valid kind:0 profile with intact provenance', () => {
    expect(evaluateCandidate(profileCandidate(), spec())).toEqual({ ok: true });
  });

  it('never mutates the candidate it is handed', () => {
    const candidate = noteCandidate();
    const frozen = JSON.parse(JSON.stringify(candidate)) as CandidateEvent;
    Object.freeze(frozen);
    Object.freeze(frozen.tags);
    Object.freeze(frozen.provenance);

    expect(() => evaluateCandidate(frozen, spec())).not.toThrow();
    expect(frozen).toEqual(candidate);
  });

  it('performs no I/O — the verdict is available synchronously, not a promise', () => {
    const verdict = evaluateCandidate(noteCandidate(), spec());
    expect(verdict).not.toBeInstanceOf(Promise);
  });

  describe('bad schema', () => {
    it('rejects a candidate that is not an object', () => {
      expect(evaluateCandidate(null, spec())).toEqual({
        ok: false,
        reasons: ['schema:not-an-object'],
      });
    });

    it('rejects a non-integer kind', () => {
      const result = evaluateCandidate(noteCandidate({ kind: 1.5 }), spec());
      expect(result).toEqual({ ok: false, reasons: ['schema:invalid-kind'] });
    });

    it('rejects a kind the gate has no NIP-01 schema for', () => {
      const result = evaluateCandidate(noteCandidate({ kind: 30023 }), spec());
      expect(result).toEqual({
        ok: false,
        reasons: ['schema:unsupported-kind'],
      });
    });

    it('rejects a non-string content on a note', () => {
      const result = evaluateCandidate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        noteCandidate({ content: 42 as any }),
        spec()
      );
      expect(result).toEqual({
        ok: false,
        reasons: ['schema:invalid-content'],
      });
    });

    it('rejects non-JSON content on a profile', () => {
      const result = evaluateCandidate(
        profileCandidate({ content: 'not json' }),
        spec()
      );
      expect(result).toEqual({
        ok: false,
        reasons: ['schema:invalid-profile-content'],
      });
    });

    it('rejects tags that are not an array of non-empty string arrays', () => {
      const result = evaluateCandidate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        noteCandidate({ tags: 'nope' as any }),
        spec()
      );
      expect(result).toEqual({ ok: false, reasons: ['schema:invalid-tags'] });

      const emptyTagResult = evaluateCandidate(
        noteCandidate({ tags: [[]] }),
        spec()
      );
      expect(emptyTagResult).toEqual({
        ok: false,
        reasons: ['schema:invalid-tags'],
      });
    });

    it('rejects a non-positive createdAt', () => {
      const result = evaluateCandidate(noteCandidate({ createdAt: 0 }), spec());
      expect(result).toEqual({
        ok: false,
        reasons: ['schema:invalid-created-at'],
      });
    });

    it('rejects a candidate with structurally incomplete provenance', () => {
      const result = evaluateCandidate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        noteCandidate({ provenance: { sourceId: 'hn' } as any }),
        spec()
      );
      expect(result).toEqual({
        ok: false,
        reasons: ['schema:invalid-provenance'],
      });
    });
  });

  it('kicks back missing provenance as a distinct reason', () => {
    const result = evaluateCandidate(
      noteCandidate({
        provenance: {
          sourceId: 'hn',
          resourceUrl: '',
          fetchedAt: '2026-07-24T00:00:00.000Z',
        },
      }),
      spec()
    );
    expect(result).toEqual({ ok: false, reasons: ['provenance:missing'] });
  });

  it('kicks back forged provenance pointing at a source the spec never configured', () => {
    const result = evaluateCandidate(
      noteCandidate({
        provenance: {
          sourceId: 'reddit',
          resourceUrl: 'https://reddit.example/api/item/1',
          fetchedAt: '2026-07-24T00:00:00.000Z',
        },
      }),
      spec()
    );
    expect(result).toEqual({
      ok: false,
      reasons: ['provenance:forged-source'],
    });
  });

  it('kicks back forged provenance whose resourceUrl does not match its claimed source endpoint', () => {
    const result = evaluateCandidate(
      noteCandidate({
        provenance: {
          sourceId: 'hn',
          resourceUrl: 'https://evil.example/item/1',
          fetchedAt: '2026-07-24T00:00:00.000Z',
        },
      }),
      spec()
    );
    expect(result).toEqual({
      ok: false,
      reasons: ['provenance:forged-source'],
    });
  });

  it('kicks back a kind the spec does not map, even though the gate can schema-check it', () => {
    const result = evaluateCandidate(
      profileCandidate(),
      spec({ nipMappings: [{ nip: 'NIP-01', kind: 1 }] })
    );
    expect(result).toEqual({ ok: false, reasons: ['spec:kind-not-allowed'] });
  });

  it('kicks back oversized content', () => {
    const result = evaluateCandidate(
      noteCandidate({ content: 'a'.repeat(MAX_CANDIDATE_CONTENT_LENGTH + 1) }),
      spec()
    );
    expect(result).toEqual({ ok: false, reasons: ['content:oversized'] });
  });

  it('rejects a ditto that blends in interpretation via a reference to another event', () => {
    const result = evaluateCandidate(
      noteCandidate({
        content: 'This is such a fascinating take on the below resource!',
        tags: [
          ['source', 'hn'],
          ['e', 'the-ditto-this-is-actually-commentary-on'],
        ],
      }),
      spec()
    );
    expect(result).toEqual({
      ok: false,
      reasons: ['ditto:interpretation-blend'],
    });
  });

  it('accumulates every distinct kick-back reason in a single verdict', () => {
    const result = evaluateCandidate(
      noteCandidate({
        content: 'a'.repeat(MAX_CANDIDATE_CONTENT_LENGTH + 1),
        provenance: {
          sourceId: 'reddit',
          resourceUrl: 'https://reddit.example/api/item/1',
          fetchedAt: '2026-07-24T00:00:00.000Z',
        },
      }),
      spec({ nipMappings: [] })
    );
    expect(result).toEqual({
      ok: false,
      reasons: [
        'spec:kind-not-allowed',
        'provenance:forged-source',
        'content:oversized',
      ],
    });
  });
});
