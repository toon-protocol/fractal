import type { NostrEvent } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools/filter';
import type { SimplePool } from 'nostr-tools/pool';
import type { ToonClient } from '@toon-protocol/client';
import { ChannelBudgetExceededError } from './ports/relay.js';
import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';

/**
 * The subset of the published `@toon-protocol/client` stack that paid
 * publish + channel funding need. A real `ToonClient` instance satisfies
 * this by construction; tests substitute a mock over the identical method
 * shapes — the claim/channel plumbing itself stays inside the client, so
 * fractal introduces no new payment code (CONTEXT.md — Dimension identity).
 */
export type ToonPublishClient = Pick<
  ToonClient,
  | 'openChannel'
  | 'publishEvent'
  | 'getChannelCumulativeAmount'
  | 'getChannelDepositTotal'
  | 'depositToChannel'
>;

/**
 * The subset of nostr-tools' `SimplePool` that NIP-01 read-back needs. Reads
 * are free (CONTEXT.md — Agent internet: "reads are free; engagement is
 * paid"), so read-back rides plain nostr, never the ILP-gated client.
 */
export type NostrReadClient = Pick<SimplePool, 'querySync'>;

export interface ToonRelayOptions {
  /** Paid-write client — a `ToonClient` or a test mock of the same shape. */
  readonly publishClient: ToonPublishClient;
  /** Free-read client — a `SimplePool` or a test mock of the same shape. */
  readonly readClient: NostrReadClient;
  /** Nostr relay URLs read-back queries against (`ReadBackQuery` carries no relay set of its own). */
  readonly relayUrls: readonly string[];
  /** ILP destination the dimension's own payment channel opens against. */
  readonly destination?: string;
  /** Flat ILP amount (base units) charged per published event. Defaults to 1n. */
  readonly pricePerEvent?: bigint;
}

function toNostrEvent(event: RelaySignedEvent): NostrEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags.map((tag) => [...tag]),
    created_at: event.createdAt,
    sig: event.sig,
  };
}

function fromNostrEvent(event: NostrEvent): RelaySignedEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    createdAt: event.created_at,
    sig: event.sig,
  };
}

function toFilter(query: ReadBackQuery): Filter {
  const filter: Filter = {};
  if (query.authors) {
    filter.authors = [...query.authors];
  }
  if (query.kinds) {
    filter.kinds = [...query.kinds];
  }
  if (query.limit !== undefined) {
    filter.limit = query.limit;
  }
  if (query.tags) {
    for (const [name, values] of Object.entries(query.tags)) {
      filter[`#${name}`] = [...values];
    }
  }
  return filter;
}

/**
 * The real Relay port, implemented against the published TOON client stack.
 * Paid publish rides `ToonClient.publishEvent` — the ILP claim/channel
 * plumbing lives entirely in the client; NIP-01 read-back rides a plain
 * nostr read client, since reads never touch the payment channel. The
 * dimension's own channel backstops its budget cap by construction: `tick`
 * asks `quoteFee` before publishing, but this port additionally refuses any
 * `publish` whose fee would exceed the channel's real, live balance,
 * independent of whatever the caller already checked (CONTEXT.md — Ditto
 * loop, Dimension identity).
 */
export class ToonRelay implements RelayPort {
  private readonly publishClient: ToonPublishClient;
  private readonly readClient: NostrReadClient;
  private readonly relayUrls: readonly string[];
  private readonly destination: string | undefined;
  private readonly pricePerEvent: bigint;
  private channelId: string | undefined;

  constructor(options: ToonRelayOptions) {
    this.publishClient = options.publishClient;
    this.readClient = options.readClient;
    this.relayUrls = options.relayUrls;
    this.destination = options.destination;
    this.pricePerEvent = options.pricePerEvent ?? 1n;
  }

  private async resolveChannel(): Promise<string> {
    if (!this.channelId) {
      this.channelId = await this.publishClient.openChannel(this.destination);
    }
    return this.channelId;
  }

  async quoteFee(_request: PublishRequest): Promise<number> {
    return Number(this.pricePerEvent);
  }

  /**
   * The channel's live cumulative claim — the real amount this dimension has
   * paid across every write the channel funded (identity events at plant,
   * dittos, tick reports alike). This, not a fractal-side tally, is what
   * budget accounting runs on, so `spent` can never drift below what the
   * channel has actually committed.
   */
  async channelSpend(): Promise<number> {
    const channelId = await this.resolveChannel();
    return Number(this.publishClient.getChannelCumulativeAmount(channelId));
  }

  /**
   * The paid write. The channel's live balance is checked first, so a write
   * the channel cannot fund is refused before `publishEvent` is ever called
   * — enforced by construction, independent of whatever the caller already
   * quoted. The reported fee is the claim's real movement, not the amount
   * asked for, so budget accounting reconciles against what was actually
   * paid (CONTEXT.md — Dimension identity).
   */
  async publish(request: PublishRequest): Promise<PublishResult> {
    const channelId = await this.resolveChannel();
    const before = this.publishClient.getChannelCumulativeAmount(channelId);
    const deposit = this.publishClient.getChannelDepositTotal(channelId);
    const ilpAmount = this.pricePerEvent;

    if (before + ilpAmount > deposit) {
      throw new ChannelBudgetExceededError(
        channelId,
        ilpAmount,
        deposit - before
      );
    }

    const result = await this.publishClient.publishEvent(
      toNostrEvent(request.event),
      { destination: this.destination, ilpAmount }
    );
    if (!result.success) {
      throw new Error(
        `fractal: publish failed — ${result.error ?? 'unknown error'}`
      );
    }

    const after = this.publishClient.getChannelCumulativeAmount(channelId);
    return {
      relaySet: request.relaySet,
      eventId: result.eventId ?? request.event.id,
      fee: Number(after - before),
    };
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    const events = await this.readClient.querySync(
      [...this.relayUrls],
      toFilter(query)
    );
    const mapped = events.map(fromNostrEvent);
    return query.limit === undefined ? mapped : mapped.slice(0, query.limit);
  }

  /**
   * Tops up the dimension's channel to at least `desiredCap` and returns its
   * actual resulting deposit — the real, on-chain-backed number `plant` uses
   * as the authoritative budget cap (CONTEXT.md — Dimension identity).
   */
  async fundChannel(desiredCap: number): Promise<number> {
    const channelId = await this.resolveChannel();
    const current = this.publishClient.getChannelDepositTotal(channelId);
    const desired = BigInt(Math.trunc(desiredCap));
    if (desired <= current) {
      return Number(current);
    }
    const { depositTotal } = await this.publishClient.depositToChannel(
      channelId,
      desired - current
    );
    return Number(depositTotal);
  }
}
