import {
  INTERPRETATION_EVENT_KIND,
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
  TICK_REPORT_EVENT_KIND,
} from '@toon-protocol/fractal/domain';
import type { DimensionSpec, Seed } from '@toon-protocol/fractal/domain';
import type { RelaySignedEvent } from '@toon-protocol/fractal/ports';

/**
 * Same literal tag names `tick.ts` publishes a ditto's provenance under
 * (`relay-reads.ts`'s SOURCE_TAG/RESOURCE_TAG) — not re-imported because that
 * module is package-internal, not part of fractal's public barrel.
 */
const SOURCE_TAG = 'source';
const RESOURCE_TAG = 'resource';

/** Events that are part of a dimension's identity/operations, never rendered in the feed. */
const NON_FEED_KINDS = new Set([
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
  TICK_REPORT_EVENT_KIND,
]);

export interface DimensionProfile {
  readonly about: string;
}

/** A ditto's provenance as visible on the published event itself — source + resource link (CONTEXT.md — Ditto). */
export interface DittoProvenance {
  readonly sourceId: string;
  readonly resourceUrl: string;
}

export interface DittoItem {
  readonly type: 'ditto';
  readonly id: string;
  readonly kind: number;
  readonly content: string;
  readonly createdAt: number;
  readonly provenance: DittoProvenance | undefined;
}

export interface InterpretationItem {
  readonly type: 'interpretation';
  readonly id: string;
  readonly content: string;
  readonly createdAt: number;
  readonly referencedDittoIds: readonly string[];
}

export type FeedItem = DittoItem | InterpretationItem;

/**
 * A dimension as rendered by the portal: identity (profile/seed/spec) plus
 * its feed — dittos and interpretation kept as structurally distinct item
 * types so a renderer can never blend them (CONTEXT.md — Ditto,
 * Interpretation).
 */
export interface DimensionView {
  readonly pubkey: string;
  readonly profile: DimensionProfile | undefined;
  readonly seed: Seed | undefined;
  readonly spec: DimensionSpec | undefined;
  readonly feed: readonly FeedItem[];
}

function parseJsonSafe<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/** Latest-by-createdAt wins, same convention `relay-reads.ts`'s latestEvent uses. */
function latestOfKind(
  events: readonly RelaySignedEvent[],
  kind: number
): RelaySignedEvent | undefined {
  return events
    .filter((event) => event.kind === kind)
    .reduce<RelaySignedEvent | undefined>(
      (latest, event) =>
        !latest || event.createdAt >= latest.createdAt ? event : latest,
      undefined
    );
}

function parseProvenance(
  tags: readonly (readonly string[])[]
): DittoProvenance | undefined {
  const sourceId = tags.find((tag) => tag[0] === SOURCE_TAG)?.[1];
  const resourceUrl = tags.find((tag) => tag[0] === RESOURCE_TAG)?.[1];
  return sourceId && resourceUrl ? { sourceId, resourceUrl } : undefined;
}

function toFeedItem(event: RelaySignedEvent): FeedItem {
  if (event.kind === INTERPRETATION_EVENT_KIND) {
    return {
      type: 'interpretation',
      id: event.id,
      content: event.content,
      createdAt: event.createdAt,
      referencedDittoIds: event.tags
        .filter((tag) => tag[0] === 'e')
        .map((tag) => tag[1])
        .filter((id): id is string => id !== undefined),
    };
  }
  return {
    type: 'ditto',
    id: event.id,
    kind: event.kind,
    content: event.content,
    createdAt: event.createdAt,
    provenance: parseProvenance(event.tags),
  };
}

/**
 * Builds a dimension's portal view purely from relay-read events — no
 * network inside this function, so it is exercised directly against fixture
 * events in tests (CONTEXT.md — Relay set, "the relay is the state of
 * record").
 */
export function buildDimensionView(
  pubkey: string,
  events: readonly RelaySignedEvent[]
): DimensionView {
  const ownEvents = events.filter((event) => event.pubkey === pubkey);

  const profileEvent = latestOfKind(ownEvents, PROFILE_EVENT_KIND);
  const seedEvent = latestOfKind(ownEvents, SEED_EVENT_KIND);
  const specEvent = latestOfKind(ownEvents, SPEC_EVENT_KIND);

  const feed = ownEvents
    .filter((event) => !NON_FEED_KINDS.has(event.kind))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toFeedItem);

  return {
    pubkey,
    profile: profileEvent
      ? parseJsonSafe<DimensionProfile>(profileEvent.content)
      : undefined,
    seed: seedEvent ? parseJsonSafe<Seed>(seedEvent.content) : undefined,
    spec: specEvent
      ? parseJsonSafe<DimensionSpec>(specEvent.content)
      : undefined,
    feed,
  };
}
