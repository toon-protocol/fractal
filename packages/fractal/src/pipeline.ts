/**
 * The life of a dimension: the ordered stages every fractal dimension moves
 * through, from operator utterance to experienced agent internet. Stage
 * definitions live in the repo glossary (CONTEXT.md — Pipeline).
 */
export const PIPELINE_STAGES = [
  'seed',
  'spec',
  'ditto-loop',
  'nip-gate',
  'relay',
  'portal',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
