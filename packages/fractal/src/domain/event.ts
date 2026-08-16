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

/** NIP-01 profile metadata (mutable — later tickets bind ArNS names here). */
export const PROFILE_EVENT_KIND = 0;
/** Immutable dimension origin record — never republished after planting. */
export const SEED_EVENT_KIND = 3300;
/** The compiled, amendable dimension spec (amendment is a later ticket). */
export const SPEC_EVENT_KIND = 3301;
/**
 * The per-tick economics log — not a ditto or interpretation, so it never
 * passes through the NIP gate, same exemption the identity events above
 * carry. Its `spent` field is the running spend total, so budget enforcement
 * is derived from relay read-back rather than local process state
 * (CONTEXT.md — Ditto loop, "the relay is the state of record"). When the
 * relay port can report its channel's live claim (`channelSpend`), that
 * claim outranks this field — see `tick`.
 */
export const TICK_REPORT_EVENT_KIND = 3302;

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
