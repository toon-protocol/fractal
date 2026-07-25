import { describe, expect, it, vi } from 'vitest';
import {
  ToonRelay,
  ChannelBudgetExceededError,
  type ToonPublishClient,
  type NostrReadClient,
} from './toon-relay.js';
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

/** A mocked publish client: never opens a socket, tracks channel state purely in memory. */
function mockPublishClient(options: {
  depositTotal?: bigint;
  cumulativeAmount?: bigint;
  cumulativeAdvanceOnPublish?: bigint;
  channelId?: string;
  publishSucceeds?: boolean;
  publishError?: string;
}): ToonPublishClient {
  const cumulativeAmountRef = { value: options.cumulativeAmount ?? 0n };
  const depositTotalRef = { value: options.depositTotal ?? 100n };
  const channelId = options.channelId ?? 'channel-1';
  const advance = options.cumulativeAdvanceOnPublish;

  return {
    openChannel: vi.fn(async () => channelId),
    publishEvent: vi.fn(async () => {
      if (advance !== undefined) {
        cumulativeAmountRef.value += advance;
      }
      if (options.publishSucceeds === false) {
        return { success: false, error: options.publishError };
      }
      return { success: true, eventId: 'real-event-id' };
    }),
    getChannelCumulativeAmount: vi.fn(() => cumulativeAmountRef.value),
    getChannelDepositTotal: vi.fn(() => depositTotalRef.value),
    depositToChannel: vi.fn(async (_channelId: string, amount) => {
      const delta = typeof amount === 'string' ? BigInt(amount) : amount;
      depositTotalRef.value += delta;
      return { channelId, depositTotal: depositTotalRef.value.toString() };
    }),
  };
}

function mockReadClient(events: unknown[] = []): NostrReadClient {
  return {
    querySync: vi.fn(async () => events as never),
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
    const [publishedEvent, publishOptions] = (
      publishClient.publishEvent as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [unknown, { destination?: string; ilpAmount?: bigint }];
    expect(publishedEvent).toMatchObject({
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      content: event.content,
      created_at: event.createdAt,
      sig: event.sig,
    });
    expect(publishOptions).toEqual({
      destination: 'g.toon.genesis',
      ilpAmount: 5n,
    });

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
      publishSucceeds: false,
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
});
