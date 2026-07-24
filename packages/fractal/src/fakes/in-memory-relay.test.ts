import { describe, expect, it } from 'vitest';
import { InMemoryRelay } from './in-memory-relay.js';
import type { RelaySignedEvent } from '../ports/relay.js';

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

describe('InMemoryRelay', () => {
  it('appends a published event and reports it as delivered to every relay in the set', async () => {
    const relay = new InMemoryRelay();
    const event = signedEvent();

    const result = await relay.publish({
      relaySet: ['wss://a', 'wss://b'],
      event,
    });

    expect(result).toEqual({
      relaySet: ['wss://a', 'wss://b'],
      eventId: 'event-1',
      fee: 1,
    });
    expect(relay.eventsPublishedTo('wss://a')).toEqual([event]);
    expect(relay.eventsPublishedTo('wss://b')).toEqual([event]);
    expect(relay.eventsPublishedTo('wss://c')).toEqual([]);
  });

  it('charges a flat fee per publish, quoted identically before and after', async () => {
    const relay = new InMemoryRelay({ feePerEvent: 7 });
    const event = signedEvent();
    const request = { relaySet: ['wss://a'], event };

    const quoted = await relay.quoteFee(request);
    const result = await relay.publish(request);

    expect(quoted).toBe(7);
    expect(result.fee).toBe(7);
  });

  it('reads back published events filtered by author, kind, and tag', async () => {
    const relay = new InMemoryRelay();
    const matching = signedEvent({
      id: 'match',
      pubkey: 'dim-1',
      kind: 1,
      tags: [['source', 'hn']],
    });
    const wrongAuthor = signedEvent({
      id: 'wrong-author',
      pubkey: 'dim-2',
      tags: [['source', 'hn']],
    });
    const wrongKind = signedEvent({
      id: 'wrong-kind',
      pubkey: 'dim-1',
      kind: 0,
      tags: [['source', 'hn']],
    });
    const wrongTag = signedEvent({
      id: 'wrong-tag',
      pubkey: 'dim-1',
      kind: 1,
      tags: [['source', 'reddit']],
    });

    await relay.publish({ relaySet: ['wss://a'], event: matching });
    await relay.publish({ relaySet: ['wss://a'], event: wrongAuthor });
    await relay.publish({ relaySet: ['wss://a'], event: wrongKind });
    await relay.publish({ relaySet: ['wss://a'], event: wrongTag });

    const results = await relay.readBack({
      authors: ['dim-1'],
      kinds: [1],
      tags: { source: ['hn'] },
    });

    expect(results).toEqual([matching]);
  });

  it('limits read-back results', async () => {
    const relay = new InMemoryRelay();
    const one = signedEvent({ id: 'one' });
    const two = signedEvent({ id: 'two' });
    await relay.publish({ relaySet: ['wss://a'], event: one });
    await relay.publish({ relaySet: ['wss://a'], event: two });

    const results = await relay.readBack({ limit: 1 });

    expect(results).toEqual([one]);
  });

  it('starts with no events published to any relay', async () => {
    const relay = new InMemoryRelay();

    expect(await relay.readBack({})).toEqual([]);
    expect(relay.eventsPublishedTo('wss://a')).toEqual([]);
  });
});
