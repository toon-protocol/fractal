import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { interpret } from './interpret.js';
import { tick } from './tick.js';
import { plant } from './plant.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import type { BrainScript } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import { FEED_RESOURCE } from './adapters/feed.js';
import { INTERPRETATION_EVENT_KIND } from './domain/event.js';
import { MAX_CANDIDATE_CONTENT_LENGTH } from './domain/gate.js';
import type { SourceConfig } from './domain/spec.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const HN_SOURCE: SourceConfig = {
  id: 'hn-top',
  kind: 'hn',
  endpoint: 'https://hacker-news.example/api',
};

const HN_PAYLOAD = [
  {
    id: 41,
    title: 'Show HN: fractal',
    url: 'https://hacker-news.example/items/41',
    by: 'pg',
    time: 1_784_000_000,
    text: 'A CLI that grows nostr dimensions from a seed.',
  },
  {
    id: 42,
    title: 'Ask HN: best roguelike devlogs?',
    by: 'dang',
    time: 1_784_003_600,
  },
];

async function dittoedDimension(
  index: number,
  brainScript: BrainScript = {}
): Promise<InMemoryRelay> {
  const relay = new InMemoryRelay();
  const below = new FixtureBelow({
    fixtures: { [`${HN_SOURCE.id}:${FEED_RESOURCE}`]: HN_PAYLOAD },
  });
  const brain = new ScriptedBrain({
    compile: () => ({
      sources: [HN_SOURCE],
      nipMappings: [{ nip: 'NIP-01', kind: 1 }],
      cadence: 'hourly',
      budgetCap: 1000,
      relaySet: ['wss://relay.example'],
    }),
    ...brainScript,
  });
  await plant(
    { utterance: 'hn roguelike scene', mnemonic: MNEMONIC, index },
    { relay, brain }
  );
  await tick({ mnemonic: MNEMONIC, index }, { below, relay });
  return relay;
}

describe('interpret', () => {
  it('publishes commentary referencing every existing ditto, structurally distinct from a ditto, signed by the dimension key', async () => {
    const relay = await dittoedDimension(30, {
      interpret: () =>
        'The dimension notices a wave of roguelike devlogs this week.',
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 30);

    const dittos = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [1],
    });
    expect(dittos).toHaveLength(2);

    const result = await interpret(
      { mnemonic: MNEMONIC, index: 30 },
      { relay, brain: new ScriptedBrain({ interpret: () => 'commentary' }) }
    );

    expect(result.kickedBack).toEqual([]);
    expect(result.published).toHaveLength(1);
    const [event] = result.published;
    expect(event?.pubkey).toBe(identity.pubkey);
    expect(event?.kind).toBe(INTERPRETATION_EVENT_KIND);
    expect(event?.kind).not.toBe(1);
    expect(verifyEvent({ ...event, created_at: event?.createdAt })).toBe(true);

    const referencedIds = event?.tags
      .filter((tag) => tag[0] === 'e')
      .map((tag) => tag[1]);
    expect(new Set(referencedIds)).toEqual(
      new Set(dittos.map((ditto) => ditto.id))
    );
    expect(event?.tags.some((tag) => tag[0] === 'source')).toBe(false);
    expect(event?.tags.some((tag) => tag[0] === 'resource')).toBe(false);
  });

  it('publishes nothing and calls the brain not at all when there are no dittos yet', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({
      compile: () => ({
        sources: [HN_SOURCE],
        nipMappings: [{ nip: 'NIP-01', kind: 1 }],
        cadence: 'hourly',
        budgetCap: 1000,
        relaySet: ['wss://relay.example'],
      }),
    });
    await plant(
      { utterance: 'hn roguelike scene', mnemonic: MNEMONIC, index: 31 },
      { relay, brain }
    );

    const result = await interpret(
      { mnemonic: MNEMONIC, index: 31 },
      { relay, brain: new ScriptedBrain({}) }
    );

    expect(result.published).toEqual([]);
    expect(result.kickedBack).toEqual([]);
  });

  it('kicks back oversized commentary without publishing it', async () => {
    const relay = await dittoedDimension(32, {
      interpret: () => 'x'.repeat(MAX_CANDIDATE_CONTENT_LENGTH + 1),
    });

    const result = await interpret(
      { mnemonic: MNEMONIC, index: 32 },
      {
        relay,
        brain: new ScriptedBrain({
          interpret: () => 'x'.repeat(MAX_CANDIDATE_CONTENT_LENGTH + 1),
        }),
      }
    );

    expect(result.published).toEqual([]);
    expect(result.kickedBack).toHaveLength(1);
    expect(result.kickedBack[0]?.reasons).toContain('content:oversized');
  });

  it('throws a clear error when the dimension has not been planted yet', async () => {
    const relay = new InMemoryRelay();

    await expect(
      interpret(
        { mnemonic: MNEMONIC, index: 99 },
        { relay, brain: new ScriptedBrain({}) }
      )
    ).rejects.toThrow(/not been planted/i);
  });
});
