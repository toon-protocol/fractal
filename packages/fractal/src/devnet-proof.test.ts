import { describe, expect, it } from 'vitest';
import {
  assertProofSucceeded,
  buildProofFixturePayload,
  buildProofFixtures,
  buildProofSpec,
  PROOF_FIXTURE_PAYLOAD,
  PROOF_FIXTURES,
  PROOF_SOURCE,
  runDevnetProof,
} from './devnet-proof.js';
import { deriveDimensionIdentity } from './identity.js';
import { dittoedResourceUrls } from './relay-reads.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { ChannelBudgetExceededError } from './ports/relay.js';
import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const RELAY_SET = ['wss://relay.example'];

function below(): FixtureBelow {
  return new FixtureBelow({ fixtures: PROOF_FIXTURES });
}

/**
 * Same shape as `tick.test.ts`'s `ChanneledRelay`: a fixed channel deposit
 * that charges every publish and refuses past it, with `channelSpend`
 * reading the running claim — the real `ToonRelay`'s enforced-by-construction
 * shape, without a network.
 */
class ChanneledRelay implements RelayPort {
  private readonly inner = new InMemoryRelay();
  private claim = 0;
  /** Every `fundChannel` target requested — lets tests assert the reuse path tops the channel up. */
  readonly fundChannelCalls: number[] = [];

  constructor(
    private readonly deposit: number,
    private readonly pricePerEvent = 1
  ) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (this.claim + this.pricePerEvent > this.deposit) {
      throw new ChannelBudgetExceededError(
        'channel-1',
        BigInt(this.pricePerEvent),
        BigInt(this.deposit - this.claim)
      );
    }
    const result = await this.inner.publish(request);
    this.claim += this.pricePerEvent;
    return { ...result, fee: this.pricePerEvent };
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    return this.inner.readBack(query);
  }

  async quoteFee(_request: PublishRequest): Promise<number> {
    return this.pricePerEvent;
  }

  async channelSpend(): Promise<number> {
    return this.claim;
  }

  async fundChannel(desiredCap: number): Promise<number> {
    this.fundChannelCalls.push(desiredCap);
    return Math.min(desiredCap, this.deposit);
  }
}

/** Wraps a relay but silently drops one kind from every `readBack` — a broken read-back path. */
class DropsKindOnReadBack implements RelayPort {
  constructor(
    private readonly inner: RelayPort,
    private readonly droppedKind: number
  ) {}

  publish(request: PublishRequest): Promise<PublishResult> {
    return this.inner.publish(request);
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    const events = await this.inner.readBack(query);
    return events.filter((event) => event.kind !== this.droppedKind);
  }

  quoteFee(request: PublishRequest): Promise<number> {
    return this.inner.quoteFee(request);
  }
}

/** A channel-backed relay whose `channelSpend` misreports — the claim diverges from what `publish` actually charged. */
class MisreportingChannelRelay implements RelayPort {
  private readonly inner = new ChanneledRelay(1000);

  publish(request: PublishRequest): Promise<PublishResult> {
    return this.inner.publish(request);
  }

  readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    return this.inner.readBack(query);
  }

  quoteFee(request: PublishRequest): Promise<number> {
    return this.inner.quoteFee(request);
  }

  async channelSpend(): Promise<number> {
    // Always reports zero, regardless of what was actually claimed.
    return 0;
  }

  fundChannel(desiredCap: number): Promise<number> {
    return this.inner.fundChannel(desiredCap);
  }
}

describe('runDevnetProof', () => {
  it('plants a fresh index, ticks it, and verifies every assertion against a plain relay', async () => {
    const relay = new InMemoryRelay();
    const report = await runDevnetProof(
      {
        mnemonic: MNEMONIC,
        index: 41,
        utterance: 'fractal devnet relay proof',
        relaySet: RELAY_SET,
        budgetCap: 1000,
      },
      { relay, below: below() }
    );

    const identity = deriveDimensionIdentity(MNEMONIC, 41);
    expect(report.pubkey).toBe(identity.pubkey);
    expect(report.npub).toBe(identity.npub);
    expect(report.plantedNow).toBe(true);
    expect(report.plantedEventsVerified).toBe(true);
    expect(report.publishedDittoIds).toHaveLength(2);
    expect(report.dittoReadBackVerified).toBe(true);
    expect(report.reportPublished).toBe(true);
    expect(report.reconciled).toBe(true);
    expect(() => assertProofSucceeded(report)).not.toThrow();
  });

  it('fails loudly, not vacuously, when a reuse run publishes nothing (unchanged fixtures)', async () => {
    const relay = new InMemoryRelay();
    const request = {
      mnemonic: MNEMONIC,
      index: 42,
      utterance: 'fractal devnet relay proof',
      relaySet: RELAY_SET,
      budgetCap: 1000,
    };

    const first = await runDevnetProof(request, { relay, below: below() });
    expect(first.plantedNow).toBe(true);
    expect(first.publishedDittoIds).toHaveLength(2);

    const second = await runDevnetProof(request, { relay, below: below() });
    expect(second.plantedNow).toBe(false);
    expect(second.publishedDittoIds).toHaveLength(0);
    // A run that published nothing proved nothing — it must not pass.
    expect(() => assertProofSucceeded(second)).toThrow(/no paid ditto/);
  });

  it('re-dispatch against an already-planted index tops the channel up and publishes one fresh paid ditto', async () => {
    const relay = new ChanneledRelay(1000);
    const request = {
      mnemonic: MNEMONIC,
      index: 47,
      utterance: 'fractal devnet relay proof',
      relaySet: RELAY_SET,
      budgetCap: 1000,
    };
    const identity = deriveDimensionIdentity(MNEMONIC, 47);

    const first = await runDevnetProof(request, {
      relay,
      below: new FixtureBelow({
        fixtures: buildProofFixtures(new Set(), 'run-1'),
      }),
    });
    expect(first.plantedNow).toBe(true);
    expect(first.publishedDittoIds).toHaveLength(3); // 2 base + run-1's item
    expect(relay.fundChannelCalls).toEqual([1000]); // plant's own top-up

    const alreadyDittoed = await dittoedResourceUrls(
      relay,
      identity.pubkey,
      PROOF_SOURCE.id
    );
    const second = await runDevnetProof(request, {
      relay,
      below: new FixtureBelow({
        fixtures: buildProofFixtures(alreadyDittoed, 'run-2'),
      }),
    });
    expect(second.plantedNow).toBe(false);
    // The reuse path must still top up — fundChannel otherwise only runs
    // inside plant, and raising the budget input would silently do nothing.
    expect(relay.fundChannelCalls).toEqual([1000, 1000]);
    expect(second.publishedDittoIds).toHaveLength(1); // only run-2's fresh position
    expect(second.dittoReadBackVerified).toBe(true);
    expect(second.reconciled).toBe(true);
    expect(() => assertProofSucceeded(second)).not.toThrow();
  });

  it('reconciles the channel-backed relay claim delta against the tick-reported fees', async () => {
    const relay = new ChanneledRelay(1000);
    const report = await runDevnetProof(
      {
        mnemonic: MNEMONIC,
        index: 43,
        utterance: 'fractal devnet relay proof',
        relaySet: RELAY_SET,
        budgetCap: 1000,
      },
      { relay, below: below() }
    );

    expect(report.channelSpendBefore).toBe(3); // plant's 3 identity events
    expect(report.channelSpendAfter).toBe(3 + report.feesPaidThisTick + 1); // + 2 dittos + 1 report
    expect(report.feesPaidThisTick).toBe(2);
    expect(report.reconciled).toBe(true);
    expect(() => assertProofSucceeded(report)).not.toThrow();
  });

  it('fails the ditto read-back assertion when a published event is not visible back through the same port', async () => {
    const relay = new DropsKindOnReadBack(new InMemoryRelay(), 1);
    const report = await runDevnetProof(
      {
        mnemonic: MNEMONIC,
        index: 44,
        utterance: 'fractal devnet relay proof',
        relaySet: RELAY_SET,
        budgetCap: 1000,
      },
      { relay, below: below() }
    );

    expect(report.publishedDittoIds).toHaveLength(2);
    expect(report.dittoReadBackVerified).toBe(false);
    expect(() => assertProofSucceeded(report)).toThrow(/read-back/);
  });

  it('fails the planted-events assertion when the seed is not visible back through the same port', async () => {
    const relay = new DropsKindOnReadBack(new InMemoryRelay(), 3300);
    const report = await runDevnetProof(
      {
        mnemonic: MNEMONIC,
        index: 45,
        utterance: 'fractal devnet relay proof',
        relaySet: RELAY_SET,
        budgetCap: 1000,
      },
      { relay, below: below() }
    );

    expect(report.plantedNow).toBe(true);
    expect(report.plantedEventsVerified).toBe(false);
    expect(() => assertProofSucceeded(report)).toThrow(/profile\/seed\/spec/);
  });

  it('fails the reconciliation assertion when the channel claim diverges from the reported fee', async () => {
    const relay = new MisreportingChannelRelay();
    const report = await runDevnetProof(
      {
        mnemonic: MNEMONIC,
        index: 46,
        utterance: 'fractal devnet relay proof',
        relaySet: RELAY_SET,
        budgetCap: 1000,
      },
      { relay, below: below() }
    );

    expect(report.reconciled).toBe(false);
    expect(() => assertProofSucceeded(report)).toThrow(/reconcile/);
  });

  it('appends one run-stamped fixture item right after the base for a fresh index', () => {
    const payload = buildProofFixturePayload(new Set(), 'run-1');
    expect(payload).toHaveLength(PROOF_FIXTURE_PAYLOAD.length + 1);
    expect(payload.slice(0, PROOF_FIXTURE_PAYLOAD.length)).toEqual([
      ...PROOF_FIXTURE_PAYLOAD,
    ]);
    expect(payload.at(-1)?.title).toContain('run-1');
  });

  it('advances the run-stamped item past every already-dittoed position, filling gaps with placeholders', () => {
    const alreadyDittoed = new Set([
      `${PROOF_SOURCE.endpoint}/latest#0`,
      `${PROOF_SOURCE.endpoint}/latest#1`,
      `${PROOF_SOURCE.endpoint}/latest#4`,
      'https://unrelated.example/latest#99', // another source's cursor never counts
    ]);
    const payload = buildProofFixturePayload(alreadyDittoed, 'run-5');
    expect(payload).toHaveLength(6); // positions 0..5
    expect(payload[3]?.title).toContain('placeholder');
    expect(payload.at(-1)?.title).toContain('run-5');
  });

  it('builds a spec that names the proof source and NIP-01 mapping', () => {
    const spec = buildProofSpec(RELAY_SET, 500);
    expect(spec.sources).toEqual([PROOF_SOURCE]);
    expect(spec.nipMappings).toEqual([{ nip: 'NIP-01', kind: 1 }]);
    expect(spec.budgetCap).toBe(500);
    expect(spec.relaySet).toEqual(RELAY_SET);
  });
});
