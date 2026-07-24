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
