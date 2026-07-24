import { deriveDimensionIdentity } from './identity.js';
import type { DimensionSpec } from './domain/spec.js';
import {
  readPlantedSpec,
  readLatestParsedEvent,
  dittoedResourceUrls,
} from './relay-reads.js';
import { TICK_REPORT_EVENT_KIND } from './tick.js';
import type { TickReport } from './tick.js';
import type { RelayPort } from './ports/relay.js';

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
  const spec = await readPlantedSpec(ports.relay, identity, request.index);

  const cursors: SourceCursor[] = [];
  for (const source of spec.sources) {
    const dittoedResources = await dittoedResourceUrls(
      ports.relay,
      identity.pubkey,
      source.id
    );
    cursors.push({ sourceId: source.id, dittoCount: dittoedResources.size });
  }

  const lastTick = await readLatestParsedEvent<TickReport>(
    ports.relay,
    identity.pubkey,
    TICK_REPORT_EVENT_KIND
  );

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
