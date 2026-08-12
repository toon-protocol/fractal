import { describe, expect, it, vi } from 'vitest';
import {
  ToonRelay,
  ChannelBudgetExceededError,
  type ToonPublishClient,
  type NostrReadClient,
} from './toon-relay.js';
import type { NostrEvent } from 'nostr-tools/pure';
import type { RelaySignedEvent } from './ports/relay.js';

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

const CHANNEL_ID = 'channel-1';

/** A mocked publish client: never opens a socket, tracks channel state purely in memory. */
function mockPublishClient(options: {
  depositTotal?: bigint;
  cumulativeAmount?: bigint;
  cumulativeAdvanceOnPublish?: bigint;
  /** When set, `publishEvent` reports failure carrying this message. */
  publishError?: string;
}): ToonPublishClient {
  let cumulativeAmount = options.cumulativeAmount ?? 0n;
  let depositTotal = options.depositTotal ?? 100n;

  return {
    openChannel: vi.fn(async () => CHANNEL_ID),
    publishEvent: vi.fn(async () => {
      cumulativeAmount += options.cumulativeAdvanceOnPublish ?? 0n;
      if (options.publishError !== undefined) {
        return { success: false, error: options.publishError };
      }
      return { success: true, eventId: 'real-event-id' };
    }),
    getChannelCumulativeAmount: vi.fn(() => cumulativeAmount),
    getChannelDepositTotal: vi.fn(() => depositTotal),
    depositToChannel: vi.fn(async (_channelId: string, amount) => {
      depositTotal += typeof amount === 'string' ? BigInt(amount) : amount;
      return { channelId: CHANNEL_ID, depositTotal: depositTotal.toString() };
    }),
  };
}

function mockReadClient(events: NostrEvent[] = []): NostrReadClient {
  return {
    querySync: vi.fn(async () => events),
  };
}

describe('ToonRelay', () => {
  it('quotes a fixed configured price per event', async () => {
    const relay = new ToonRelay({
      publishClient: mockPublishClient({}),
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
      pricePerEvent: 5n,
    });

    const quoted = await relay.quoteFee({
      relaySet: ['wss://relay.example'],
      event: signedEvent(),
    });

    expect(quoted).toBe(5);
  });

  it('publishes through the client and derives the fee from the real claim delta, not the configured price', async () => {
    const publishClient = mockPublishClient({
      depositTotal: 100n,
      cumulativeAmount: 0n,
      cumulativeAdvanceOnPublish: 7n,
    });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
      destination: 'g.toon.genesis',
      pricePerEvent: 5n,
    });
    const event = signedEvent();

    const result = await relay.publish({
      relaySet: ['wss://relay.example'],
      event,
    });

    expect(publishClient.publishEvent).toHaveBeenCalledTimes(1);
    expect(publishClient.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: event.id,
        pubkey: event.pubkey,
        kind: event.kind,
        content: event.content,
        created_at: event.createdAt,
        sig: event.sig,
      }),
      { destination: 'g.toon.genesis', ilpAmount: 5n }
    );

    // The real claim advanced the channel by 7, not the configured price of 5.
    expect(result.fee).toBe(7);
    expect(result.eventId).toBe('real-event-id');
    expect(result.relaySet).toEqual(['wss://relay.example']);
  });

  it('opens the channel lazily and only once across repeated calls', async () => {
    const publishClient = mockPublishClient({});
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
    });

    await relay.publish({
      relaySet: ['wss://relay.example'],
      event: signedEvent(),
    });
    await relay.publish({
      relaySet: ['wss://relay.example'],
      event: signedEvent({ id: 'event-2' }),
    });

    expect(publishClient.openChannel).toHaveBeenCalledTimes(1);
  });

  it('refuses a publish that would exceed the channel balance without ever attempting the paid write', async () => {
    const publishClient = mockPublishClient({
      depositTotal: 100n,
      cumulativeAmount: 95n,
    });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
      pricePerEvent: 10n,
    });

    await expect(
      relay.publish({
        relaySet: ['wss://relay.example'],
        event: signedEvent(),
      })
    ).rejects.toThrow(ChannelBudgetExceededError);

    expect(publishClient.publishEvent).not.toHaveBeenCalled();
  });

  it('allows a publish that exactly exhausts the remaining channel balance', async () => {
    const publishClient = mockPublishClient({
      depositTotal: 100n,
      cumulativeAmount: 90n,
      cumulativeAdvanceOnPublish: 10n,
    });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
      pricePerEvent: 10n,
    });

    const result = await relay.publish({
      relaySet: ['wss://relay.example'],
      event: signedEvent(),
    });

    expect(result.fee).toBe(10);
    expect(publishClient.publishEvent).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed publish as a thrown error carrying the client error message', async () => {
    const publishClient = mockPublishClient({
      publishError: 'connector rejected the claim',
    });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
    });

    await expect(
      relay.publish({
        relaySet: ['wss://relay.example'],
        event: signedEvent(),
      })
    ).rejects.toThrow(/connector rejected the claim/);
  });

  it('reads back through the free nostr read client, mapping NIP-01 events to RelaySignedEvent', async () => {
    const nostrEvent = {
      id: 'event-1',
      pubkey: 'pubkey-1',
      kind: 1,
      content: 'hello below',
      tags: [['source', 'hn']],
      created_at: 1_700_000_000,
      sig: 'sig-1',
    };
    const readClient = mockReadClient([nostrEvent]);
    const relay = new ToonRelay({
      publishClient: mockPublishClient({}),
      readClient,
      relayUrls: ['wss://relay.example', 'wss://relay.two'],
    });

    const results = await relay.readBack({
      authors: ['pubkey-1'],
      kinds: [1],
      tags: { source: ['hn'] },
      limit: 5,
    });

    expect(readClient.querySync).toHaveBeenCalledWith(
      ['wss://relay.example', 'wss://relay.two'],
      {
        authors: ['pubkey-1'],
        kinds: [1],
        limit: 5,
        '#source': ['hn'],
      }
    );
    expect(results).toEqual([
      {
        id: 'event-1',
        pubkey: 'pubkey-1',
        kind: 1,
        content: 'hello below',
        tags: [['source', 'hn']],
        createdAt: 1_700_000_000,
        sig: 'sig-1',
      },
    ]);
  });

  it('funds the channel up to the desired cap and returns the resulting deposit total', async () => {
    const publishClient = mockPublishClient({ depositTotal: 10n });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
    });

    const funded = await relay.fundChannel(50);

    expect(publishClient.depositToChannel).toHaveBeenCalledWith(
      'channel-1',
      40n
    );
    expect(funded).toBe(50);
  });

  it('does not deposit when the channel is already funded past the desired cap', async () => {
    const publishClient = mockPublishClient({ depositTotal: 100n });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
    });

    const funded = await relay.fundChannel(50);

    expect(publishClient.depositToChannel).not.toHaveBeenCalled();
    expect(funded).toBe(100);
  });

  it('reports channel spend from the live claim, counting every write the channel funded', async () => {
    const publishClient = mockPublishClient({
      depositTotal: 100n,
      cumulativeAmount: 3n,
      cumulativeAdvanceOnPublish: 7n,
    });
    const relay = new ToonRelay({
      publishClient,
      readClient: mockReadClient(),
      relayUrls: ['wss://relay.example'],
      pricePerEvent: 5n,
    });

    // Writes that happened before this port instance existed (plant's three
    // identity events, an earlier tick's report) are already on the claim.
    expect(await relay.channelSpend()).toBe(3);

    await relay.publish({
      relaySet: ['wss://relay.example'],
      event: signedEvent(),
    });

    // …and the claim, not the configured price, is what it grows by.
    expect(await relay.channelSpend()).toBe(10);
  });
});
