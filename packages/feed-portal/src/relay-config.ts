import { DEFAULT_RELAY_SET } from '@toon-protocol/fractal/domain';

/**
 * Resolves the relay set the portal queries from the page URL: a
 * `?relays=` query param (comma-separated, the same convention
 * `FRACTAL_DEVNET_RELAY_SET` uses in `bin/devnet-relay-proof.ts`)
 * overrides; {@link DEFAULT_RELAY_SET} is only the fallback when none is
 * given. This is what makes a devnet dimension — planted against
 * `wss://relay-ws.devnet.toonprotocol.dev`, not the default set —
 * reachable from a deployed portal without a rebuild (fractal#13, AC 1).
 */
export function resolveRelaySetFromSearch(search: string): readonly string[] {
  const raw = new URLSearchParams(search).get('relays');
  if (!raw) {
    return DEFAULT_RELAY_SET;
  }
  const relays = raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return relays.length > 0 ? relays : DEFAULT_RELAY_SET;
}
