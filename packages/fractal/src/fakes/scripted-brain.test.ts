import { describe, expect, it } from 'vitest';
import { ScriptedBrain } from './scripted-brain.js';
import type { DimensionSpec } from '../domain/spec.js';
import type { Seed } from '../domain/seed.js';

const seed: Seed = {
  id: 'seed-1',
  utterance: 'indie game dev scene',
  plantedAt: '2026-07-24T00:00:00.000Z',
};

const spec: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.toon.example'],
};

describe('ScriptedBrain', () => {
  it('returns the scripted spec for compile', async () => {
    const brain = new ScriptedBrain({ compile: () => spec });

    await expect(brain.compile({ seed })).resolves.toEqual(spec);
  });

  it('returns the scripted commentary for interpret', async () => {
    const brain = new ScriptedBrain({ interpret: () => 'quiet week below' });

    await expect(brain.interpret({ dittos: [] })).resolves.toBe(
      'quiet week below'
    );
  });

  it('returns the scripted spec revision for adapt', async () => {
    const brain = new ScriptedBrain({ adapt: () => spec });

    await expect(
      brain.adapt({ spec, reason: 'source drift' })
    ).resolves.toEqual(spec);
  });

  it('rejects compile when no script is provided for that moment', async () => {
    const brain = new ScriptedBrain({});

    await expect(brain.compile({ seed })).rejects.toThrow(/no compile script/i);
  });

  it('rejects interpret when no script is provided for that moment', async () => {
    const brain = new ScriptedBrain({});

    await expect(brain.interpret({ dittos: [] })).rejects.toThrow(
      /no interpret script/i
    );
  });

  it('rejects adapt when no script is provided for that moment', async () => {
    const brain = new ScriptedBrain({});

    await expect(brain.adapt({ spec, reason: 'source drift' })).rejects.toThrow(
      /no adapt script/i
    );
  });
});
