import type { MediumAdapter } from '../ports/adapter.js';

/**
 * Where medium adapters register themselves so the ditto loop resolves a
 * source's adapter by its `kind` rather than a hardcoded switch (CONTEXT.md
 * — Fractal dimension; the founding spec's "media are adapters behind one
 * interface").
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, MediumAdapter>();

  register(adapter: MediumAdapter): void {
    for (const kind of adapter.supportedKinds) {
      if (this.adapters.has(kind)) {
        throw new Error(
          `AdapterRegistry: "${kind}" is already registered to another adapter`
        );
      }
      this.adapters.set(kind, adapter);
    }
  }

  resolve(kind: string): MediumAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(`AdapterRegistry: no adapter registered for "${kind}"`);
    }
    return adapter;
  }
}
