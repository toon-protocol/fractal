import type { BelowPort, BelowRequest, BelowResponse } from '../ports/below.js';

/**
 * Below fake backed by recorded HTTP payloads, keyed by source and resource
 * (CONTEXT.md — Hermetic framing). Serves fixtures verbatim; never touches
 * the network.
 */
export interface FixtureBelowOptions {
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly now?: () => string;
}

export class FixtureBelow implements BelowPort {
  private readonly fixtures: Readonly<Record<string, unknown>>;
  private readonly now: () => string;

  constructor(options: FixtureBelowOptions) {
    this.fixtures = options.fixtures;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async fetch(request: BelowRequest): Promise<BelowResponse> {
    const key = fixtureKey(request.sourceId, request.resource);
    if (!(key in this.fixtures)) {
      throw new Error(`FixtureBelow: no recorded payload for "${key}"`);
    }
    return {
      sourceId: request.sourceId,
      resource: request.resource,
      fetchedAt: this.now(),
      payload: this.fixtures[key],
    };
  }
}

export function fixtureKey(sourceId: string, resource: string): string {
  return `${sourceId}:${resource}`;
}
