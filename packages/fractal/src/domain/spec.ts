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
