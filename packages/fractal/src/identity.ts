import { accountFromSeedWords, validateWords } from 'nostr-tools/nip06';
import { npubEncode } from 'nostr-tools/nip19';

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
