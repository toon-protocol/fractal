import type { RelaySignedEvent } from '@toon-protocol/fractal/ports';

/**
 * Deterministic fixture events for component tests — no network, no relay.
 * {@link FIXTURE_EVENTS} is one dimension's full event history: profile,
 * seed, spec, two dittos (one with provenance tags, one without), one
 * interpretation referencing both, and a tick report (CONTEXT.md — Ditto,
 * Interpretation). The hostile- and malformed-resource dittos are exported
 * on their own rather than folded into that history: they are the renderer's
 * untrusted-input cases, not part of a well-formed dimension.
 *
 * Kinds are written as their literal wire numbers on purpose — a fixture
 * that reused fractal's exported constants could never catch a kind
 * regression, because it would move with the code under test.
 */

export const FIXTURE_PUBKEY =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

let counter = 0;
function nextId(): string {
  counter += 1;
  return `event-${counter}`;
}

function buildEvent(
  overrides: Partial<RelaySignedEvent> & Pick<RelaySignedEvent, 'kind'>
): RelaySignedEvent {
  return {
    id: nextId(),
    pubkey: FIXTURE_PUBKEY,
    content: '',
    tags: [],
    createdAt: 1_700_000_000,
    sig: 'sig',
    ...overrides,
  };
}

export const FIXTURE_PROFILE_EVENT = buildEvent({
  kind: 0,
  content: JSON.stringify({ about: 'A dimension of the indie game dev scene' }),
  createdAt: 1_700_000_000,
});

export const FIXTURE_SEED_EVENT = buildEvent({
  kind: 3300,
  content: JSON.stringify({
    id: FIXTURE_PUBKEY,
    utterance: 'build me a dimension of the indie game dev scene',
    plantedAt: '2026-01-01T00:00:00.000Z',
  }),
  createdAt: 1_700_000_000,
});

export const FIXTURE_SPEC_EVENT = buildEvent({
  kind: 3301,
  content: JSON.stringify({
    sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
    nipMappings: [{ nip: 'NIP-01', kind: 1 }],
    cadence: 'hourly',
    budgetCap: 1000,
    relaySet: ['wss://relay.toon.social'],
  }),
  createdAt: 1_700_000_000,
});

export const FIXTURE_DITTO_EVENT = buildEvent({
  kind: 1,
  content: 'Show HN: a new roguelike engine\n\nhttps://hn.example/item/1',
  tags: [
    ['r', 'https://hn.example/item/1'],
    ['source', 'hn'],
    ['resource', 'https://hn.example/top#0'],
  ],
  createdAt: 1_700_000_100,
});

/** A ditto whose `resource` tag is a hostile `javascript:` URL — permissionless-relay data must never become a clickable script sink. */
export const FIXTURE_DITTO_EVENT_HOSTILE_RESOURCE = buildEvent({
  kind: 1,
  content: 'A ditto published by an attacker',
  tags: [
    ['source', 'hn'],
    ['resource', 'javascript:alert(1)'],
  ],
  createdAt: 1_700_000_120,
});

/** A ditto whose `resource` tag is not a parseable absolute URL at all. */
export const FIXTURE_DITTO_EVENT_MALFORMED_RESOURCE = buildEvent({
  kind: 1,
  content: 'A ditto with a malformed resource tag',
  tags: [
    ['source', 'hn'],
    ['resource', 'not a url'],
  ],
  createdAt: 1_700_000_110,
});

/** A ditto missing its provenance tags — malformed relay data at the read boundary. */
export const FIXTURE_DITTO_EVENT_NO_PROVENANCE = buildEvent({
  kind: 1,
  content: 'A ditto with no provenance tags',
  tags: [],
  createdAt: 1_700_000_050,
});

export const FIXTURE_INTERPRETATION_EVENT = buildEvent({
  kind: 1111,
  content: 'Two more roguelike engines this week — the genre keeps growing.',
  tags: [
    ['e', FIXTURE_DITTO_EVENT.id],
    ['e', FIXTURE_DITTO_EVENT_NO_PROVENANCE.id],
  ],
  createdAt: 1_700_000_200,
});

export const FIXTURE_TICK_REPORT_EVENT = buildEvent({
  kind: 3302,
  content: JSON.stringify({
    published: 1,
    feesPaid: 1,
    spent: 1,
    budgetRemaining: 999,
    kickedBack: [],
    withheld: [],
  }),
  createdAt: 1_700_000_150,
});

export const FIXTURE_EVENTS: readonly RelaySignedEvent[] = [
  FIXTURE_PROFILE_EVENT,
  FIXTURE_SEED_EVENT,
  FIXTURE_SPEC_EVENT,
  FIXTURE_DITTO_EVENT,
  FIXTURE_DITTO_EVENT_NO_PROVENANCE,
  FIXTURE_INTERPRETATION_EVENT,
  FIXTURE_TICK_REPORT_EVENT,
];
