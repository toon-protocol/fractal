import { describe, expect, it } from 'vitest';
import { validateSpec } from './spec.js';

const validSpec = {
  sources: [{ id: 'hn', kind: 'hn', endpoint: 'https://hn.example/top' }],
  nipMappings: [{ nip: 'NIP-01', kind: 1 }],
  cadence: 'hourly',
  budgetCap: 1000,
  relaySet: ['wss://relay.example'],
};

describe('validateSpec', () => {
  it('accepts a well-formed spec and returns it typed', () => {
    const result = validateSpec(validSpec);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec).toEqual(validSpec);
    }
  });

  it('accepts an empty relay set — resolveRelaySet fills the default later', () => {
    const result = validateSpec({ ...validSpec, relaySet: [] });

    expect(result.ok).toBe(true);
  });

  it('rejects a non-object candidate', () => {
    const result = validateSpec('not a spec');

    expect(result).toEqual({ ok: false, reasons: ['spec:not-an-object'] });
  });

  it('rejects an empty sources array — nothing to ditto with none', () => {
    const result = validateSpec({ ...validSpec, sources: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-sources');
    }
  });

  it('rejects a source missing a required field', () => {
    const result = validateSpec({
      ...validSpec,
      sources: [{ id: 'hn', kind: 'hn' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-sources');
    }
  });

  it('rejects an empty nipMappings array — the gate would allow nothing through', () => {
    const result = validateSpec({ ...validSpec, nipMappings: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-nip-mappings');
    }
  });

  it('rejects a non-integer nipMapping kind', () => {
    const result = validateSpec({
      ...validSpec,
      nipMappings: [{ nip: 'NIP-01', kind: 1.5 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-nip-mappings');
    }
  });

  it('rejects a blank cadence', () => {
    const result = validateSpec({ ...validSpec, cadence: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-cadence');
    }
  });

  it('rejects a non-positive budgetCap', () => {
    const result = validateSpec({ ...validSpec, budgetCap: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-budget-cap');
    }
  });

  it('rejects a relaySet with a non-string entry', () => {
    const result = validateSpec({ ...validSpec, relaySet: [42] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('spec:invalid-relay-set');
    }
  });

  it('accumulates every failing reason at once, not just the first', () => {
    const result = validateSpec({
      sources: [],
      nipMappings: [],
      cadence: '',
      budgetCap: -1,
      relaySet: [1],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.sort()).toEqual(
        [
          'spec:invalid-sources',
          'spec:invalid-nip-mappings',
          'spec:invalid-cadence',
          'spec:invalid-budget-cap',
          'spec:invalid-relay-set',
        ].sort()
      );
    }
  });
});
