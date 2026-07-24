import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { tick } from './tick.js';
import { plant } from './plant.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import { FEED_RESOURCE } from './adapters/feed.js';
import type { DimensionSpec, SourceConfig } from './domain/spec.js';

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

function fixturesFor(source: SourceConfig, payload: unknown) {
  return { [`${source.id}:${FEED_RESOURCE}`]: payload };
}

async function plantedDimension(
  index: number,
  sources: readonly SourceConfig[] = [HN_SOURCE]
): Promise<InMemoryRelay> {
  const relay = new InMemoryRelay();
  const brain = new ScriptedBrain({
    compile: () => ({
      sources,
      nipMappings: [{ nip: 'NIP-01', kind: 1 }],
      cadence: 'hourly',
      budgetCap: 1000,
      relaySet: ['wss://relay.example'],
    }),
  });
  await plant(
    { utterance: 'hn roguelike scene', mnemonic: MNEMONIC, index },
    { relay, brain }
  );
  return relay;
}

describe('tick', () => {
  it('publishes exactly the gate-passed candidates beyond the derived cursor, signed by the dimension key', async () => {
    const relay = await plantedDimension(10);
    const below = new FixtureBelow({
      fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 10);

    const result = await tick(
      { mnemonic: MNEMONIC, index: 10 },
      { below, relay }
    );

    expect(result.kickedBack).toEqual([]);
    expect(result.published).toHaveLength(2);
    for (const event of result.published) {
      expect(event.pubkey).toBe(identity.pubkey);
      expect(verifyEvent({ ...event, created_at: event.createdAt })).toBe(true);
    }

    const dittos = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [1],
    });
    expect(dittos).toHaveLength(2);
  });

  it('a second tick with unchanged fixtures publishes zero new events (cursor via read-back)', async () => {
    const relay = await plantedDimension(11);
    const below = new FixtureBelow({
      fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
    });

    const first = await tick(
      { mnemonic: MNEMONIC, index: 11 },
      { below, relay }
    );
    expect(first.published).toHaveLength(2);

    const second = await tick(
      { mnemonic: MNEMONIC, index: 11 },
      { below, relay }
    );

    expect(second.published).toEqual([]);
    expect(second.kickedBack).toEqual([]);

    const identity = deriveDimensionIdentity(MNEMONIC, 11);
    const dittos = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [1],
    });
    expect(dittos).toHaveLength(2);
  });

  it('publishes nothing new even from a completely fresh call (read-back, not cache, decides)', async () => {
    const relay = await plantedDimension(12);

    await tick(
      { mnemonic: MNEMONIC, index: 12 },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
        }),
        relay,
      }
    );

    // A brand-new Below fake stands in for "all local state deleted" — tick
    // itself holds no state of its own, so only the relay read-back can be
    // what decides this.
    const again = await tick(
      { mnemonic: MNEMONIC, index: 12 },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
        }),
        relay,
      }
    );

    expect(again.published).toEqual([]);
  });

  it('kicks back an oversized candidate without publishing it, and retries it (never silently skipping it) while newer resources still publish', async () => {
    const oversizedText = 'x'.repeat(9000);
    const mixedPayload = [
      {
        id: 1,
        title: 'Huge one',
        by: 'pg',
        time: 1_784_000_000,
        text: oversizedText,
      },
      {
        id: 2,
        title: 'Normal one',
        by: 'dang',
        time: 1_784_003_600,
      },
    ];
    const relay = await plantedDimension(13);
    const below = new FixtureBelow({
      fixtures: fixturesFor(HN_SOURCE, mixedPayload),
    });

    const first = await tick(
      { mnemonic: MNEMONIC, index: 13 },
      { below, relay }
    );

    expect(first.published).toHaveLength(1);
    expect(first.kickedBack).toHaveLength(1);
    expect(first.kickedBack[0]?.reasons).toContain('content:oversized');
    expect(first.kickedBack[0]?.sourceId).toBe(HN_SOURCE.id);

    const second = await tick(
      { mnemonic: MNEMONIC, index: 13 },
      { below, relay }
    );

    expect(second.published).toEqual([]);
    expect(second.kickedBack).toHaveLength(1);
    expect(second.kickedBack[0]?.resourceUrl).toBe(
      first.kickedBack[0]?.resourceUrl
    );
  });

  it('throws a clear error when the dimension has not been planted yet', async () => {
    const relay = new InMemoryRelay();
    const below = new FixtureBelow({ fixtures: {} });

    await expect(
      tick({ mnemonic: MNEMONIC, index: 99 }, { below, relay })
    ).rejects.toThrow(/not been planted/i);
  });

  it('fetches every configured source and tags published dittos with their own source id', async () => {
    const RSS_SOURCE: SourceConfig = {
      id: 'indie-blog',
      kind: 'rss',
      endpoint: 'https://indie.example/feed',
    };
    const relay = await plantedDimension(14, [HN_SOURCE, RSS_SOURCE]);
    const below = new FixtureBelow({
      fixtures: {
        ...fixturesFor(HN_SOURCE, HN_PAYLOAD),
        ...fixturesFor(RSS_SOURCE, [
          {
            title: 'Shipping a roguelike in a weekend',
            link: 'https://indie.example/posts/roguelike-weekend',
            author: 'ada',
            pubDate: '2026-07-20T12:00:00.000Z',
            content: 'How I built a roguelike in 48 hours.',
          },
        ]),
      },
    });

    const result = await tick(
      { mnemonic: MNEMONIC, index: 14 },
      { below, relay }
    );

    expect(result.published).toHaveLength(3);
    const sourceTags = result.published.map(
      (event) => event.tags.find((tag) => tag[0] === 'source')?.[1]
    );
    expect(new Set(sourceTags)).toEqual(new Set([HN_SOURCE.id, RSS_SOURCE.id]));
  });
});
