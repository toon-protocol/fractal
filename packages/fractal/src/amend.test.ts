import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { amend } from './amend.js';
import { plant, SEED_EVENT_KIND, SPEC_EVENT_KIND } from './plant.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import { DEFAULT_RELAY_SET } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const originalSpec: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

async function plantedRelay(index: number): Promise<{ relay: InMemoryRelay }> {
  const relay = new InMemoryRelay();
  const brain = new ScriptedBrain({ compile: () => originalSpec });
  await plant(
    { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index },
    { relay, brain }
  );
  return { relay };
}

describe('amend', () => {
  it('publishes a new spec version signed by the dimension key; read-back resolves the latest', async () => {
    const { relay } = await plantedRelay(0);
    const identity = deriveDimensionIdentity(MNEMONIC, 0);
    const amendedSpec: DimensionSpec = { ...originalSpec, budgetCap: 5000 };

    const result = await amend(
      { mnemonic: MNEMONIC, index: 0, spec: amendedSpec },
      { relay }
    );

    expect(result.pubkey).toBe(identity.pubkey);
    expect(result.npub).toBe(identity.npub);
    expect(result.previousSpec).toEqual(originalSpec);
    expect(result.spec).toEqual(amendedSpec);

    const specEvents = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [SPEC_EVENT_KIND],
    });
    expect(specEvents).toHaveLength(2);
    for (const event of specEvents) {
      expect(verifyEvent({ ...event, created_at: event.createdAt })).toBe(true);
    }

    const latest = specEvents.reduce((a, b) =>
      b.createdAt >= a.createdAt ? b : a
    );
    expect(JSON.parse(latest.content)).toEqual(amendedSpec);
  });

  it('keeps the seed event byte-identical before and after an amendment', async () => {
    const { relay } = await plantedRelay(1);
    const identity = deriveDimensionIdentity(MNEMONIC, 1);

    const [seedBefore] = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [SEED_EVENT_KIND],
    });

    await amend(
      {
        mnemonic: MNEMONIC,
        index: 1,
        spec: { ...originalSpec, budgetCap: 2000 },
      },
      { relay }
    );

    const [seedAfter] = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [SEED_EVENT_KIND],
    });
    expect(seedAfter).toEqual(seedBefore);
  });

  it('defaults the relay set to the shared TOON relay when the amendment carries none', async () => {
    const { relay } = await plantedRelay(2);

    const result = await amend(
      { mnemonic: MNEMONIC, index: 2, spec: { ...originalSpec, relaySet: [] } },
      { relay }
    );

    expect(result.spec.relaySet).toEqual(DEFAULT_RELAY_SET);
  });

  it('rejects amending a dimension that has not been planted', async () => {
    const relay = new InMemoryRelay();

    await expect(
      amend({ mnemonic: MNEMONIC, index: 99, spec: originalSpec }, { relay })
    ).rejects.toThrow(/not been planted/i);
  });
});
