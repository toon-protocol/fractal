import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { runCommand, CLI_VERSION } from './command.js';
import type { Ports } from './command.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import type { BrainScript } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import {
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
  PROFILE_EVENT_KIND,
} from './plant.js';
import { FEED_RESOURCE } from './adapters/feed.js';
import { INTERPRETATION_EVENT_KIND } from './domain/event.js';
import { TICK_REPORT_EVENT_KIND } from './tick.js';
import { ChannelBudgetExceededError } from './ports/relay.js';
import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';
import type { DimensionSpec } from './domain/spec.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const compiledSpec: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

function fakedPorts(brainScript: BrainScript = {}): {
  ports: Ports;
  relay: InMemoryRelay;
} {
  const relay = new InMemoryRelay();
  const ports: Ports = {
    below: new FixtureBelow({ fixtures: {} }),
    relay,
    brain: new ScriptedBrain(brainScript),
  };
  return { ports, relay };
}

/**
 * A relay whose channel has just enough left for the tick's dittos but not
 * for the tick's own economics report — standing in for a real channel
 * refusing that last paid write.
 */
class ReportRefusingRelay implements RelayPort {
  constructor(private readonly inner: InMemoryRelay) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (request.event.kind === TICK_REPORT_EVENT_KIND) {
      throw new ChannelBudgetExceededError('channel-1', 1n, 0n);
    }
    return this.inner.publish(request);
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    return this.inner.readBack(query);
  }

  async quoteFee(request: PublishRequest): Promise<number> {
    return this.inner.quoteFee(request);
  }
}

describe('runCommand (black-box command layer)', () => {
  it('reports the CLI version end-to-end, through all three faked ports', async () => {
    const { ports, relay } = fakedPorts();

    const result = await runCommand(['--version'], ports);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${CLI_VERSION}\n`,
      stderr: '',
    });
    expect(await relay.readBack({})).toEqual([]);
  });

  it('accepts -v as a version alias', async () => {
    const { ports } = fakedPorts();

    const result = await runCommand(['-v'], ports);

    expect(result.stdout).toBe(`${CLI_VERSION}\n`);
    expect(result.exitCode).toBe(0);
  });

  it('rejects an unknown command without touching any port', async () => {
    const { ports, relay } = fakedPorts();

    const result = await runCommand(['grow'], ports);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/unknown command/i);
    expect(await relay.readBack({})).toEqual([]);
  });

  describe('plant', () => {
    it('plants a seed end-to-end: derives identity, compiles a spec, and publishes profile/seed/spec', async () => {
      const { ports, relay } = fakedPorts({ compile: () => compiledSpec });
      const identity = deriveDimensionIdentity(MNEMONIC, 0);

      const result = await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '0',
        ],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(identity.npub);

      const published = await relay.readBack({ authors: [identity.pubkey] });
      expect(published).toHaveLength(3);
      expect(published.map((event) => event.kind).sort()).toEqual(
        [PROFILE_EVENT_KIND, SEED_EVENT_KIND, SPEC_EVENT_KIND].sort()
      );
      for (const event of published) {
        expect(verifyEvent({ ...event, created_at: event.createdAt })).toBe(
          true
        );
      }
    });

    it('rejects missing --mnemonic without touching any port', async () => {
      const { ports, relay } = fakedPorts({ compile: () => compiledSpec });

      const result = await runCommand(['plant', 'indie game dev scene'], ports);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--mnemonic/i);
      expect(await relay.readBack({})).toEqual([]);
    });

    it('rejects a missing seed utterance without touching any port', async () => {
      const { ports, relay } = fakedPorts({ compile: () => compiledSpec });

      const result = await runCommand(['plant'], ports);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/seed/i);
      expect(await relay.readBack({})).toEqual([]);
    });

    it('rejects re-planting an already-planted index with a clear error', async () => {
      const { ports } = fakedPorts({ compile: () => compiledSpec });
      const argv = [
        'plant',
        'indie game dev scene',
        '--mnemonic',
        MNEMONIC,
        '--index',
        '1',
      ];

      const first = await runCommand(argv, ports);
      expect(first.exitCode).toBe(0);

      const second = await runCommand(argv, ports);

      expect(second.exitCode).toBe(1);
      expect(second.stderr).toMatch(/already planted/i);
    });

    it('plants from --spec without ever calling the brain — the credential-less path', async () => {
      let compileCalls = 0;
      const { ports, relay } = fakedPorts({
        compile: () => {
          compileCalls += 1;
          return compiledSpec;
        },
      });
      const identity = deriveDimensionIdentity(MNEMONIC, 20);

      const result = await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '20',
          '--spec',
          JSON.stringify(compiledSpec),
        ],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(compileCalls).toBe(0);
      const published = await relay.readBack({ authors: [identity.pubkey] });
      expect(published).toHaveLength(3);
    });

    it('rejects malformed --spec JSON without touching any port', async () => {
      const { ports, relay } = fakedPorts({ compile: () => compiledSpec });

      const result = await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '21',
          '--spec',
          '{not json',
        ],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--spec/i);
      expect(await relay.readBack({})).toEqual([]);
    });
  });

  describe('tick', () => {
    const HN_PAYLOAD = [
      {
        id: 41,
        title: 'Show HN: fractal',
        url: 'https://hacker-news.example/items/41',
        by: 'pg',
        time: 1_784_000_000,
      },
    ];

    async function plantedPorts(index: number): Promise<{
      ports: Ports;
      relay: InMemoryRelay;
    }> {
      const relay = new InMemoryRelay();
      const below = new FixtureBelow({
        fixtures: { [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD },
      });
      const ports: Ports = {
        below,
        relay,
        brain: new ScriptedBrain({ compile: () => compiledSpec }),
      };
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          String(index),
        ],
        ports
      );
      return { ports, relay };
    }

    it('ticks the ditto loop end-to-end, publishing gate-passed candidates signed by the dimension key, with no Brain-port call', async () => {
      const { ports } = await plantedPorts(20);
      const identity = deriveDimensionIdentity(MNEMONIC, 20);

      const result = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '20'],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(identity.npub);
      expect(result.stdout).toContain('"published": 1');

      const dittos = await ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [1],
      });
      expect(dittos).toHaveLength(1);
      for (const event of dittos) {
        expect(verifyEvent({ ...event, created_at: event.createdAt })).toBe(
          true
        );
      }
    });

    it('publishes nothing new on a second tick against unchanged fixtures (cursor via read-back)', async () => {
      const { ports } = await plantedPorts(21);
      const argv = ['tick', '--mnemonic', MNEMONIC, '--index', '21'];

      const first = await runCommand(argv, ports);
      expect(first.stdout).toContain('"published": 1');

      const second = await runCommand(argv, ports);

      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain('"published": 0');
      expect(second.stdout).toContain('"kickedBack": []');
    });

    it('reports fees paid and budget remaining alongside published/kicked-back counts', async () => {
      const { ports } = await plantedPorts(22);

      const result = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '22'],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"feesPaid"');
      expect(result.stdout).toContain('"budgetRemaining"');
      expect(result.stdout).toContain('"withheld": []');
      // A written report is the unremarkable case, so the summary stays quiet
      // about it.
      expect(result.stdout).not.toContain('reportPublished');
    });

    it('reports that the tick went unlogged when the channel refuses to pay for the tick report', async () => {
      const relay = new ReportRefusingRelay(new InMemoryRelay());
      const ports: Ports = {
        below: new FixtureBelow({
          fixtures: { [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD },
        }),
        relay,
        brain: new ScriptedBrain({ compile: () => compiledSpec }),
      };
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '23',
        ],
        ports
      );

      const result = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '23'],
        ports
      );

      // The ditto still landed — only the tick's own economics log did not.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"published": 1');
      expect(result.stdout).toContain('"reportPublished": false');
      expect(await relay.readBack({ kinds: [TICK_REPORT_EVENT_KIND] })).toEqual(
        []
      );
    });

    it('rejects ticking a dimension that has not been planted', async () => {
      const { ports } = fakedPorts();

      const result = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '42'],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/not been planted/i);
    });

    it('rejects missing --mnemonic without touching any port', async () => {
      const { ports, relay } = fakedPorts();

      const result = await runCommand(['tick', '--index', '0'], ports);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--mnemonic/i);
      expect(await relay.readBack({})).toEqual([]);
    });
  });

  describe('amend', () => {
    const HN_SOURCE = {
      id: 'hn',
      kind: 'hn',
      endpoint: 'https://hacker-news.example/api',
    };
    const BLOG_SOURCE = {
      id: 'blog',
      kind: 'rss',
      endpoint: 'https://blog.example/feed',
    };
    const HN_PAYLOAD = [
      {
        id: 41,
        title: 'Show HN: fractal',
        url: 'https://hacker-news.example/items/41',
        by: 'pg',
        time: 1_784_000_000,
      },
    ];
    const BLOG_PAYLOAD = [
      {
        title: 'A devlog on roguelikes',
        link: 'https://blog.example/posts/1',
        author: 'jane',
        pubDate: '2026-01-01T00:00:00Z',
      },
    ];

    function specWith(overrides: Partial<DimensionSpec>): DimensionSpec {
      return { ...compiledSpec, sources: [HN_SOURCE], ...overrides };
    }

    async function plantedPorts(
      index: number,
      spec: DimensionSpec = specWith({})
    ): Promise<{ ports: Ports; relay: InMemoryRelay }> {
      const relay = new InMemoryRelay();
      const below = new FixtureBelow({
        fixtures: {
          [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD,
          [`blog:${FEED_RESOURCE}`]: BLOG_PAYLOAD,
        },
      });
      const ports: Ports = {
        below,
        relay,
        brain: new ScriptedBrain({ compile: () => spec }),
      };
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          String(index),
        ],
        ports
      );
      return { ports, relay };
    }

    it('amends the spec end-to-end; the next tick honors it — removed source stops producing, added source starts', async () => {
      const { ports } = await plantedPorts(50);
      const identity = deriveDimensionIdentity(MNEMONIC, 50);

      const firstTick = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '50'],
        ports
      );
      expect(firstTick.stdout).toContain('"published": 1');

      const amendedSpec = specWith({ sources: [BLOG_SOURCE] });
      const amendResult = await runCommand(
        [
          'amend',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '50',
          '--spec',
          JSON.stringify(amendedSpec),
        ],
        ports
      );
      expect(amendResult.exitCode).toBe(0);
      expect(amendResult.stderr).toBe('');
      expect(amendResult.stdout).toContain(identity.npub);

      const secondTick = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '50'],
        ports
      );
      expect(secondTick.stdout).toContain('"published": 1');

      const dittos = await ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [1],
      });
      expect(dittos).toHaveLength(2);
      const resources = dittos.flatMap((event) =>
        event.tags.filter((tag) => tag[0] === 'resource').map((tag) => tag[1])
      );
      expect(resources.some((url) => url?.includes('hacker-news'))).toBe(true);
      expect(resources.some((url) => url?.includes('blog.example'))).toBe(true);

      // A third tick against the amended (hn-less) spec produces nothing new
      // for hn — the removed source stays stopped.
      const thirdTick = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '50'],
        ports
      );
      expect(thirdTick.stdout).toContain('"published": 0');
    });

    it('raising the budget cap via amend unblocks previously withheld work on the next tick', async () => {
      const relay = new InMemoryRelay({ feePerEvent: 1 });
      const below = new FixtureBelow({
        fixtures: {
          [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD,
          [`blog:${FEED_RESOURCE}`]: BLOG_PAYLOAD,
        },
      });
      const lowCapSpec = specWith({
        sources: [HN_SOURCE, BLOG_SOURCE],
        budgetCap: 1,
      });
      const ports: Ports = {
        below,
        relay,
        brain: new ScriptedBrain({ compile: () => lowCapSpec }),
      };
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '51',
        ],
        ports
      );

      const firstTick = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '51'],
        ports
      );
      expect(firstTick.stdout).toContain('"published": 1');
      expect(firstTick.stdout).not.toContain('"withheld": []');

      const raisedCapSpec = { ...lowCapSpec, budgetCap: 100 };
      const amendResult = await runCommand(
        [
          'amend',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '51',
          '--spec',
          JSON.stringify(raisedCapSpec),
        ],
        ports
      );
      expect(amendResult.exitCode).toBe(0);

      const secondTick = await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '51'],
        ports
      );
      expect(secondTick.stdout).toContain('"published": 1');
      expect(secondTick.stdout).toContain('"withheld": []');
    });

    it('rejects amending a dimension that has not been planted', async () => {
      const { ports } = fakedPorts();

      const result = await runCommand(
        [
          'amend',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '42',
          '--spec',
          JSON.stringify(compiledSpec),
        ],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/not been planted/i);
    });

    it('rejects a missing --spec without touching any port', async () => {
      const { ports } = await plantedPorts(52);

      const result = await runCommand(
        ['amend', '--mnemonic', MNEMONIC, '--index', '52'],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--spec/i);
    });

    it('rejects malformed --spec JSON with a clear error', async () => {
      const { ports } = await plantedPorts(53);

      const result = await runCommand(
        [
          'amend',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '53',
          '--spec',
          '{not json',
        ],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--spec/i);
    });

    it('rejects missing --mnemonic without touching any port', async () => {
      const { ports, relay } = fakedPorts();
      const before = await relay.readBack({});

      const result = await runCommand(
        ['amend', '--index', '0', '--spec', JSON.stringify(compiledSpec)],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--mnemonic/i);
      expect(await relay.readBack({})).toEqual(before);
    });
  });

  describe('interpret', () => {
    const HN_PAYLOAD = [
      {
        id: 41,
        title: 'Show HN: fractal',
        url: 'https://hacker-news.example/items/41',
        by: 'pg',
        time: 1_784_000_000,
      },
    ];

    async function dittoedPorts(index: number): Promise<{
      ports: Ports;
      relay: InMemoryRelay;
    }> {
      const relay = new InMemoryRelay();
      const below = new FixtureBelow({
        fixtures: { [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD },
      });
      const ports: Ports = {
        below,
        relay,
        brain: new ScriptedBrain({
          compile: () => compiledSpec,
          interpret: () => 'a wave of roguelike devlogs this week',
        }),
      };
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          String(index),
        ],
        ports
      );
      await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', String(index)],
        ports
      );
      return { ports, relay };
    }

    it('interprets the ditto loop end-to-end, publishing commentary that references the existing dittos', async () => {
      const { ports } = await dittoedPorts(40);
      const identity = deriveDimensionIdentity(MNEMONIC, 40);

      const result = await runCommand(
        ['interpret', '--mnemonic', MNEMONIC, '--index', '40'],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(identity.npub);
      expect(result.stdout).toContain('"published": 1');

      const dittos = await ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [1],
      });
      const interpretations = await ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [INTERPRETATION_EVENT_KIND],
      });
      expect(interpretations).toHaveLength(1);
      const [interpretation] = interpretations;
      expect(
        verifyEvent({
          ...interpretation,
          created_at: interpretation?.createdAt,
        })
      ).toBe(true);
      const referencedIds = interpretation?.tags
        .filter((tag) => tag[0] === 'e')
        .map((tag) => tag[1]);
      expect(new Set(referencedIds)).toEqual(
        new Set(dittos.map((ditto) => ditto.id))
      );
    });

    it('rejects interpreting a dimension that has not been planted', async () => {
      const { ports } = fakedPorts();

      const result = await runCommand(
        ['interpret', '--mnemonic', MNEMONIC, '--index', '42'],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/not been planted/i);
    });

    it('rejects missing --mnemonic without touching any port', async () => {
      const { ports, relay } = fakedPorts();

      const result = await runCommand(['interpret', '--index', '0'], ports);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--mnemonic/i);
      expect(await relay.readBack({})).toEqual([]);
    });
  });

  describe('status', () => {
    const HN_PAYLOAD = [
      {
        id: 41,
        title: 'Show HN: fractal',
        url: 'https://hacker-news.example/items/41',
        by: 'pg',
        time: 1_784_000_000,
      },
    ];

    it('renders an empty forest when no --index is given', async () => {
      const { ports } = fakedPorts();

      const result = await runCommand(
        ['status', '--mnemonic', MNEMONIC],
        ports
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it('renders a single planted dimension', async () => {
      const { ports } = fakedPorts({ compile: () => compiledSpec });
      const identity = deriveDimensionIdentity(MNEMONIC, 70);
      await runCommand(
        [
          'plant',
          'indie game dev scene',
          '--mnemonic',
          MNEMONIC,
          '--index',
          '70',
        ],
        ports
      );

      const result = await runCommand(
        ['status', '--mnemonic', MNEMONIC, '--index', '70'],
        ports
      );

      expect(result.exitCode).toBe(0);
      const dimensions = JSON.parse(result.stdout);
      expect(dimensions).toHaveLength(1);
      expect(dimensions[0].npub).toBe(identity.npub);
      expect(dimensions[0].spec.budgetCap).toBe(compiledSpec.budgetCap);
      expect(dimensions[0].lastTick).toBeNull();
    });

    it('renders several dimensions, each reflecting its own tick outcome', async () => {
      const relay = new InMemoryRelay();
      const below = new FixtureBelow({
        fixtures: { [`hn:${FEED_RESOURCE}`]: HN_PAYLOAD },
      });
      const ports: Ports = {
        below,
        relay,
        brain: new ScriptedBrain({ compile: () => compiledSpec }),
      };
      const identity80 = deriveDimensionIdentity(MNEMONIC, 80);
      const identity81 = deriveDimensionIdentity(MNEMONIC, 81);

      for (const index of [80, 81]) {
        await runCommand(
          [
            'plant',
            'indie game dev scene',
            '--mnemonic',
            MNEMONIC,
            '--index',
            String(index),
          ],
          ports
        );
      }
      await runCommand(
        ['tick', '--mnemonic', MNEMONIC, '--index', '80'],
        ports
      );
      // Index 81 was planted but never ticked.

      const result = await runCommand(
        ['status', '--mnemonic', MNEMONIC, '--index', '80', '--index', '81'],
        ports
      );

      expect(result.exitCode).toBe(0);
      const dimensions = JSON.parse(result.stdout);
      expect(dimensions).toHaveLength(2);
      expect(dimensions[0].npub).toBe(identity80.npub);
      expect(dimensions[0].lastTick).not.toBeNull();
      expect(dimensions[1].npub).toBe(identity81.npub);
      expect(dimensions[1].lastTick).toBeNull();
    });

    it('rejects status for an unplanted index with a clear error', async () => {
      const { ports } = fakedPorts();

      const result = await runCommand(
        ['status', '--mnemonic', MNEMONIC, '--index', '90'],
        ports
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/not been planted/i);
    });

    it('rejects missing --mnemonic without touching any port', async () => {
      const { ports, relay } = fakedPorts();

      const result = await runCommand(['status', '--index', '0'], ports);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--mnemonic/i);
      expect(await relay.readBack({})).toEqual([]);
    });
  });
});
