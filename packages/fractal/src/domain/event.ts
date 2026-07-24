/**
 * The API resource a ditto traces back to, so every dittoed event carries
 * provenance to the world below (CONTEXT.md — Ditto, Hermetic framing).
 */
export interface Provenance {
  readonly sourceId: string;
  readonly resourceUrl: string;
  readonly fetchedAt: string;
}

/**
 * A faithful structural projection of a below-resource into a NIP shape,
 * awaiting the NIP gate before any paid publish. Never carries interpretation
 * (CONTEXT.md — Ditto, Projection, Interpretation).
 */
export interface CandidateEvent {
  readonly kind: number;
  readonly content: string;
  readonly tags: readonly (readonly string[])[];
  readonly createdAt: number;
  readonly provenance: Provenance;
}

/**
 * Interpretation's own kind — NIP-22's generic Comment kind, chosen
 * deliberately over an arbitrary fractal-only number: 1111 already means
 * "commentary referencing another event" to any NIP-22-aware client, so a
 * dimension's perception layer reads as conformant nostr, not a private
 * convention (CONTEXT.md — Interpretation, "structurally distinct").
 */
export const INTERPRETATION_EVENT_KIND = 1111;

/**
 * Agent commentary that references the dittos it comments on via 'e' tags.
 * Carries no below-resource provenance — it is not itself a projection, so
 * it has nothing to be faithful to below (CONTEXT.md — Interpretation).
 */
export interface InterpretationCandidate {
  readonly kind: number;
  readonly content: string;
  readonly tags: readonly (readonly string[])[];
  readonly createdAt: number;
}
