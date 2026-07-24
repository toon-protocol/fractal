import { describe, expect, it } from 'vitest';
import { tick } from './tick.js';
import { plant } from './plant.js';
import { RelayPool } from './relay-pool.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { FEED_RESOURCE } from './adapters/feed.js';
import type { SourceConfig } from './domain/spec.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const HN_SOURCE: SourceConfig = {
  id: 'hn-top',
  kind: 'hn',
  endpoint: 'https://hacker-news.example/api',
};

const INITIAL_PAYLOAD = [
  {
    id: 41,
    title: 'Show HN: fractal',
    by: 'pg',
    time: 1_784_000_000,
  },
];

const ADVANCED_PAYLOAD = [
  ...INITIAL_PAYLOAD,
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

/**
 * Builds a `RelayPool` from scratch against the operator's known relay list
 * — the only inputs a genuinely fresh fractal instance has (CONTEXT.md —
 * Relay set, Dimension identity). It shares no object with any previously
 * built pool except the physical relay connections themselves, which stand
 * in for the actual relay servers.
 */
function freshInstance(relayConnections: ReadonlyMap<string, InMemoryRelay>) {
  return new RelayPool(relayConnections);
}

describe('cold resume', () => {
  it('a fresh instance with only the mnemonic and relay list reconstructs the dimension: nothing new on unchanged fixtures, only-the-new on advanced fixtures', async () => {
    const relayConnections = new Map([
      ['wss://relay-one.example', new InMemoryRelay()],
      ['wss://relay-two.example', new InMemoryRelay()],
    ]);
    const relayList = [...relayConnections.keys()];
    const index = 30;

    // Original instance: plant + first tick.
    const originalPool = freshInstance(relayConnections);
    const brain = new ScriptedBrain({
      compile: () => ({
        sources: [HN_SOURCE],
        nipMappings: [{ nip: 'NIP-01', kind: 1 }],
        cadence: 'hourly',
        budgetCap: 1000,
        relaySet: relayList,
      }),
    });
    await plant(
      { utterance: 'hn roguelike scene', mnemonic: MNEMONIC, index },
      { relay: originalPool, brain }
    );
    const firstTick = await tick(
      { mnemonic: MNEMONIC, index },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, INITIAL_PAYLOAD),
        }),
        relay: originalPool,
      }
    );
    expect(firstTick.published).toHaveLength(1);

    // Fresh instance: a brand-new RelayPool built only from the relay
    // connections (standing in for the relay servers) + mnemonic + index —
    // no shared cache or process state with the original instance.
    const resumedPool = freshInstance(relayConnections);
    const unchanged = await tick(
      { mnemonic: MNEMONIC, index },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, INITIAL_PAYLOAD),
        }),
        relay: resumedPool,
      }
    );
    expect(unchanged.published).toEqual([]);

    const advanced = await tick(
      { mnemonic: MNEMONIC, index },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, ADVANCED_PAYLOAD),
        }),
        relay: resumedPool,
      }
    );
    expect(advanced.published).toHaveLength(1);
    expect(
      advanced.published[0]?.tags.find((tag) => tag[0] === 'resource')?.[1]
    ).toContain('#1');

    // Every relay in the set saw every published ditto — no relay was
    // silently skipped by resume.
    for (const relay of relayConnections.values()) {
      const dittos = await relay.readBack({ kinds: [1] });
      expect(dittos).toHaveLength(2);
    }
  });

  it('a dimension whose spec names a single custom relay resumes identically — no special-casing', async () => {
    const relayConnections = new Map([
      ['wss://private.example', new InMemoryRelay()],
    ]);
    const index = 31;
    const brain = new ScriptedBrain({
      compile: () => ({
        sources: [HN_SOURCE],
        nipMappings: [{ nip: 'NIP-01', kind: 1 }],
        cadence: 'hourly',
        budgetCap: 1000,
        relaySet: [...relayConnections.keys()],
      }),
    });

    await plant(
      { utterance: 'private roguelike scene', mnemonic: MNEMONIC, index },
      { relay: freshInstance(relayConnections), brain }
    );
    await tick(
      { mnemonic: MNEMONIC, index },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, INITIAL_PAYLOAD),
        }),
        relay: freshInstance(relayConnections),
      }
    );

    const resumed = await tick(
      { mnemonic: MNEMONIC, index },
      {
        below: new FixtureBelow({
          fixtures: fixturesFor(HN_SOURCE, INITIAL_PAYLOAD),
        }),
        relay: freshInstance(relayConnections),
      }
    );

    expect(resumed.published).toEqual([]);
  });
});
