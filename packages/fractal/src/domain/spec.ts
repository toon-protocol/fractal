/**
 * One API source a dimension ditto-loops against; medium adapters interpret
 * `kind` (CONTEXT.md — Ditto loop, Dimension spec).
 */
export interface SourceConfig {
  readonly id: string;
  readonly kind: string;
  readonly endpoint: string;
}

/** Which NIP shape a source's dittos project into (CONTEXT.md — Projection). */
export interface NipMapping {
  readonly nip: string;
  readonly kind: number;
}

/**
 * What the brain compiles a seed into: sources, NIP mappings, cadence, and
 * budget cap. Operator-reviewable and amendable — amendments happen here,
 * never to the seed (CONTEXT.md — Dimension spec, Relay set).
 */
export interface DimensionSpec {
  readonly sources: readonly SourceConfig[];
  readonly nipMappings: readonly NipMapping[];
  readonly cadence: string;
  readonly budgetCap: number;
  readonly relaySet: readonly string[];
}

/**
 * The shared TOON relay a dimension's spec falls back to when the brain
 * compiles no relay set of its own, so dimensions are social and discoverable
 * by default (CONTEXT.md — Relay set).
 */
export const DEFAULT_RELAY_SET: readonly string[] = ['wss://relay.toon.social'];

/** Falls back to {@link DEFAULT_RELAY_SET} when a spec carries no relay set of its own. */
export function resolveRelaySet(
  relaySet: readonly string[]
): readonly string[] {
  return relaySet.length > 0 ? relaySet : DEFAULT_RELAY_SET;
}

/**
 * The compile skill's pre-publish check on its own output, and the same
 * check an operator's explicit `plant --spec` goes through — one function so
 * both paths reject the same malformed specs the same way (CONTEXT.md —
 * Dimension spec).
 */
export type SpecValidationResult =
  | { readonly ok: true; readonly spec: DimensionSpec }
  | { readonly ok: false; readonly reasons: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidSourceConfig(value: unknown): value is SourceConfig {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.kind) &&
    isNonEmptyString(value.endpoint)
  );
}

function isValidSourceConfigList(
  value: unknown
): value is readonly SourceConfig[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isValidSourceConfig)
  );
}

function isValidNipMapping(value: unknown): value is NipMapping {
  return (
    isRecord(value) &&
    isNonEmptyString(value.nip) &&
    typeof value.kind === 'number' &&
    Number.isInteger(value.kind) &&
    value.kind >= 0
  );
}

function isValidNipMappingList(value: unknown): value is readonly NipMapping[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isValidNipMapping)
  );
}

function isValidRelaySet(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

/**
 * Structural + invariant validation for a candidate `DimensionSpec` —
 * non-empty sources (nothing to ditto with none), non-empty NIP mappings
 * (nothing the gate would ever allow through without one), a named cadence,
 * a positive finite budget cap, and a relay set of plain strings (empty is
 * valid — {@link resolveRelaySet} fills the default).
 */
export function validateSpec(candidate: unknown): SpecValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, reasons: ['spec:not-an-object'] };
  }

  const { sources, nipMappings, cadence, budgetCap, relaySet } = candidate;
  const reasons: string[] = [];

  if (!isValidSourceConfigList(sources)) {
    reasons.push('spec:invalid-sources');
  }
  if (!isValidNipMappingList(nipMappings)) {
    reasons.push('spec:invalid-nip-mappings');
  }
  if (!isNonEmptyString(cadence)) {
    reasons.push('spec:invalid-cadence');
  }
  if (
    typeof budgetCap !== 'number' ||
    !Number.isFinite(budgetCap) ||
    budgetCap <= 0
  ) {
    reasons.push('spec:invalid-budget-cap');
  }
  if (!isValidRelaySet(relaySet)) {
    reasons.push('spec:invalid-relay-set');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    spec: {
      sources: sources as readonly SourceConfig[],
      nipMappings: nipMappings as readonly NipMapping[],
      cadence: cadence as string,
      budgetCap: budgetCap as number,
      relaySet: relaySet as readonly string[],
    },
  };
}
