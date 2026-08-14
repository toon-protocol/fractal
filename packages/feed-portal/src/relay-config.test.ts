import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAY_SET } from '@toon-protocol/fractal/domain';
import { resolveRelaySetFromSearch } from './relay-config.js';

describe('resolveRelaySetFromSearch', () => {
  it('falls back to the shared default relay set when no ?relays= is given', () => {
    expect(resolveRelaySetFromSearch('?npub=npub1abc')).toEqual(
      DEFAULT_RELAY_SET
    );
  });

  it('overrides the default with a single ?relays= URL — a devnet dimension is reachable', () => {
    expect(
      resolveRelaySetFromSearch(
        '?npub=npub1abc&relays=wss%3A%2F%2Frelay-ws.devnet.toonprotocol.dev'
      )
    ).toEqual(['wss://relay-ws.devnet.toonprotocol.dev']);
  });

  it('splits a comma-separated ?relays= list and trims whitespace', () => {
    expect(
      resolveRelaySetFromSearch(
        '?relays=wss://a.example, wss://b.example ,wss://c.example'
      )
    ).toEqual(['wss://a.example', 'wss://b.example', 'wss://c.example']);
  });

  it('falls back to the default when ?relays= is empty or only separators', () => {
    expect(resolveRelaySetFromSearch('?relays=')).toEqual(DEFAULT_RELAY_SET);
    expect(resolveRelaySetFromSearch('?relays=,%20,')).toEqual(
      DEFAULT_RELAY_SET
    );
  });
});
