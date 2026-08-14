import { deriveDimensionIdentity } from './identity.js';
import {
  plant,
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
} from './plant.js';
import { validateSpec } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';
import type { BrainPort } from './ports/brain.js';
import type { RelayPort } from './ports/relay.js';

export interface BrainPlantProofRequest {
  readonly mnemonic: string;
  readonly index: number;
  readonly utterance: string;
}

export interface BrainPlantProofPorts {
  readonly relay: RelayPort;
  readonly brain: BrainPort;
}

export interface BrainPlantProofReport {
  readonly index: number;
  readonly pubkey: string;
  readonly npub: string;
  readonly spec: DimensionSpec;
  /**
   * Re-checked independently of `plant`'s own internal validation — proves
   * fractal#9's "produces a validated spec" from the proof's own vantage
   * point, not merely that `plant` didn't throw.
   */
  readonly specValid: boolean;
  /** Profile, seed, AND spec were all independently visible on read-back — a half-plant would show up here as false (fractal#33, "no half-plant"). */
  readonly plantedEventsVerified: boolean;
}

/**
 * The one-utterance-plant proof (fractal#9): plant a fresh index through the
 * REAL Brain port (`ports.brain` is expected to be a credentialed
 * `ClaudeBrain` in the live run — a `ScriptedBrain` in tests), then verify
 * — by reading the relay back rather than trusting `plant`'s own return
 * value — that the compiled spec validates and all three planted events are
 * visible. `ports.relay` needs no real network for this proof: fractal#8/#32
 * already proved the Relay port live; this proof is scoped to the Brain
 * port only, so an `InMemoryRelay` is exactly as probative here as a real
 * one.
 */
export async function runBrainPlantProof(
  request: BrainPlantProofRequest,
  ports: BrainPlantProofPorts
): Promise<BrainPlantProofReport> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);

  const existing = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [SEED_EVENT_KIND],
    limit: 1,
  });
  if (existing.length > 0) {
    throw new Error(
      `fractal: brain plant proof index ${request.index} is already planted (${identity.npub}) — pick a fresh index`
    );
  }

  const result = await plant(
    {
      utterance: request.utterance,
      mnemonic: request.mnemonic,
      index: request.index,
    },
    { relay: ports.relay, brain: ports.brain }
  );

  const specValid = validateSpec(result.spec).ok;

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
  const plantedEventsVerified =
    profileBack.length > 0 && seedBack.length > 0 && specBack.length > 0;

  return {
    index: request.index,
    pubkey: identity.pubkey,
    npub: identity.npub,
    spec: result.spec,
    specValid,
    plantedEventsVerified,
  };
}

/** Throws with a summary of every failed assertion — the workflow's fail-loud gate. */
export function assertBrainPlantProofSucceeded(
  report: BrainPlantProofReport
): void {
  const failures: string[] = [];
  if (!report.specValid) {
    failures.push("the brain's compiled spec did not validate");
  }
  if (!report.plantedEventsVerified) {
    failures.push(
      'planted profile/seed/spec were not all visible on read-back — a partial plant'
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `fractal: brain plant proof FAILED — ${failures.join('; ')}`
    );
  }
}
