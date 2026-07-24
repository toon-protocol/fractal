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

/**
 * The per-tick economics log: not a ditto or interpretation, so it never
 * passes through the NIP gate — same exemption plant.ts's own identity
 * events already carry. Its `spent` field is the running total of fees the
 * ditto loop has paid across every tick, so budget enforcement is derived
 * purely from relay read-back, never local state (CONTEXT.md — Ditto loop,
 * "the relay is the state of record").
 */
export const TICK_REPORT_EVENT_KIND = 3302;

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

/** A gate-passed candidate that would have exceeded the budget cap — never published, never dropped. */
export interface TickWithheld {
  readonly sourceId: string;
  readonly resourceUrl: string;
}

/** The tick's own economics report, persisted to the relay so a later tick or `fractal status` can read it back. */
export interface TickReport {
  readonly published: number;
  readonly feesPaid: number;
  readonly spent: number;
  readonly budgetRemaining: number;
  readonly kickedBack: readonly TickKickBack[];
  readonly withheld: readonly TickWithheld[];
}

export interface TickResult {
  readonly pubkey: string;
  readonly npub: string;
  readonly published: readonly RelaySignedEvent[];
  readonly kickedBack: readonly TickKickBack[];
  readonly withheld: readonly TickWithheld[];
  readonly feesPaid: number;
  readonly budgetRemaining: number;
}

/**
 * Latest-by-createdAt wins — the relay may hold more than one event of a
 * kind (e.g. successive tick reports). Same-second ties (routine within a
 * single test or a fast heartbeat) break toward the later element of
 * `events`, since read-back preserves publish order.
 */
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
  });
  const specEvent = latestEvent(specEvents);
  if (!specEvent) {
    throw new Error(
      `fractal: dimension index ${request.index} (${identity.npub}) has not been planted yet — run \`fractal plant\` first`
    );
  }
  const spec = JSON.parse(specEvent.content) as DimensionSpec;

  const reportEvents = await ports.relay.readBack({
    authors: [identity.pubkey],
    kinds: [TICK_REPORT_EVENT_KIND],
  });
  const previousReport = latestEvent(reportEvents);
  let spent = previousReport
    ? (JSON.parse(previousReport.content) as TickReport).spent
    : 0;
  let budgetExhausted = spent >= spec.budgetCap;
  let feesPaidThisTick = 0;

  const published: RelaySignedEvent[] = [];
  const kickedBack: TickKickBack[] = [];
  const withheld: TickWithheld[] = [];

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

      if (budgetExhausted) {
        withheld.push({
          sourceId: source.id,
          resourceUrl: candidate.provenance.resourceUrl,
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

      const fee = await ports.relay.quoteFee({
        relaySet: spec.relaySet,
        event,
      });
      if (spent + fee > spec.budgetCap) {
        budgetExhausted = true;
        withheld.push({
          sourceId: source.id,
          resourceUrl: candidate.provenance.resourceUrl,
        });
        continue;
      }

      await ports.relay.publish({ relaySet: spec.relaySet, event });
      spent += fee;
      feesPaidThisTick += fee;
      published.push(event);
    }
  }

  const budgetRemaining = Math.max(spec.budgetCap - spent, 0);
  const report: TickReport = {
    published: published.length,
    feesPaid: feesPaidThisTick,
    spent,
    budgetRemaining,
    kickedBack,
    withheld,
  };
  const reportEvent = signEvent(identity, {
    kind: TICK_REPORT_EVENT_KIND,
    content: JSON.stringify(report),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  });
  await ports.relay.publish({ relaySet: spec.relaySet, event: reportEvent });

  return {
    pubkey: identity.pubkey,
    npub: identity.npub,
    published,
    kickedBack,
    withheld,
    feesPaid: feesPaidThisTick,
    budgetRemaining,
  };
}
