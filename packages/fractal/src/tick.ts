import { deriveDimensionIdentity, signEvent } from './identity.js';
import { evaluateCandidate } from './domain/gate.js';
import type { DimensionSpec } from './domain/spec.js';
import { AdapterRegistry } from './adapters/registry.js';
import { feedAdapter } from './adapters/feed.js';
import { SPEC_EVENT_KIND } from './plant.js';
import type { BelowPort } from './ports/below.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

/** Tags a published ditto carries so a later tick can read back what a source has already dittoed. */
const SOURCE_TAG = 'source';
const RESOURCE_TAG = 'resource';

const ADAPTERS = new AdapterRegistry();
ADAPTERS.register(feedAdapter);

export interface TickRequest {
  readonly mnemonic: string;
  readonly index: number;
}

export interface TickPorts {
  readonly below: BelowPort;
  readonly relay: RelayPort;
}

export interface TickKickBack {
  readonly sourceId: string;
  readonly resourceUrl: string;
  readonly reasons: readonly string[];
}

export interface TickResult {
  readonly pubkey: string;
  readonly npub: string;
  readonly published: readonly RelaySignedEvent[];
  readonly kickedBack: readonly TickKickBack[];
}

/**
 * The ditto loop's heartbeat: fetch (Below, per spec source) → project (the
 * source's medium adapter) → NIP gate → publish (Relay, paid writes). Cursors
 * — which resources a source has already dittoed — are derived purely from
 * reading the relay back, never from local state, so a second tick against
 * unchanged fixtures publishes nothing new and deleting all local state
 * changes nothing (CONTEXT.md — Ditto loop). No Brain-port call occurs
 * anywhere in this path.
 */
export async function tick(
  request: TickRequest,
  ports: TickPorts
): Promise<TickResult> {
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

  const published: RelaySignedEvent[] = [];
  const kickedBack: TickKickBack[] = [];

  for (const source of spec.sources) {
    const adapter = ADAPTERS.resolve(source.kind);
    const response = await adapter.fetch(source, ports.below);
    const candidates = adapter.project(response, source);

    const dittoedForSource = await ports.relay.readBack({
      authors: [identity.pubkey],
      tags: { [SOURCE_TAG]: [source.id] },
    });
    const alreadyDittoed = new Set(
      dittoedForSource.flatMap((event) =>
        event.tags
          .filter((tag) => tag[0] === RESOURCE_TAG)
          .map((tag) => tag[1] ?? '')
      )
    );

    const newCandidates = candidates.filter(
      (candidate) => !alreadyDittoed.has(candidate.provenance.resourceUrl)
    );

    for (const candidate of newCandidates) {
      const verdict = evaluateCandidate(candidate, spec);
      if (!verdict.ok) {
        kickedBack.push({
          sourceId: source.id,
          resourceUrl: candidate.provenance.resourceUrl,
          reasons: verdict.reasons,
        });
        continue;
      }

      const event = signEvent(identity, {
        kind: candidate.kind,
        content: candidate.content,
        tags: [
          ...candidate.tags.map((tag) => [...tag]),
          [SOURCE_TAG, source.id],
          [RESOURCE_TAG, candidate.provenance.resourceUrl],
        ],
        created_at: candidate.createdAt,
      });

      await ports.relay.publish({ relaySet: spec.relaySet, event });
      published.push(event);
    }
  }

  return {
    pubkey: identity.pubkey,
    npub: identity.npub,
    published,
    kickedBack,
  };
}
