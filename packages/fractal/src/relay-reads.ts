import type { DimensionIdentity } from './identity.js';
import type { DimensionSpec } from './domain/spec.js';
import { SPEC_EVENT_KIND } from './plant.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

/**
 * Package-internal only — deliberately not part of the root barrel
 * (index.ts). These are relay read-back helpers shared by `tick` and
 * `status`, not public surface.
 */

/** Tags a published ditto carries so a later read-back can tell what a source has already dittoed. */
export const SOURCE_TAG = 'source';
export const RESOURCE_TAG = 'resource';

/**
 * Latest-by-createdAt wins — the relay may hold more than one event of a
 * kind (e.g. successive spec amendments or tick reports). Same-second ties
 * break toward the later element of `events`, since read-back preserves
 * publish order.
 */
export function latestEvent(
  events: readonly RelaySignedEvent[]
): RelaySignedEvent | undefined {
  return events.reduce<RelaySignedEvent | undefined>(
    (latest, event) =>
      !latest || event.createdAt >= latest.createdAt ? event : latest,
    undefined
  );
}

/**
 * Reads a dimension's latest planted spec back from the relay — shared by
 * every read path (`tick`, `status`) since the relay, not local state, is
 * what makes a spec amendment visible (CONTEXT.md — "the relay is the state
 * of record"). Throws if the dimension has never been planted.
 */
export async function readPlantedSpec(
  relay: RelayPort,
  identity: DimensionIdentity,
  index: number
): Promise<DimensionSpec> {
  const specEvents = await relay.readBack({
    authors: [identity.pubkey],
    kinds: [SPEC_EVENT_KIND],
  });
  const specEvent = latestEvent(specEvents);
  if (!specEvent) {
    throw new Error(
      `fractal: dimension index ${index} (${identity.npub}) has not been planted yet — run \`fractal plant\` first`
    );
  }
  return JSON.parse(specEvent.content) as DimensionSpec;
}

/** Reads a dimension's latest event of a kind back from the relay, parsed as `T`, or `null` if none exists. */
export async function readLatestParsedEvent<T>(
  relay: RelayPort,
  pubkey: string,
  kind: number
): Promise<T | null> {
  const events = await relay.readBack({ authors: [pubkey], kinds: [kind] });
  const event = latestEvent(events);
  return event ? (JSON.parse(event.content) as T) : null;
}

/** The resource URLs a source has already dittoed, derived purely from relay read-back. */
export async function dittoedResourceUrls(
  relay: RelayPort,
  pubkey: string,
  sourceId: string
): Promise<ReadonlySet<string>> {
  const events = await relay.readBack({
    authors: [pubkey],
    tags: { [SOURCE_TAG]: [sourceId] },
  });
  return new Set(
    events.flatMap((event) =>
      event.tags
        .filter((tag) => tag[0] === RESOURCE_TAG)
        .map((tag) => tag[1] ?? '')
    )
  );
}
