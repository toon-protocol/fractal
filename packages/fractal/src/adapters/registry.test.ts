import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from './registry.js';
import type { MediumAdapter } from '../ports/adapter.js';

function stubAdapter(supportedKinds: readonly string[]): MediumAdapter {
  return {
    supportedKinds,
    fetch: () => {
      throw new Error('not implemented');
    },
    project: () => [],
  };
}

describe('AdapterRegistry', () => {
  it('resolves an adapter by a kind it declared support for', () => {
    const registry = new AdapterRegistry();
    const adapter = stubAdapter(['rss']);

    registry.register(adapter);

    expect(registry.resolve('rss')).toBe(adapter);
  });

  it('resolves the same adapter under each of its supported kinds', () => {
    const registry = new AdapterRegistry();
    const adapter = stubAdapter(['rss', 'hn']);

    registry.register(adapter);

    expect(registry.resolve('rss')).toBe(adapter);
    expect(registry.resolve('hn')).toBe(adapter);
  });

  it('throws resolving a kind nothing registered', () => {
    const registry = new AdapterRegistry();

    expect(() => registry.resolve('rss')).toThrow(/no adapter registered/i);
  });

  it('throws registering a kind two adapters both claim', () => {
    const registry = new AdapterRegistry();
    registry.register(stubAdapter(['rss']));

    expect(() => registry.register(stubAdapter(['rss']))).toThrow(
      /already registered/i
    );
  });
});
