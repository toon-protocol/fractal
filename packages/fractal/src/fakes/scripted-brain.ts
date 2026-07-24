import type {
  AdaptRequest,
  BrainPort,
  CompileRequest,
  InterpretRequest,
} from '../ports/brain.js';
import type { DimensionSpec } from '../domain/spec.js';

/**
 * Brain fake: returns canned specs/commentary per moment, scripted by the
 * test. No LLM invocation, matching the brain being invoked only at compile,
 * interpretation, and adaptation moments (CONTEXT.md — Brain, Hands).
 */
export interface BrainScript {
  readonly compile?: (request: CompileRequest) => DimensionSpec;
  readonly interpret?: (request: InterpretRequest) => string;
  readonly adapt?: (request: AdaptRequest) => DimensionSpec;
}

export class ScriptedBrain implements BrainPort {
  constructor(private readonly script: BrainScript) {}

  async compile(request: CompileRequest): Promise<DimensionSpec> {
    if (!this.script.compile) {
      throw new Error('ScriptedBrain: no compile script provided');
    }
    return this.script.compile(request);
  }

  async interpret(request: InterpretRequest): Promise<string> {
    if (!this.script.interpret) {
      throw new Error('ScriptedBrain: no interpret script provided');
    }
    return this.script.interpret(request);
  }

  async adapt(request: AdaptRequest): Promise<DimensionSpec> {
    if (!this.script.adapt) {
      throw new Error('ScriptedBrain: no adapt script provided');
    }
    return this.script.adapt(request);
  }
}
