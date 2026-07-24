import type { BelowPort, BelowResponse } from './below.js';
import type { CandidateEvent } from '../domain/event.js';
import type { SourceConfig } from '../domain/spec.js';

/**
 * One medium plugged into fractal behind a single interface — the feed
 * medium today, the git medium (via rig) later — so growing a new medium
 * never touches the ditto loop itself (CONTEXT.md — Fractal dimension; the
 * founding spec's "media are adapters behind one interface").
 */
export interface MediumAdapter {
  /** The `SourceConfig.kind` values this adapter handles (e.g. 'rss', 'hn'). */
  readonly supportedKinds: readonly string[];

  /** Pulls one source's current resource through the Below port. */
  fetch(source: SourceConfig, below: BelowPort): Promise<BelowResponse>;

  /**
   * Faithful structural projection: a fetched resource becomes zero or more
   * candidates, ready for the NIP gate. Never interprets (CONTEXT.md —
   * Ditto, Projection).
   */
  project(
    response: BelowResponse,
    source: SourceConfig
  ): readonly CandidateEvent[];
}
