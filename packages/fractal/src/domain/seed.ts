/**
 * The operator's natural-language intent for a dimension. Immutable once
 * planted — the dimension's origin record and genome (CONTEXT.md — Seed).
 */
export interface Seed {
  readonly id: string;
  readonly utterance: string;
  readonly plantedAt: string;
}
