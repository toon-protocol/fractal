import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from '../ports/relay.js';

export interface InMemoryRelayOptions {
  /** Flat fee charged per publish, standing in for a real relay's fee schedule. Defaults to 1. */
  readonly feePerEvent?: number;
}

/**
 * Relay fake: publish appends signed events, read-back queries by
 * author/kind/tag. Doubles as the seam for cursor derivation, resume, and
 * per-relay accounting, since the relay is the state of record
 * (CONTEXT.md — Relay set, Ditto loop).
 */
export class InMemoryRelay implements RelayPort {
  private readonly events: RelaySignedEvent[] = [];
  private readonly perRelay = new Map<string, RelaySignedEvent[]>();
  private readonly feePerEvent: number;

  constructor(options: InMemoryRelayOptions = {}) {
    this.feePerEvent = options.feePerEvent ?? 1;
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    this.events.push(request.event);
    for (const relay of request.relaySet) {
      const delivered = this.perRelay.get(relay);
      if (delivered) {
        delivered.push(request.event);
      } else {
        this.perRelay.set(relay, [request.event]);
      }
    }
    return {
      relaySet: request.relaySet,
      eventId: request.event.id,
      fee: this.feePerEvent,
    };
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    const matches = this.events.filter((event) => matchesQuery(event, query));
    return query.limit === undefined ? matches : matches.slice(0, query.limit);
  }

  async quoteFee(_request: PublishRequest): Promise<number> {
    return this.feePerEvent;
  }

  eventsPublishedTo(relay: string): readonly RelaySignedEvent[] {
    return this.perRelay.get(relay) ?? [];
  }
}

function matchesQuery(event: RelaySignedEvent, query: ReadBackQuery): boolean {
  if (query.authors && !query.authors.includes(event.pubkey)) {
    return false;
  }
  if (query.kinds && !query.kinds.includes(event.kind)) {
    return false;
  }
  if (query.tags) {
    for (const [name, allowed] of Object.entries(query.tags)) {
      const hasMatch = event.tags.some(
        (tag) => tag[0] === name && allowed.includes(tag[1] ?? '')
      );
      if (!hasMatch) {
        return false;
      }
    }
  }
  return true;
}
