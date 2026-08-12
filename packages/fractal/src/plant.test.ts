import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import {
  plant,
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
} from './plant.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import { DEFAULT_RELAY_SET } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';
import type { RelayPort } from './ports/relay.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const compiledSpec: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

describe('plant', () => {
  it('publishes profile, seed, and spec events signed by the derived dimension key', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({ compile: () => compiledSpec });
    const identity = deriveDimensionIdentity(MNEMONIC, 0);

    const result = await plant(
      { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 0 },
      { relay, brain }
    );

    expect(result.pubkey).toBe(identity.pubkey);
    expect(result.npub).toBe(identity.npub);
    expect(result.spec).toEqual(compiledSpec);

    const published = await relay.readBack({ authors: [identity.pubkey] });
    expect(published).toHaveLength(3);
    for (const event of published) {
      expect(verifyEvent({ ...event, created_at: event.createdAt })).toBe(true);
    }

    const profile = published.find(
      (event) => event.kind === PROFILE_EVENT_KIND
    );
    expect(profile).toBeDefined();
    expect(JSON.parse(profile!.content)).toMatchObject({
      about: 'indie game dev scene',
    });

    const seedEvent = published.find((event) => event.kind === SEED_EVENT_KIND);
    expect(seedEvent).toBeDefined();
    expect(JSON.parse(seedEvent!.content)).toMatchObject({
      utterance: 'indie game dev scene',
    });
    expect(result.seed.utterance).toBe('indie game dev scene');

    const specEvent = published.find((event) => event.kind === SPEC_EVENT_KIND);
    expect(specEvent).toBeDefined();
    expect(JSON.parse(specEvent!.content)).toEqual(compiledSpec);

    expect(relay.eventsPublishedTo('wss://relay.example')).toHaveLength(3);
  });

  it('defaults the relay set to the shared TOON relay when the brain compiles none', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({
      compile: () => ({ ...compiledSpec, relaySet: [] }),
    });

    const result = await plant(
      { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 1 },
      { relay, brain }
    );

    expect(result.spec.relaySet).toEqual(DEFAULT_RELAY_SET);
    expect(relay.eventsPublishedTo(DEFAULT_RELAY_SET[0]!)).toHaveLength(3);
  });

  it('rejects re-planting the same index without touching the brain or publishing again', async () => {
    const relay = new InMemoryRelay();
    let compileCalls = 0;
    const brain = new ScriptedBrain({
      compile: () => {
        compileCalls += 1;
        return compiledSpec;
      },
    });

    await plant(
      { utterance: 'first seed', mnemonic: MNEMONIC, index: 2 },
      { relay, brain }
    );
    expect(compileCalls).toBe(1);

    await expect(
      plant(
        { utterance: 'second seed', mnemonic: MNEMONIC, index: 2 },
        { relay, brain }
      )
    ).rejects.toThrow(/already planted/i);

    expect(compileCalls).toBe(1);
    const identity = deriveDimensionIdentity(MNEMONIC, 2);
    expect(await relay.readBack({ authors: [identity.pubkey] })).toHaveLength(
      3
    );
  });

  it('keeps the seed immutable — the seed event carries the original utterance verbatim', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({ compile: () => compiledSpec });

    await plant(
      {
        utterance: 'build me a dimension of the indie game dev scene',
        mnemonic: MNEMONIC,
        index: 3,
      },
      { relay, brain }
    );

    const identity = deriveDimensionIdentity(MNEMONIC, 3);
    const [seedEvent] = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [SEED_EVENT_KIND],
    });
    expect(JSON.parse(seedEvent!.content).utterance).toBe(
      'build me a dimension of the indie game dev scene'
    );
  });

  it('overrides the compiled budget cap with the funded channel balance when the relay funds a channel', async () => {
    const inMemory = new InMemoryRelay();
    let fundedFor: number | undefined;
    const relay: RelayPort = {
      publish: (request) => inMemory.publish(request),
      readBack: (query) => inMemory.readBack(query),
      quoteFee: (request) => inMemory.quoteFee(request),
      fundChannel: async (desiredCap: number) => {
        fundedFor = desiredCap;
        return 42;
      },
    };
    const brain = new ScriptedBrain({ compile: () => compiledSpec });

    const result = await plant(
      { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 4 },
      { relay, brain }
    );

    expect(fundedFor).toBe(compiledSpec.budgetCap);
    expect(result.spec.budgetCap).toBe(42);

    const identity = deriveDimensionIdentity(MNEMONIC, 4);
    const [specEvent] = await relay.readBack({
      authors: [identity.pubkey],
      kinds: [SPEC_EVENT_KIND],
    });
    expect(JSON.parse(specEvent!.content).budgetCap).toBe(42);
  });

  it('keeps the brain-compiled budget cap when the relay has no channel to fund', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({ compile: () => compiledSpec });

    const result = await plant(
      { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 5 },
      { relay, brain }
    );

    expect(result.spec.budgetCap).toBe(compiledSpec.budgetCap);
  });

  it('leaves no half-planted dimension when the brain persistently fails to compile', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({
      compile: () => {
        throw new Error('fractal: brain gave up after 3 attempt(s)');
      },
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 6);

    await expect(
      plant(
        { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 6 },
        { relay, brain }
      )
    ).rejects.toThrow(/gave up/i);

    expect(await relay.readBack({ authors: [identity.pubkey] })).toEqual([]);
  });

  it('leaves no half-planted dimension when the brain compiles a structurally invalid spec', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({
      compile: () => ({ ...compiledSpec, sources: [] }),
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 7);

    await expect(
      plant(
        { utterance: 'indie game dev scene', mnemonic: MNEMONIC, index: 7 },
        { relay, brain }
      )
    ).rejects.toThrow(/invalid/i);

    expect(await relay.readBack({ authors: [identity.pubkey] })).toEqual([]);
  });

  it('plants from an explicit spec, never calling the brain — the credential-less path', async () => {
    const relay = new InMemoryRelay();
    let compileCalls = 0;
    const brain = new ScriptedBrain({
      compile: () => {
        compileCalls += 1;
        return compiledSpec;
      },
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 8);
    const explicitSpec: DimensionSpec = { ...compiledSpec, budgetCap: 42 };

    const result = await plant(
      {
        utterance: 'indie game dev scene',
        mnemonic: MNEMONIC,
        index: 8,
        spec: explicitSpec,
      },
      { relay, brain }
    );

    expect(compileCalls).toBe(0);
    expect(result.spec).toEqual(explicitSpec);
    const published = await relay.readBack({ authors: [identity.pubkey] });
    expect(published).toHaveLength(3);
  });

  it('rejects a structurally invalid explicit spec without touching the brain or publishing', async () => {
    const relay = new InMemoryRelay();
    let compileCalls = 0;
    const brain = new ScriptedBrain({
      compile: () => {
        compileCalls += 1;
        return compiledSpec;
      },
    });
    const identity = deriveDimensionIdentity(MNEMONIC, 9);
    const invalidSpec = { ...compiledSpec, budgetCap: -1 } as DimensionSpec;

    await expect(
      plant(
        {
          utterance: 'indie game dev scene',
          mnemonic: MNEMONIC,
          index: 9,
          spec: invalidSpec,
        },
        { relay, brain }
      )
    ).rejects.toThrow(/--spec you provided.*invalid/i);

    expect(compileCalls).toBe(0);
    expect(await relay.readBack({ authors: [identity.pubkey] })).toEqual([]);
  });
});
