import { describe, expect, it } from 'vitest';
import { RelayPool } from './relay-pool.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import type { RelayPort, RelaySignedEvent } from './ports/relay.js';

function signedEvent(
  overrides: Partial<RelaySignedEvent> = {}
): RelaySignedEvent {
  return {
    id: 'event-1',
    pubkey: 'pubkey-1',
    kind: 1,
    content: 'hello below',
    tags: [['source', 'hn']],
    createdAt: 1_700_000_000,
    sig: 'sig-1',
    ...overrides,
  };
}

describe('RelayPool', () => {
  it('propagates a published event to every relay in the set', async () => {
    const relayA = new InMemoryRelay();
    const relayB = new InMemoryRelay();
    const relayC = new InMemoryRelay();
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://b', relayB],
        ['wss://c', relayC],
      ])
    );
    const event = signedEvent();

    const result = await pool.publish({
      relaySet: ['wss://a', 'wss://b', 'wss://c'],
      event,
    });

    expect(result).toEqual({
      relaySet: ['wss://a', 'wss://b', 'wss://c'],
      eventId: 'event-1',
      fee: 3,
    });
    expect(relayA.eventsPublishedTo('wss://a')).toEqual([event]);
    expect(relayB.eventsPublishedTo('wss://b')).toEqual([event]);
    expect(relayC.eventsPublishedTo('wss://c')).toEqual([event]);
  });

  it('quotes and charges the sum of every named relay fee', async () => {
    const relayA = new InMemoryRelay({ feePerEvent: 2 });
    const relayB = new InMemoryRelay({ feePerEvent: 5 });
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://b', relayB],
      ])
    );
    const event = signedEvent();
    const request = { relaySet: ['wss://a', 'wss://b'], event };

    const quoted = await pool.quoteFee(request);
    const result = await pool.publish(request);

    expect(quoted).toBe(7);
    expect(result.fee).toBe(7);
  });

  it('does not reach a relay left out of the relay set', async () => {
    const relayA = new InMemoryRelay();
    const relayB = new InMemoryRelay();
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://b', relayB],
      ])
    );

    await pool.publish({ relaySet: ['wss://a'], event: signedEvent() });

    expect(relayA.eventsPublishedTo('wss://a')).toHaveLength(1);
    expect(await relayB.readBack({})).toEqual([]);
  });

  it('throws when the relay set references a relay the pool has no connection for', async () => {
    const pool = new RelayPool(new Map());

    await expect(
      pool.publish({ relaySet: ['wss://unknown'], event: signedEvent() })
    ).rejects.toThrow(/no connection.*wss:\/\/unknown/i);
  });

  it('merges read-back across the relay set, tolerating a relay missing an event', async () => {
    const relayA = new InMemoryRelay();
    const relayB = new InMemoryRelay();
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://b', relayB],
      ])
    );
    const eventOne = signedEvent({ id: 'one' });
    const eventTwo = signedEvent({ id: 'two' });

    // Reaches both relays.
    await pool.publish({ relaySet: ['wss://a', 'wss://b'], event: eventOne });
    // Reaches only relay A — relay B "misses" it (down, dropped, whatever).
    await pool.publish({ relaySet: ['wss://a'], event: eventTwo });

    const merged = await pool.readBack({});

    expect(merged.map((event) => event.id).sort()).toEqual(['one', 'two']);
  });

  it('deduplicates an event present on more than one relay', async () => {
    const relayA = new InMemoryRelay();
    const relayB = new InMemoryRelay();
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://b', relayB],
      ])
    );
    const event = signedEvent();

    await pool.publish({ relaySet: ['wss://a', 'wss://b'], event });

    const results = await pool.readBack({});

    expect(results).toEqual([event]);
  });

  it('tolerates a relay whose read-back fails', async () => {
    const relayA = new InMemoryRelay();
    const downRelay: RelayPort = {
      publish: (request) =>
        Promise.resolve({
          relaySet: request.relaySet,
          eventId: request.event.id,
          fee: 1,
        }),
      readBack: () => Promise.reject(new Error('relay unreachable')),
      quoteFee: () => Promise.resolve(1),
    };
    const pool = new RelayPool(
      new Map([
        ['wss://a', relayA],
        ['wss://down', downRelay],
      ])
    );
    const event = signedEvent();

    await pool.publish({ relaySet: ['wss://a', 'wss://down'], event });

    const results = await pool.readBack({});

    expect(results).toEqual([event]);
  });

  it('a single custom relay works identically — no special-casing on set size', async () => {
    const relay = new InMemoryRelay();
    const pool = new RelayPool(new Map([['wss://private.example', relay]]));
    const event = signedEvent();

    await pool.publish({ relaySet: ['wss://private.example'], event });

    expect(await pool.readBack({})).toEqual([event]);
  });
});
