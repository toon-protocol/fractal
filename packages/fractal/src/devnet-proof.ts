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
import { fixtureKey } from './fakes/fixture-below.js';

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
 * The fixed, deterministic BASE of every run's fixture: a fresh index always
 * dittos these exact two candidates first (no wall-clock timestamp, so a run
 * against a NEW index is directly comparable to the last one). A real run's
 * payload is built by `buildProofFixturePayload`, which appends one
 * run-stamped item at a fresh position — that is what keeps a re-dispatch
 * against an already-planted index publishing, since `tick`'s cursor skips
 * every position it has already seen.
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

/** The base payload above, keyed the way `FixtureBelow` looks it up — ready to hand straight to `new FixtureBelow({ fixtures })`. Real runs use `buildProofFixtures` instead, which adds this run's fresh item. */
export const PROOF_FIXTURES: Readonly<Record<string, unknown>> = {
  [fixtureKey(PROOF_SOURCE.id, FEED_RESOURCE)]: PROOF_FIXTURE_PAYLOAD,
};

/**
 * The positional resource-URL prefix `feedAdapter`'s `buildResourceUrl` gives
 * every candidate of `PROOF_SOURCE` (`<endpoint>/<resource>#<position>`) —
 * the cursor namespace this proof's fixture grows within.
 */
const PROOF_RESOURCE_URL_PREFIX = `${PROOF_SOURCE.endpoint}/${FEED_RESOURCE}#`;

/**
 * The first fixture position no prior run has dittoed, derived from the same
 * read-back cursor `tick` itself consults. The base payload occupies
 * positions `0..PROOF_FIXTURE_PAYLOAD.length - 1`, so a fresh index starts
 * right after it; on a reused index the highest position any prior run
 * published wins.
 */
function nextProofFixturePosition(alreadyDittoed: ReadonlySet<string>): number {
  let highest = PROOF_FIXTURE_PAYLOAD.length - 1;
  for (const url of alreadyDittoed) {
    if (!url.startsWith(PROOF_RESOURCE_URL_PREFIX)) {
      continue;
    }
    const position = Number.parseInt(
      url.slice(PROOF_RESOURCE_URL_PREFIX.length),
      10
    );
    if (Number.isInteger(position) && position > highest) {
      highest = position;
    }
  }
  return highest + 1;
}

/**
 * Builds this run's fixture payload: the fixed base items plus ONE
 * run-stamped item at a position no prior run has dittoed (positions are the
 * payload's array indices — see `feedAdapter`'s `buildResourceUrl`). This is
 * what makes a re-dispatch against an already-planted index still perform a
 * real paid publish: `tick` derives its cursor from read-back and skips
 * every position it has already seen, so against an unchanged fixture a
 * reuse run would publish nothing and the proof would pass vacuously.
 * Positions between the base and the fresh one (possible when an earlier
 * run failed mid-tick) are filled with deterministic placeholders; a gap
 * that never actually published simply publishes its placeholder too — one
 * extra paid ditto, never a wrong one.
 */
export function buildProofFixturePayload(
  alreadyDittoed: ReadonlySet<string>,
  runStamp: string
): readonly Record<string, unknown>[] {
  const next = nextProofFixturePosition(alreadyDittoed);
  const payload = [...PROOF_FIXTURE_PAYLOAD];
  for (let position = payload.length; position < next; position += 1) {
    payload.push({
      id: 100 + position,
      title: `fractal devnet relay proof — position ${position} placeholder`,
      by: 'fractal',
      time: 1_800_000_000 + position * 3_600,
    });
  }
  payload.push({
    id: 100 + next,
    title: `fractal devnet relay proof — run ${runStamp}`,
    by: 'fractal',
    time: 1_800_000_000 + next * 3_600,
  });
  return payload;
}

/** `buildProofFixturePayload`, keyed for `new FixtureBelow({ fixtures })` the same way `PROOF_FIXTURES` is. */
export function buildProofFixtures(
  alreadyDittoed: ReadonlySet<string>,
  runStamp: string
): Readonly<Record<string, unknown>> {
  return {
    [fixtureKey(PROOF_SOURCE.id, FEED_RESOURCE)]: buildProofFixturePayload(
      alreadyDittoed,
      runStamp
    ),
  };
}

/** The NIP-01 kind the feed medium dittos into — what this proof plants a mapping for and reads back to verify. */
const DITTO_EVENT_KIND = 1;

/** Builds the spec this proof plants — one source, one NIP mapping, `budgetCap` is a pre-fund request that `plant`'s `fundChannel` overrides with the channel's real deposit. */
export function buildProofSpec(
  relaySet: readonly string[],
  budgetCap: number
): DimensionSpec {
  return {
    sources: [PROOF_SOURCE],
    nipMappings: [{ nip: 'NIP-01', kind: DITTO_EVENT_KIND }],
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
 * new one" — and topping its channel up to the requested budget target,
 * which `plant` would otherwise have done), tick it once, then verify by
 * reading the *same port* back
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
  } else if (ports.relay.fundChannel) {
    // `fundChannel` otherwise runs only inside `plant`, and plant only runs
    // on a fresh index — so the reuse path must top the channel up here, or
    // re-dispatching with a raised `budget_cap_base_units` would silently do
    // nothing. The target is absolute ("top up to at least"), so this is a
    // no-op whenever the channel already holds that much.
    await ports.relay.fundChannel(request.budgetCap);
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
      kinds: [DITTO_EVENT_KIND],
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
  if (report.publishedDittoIds.length === 0) {
    // Without this a reuse run whose cursor already covered every fixture
    // position would pass every assertion having published nothing and
    // verified nothing — a vacuous green. `buildProofFixtures` guarantees a
    // fresh position per run, so an empty publish list here means the run
    // did not exercise the paid path at all.
    failures.push(
      'no paid ditto was published this run — the proof exercised nothing'
    );
  }
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
