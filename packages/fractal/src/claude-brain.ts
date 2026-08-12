import { validateSpec } from './domain/spec.js';
import type { DimensionSpec } from './domain/spec.js';
import type { Seed } from './domain/seed.js';
import { runHeadlessQuery } from './headless-claude.js';
import type { HeadlessQuery } from './headless-claude.js';
import type {
  AdaptRequest,
  BrainPort,
  CompileRequest,
  InterpretRequest,
} from './ports/brain.js';

/**
 * How many compile/adapt attempts the brain makes in total — the first try
 * plus the kick-backs that follow an invalid candidate — before it gives up.
 * Explicit and tested — persistent failure must surface a clear error, never
 * a half-planted dimension (fractal#33).
 */
export const MAX_SPEC_ATTEMPTS = 3;

const CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/** Whether headless Claude has anything to authenticate with — checked before every brain call, never assumed. */
export function hasHeadlessClaudeCredentials(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return CREDENTIAL_ENV_KEYS.some((key) => Boolean(env[key]));
}

function missingCredentialsMessage(): string {
  return (
    `fractal: the Brain has no Claude credentials — set one of ${CREDENTIAL_ENV_KEYS.join(' or ')}. ` +
    'Mechanical commands and "plant --spec" work without them; compile, interpret, and adapt do not.'
  );
}

const DIMENSION_SPEC_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['sources', 'nipMappings', 'cadence', 'budgetCap', 'relaySet'],
  properties: {
    sources: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'endpoint'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string' },
          endpoint: { type: 'string' },
        },
      },
    },
    nipMappings: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nip', 'kind'],
        properties: {
          nip: { type: 'string' },
          kind: { type: 'integer', minimum: 0 },
        },
      },
    },
    cadence: { type: 'string', minLength: 1 },
    budgetCap: { type: 'number', exclusiveMinimum: 0 },
    relaySet: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * The kick-back itself: a rejected candidate goes back to the model with the
 * reasons it failed validation. No reasons — the first attempt — leaves the
 * prompt untouched.
 */
function withRejectionNote(
  prompt: string,
  previousReasons: readonly string[]
): string {
  if (previousReasons.length === 0) {
    return prompt;
  }

  return `${prompt}\n\nYour previous reply was rejected: ${previousReasons.join('; ')}. Return corrected JSON only.`;
}

function buildCompilePrompt(
  seed: Seed,
  previousReasons: readonly string[]
): string {
  return withRejectionNote(
    [
      "You are fractal's compile skill: turn one operator seed utterance into a DimensionSpec.",
      `Seed utterance: "${seed.utterance}"`,
      'Choose real-world, read-only API sources (id, kind, endpoint) that fit the seed; NIP mappings (nip, kind) for the events those sources project into; a cadence describing how often the dimension ticks; a positive budgetCap (a count of paid writes the dimension should afford); and a relaySet (an array of wss:// relay URLs, or an empty array to accept the shared default relay).',
      'Reply with the DimensionSpec JSON only — no prose, no markdown fences.',
    ].join('\n'),
    previousReasons
  );
}

function buildAdaptPrompt(
  request: AdaptRequest,
  previousReasons: readonly string[]
): string {
  return withRejectionNote(
    [
      "You are fractal's adaptation moment: revise a living dimension's spec.",
      `Reason for revision: ${request.reason}`,
      `Current spec:\n${JSON.stringify(request.spec)}`,
      'Reply with the complete revised DimensionSpec JSON only — no prose, no markdown fences.',
    ].join('\n'),
    previousReasons
  );
}

function buildInterpretPrompt(request: InterpretRequest): string {
  return [
    "You are fractal's interpretation pass: write commentary on these recently dittoed events, as perception layered on top of the projection below — never restated as a new ditto.",
    JSON.stringify(request.dittos),
  ].join('\n\n');
}

function parseJsonCandidate(
  text: string
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export interface ClaudeBrainOptions {
  /** Defaults to the real SDK-backed {@link runHeadlessQuery}; tests inject a scripted one. */
  readonly query?: HeadlessQuery;
  readonly model?: string;
  /** Defaults to {@link MAX_SPEC_ATTEMPTS}. */
  readonly maxAttempts?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * The real Brain port, implemented against headless Claude. `compile` and
 * `adapt` share one bounded-retry loop: an invalid candidate is kicked back
 * to the model with its validation reasons and retried up to `maxAttempts`
 * times; persistent failure throws a clear, actionable error and returns
 * nothing, so a caller (`plant`) can never observe — let alone publish — a
 * half-formed spec (CONTEXT.md — Brain; fractal#33, "no half-plant").
 * `interpret` is free text with nothing to validate structurally, so it is
 * a single call.
 */
export class ClaudeBrain implements BrainPort {
  private readonly runQuery: HeadlessQuery;
  private readonly model: string | undefined;
  private readonly maxAttempts: number;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ClaudeBrainOptions = {}) {
    this.runQuery = options.query ?? runHeadlessQuery;
    this.model = options.model;
    this.maxAttempts = options.maxAttempts ?? MAX_SPEC_ATTEMPTS;
    this.env = options.env ?? process.env;
  }

  private requireCredentials(): void {
    if (!hasHeadlessClaudeCredentials(this.env)) {
      throw new Error(missingCredentialsMessage());
    }
  }

  async compile(request: CompileRequest): Promise<DimensionSpec> {
    this.requireCredentials();
    return this.resolveSpecWithRetry((reasons) =>
      buildCompilePrompt(request.seed, reasons)
    );
  }

  async adapt(request: AdaptRequest): Promise<DimensionSpec> {
    this.requireCredentials();
    return this.resolveSpecWithRetry((reasons) =>
      buildAdaptPrompt(request, reasons)
    );
  }

  async interpret(request: InterpretRequest): Promise<string> {
    this.requireCredentials();
    const result = await this.runQuery({
      prompt: buildInterpretPrompt(request),
      model: this.model,
    });
    if (!result.ok) {
      throw new Error(`fractal: brain interpret failed — ${result.error}`);
    }
    return result.text;
  }

  private async resolveSpecWithRetry(
    buildPrompt: (previousReasons: readonly string[]) => string
  ): Promise<DimensionSpec> {
    let reasons: readonly string[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const result = await this.runQuery({
        prompt: buildPrompt(reasons),
        model: this.model,
        jsonSchema: DIMENSION_SPEC_JSON_SCHEMA,
      });

      if (!result.ok) {
        reasons = [`query:${result.error}`];
        continue;
      }

      const parsed = parseJsonCandidate(result.text);
      if (!parsed.ok) {
        reasons = ['json:unparseable-response'];
        continue;
      }

      const validation = validateSpec(parsed.value);
      if (validation.ok) {
        return validation.spec;
      }
      reasons = validation.reasons;
    }

    throw new Error(
      `fractal: brain gave up after ${this.maxAttempts} attempt(s) — last error: ${reasons.join('; ')}`
    );
  }
}
