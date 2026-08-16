import { deriveDimensionIdentity, signEvent } from './identity.js';
import { resolveRelaySet, validateSpec } from './domain/spec.js';
import {
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
} from './domain/event.js';
import type { DimensionSpec } from './domain/spec.js';
import type { Seed } from './domain/seed.js';
import type { BrainPort } from './ports/brain.js';
import type { RelayPort } from './ports/relay.js';

/**
 * Re-exported, not declared here: these kinds now live in `domain/event.ts`
 * so the portal can import them from the `./domain` subpath without pulling
 * in plant's relay/brain wiring. Kept on plant's surface because the modules
 * that publish and read these events already import them from here.
 */
export { PROFILE_EVENT_KIND, SEED_EVENT_KIND, SPEC_EVENT_KIND };

export interface PlantRequest {
  readonly utterance: string;
  readonly mnemonic: string;
  readonly index: number;
  /**
   * Bypasses the brain entirely when present — the credential-less path: an
   * operator-supplied spec skips `ports.brain.compile`, so a Brain port with
   * no credentials never gets called (CONTEXT.md — Hands, Brain).
   */
  readonly spec?: DimensionSpec;
}

export interface PlantResult {
  readonly pubkey: string;
  readonly npub: string;
  readonly seed: Seed;
  readonly spec: DimensionSpec;
}

export interface PlantPorts {
  readonly relay: RelayPort;
  readonly brain: BrainPort;
}

/**
 * The plant use case: derive the dimension's identity, refuse to re-plant an
 * already-living index, compile the seed into a spec, then publish the
 * profile/seed/spec events signed by the dimension key (CONTEXT.md — Seed,
 * Dimension spec, Dimension identity).
 */
export async function plant(
  request: PlantRequest,
  ports: PlantPorts
): Promise<PlantResult> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);

  const alreadyPlanted = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [SEED_EVENT_KIND],
    limit: 1,
  });
  if (alreadyPlanted.length > 0) {
    throw new Error(
      `fractal: dimension index ${request.index} is already planted (${identity.npub}) — the seed is immutable, plant a new index instead`
    );
  }

  const seed: Seed = {
    id: identity.pubkey,
    utterance: request.utterance,
    plantedAt: new Date().toISOString(),
  };

  const candidate = request.spec ?? (await ports.brain.compile({ seed }));
  const validation = validateSpec(candidate);
  if (!validation.ok) {
    throw new Error(
      `fractal: ${
        request.spec ? 'the --spec you provided' : "the brain's compiled spec"
      } is invalid — ${validation.reasons.join('; ')} — nothing was published`
    );
  }
  const compiled = validation.spec;

  const budgetCap = ports.relay.fundChannel
    ? await ports.relay.fundChannel(compiled.budgetCap)
    : compiled.budgetCap;
  const spec: DimensionSpec = {
    ...compiled,
    budgetCap,
    relaySet: resolveRelaySet(compiled.relaySet),
  };

  const createdAt = Math.floor(Date.parse(seed.plantedAt) / 1000);
  const events = [
    signEvent(identity, {
      kind: PROFILE_EVENT_KIND,
      content: JSON.stringify({ about: seed.utterance }),
      tags: [],
      created_at: createdAt,
    }),
    signEvent(identity, {
      kind: SEED_EVENT_KIND,
      content: JSON.stringify(seed),
      tags: [],
      created_at: createdAt,
    }),
    signEvent(identity, {
      kind: SPEC_EVENT_KIND,
      content: JSON.stringify(spec),
      tags: [],
      created_at: createdAt,
    }),
  ];

  for (const event of events) {
    await ports.relay.publish({ relaySet: spec.relaySet, event });
  }

  return { pubkey: identity.pubkey, npub: identity.npub, seed, spec };
}
