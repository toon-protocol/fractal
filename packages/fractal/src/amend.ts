import { deriveDimensionIdentity, signEvent } from './identity.js';
import { DEFAULT_RELAY_SET } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';
import { SPEC_EVENT_KIND } from './plant.js';
import { readPlantedSpec } from './relay-reads.js';
import type { RelayPort } from './ports/relay.js';

export interface AmendRequest {
  readonly mnemonic: string;
  readonly index: number;
  readonly spec: DimensionSpec;
}

export interface AmendResult {
  readonly pubkey: string;
  readonly npub: string;
  readonly previousSpec: DimensionSpec;
  readonly spec: DimensionSpec;
}

export interface AmendPorts {
  readonly relay: RelayPort;
}

/**
 * The amend use case: publish a new spec version signed by the dimension
 * key, without touching the seed (CONTEXT.md — Dimension spec, "amendable;
 * amendments happen here, never to the seed"). Like plant's profile/seed/
 * spec events, this is identity/config management rather than a ditto or
 * interpretation, so it never passes through the NIP gate. History remains
 * on the relay — this publishes a new SPEC_EVENT_KIND event rather than
 * replacing one — and every reader (tick, status, a later amend) resolves
 * to the latest by createdAt (relay-reads.ts), so the next tick and a cold
 * resume both honor the amendment by construction, with no changes needed
 * on their side.
 */
export async function amend(
  request: AmendRequest,
  ports: AmendPorts
): Promise<AmendResult> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);
  const previousSpec = await readPlantedSpec(
    ports.relay,
    identity,
    request.index
  );

  const spec: DimensionSpec = {
    ...request.spec,
    relaySet:
      request.spec.relaySet.length > 0
        ? request.spec.relaySet
        : DEFAULT_RELAY_SET,
  };

  const event = signEvent(identity, {
    kind: SPEC_EVENT_KIND,
    content: JSON.stringify(spec),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });
  await ports.relay.publish({ relaySet: spec.relaySet, event });

  return { pubkey: identity.pubkey, npub: identity.npub, previousSpec, spec };
}
