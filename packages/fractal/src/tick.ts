import { deriveDimensionIdentity, signEvent } from './identity.js';
import { evaluateCandidate } from './domain/gate.js';
import { TICK_REPORT_EVENT_KIND } from './domain/event.js';
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
import { ChannelBudgetExceededError } from './ports/relay.js';
import type {
  PublishResult,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';

export { TICK_REPORT_EVENT_KIND };

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
  /**
   * False when the channel refused to pay for the tick's own economics
   * report. The tick's work still stands, and the spend total is not lost —
   * it lives on the channel's claim, which the next tick reads back.
   */
  readonly reportPublished: boolean;
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
  // The channel's live claim is the authority on what has been spent: it
  // counts every write the channel funds — plant's three identity events and
  // each tick report included — which a report-carried tally of ditto fees
  // alone never sees. Without it, `spent` lags the channel, `budgetRemaining`
  // over-reports, and the loop runs on until the channel's own hard cap
  // refuses a write. A port with no channel underneath it (the in-memory
  // fake) has no claim to read, so the previous report's running total
  // remains the fallback.
  const claimSpend = ports.relay.channelSpend
    ? await ports.relay.channelSpend()
    : undefined;
  let spent = claimSpend ?? (previousReport ? previousReport.spent : 0);
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

      // quoteFee is a preview, not a guarantee — the client's real claim
      // movement can differ from it (a connector charging more than
      // requested). Use it only to skip an attempt already known to be
      // hopeless; budget accounting below reconciles against the fee
      // `publish` actually reports for this request.
      const quotedFee = await ports.relay.quoteFee({
        relaySet: spec.relaySet,
        event,
      });
      if (spent + quotedFee > spec.budgetCap) {
        budgetExhausted = true;
        withheld.push({
          sourceId: source.id,
          resourceUrl: candidate.provenance.resourceUrl,
        });
        continue;
      }

      let result: PublishResult;
      try {
        result = await ports.relay.publish({ relaySet: spec.relaySet, event });
      } catch (error) {
        if (error instanceof ChannelBudgetExceededError) {
          // The channel-balance backstop refused a write the quote-based
          // check above already let through — enforced by construction,
          // so this candidate is withheld rather than aborting the tick.
          budgetExhausted = true;
          withheld.push({
            sourceId: source.id,
            resourceUrl: candidate.provenance.resourceUrl,
          });
          continue;
        }
        throw error;
      }

      spent += result.fee;
      feesPaidThisTick += result.fee;
      published.push(event);
      if (spent >= spec.budgetCap) {
        budgetExhausted = true;
      }
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
  // The report is a paid write like any other, so an exhausted channel can
  // refuse it too. Refusing to log is not a reason to fail the tick that
  // already did its work: the report degrades to "not written" and the tick
  // still returns. This is only safe because the spend total no longer rides
  // on the report — a port with a real channel reports its claim above, so
  // the next tick reads the true spend straight off the channel and picks up
  // exactly where this one stopped.
  let reportPublished = true;
  try {
    await ports.relay.publish({ relaySet: spec.relaySet, event: reportEvent });
  } catch (error) {
    if (!(error instanceof ChannelBudgetExceededError)) {
      throw error;
    }
    reportPublished = false;
  }

  return {
    pubkey: identity.pubkey,
    npub: identity.npub,
    published,
    kickedBack,
    withheld,
    feesPaid: feesPaidThisTick,
    budgetRemaining,
    reportPublished,
  };
}
