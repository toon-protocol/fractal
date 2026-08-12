/**
 * The paid-publish and read-back port, combined as one interface because the
 * relay is the dimension's state of record: cursors and resume derive from
 * reading it back, never from local-only state (CONTEXT.md — Relay set,
 * Ditto loop).
 */
export interface RelaySignedEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly kind: number;
  readonly content: string;
  readonly tags: readonly (readonly string[])[];
  readonly createdAt: number;
  readonly sig: string;
}

export interface PublishRequest {
  readonly relaySet: readonly string[];
  readonly event: RelaySignedEvent;
}

export interface PublishResult {
  readonly relaySet: readonly string[];
  readonly eventId: string;
  readonly fee: number;
}

export interface ReadBackQuery {
  readonly authors?: readonly string[];
  readonly kinds?: readonly number[];
  readonly tags?: Readonly<Record<string, readonly string[]>>;
  readonly limit?: number;
}

/**
 * Thrown by `publish` when the write would spend past the funded channel's
 * balance. An implementation backed by a real channel raises this *before*
 * attempting the paid write, so an over-balance write is unrepresentable
 * rather than merely rejected after the fact (CONTEXT.md — Dimension
 * identity, "budget cap is the channel balance, enforced by construction").
 * Part of the port contract, not of any one implementation: `tick` withholds
 * the refused candidate instead of aborting, whichever relay refused it.
 */
export class ChannelBudgetExceededError extends Error {
  constructor(
    readonly channelId: string,
    readonly attempted: bigint,
    readonly available: bigint
  ) {
    super(
      `fractal: publish would spend ${attempted} on channel ${channelId}, exceeding its ${available} available balance — refused before any paid write was attempted`
    );
    this.name = 'ChannelBudgetExceededError';
  }
}

export interface RelayPort {
  /** Throws `ChannelBudgetExceededError` when the channel cannot fund this write. */
  publish(request: PublishRequest): Promise<PublishResult>;
  readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]>;
  /**
   * Previews the fee a `publish` of this exact request would charge, so a
   * caller can check a budget cap before attempting the paid write
   * (CONTEXT.md — Dimension identity, "budget cap is the channel balance").
   * This is an estimate, not a guarantee: a real client's claim movement can
   * differ from the quote (e.g. a connector charging more than requested).
   * Callers doing running budget accounting must reconcile against the fee
   * `publish` actually reports for the same request, not this quote.
   */
  quoteFee(request: PublishRequest): Promise<number>;
  /**
   * The total this dimension's own channel has actually paid out so far — the
   * live claim, not a fractal-side tally. It covers **every** write the
   * channel funds: `plant`'s three identity events, every ditto, and every
   * tick report. Budget accounting prefers it over any locally reconstructed
   * running total, so "budget cap is the channel balance" is measured against
   * the same number the channel enforces (CONTEXT.md — Dimension identity).
   *
   * Optional: a relay with no channel underneath it (the in-memory fake, a
   * plain relay-set fan-out) has no claim to read, so `tick` falls back to
   * the running total carried in the previous tick report.
   */
  channelSpend?(): Promise<number>;
  /**
   * Funds (or tops up) the dimension's own payment channel to at least
   * `desiredCap` and returns the channel's actual resulting balance — the
   * authoritative budget cap, since "budget cap is the channel balance,
   * enforced by construction" (CONTEXT.md — Dimension identity). Optional:
   * a relay with no real channel underneath it (the in-memory fake, a plain
   * relay-set fan-out) has no funding step, so `plant` falls back to
   * whatever budget cap the brain compiled.
   */
  fundChannel?(desiredCap: number): Promise<number>;
}
