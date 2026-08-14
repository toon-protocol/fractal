import { SimplePool } from 'nostr-tools/pool';
import { DEFAULT_RELAY_SET } from '@toon-protocol/fractal/domain';
import type { RelaySignedEvent } from '@toon-protocol/fractal/ports';

/**
 * The portal's only network-touching module — real IO glue kept out of the
 * pure feed-model/render seam, same split fractal's own `bin/*.ts` files use
 * between orchestration and real client wiring. Never unit-tested; no
 * network runs in CI (issue #13's AC).
 */
export interface DimensionReader {
  readEvents(
    pubkey: string,
    relaySet?: readonly string[]
  ): Promise<readonly RelaySignedEvent[]>;
}

function toRelaySignedEvent(event: {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  sig: string;
}): RelaySignedEvent {
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

/**
 * Reads a dimension's events back over free NIP-01 nostr reads (CONTEXT.md —
 * Agent internet, "Browsing it is free (reads)"). A dimension's own relay set
 * lives inside its spec, which itself must first be read from somewhere — so
 * the caller passes the relay set to bootstrap from (`main.ts` resolves it
 * from the page URL via `relay-config.ts`), defaulting to the shared relay
 * set every dimension falls back to when its spec compiles none of its own
 * (a two-phase read — spec first, then the spec's own relay set — is a later
 * portal iteration's concern).
 */
export class NostrPoolReader implements DimensionReader {
  private readonly pool = new SimplePool();

  async readEvents(
    pubkey: string,
    relaySet: readonly string[] = DEFAULT_RELAY_SET
  ): Promise<readonly RelaySignedEvent[]> {
    const events = await this.pool.querySync([...relaySet], {
      authors: [pubkey],
    });
    return events.map(toRelaySignedEvent);
  }
}
