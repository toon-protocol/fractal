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
});
