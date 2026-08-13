import { deriveDimensionIdentity } from './identity.js';
import {
  plant,
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
} from './plant.js';
import { tick } from './tick.js';
import { readPlantedSpec } from './relay-reads.js';
import { validateSpec } from './domain/spec.js';
import type { DimensionSpec, SourceConfig } from './domain/spec.js';
import type { BelowPort } from './ports/below.js';
import type { BrainPort } from './ports/brain.js';
import type { RelayPort } from './ports/relay.js';
import { FEED_RESOURCE } from './adapters/feed.js';

/**
 * The fixed source this proof ditto-loops against. Its endpoint is a
 * namespaced, never-dereferenced URL — the source of truth is the fixture
 * payload below, served by a `FixtureBelow`, not a live API — because this
 * issue proves the Relay port is real, not the Below port (no real Below
 * implementation exists yet; see CONTEXT.md and fractal#8/#32).
 */
export const PROOF_SOURCE: SourceConfig = {
  id: 'fractal-devnet-relay-proof',
  kind: 'hn',
  endpoint: 'https://fractal-devnet-proof.invalid/source',
};

/**
 * A fixed, deterministic two-item fixture so every run of this proof against
 * a fresh index dittos the exact same candidates — repeatable by
 * construction, per this issue's rescope (no wall-clock timestamp, so a
 * re-run against a NEW index is byte-identical to the last one).
 */
export const PROOF_FIXTURE_PAYLOAD: readonly Record<string, unknown>[] = [
  {
    id: 1,
    title: 'fractal devnet relay proof — event one',
    by: 'fractal',
    time: 1_800_000_000,
  },
  {
    id: 2,
    title: 'fractal devnet relay proof — event two',
    by: 'fractal',
    time: 1_800_003_600,
  },
];

/** `FixtureBelow`'s fixture-key convention (`fakes/fixture-below.ts`), duplicated here to avoid a fakes -> proof dependency. */
export const PROOF_FIXTURES: Readonly<Record<string, unknown>> = {
  [`${PROOF_SOURCE.id}:${FEED_RESOURCE}`]: PROOF_FIXTURE_PAYLOAD,
};

/** Builds the spec this proof plants — one source, one NIP mapping, `budgetCap` is a pre-fund request that `plant`'s `fundChannel` overrides with the channel's real deposit. */
export function buildProofSpec(
  relaySet: readonly string[],
  budgetCap: number
): DimensionSpec {
  return {
    sources: [PROOF_SOURCE],
    nipMappings: [{ nip: 'NIP-01', kind: 1 }],
    cadence: 'hourly',
    budgetCap,
    relaySet,
  };
}

/**
 * A `BrainPort` that throws if ever called. Plant only calls the brain when
 * no explicit spec is given (`plant.ts`); this proof always supplies one, so
 * wiring this in place of a real brain proves — by construction, not by
 * inspection — that the proof run never depended on brain credentials.
 */
export const NEVER_BRAIN: BrainPort = {
  compile() {
    throw new Error(
      'fractal: devnet proof must never call the brain — an explicit spec is always supplied'
    );
  },
  interpret() {
    throw new Error(
      'fractal: devnet proof must never call the brain — no interpretation pass runs here'
    );
  },
  adapt() {
    throw new Error(
      'fractal: devnet proof must never call the brain — no adaptation pass runs here'
    );
  },
};

export interface DevnetProofRequest {
  readonly mnemonic: string;
  readonly index: number;
  readonly utterance: string;
  readonly relaySet: readonly string[];
  /** Pre-fund request; overridden by the channel's real deposit when `ports.relay.fundChannel` is wired. */
  readonly budgetCap: number;
}

export interface DevnetProofPorts {
  readonly relay: RelayPort;
  readonly below: BelowPort;
}

export interface DevnetProofReport {
  readonly index: number;
  readonly pubkey: string;
  readonly npub: string;
  /** False when index was already planted — the run reused it rather than opening a new channel. */
  readonly plantedNow: boolean;
  /** Only meaningful when `plantedNow`: profile/seed/spec all read back after publish. */
  readonly plantedEventsVerified: boolean;
  readonly publishedDittoIds: readonly string[];
  /** Every id in `publishedDittoIds` was independently visible in a fresh `readBack` call. */
  readonly dittoReadBackVerified: boolean;
  readonly reportPublished: boolean;
  readonly feesPaidThisTick: number;
  readonly channelSpendBefore: number | undefined;
  readonly channelSpendAfter: number | undefined;
  readonly budgetCap: number;
  readonly budgetRemaining: number;
  /** The channel's real claim delta reconciles against the tick's self-reported fees — AC 2. */
  readonly reconciled: boolean;
}

/**
 * The devnet proof: plant this index if it isn't already living (reusing an
 * existing one otherwise — "prefer reusing an open channel over opening a
 * new one"), tick it once, then verify by reading the *same port* back
 * rather than trusting either call's return value, and reconcile the
 * channel's live claim against the tick's self-reported fees (CONTEXT.md —
 * Ditto loop, Dimension identity; fractal#8/#32).
 */
export async function runDevnetProof(
  request: DevnetProofRequest,
  ports: DevnetProofPorts
): Promise<DevnetProofReport> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);

  const existing = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [SEED_EVENT_KIND],
    limit: 1,
  });

  let plantedNow = false;
  let plantedEventsVerified = true;

  if (existing.length === 0) {
    const candidate = buildProofSpec(request.relaySet, request.budgetCap);
    const validation = validateSpec(candidate);
    if (!validation.ok) {
      throw new Error(
        `fractal: devnet proof spec is invalid — ${validation.reasons.join('; ')} — refusing to plant`
      );
    }

    await plant(
      {
        utterance: request.utterance,
        mnemonic: request.mnemonic,
        index: request.index,
        spec: validation.spec,
      },
      { relay: ports.relay, brain: NEVER_BRAIN }
    );
    plantedNow = true;

    const [profileBack, seedBack, specBack] = await Promise.all([
      ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [PROFILE_EVENT_KIND],
        limit: 1,
      }),
      ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [SEED_EVENT_KIND],
        limit: 1,
      }),
      ports.relay.readBack({
        authors: [identity.pubkey],
        kinds: [SPEC_EVENT_KIND],
        limit: 1,
      }),
    ]);
    plantedEventsVerified =
      profileBack.length > 0 && seedBack.length > 0 && specBack.length > 0;
  }

  const channelSpendBefore = await ports.relay.channelSpend?.();

  const tickResult = await tick(
    { mnemonic: request.mnemonic, index: request.index },
    { below: ports.below, relay: ports.relay }
  );

  const channelSpendAfter = await ports.relay.channelSpend?.();

  let dittoReadBackVerified = true;
  if (tickResult.published.length > 0) {
    const dittoReadBack = await ports.relay.readBack({
      authors: [identity.pubkey],
      kinds: [1],
      limit: 500,
    });
    const seenIds = new Set(dittoReadBack.map((event) => event.id));
    dittoReadBackVerified = tickResult.published.every((event) =>
      seenIds.has(event.id)
    );
  }

  let reconciled = true;
  if (channelSpendBefore !== undefined && channelSpendAfter !== undefined) {
    const delta = channelSpendAfter - channelSpendBefore;
    // The report is itself a paid write that can add to the delta beyond
    // `feesPaidThisTick` (ditto fees only); when it was refused, no extra
    // charge should appear and the delta must match exactly.
    reconciled = tickResult.reportPublished
      ? delta >= tickResult.feesPaid
      : delta === tickResult.feesPaid;
  }

  const spec = await readPlantedSpec(ports.relay, identity, request.index);

  return {
    index: request.index,
    pubkey: identity.pubkey,
    npub: identity.npub,
    plantedNow,
    plantedEventsVerified,
    publishedDittoIds: tickResult.published.map((event) => event.id),
    dittoReadBackVerified,
    reportPublished: tickResult.reportPublished,
    feesPaidThisTick: tickResult.feesPaid,
    channelSpendBefore,
    channelSpendAfter,
    budgetCap: spec.budgetCap,
    budgetRemaining: tickResult.budgetRemaining,
    reconciled,
  };
}

/** Throws with a summary of every failed assertion — the workflow's fail-loud gate. */
export function assertProofSucceeded(report: DevnetProofReport): void {
  const failures: string[] = [];
  if (!report.plantedEventsVerified) {
    failures.push(
      'planted profile/seed/spec were not all visible on read-back'
    );
  }
  if (!report.dittoReadBackVerified) {
    failures.push('a published ditto id was not visible on read-back');
  }
  if (!report.reconciled) {
    failures.push(
      "the channel's live claim delta did not reconcile against the tick's reported fees"
    );
  }
  if (failures.length > 0) {
    throw new Error(`fractal: devnet proof FAILED — ${failures.join('; ')}`);
  }
}
