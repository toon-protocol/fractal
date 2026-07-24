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
  Provenance,
  GateVerdict,
  DimensionIdentity,
  PlantRequest,
  PlantResult,
  PlantPorts,
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
  FixtureBelowOptions,
  BrainScript,
} from './index.js';

// Compile-time proof that every type symbol below is still exported from the
// root barrel, with the same name. This array is never read at runtime; its
// only job is to fail `tsc` if a type goes missing during a barrel refactor.
type ExportedTypesStillPresent = [
  PipelineStage,
  Ports,
  CommandResult,
  Seed,
  DimensionSpec,
  SourceConfig,
  NipMapping,
  CandidateEvent,
  Provenance,
  GateVerdict,
  DimensionIdentity,
  PlantRequest,
  PlantResult,
  PlantPorts,
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
  FixtureBelowOptions,
  BrainScript,
];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Assert = ExportedTypesStillPresent;

const EXPECTED_VALUE_EXPORTS = [
  'CLI_VERSION',
  'DEFAULT_RELAY_SET',
  'FixtureBelow',
  'InMemoryRelay',
  'MAX_CANDIDATE_CONTENT_LENGTH',
  'PIPELINE_STAGES',
  'PROFILE_EVENT_KIND',
  'ScriptedBrain',
  'SEED_EVENT_KIND',
  'SPEC_EVENT_KIND',
  'deriveDimensionIdentity',
  'evaluateCandidate',
  'fixtureKey',
  'plant',
  'runCommand',
].sort();

describe('package root barrel', () => {
  it('exports exactly the documented public value symbols', () => {
    expect(Object.keys(FractalIndex).sort()).toEqual(EXPECTED_VALUE_EXPORTS);
  });
});
