import type {
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  RelayPort,
  RelaySignedEvent,
} from './ports/relay.js';

/**
 * Composes per-relay connections (each a `RelayPort`, real or faked) into a
 * single `RelayPort` scoped to a dimension's relay set: publish fans an event
 * out to every relay named in the request, and read-back merges across every
 * connected relay, deduplicating by event id and tolerating any one relay
 * being down or missing an event — the relay set is the state of record, not
 * any single relay in it (CONTEXT.md — Relay set, Ditto loop).
 */
export class RelayPool implements RelayPort {
  constructor(private readonly relays: ReadonlyMap<string, RelayPort>) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    await Promise.all(
      request.relaySet.map((url) => {
        const relay = this.relays.get(url);
        if (!relay) {
          throw new Error(
            `fractal: relay pool has no connection for ${url} — every relay in the spec's relay set must be wired`
          );
        }
        return relay.publish({ relaySet: [url], event: request.event });
      })
    );
    return { relaySet: request.relaySet, eventId: request.event.id };
  }

  async readBack(query: ReadBackQuery): Promise<readonly RelaySignedEvent[]> {
    const settled = await Promise.allSettled(
      [...this.relays.values()].map((relay) => relay.readBack(query))
    );

    const merged = new Map<string, RelaySignedEvent>();
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        for (const event of result.value) {
          merged.set(event.id, event);
        }
      }
    }

    const events = [...merged.values()].sort(
      (a, b) => a.createdAt - b.createdAt
    );
    return query.limit === undefined ? events : events.slice(0, query.limit);
  }
}
