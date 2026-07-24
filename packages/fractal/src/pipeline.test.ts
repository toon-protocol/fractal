import { describe, expect, it } from 'vitest';
import { PIPELINE_STAGES } from './pipeline.js';

describe('PIPELINE_STAGES', () => {
  it('runs from seed to portal in glossary order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'seed',
      'spec',
      'ditto-loop',
      'nip-gate',
      'relay',
      'portal',
    ]);
  });

  it('contains no duplicate stages', () => {
    expect(new Set(PIPELINE_STAGES).size).toBe(PIPELINE_STAGES.length);
  });

  it('gates before any paid publish: nip-gate precedes relay', () => {
    expect(PIPELINE_STAGES.indexOf('nip-gate')).toBeLessThan(
      PIPELINE_STAGES.indexOf('relay')
    );
  });
});
