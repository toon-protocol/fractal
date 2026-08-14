import { describe, expect, it } from 'vitest';
import {
  assertBrainPlantProofSucceeded,
  runBrainPlantProof,
} from './brain-plant-proof.js';
import type { BrainPlantProofReport } from './brain-plant-proof.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';
import { deriveDimensionIdentity } from './identity.js';
import type { DimensionSpec } from './domain/spec.js';
import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const VALID_SPEC: DimensionSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

describe('runBrainPlantProof', () => {
  it('plants through the given brain and verifies the spec validates and every event is readable back', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({ compile: () => VALID_SPEC });
    const identity = deriveDimensionIdentity(MNEMONIC, 0);

    const report = await runBrainPlantProof(
      { mnemonic: MNEMONIC, index: 0, utterance: 'indie game dev scene' },
      { relay, brain }
    );

    expect(report).toEqual<BrainPlantProofReport>({
      index: 0,
      pubkey: identity.pubkey,
      npub: identity.npub,
      spec: VALID_SPEC,
      specValid: true,
      plantedEventsVerified: true,
    });
    expect(() => assertBrainPlantProofSucceeded(report)).not.toThrow();
  });

  it('refuses to run against an index that is already planted', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({ compile: () => VALID_SPEC });

    await runBrainPlantProof(
      { mnemonic: MNEMONIC, index: 0, utterance: 'first plant' },
      { relay, brain }
    );

    await expect(
      runBrainPlantProof(
        { mnemonic: MNEMONIC, index: 0, utterance: 'second plant' },
        { relay, brain }
      )
    ).rejects.toThrow(/already planted/);
  });

  it('propagates a brain that never resolves a valid spec — plant itself refuses to publish', async () => {
    const relay = new InMemoryRelay();
    const brain = new ScriptedBrain({
      compile: () => {
        throw new Error('brain gave up');
      },
    });

    await expect(
      runBrainPlantProof(
        { mnemonic: MNEMONIC, index: 0, utterance: 'indie game dev scene' },
        { relay, brain }
      )
    ).rejects.toThrow(/brain gave up/);

    const identity = deriveDimensionIdentity(MNEMONIC, 0);
    const published = await relay.readBack({ authors: [identity.pubkey] });
    expect(published).toHaveLength(0);
  });

  it('reports a partial plant when the relay loses a write plant itself does not know about', async () => {
    // A relay whose seed/spec publish silently drops the SPEC event only —
    // reproduces exactly the "half-plant" shape `plantedEventsVerified` is
    // built to catch, since `plant`'s own return value would still look
    // fine (it never reads its own writes back).
    class DropsSpecRelay implements RelayPort {
      private readonly inner = new InMemoryRelay();

      async publish(request: PublishRequest): Promise<PublishResult> {
        if (request.event.kind === 3301) {
          return {
            relaySet: request.relaySet,
            eventId: request.event.id,
            fee: 0,
          };
        }
        return this.inner.publish(request);
      }

      async readBack(
        query: ReadBackQuery
      ): Promise<readonly RelaySignedEvent[]> {
        return this.inner.readBack(query);
      }

      async quoteFee(request: PublishRequest): Promise<number> {
        return this.inner.quoteFee(request);
      }
    }

    const relay = new DropsSpecRelay();
    const brain = new ScriptedBrain({ compile: () => VALID_SPEC });

    const report = await runBrainPlantProof(
      { mnemonic: MNEMONIC, index: 0, utterance: 'indie game dev scene' },
      { relay, brain }
    );

    expect(report.plantedEventsVerified).toBe(false);
    expect(() => assertBrainPlantProofSucceeded(report)).toThrow(
      /partial plant/
    );
  });
});

describe('assertBrainPlantProofSucceeded', () => {
  const BASE_REPORT: BrainPlantProofReport = {
    index: 0,
    pubkey: 'pubkey',
    npub: 'npub1x',
    spec: VALID_SPEC,
    specValid: true,
    plantedEventsVerified: true,
  };

  it('throws when the spec did not validate', () => {
    expect(() =>
      assertBrainPlantProofSucceeded({ ...BASE_REPORT, specValid: false })
    ).toThrow(/did not validate/);
  });

  it('does not throw when every assertion holds', () => {
    expect(() => assertBrainPlantProofSucceeded(BASE_REPORT)).not.toThrow();
  });
});
