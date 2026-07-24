import { describe, expect, it } from 'vitest';
import { deriveDimensionIdentity } from './identity.js';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('deriveDimensionIdentity', () => {
  it('deterministically derives the same keypair for the same mnemonic + index', () => {
    const first = deriveDimensionIdentity(MNEMONIC, 0);
    const second = deriveDimensionIdentity(MNEMONIC, 0);

    expect(second.pubkey).toBe(first.pubkey);
    expect(second.npub).toBe(first.npub);
    expect(second.privateKey).toEqual(first.privateKey);
  });

  it('derives a distinct keypair per dimension index', () => {
    const dimensionZero = deriveDimensionIdentity(MNEMONIC, 0);
    const dimensionOne = deriveDimensionIdentity(MNEMONIC, 1);

    expect(dimensionOne.pubkey).not.toBe(dimensionZero.pubkey);
  });

  it('encodes the pubkey as a bech32 npub', () => {
    const identity = deriveDimensionIdentity(MNEMONIC, 0);

    expect(identity.npub).toMatch(/^npub1[a-z0-9]+$/);
  });

  it('rejects a mnemonic that fails BIP-39 validation', () => {
    expect(() => deriveDimensionIdentity('not a real mnemonic', 0)).toThrow(
      /BIP-39 validation/i
    );
  });
});
