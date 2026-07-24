import { finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/pure';
import { deriveDimensionIdentity } from './identity.js';
import type { DimensionIdentity } from './identity.js';
import { DEFAULT_RELAY_SET } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';
import type { Seed } from './domain/seed.js';
import type { BrainPort } from './ports/brain.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

/** NIP-01 profile metadata (mutable — later tickets bind ArNS names here). */
export const PROFILE_EVENT_KIND = 0;
/** Immutable dimension origin record — never republished after planting. */
export const SEED_EVENT_KIND = 3300;
/** The compiled, amendable dimension spec (amendment is a later ticket). */
export const SPEC_EVENT_KIND = 3301;

export interface PlantRequest {
  readonly utterance: string;
  readonly mnemonic: string;
  readonly index: number;
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

  const compiled = await ports.brain.compile({ seed });
  const spec: DimensionSpec = {
    ...compiled,
    relaySet:
      compiled.relaySet.length > 0 ? compiled.relaySet : DEFAULT_RELAY_SET,
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

function signEvent(
  identity: DimensionIdentity,
  template: EventTemplate
): RelaySignedEvent {
  const finalized = finalizeEvent(template, identity.privateKey);
  return {
    id: finalized.id,
    pubkey: finalized.pubkey,
    kind: finalized.kind,
    content: finalized.content,
    tags: finalized.tags,
    createdAt: finalized.created_at,
    sig: finalized.sig,
  };
}
