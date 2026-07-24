import { deriveDimensionIdentity, signEvent } from './identity.js';
import { evaluateCandidate } from './domain/gate.js';
import { AdapterRegistry } from './adapters/registry.js';
import { feedAdapter } from './adapters/feed.js';
import {
  SOURCE_TAG,
  RESOURCE_TAG,
  readPlantedSpec,
  readLatestParsedEvent,
  dittoedResourceUrls,
} from './relay-reads.js';
import type { BelowPort } from './ports/below.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

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
  const spec = await readPlantedSpec(ports.relay, identity, request.index);

  const previousReport = await readLatestParsedEvent<TickReport>(
    ports.relay,
    identity.pubkey,
    TICK_REPORT_EVENT_KIND
  );
  let spent = previousReport ? previousReport.spent : 0;
  let budgetExhausted = spent >= spec.budgetCap;
  let feesPaidThisTick = 0;

  const published: RelaySignedEvent[] = [];
  const kickedBack: TickKickBack[] = [];
  const withheld: TickWithheld[] = [];

  for (const source of spec.sources) {
    const adapter = ADAPTERS.resolve(source.kind);
    const response = await adapter.fetch(source, ports.below);
    const candidates = adapter.project(response, source);

    const alreadyDittoed = await dittoedResourceUrls(
      ports.relay,
      identity.pubkey,
      source.id
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
