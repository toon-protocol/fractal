import { deriveDimensionIdentity, signEvent } from './identity.js';
import { evaluateInterpretation } from './domain/gate.js';
import { INTERPRETATION_EVENT_KIND } from './domain/event.js';
import type { DimensionSpec } from './domain/spec.js';
import { SPEC_EVENT_KIND } from './plant.js';
import type { BrainPort } from './ports/brain.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

/** The feed medium's ditto kind — v1's only source of dittos to interpret. */
const DITTO_KIND = 1;

export interface InterpretationRequest {
  readonly mnemonic: string;
  readonly index: number;
}

export interface InterpretPorts {
  readonly relay: RelayPort;
  readonly brain: BrainPort;
}

export interface InterpretKickBack {
  readonly reasons: readonly string[];
}

export interface InterpretResult {
  readonly pubkey: string;
  readonly npub: string;
  readonly published: readonly RelaySignedEvent[];
  readonly kickedBack: readonly InterpretKickBack[];
}

/**
 * The interpretation pass: read back the dimension's dittos (Relay), ask the
 * Brain port for commentary, then publish it as its own event — referencing
 * every ditto it comments on, never blended into one (CONTEXT.md —
 * Interpretation). Passes through the NIP gate like any other publish; a
 * kicked-back candidate is reported, never published and never silently
 * dropped, same as the ditto loop.
 */
export async function interpret(
  request: InterpretationRequest,
  ports: InterpretPorts
): Promise<InterpretResult> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);

  const specEvents = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [SPEC_EVENT_KIND],
    limit: 1,
  });
  const specEvent = specEvents[0];
  if (!specEvent) {
    throw new Error(
      `fractal: dimension index ${request.index} (${identity.npub}) has not been planted yet — run \`fractal plant\` first`
    );
  }
  const spec = JSON.parse(specEvent.content) as DimensionSpec;

  const dittos = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [DITTO_KIND],
  });

  if (dittos.length === 0) {
    return {
      pubkey: identity.pubkey,
      npub: identity.npub,
      published: [],
      kickedBack: [],
    };
  }

  const commentary = await ports.brain.interpret({ dittos });
  const dittoIds = new Set(dittos.map((ditto) => ditto.id));

  const candidate = {
    kind: INTERPRETATION_EVENT_KIND,
    content: commentary,
    tags: [...dittoIds].map((id) => ['e', id]),
    createdAt: Math.floor(Date.now() / 1000),
  };

  const verdict = evaluateInterpretation(candidate, dittoIds);
  if (!verdict.ok) {
    return {
      pubkey: identity.pubkey,
      npub: identity.npub,
      published: [],
      kickedBack: [{ reasons: verdict.reasons }],
    };
  }

  const event = signEvent(identity, {
    kind: candidate.kind,
    content: candidate.content,
    tags: candidate.tags,
    created_at: candidate.createdAt,
  });

  await ports.relay.publish({ relaySet: spec.relaySet, event });

  return {
    pubkey: identity.pubkey,
    npub: identity.npub,
    published: [event],
    kickedBack: [],
  };
}
