import type { Seed } from '../domain/seed.js';
import type { DimensionSpec } from '../domain/spec.js';
import type { RelaySignedEvent } from './relay.js';

/**
 * The only port through which fractal thinks. Invoked at exactly three
 * moments — compile, interpretation, adaptation — never inside the
 * mechanical ditto loop (CONTEXT.md — Brain, Hands).
 */
export interface CompileRequest {
  readonly seed: Seed;
}

export interface InterpretRequest {
  readonly dittos: readonly RelaySignedEvent[];
}

export interface AdaptRequest {
  readonly spec: DimensionSpec;
  readonly reason: string;
}

export interface BrainPort {
  compile(request: CompileRequest): Promise<DimensionSpec>;
  interpret(request: InterpretRequest): Promise<string>;
  adapt(request: AdaptRequest): Promise<DimensionSpec>;
}
