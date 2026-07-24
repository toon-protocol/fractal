import { accountFromSeedWords, validateWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';
import { finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/pure';
import type { RelaySignedEvent } from './ports/relay.js';

/**
 * A dimension's nostr keypair, NIP-06-derived from the operator's master
 * mnemonic by index — the dimension IS this identity (CONTEXT.md — Dimension
 * identity). Same mnemonic + index always yields the same keys, so a whole
 * forest is recoverable from one mnemonic.
 */
export interface DimensionIdentity {
  readonly index: number;
  readonly privateKey: Uint8Array;
  readonly pubkey: string;
  readonly npub: string;
}

export function deriveDimensionIdentity(
  mnemonic: string,
  index: number
): DimensionIdentity {
  if (!validateWords(mnemonic)) {
    throw new Error(
      'fractal: the master mnemonic failed BIP-39 validation (checksum or word list mismatch)'
    );
  }
  const { privateKey, publicKey } = accountFromSeedWords(
    mnemonic,
    undefined,
    index
  );
  return {
    index,
    privateKey,
    pubkey: publicKey,
    npub: npubEncode(publicKey),
  };
}

/** Signs an event template with a dimension's derived key — every published fractal event goes through this. */
export function signEvent(
  identity: DimensionIdentity,
  template: EventTemplate
): RelaySignedEvent {
  const finalized = finalizeEvent(template, identity.privateKey);
  return {
    id: finalized.id,
    pubkey: finalized.pubkey,
    kind: finalized.kind,
    content: finalized.content,
    tags: finalized.tags,
    createdAt: finalized.created_at,
    sig: finalized.sig,
  };
}
