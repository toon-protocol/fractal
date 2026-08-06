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

export interface RelayPort {
  publish(request: PublishRequest): Promise<PublishResult>;
  readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]>;
  /**
   * Previews the fee a `publish` of this exact request would charge, so a
   * caller can check a budget cap before spending (CONTEXT.md — Dimension
   * identity, "budget cap is the channel balance"). Must agree with the fee
   * `publish` actually reports for the same request.
   */
  quoteFee(request: PublishRequest): Promise<number>;
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
