import { deriveDimensionIdentity } from './identity.js';
import type { DimensionSpec } from './domain/spec.js';
import { SPEC_EVENT_KIND } from './plant.js';
import { TICK_REPORT_EVENT_KIND } from './tick.js';
import type { TickReport } from './tick.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

const SOURCE_TAG = 'source';
const RESOURCE_TAG = 'resource';

export interface StatusRequest {
  readonly mnemonic: string;
  readonly index: number;
}

export interface StatusPorts {
  readonly relay: RelayPort;
}

/** How far a source's ditto loop has advanced — the resources it has already dittoed. */
export interface SourceCursor {
  readonly sourceId: string;
  readonly dittoCount: number;
}

/** The gardening view of one dimension: everything an operator needs to tend it from the terminal. */
export interface DimensionStatus {
  readonly index: number;
  readonly pubkey: string;
  readonly npub: string;
  readonly spec: DimensionSpec;
  readonly cursors: readonly SourceCursor[];
  readonly lastTick: TickReport | null;
  readonly budgetRemaining: number;
}

function latestEvent(
  events: readonly RelaySignedEvent[]
): RelaySignedEvent | undefined {
  return events.reduce<RelaySignedEvent | undefined>(
    (latest, event) =>
      !latest || event.createdAt >= latest.createdAt ? event : latest,
    undefined
  );
}

/**
 * The gardening view: derives a dimension's forest status purely from the
 * relay — spec summary, per-source cursor positions, the last tick's
 * economics report, and budget remaining — so `fractal status` works from a
 * cold process exactly like every other read in fractal (CONTEXT.md — Ditto
 * loop, "the relay is the state of record").
 */
export async function status(
  request: StatusRequest,
  ports: StatusPorts
): Promise<DimensionStatus> {
  const identity = deriveDimensionIdentity(request.mnemonic, request.index);

  const specEvents = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [SPEC_EVENT_KIND],
  });
  const specEvent = latestEvent(specEvents);
  if (!specEvent) {
    throw new Error(
      `fractal: dimension index ${request.index} (${identity.npub}) has not been planted yet — run \`fractal plant\` first`
    );
  }
  const spec = JSON.parse(specEvent.content) as DimensionSpec;

  const cursors: SourceCursor[] = [];
  for (const source of spec.sources) {
    const dittoedForSource = await ports.relay.readBack({
      authors: [identity.pubkey],
      tags: { [SOURCE_TAG]: [source.id] },
    });
    const dittoedResources = new Set(
      dittoedForSource.flatMap((event) =>
        event.tags
          .filter((tag) => tag[0] === RESOURCE_TAG)
          .map((tag) => tag[1] ?? '')
      )
    );
    cursors.push({ sourceId: source.id, dittoCount: dittoedResources.size });
  }

  const reportEvents = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [TICK_REPORT_EVENT_KIND],
  });
  const latestReportEvent = latestEvent(reportEvents);
  const lastTick = latestReportEvent
    ? (JSON.parse(latestReportEvent.content) as TickReport)
    : null;

  return {
    index: request.index,
    pubkey: identity.pubkey,
    npub: identity.npub,
    spec,
    cursors,
    lastTick,
    budgetRemaining: lastTick ? lastTick.budgetRemaining : spec.budgetCap,
  };
}
