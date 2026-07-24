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
});
