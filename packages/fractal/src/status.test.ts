import { describe, expect, it } from 'vitest';
import { status } from './status.js';
import { tick } from './tick.js';
import { plant } from './plant.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import { FEED_RESOURCE } from './adapters/feed.js';
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
  budgetCap = 1000
): Promise<InMemoryRelay> {
  const relay = new InMemoryRelay();
  const brain = new ScriptedBrain({
    compile: () => ({
      sources: [HN_SOURCE],
      nipMappings: [{ nip: 'NIP-01', kind: 1 }],
      cadence: 'hourly',
      budgetCap,
      relaySet: ['wss://relay.example'],
    }),
  });
  await plant(
    { utterance: 'hn roguelike scene', mnemonic: MNEMONIC, index },
    { relay, brain }
  );
  return relay;
}

describe('status', () => {
  it('reports the spec, zeroed cursors, and no last-tick outcome for a planted-but-unticked dimension', async () => {
    const relay = await plantedDimension(60);
    const identity = deriveDimensionIdentity(MNEMONIC, 60);

    const result = await status({ mnemonic: MNEMONIC, index: 60 }, { relay });

    expect(result.pubkey).toBe(identity.pubkey);
    expect(result.npub).toBe(identity.npub);
    expect(result.spec.budgetCap).toBe(1000);
    expect(result.cursors).toEqual([{ sourceId: HN_SOURCE.id, dittoCount: 0 }]);
    expect(result.lastTick).toBeNull();
    expect(result.budgetRemaining).toBe(1000);
  });

  it('reflects cursor positions and the last tick outcome after a tick', async () => {
    const relay = await plantedDimension(61);
    const below = new FixtureBelow({
      fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
    });

    const tickResult = await tick(
      { mnemonic: MNEMONIC, index: 61 },
      { below, relay }
    );

    const result = await status({ mnemonic: MNEMONIC, index: 61 }, { relay });

    expect(result.cursors).toEqual([{ sourceId: HN_SOURCE.id, dittoCount: 2 }]);
    expect(result.lastTick).toEqual({
      published: tickResult.published.length,
      feesPaid: tickResult.feesPaid,
      spent: tickResult.feesPaid,
      budgetRemaining: tickResult.budgetRemaining,
      kickedBack: tickResult.kickedBack,
      withheld: tickResult.withheld,
    });
    expect(result.budgetRemaining).toBe(tickResult.budgetRemaining);
  });

  it('reports the most recent tick outcome, not an earlier one, across several ticks', async () => {
    const relay = await plantedDimension(62);
    const first = await tick(
      { mnemonic: MNEMONIC, index: 62 },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
        }),
        relay,
      }
    );
    expect(first.published).toHaveLength(2);

    // Second tick against unchanged fixtures: nothing new to publish, but it
    // still writes its own (zeroed) tick report.
    await tick(
      { mnemonic: MNEMONIC, index: 62 },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, HN_PAYLOAD),
        }),
        relay,
      }
    );

    const result = await status({ mnemonic: MNEMONIC, index: 62 }, { relay });

    expect(result.lastTick?.published).toBe(0);
  });

  it('throws a clear error for a dimension that has not been planted', async () => {
    const relay = new InMemoryRelay();

    await expect(
      status({ mnemonic: MNEMONIC, index: 99 }, { relay })
    ).rejects.toThrow(/not been planted/i);
  });
});
