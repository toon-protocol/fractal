export { PIPELINE_STAGES } from './pipeline.js';
export type { PipelineStage } from './pipeline.js';

export { runCommand, CLI_VERSION } from './command.js';
export type { Ports, CommandResult } from './command.js';

export type {
  Seed,
  DimensionSpec,
  SourceConfig,
  NipMapping,
  CandidateEvent,
  Provenance,
  GateVerdict,
} from './domain/index.js';
export {
  DEFAULT_RELAY_SET,
  evaluateCandidate,
  MAX_CANDIDATE_CONTENT_LENGTH,
} from './domain/index.js';

export { deriveDimensionIdentity } from './identity.js';
export type { DimensionIdentity } from './identity.js';

export {
  plant,
  PROFILE_EVENT_KIND,
  SEED_EVENT_KIND,
  SPEC_EVENT_KIND,
} from './plant.js';
export type { PlantRequest, PlantResult, PlantPorts } from './plant.js';

export type {
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
} from './ports/index.js';

export {
  FixtureBelow,
  fixtureKey,
  InMemoryRelay,
  ScriptedBrain,
} from './fakes/index.js';
export type { FixtureBelowOptions, BrainScript } from './fakes/index.js';
