import { decode } from 'nostr-tools/nip19';
import { buildDimensionView } from './feed-model.js';
import { renderDimensionView } from './render.js';
import { NostrPoolReader } from './dimension-reader.js';
import { resolveRelaySetFromSearch } from './relay-config.js';

function readNpubFromLocation(): string | undefined {
  return new URLSearchParams(window.location.search).get('npub') ?? undefined;
}

function decodeNpub(npub: string): string | undefined {
  try {
    const decoded = decode(npub);
    return decoded.type === 'npub' ? decoded.data : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) {
    return;
  }

  const npub = readNpubFromLocation();
  if (!npub) {
    root.textContent = 'Append ?npub=<dimension npub> to view a dimension.';
    return;
  }

  const pubkey = decodeNpub(npub);
  if (!pubkey) {
    root.textContent = `Not a valid npub: ${npub}`;
    return;
  }

  const relaySet = resolveRelaySetFromSearch(window.location.search);
  const events = await new NostrPoolReader().readEvents(pubkey, relaySet);
  if (events.length === 0) {
    root.textContent = `No dimension found for ${npub} on ${relaySet.join(', ')} — pass ?relays=<url,…> to query a different relay set.`;
    return;
  }

  renderDimensionView(root, buildDimensionView(pubkey, events));
}

void main();
