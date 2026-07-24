import { describe, expect, it } from 'vitest';
import * as FractalIndex from './index.js';
import type {
  PipelineStage,
  Ports,
  CommandResult,
  Seed,
  DimensionSpec,
  SourceConfig,
  NipMapping,
  CandidateEvent,
  InterpretationCandidate,
  Provenance,
  GateVerdict,
  DimensionIdentity,
  PlantRequest,
  PlantResult,
  PlantPorts,
  TickRequest,
  TickPorts,
  TickResult,
  TickKickBack,
  TickWithheld,
  TickReport,
  InterpretationRequest,
  InterpretPorts,
  InterpretResult,
  InterpretKickBack,
  StatusRequest,
  StatusPorts,
  DimensionStatus,
  SourceCursor,
  BelowPort,
  BelowRequest,
  BelowResponse,
  RelayPort,
  RelaySignedEvent,
  PublishRequest,
  PublishResult,
  ReadBackQuery,
  BrainPort,
  CompileRequest,
  InterpretRequest,
  AdaptRequest,
  MediumAdapter,
  FixtureBelowOptions,
  BrainScript,
} from './index.js';

// The `import type { ... }` above is itself the guard: if a type is renamed
// or dropped from the root barrel, this file fails to resolve it. Note that
// packages/fractal/tsconfig.json excludes `*.test.ts` from `tsc -b`, so that
// failure only surfaces in editor tooling, not in `pnpm typecheck`/CI — the
// value-export check below is the one regression guard CI actually runs.

const EXPECTED_VALUE_EXPORTS = [
  'AdapterRegistry',
  'CLI_VERSION',
  'DEFAULT_RELAY_SET',
  'FEED_RESOURCE',
  'FixtureBelow',
  'InMemoryRelay',
  'MAX_CANDIDATE_CONTENT_LENGTH',
  'PIPELINE_STAGES',
  'PROFILE_EVENT_KIND',
  'RelayPool',
  'ScriptedBrain',
  'SEED_EVENT_KIND',
  'SPEC_EVENT_KIND',
  'INTERPRETATION_EVENT_KIND',
  'TICK_REPORT_EVENT_KIND',
  'deriveDimensionIdentity',
  'evaluateCandidate',
  'evaluateInterpretation',
  'feedAdapter',
  'fixtureKey',
  'interpret',
  'plant',
  'runCommand',
  'signEvent',
  'status',
  'tick',
].sort();

describe('package root barrel', () => {
  it('exports exactly the documented public value symbols', () => {
    expect(Object.keys(FractalIndex).sort()).toEqual(EXPECTED_VALUE_EXPORTS);
  });
});
