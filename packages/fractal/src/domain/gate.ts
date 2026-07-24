import type { CandidateEvent, Provenance } from './event.js';
import type { DimensionSpec } from './spec.js';

/**
 * The NIP gate's pre-publish pure-function output: a candidate event either
 * passes, or is kicked back with reasons for rework — never published
 * unverified (CONTEXT.md — NIP gate).
 */
export type GateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * The feed medium's v1 kinds: NIP-01 kind:1 notes and kind:0 profiles. The
 * gate has no schema for any other kind (CONTEXT.md — Fractal dimension,
 * "any NIP is a candidate shape").
 */
const SUPPORTED_KINDS = new Set([0, 1]);

/**
 * Conservative relay-typical cap on note/profile content. Chosen to catch
 * runaway projections before a paid write, not to encode a specific relay's
 * policy.
 */
export const MAX_CANDIDATE_CONTENT_LENGTH = 8000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isTagList(value: unknown): value is readonly (readonly string[])[] {
  return (
    Array.isArray(value) &&
    value.every((tag) => isStringArray(tag) && tag.length > 0)
  );
}

function isProvenanceShape(value: unknown): value is Provenance {
  return (
    isRecord(value) &&
    typeof value.sourceId === 'string' &&
    typeof value.resourceUrl === 'string' &&
    typeof value.fetchedAt === 'string'
  );
}

function isJsonObject(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed);
  } catch {
    return false;
  }
}

type SchemaCheck =
  | { readonly ok: true; readonly candidate: CandidateEvent }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * NIP-01 structural validation, run against unknown input rather than the
 * already-typed CandidateEvent — the gate is the boundary where a bad
 * projection is caught, not just a re-statement of the compiler's guarantee
 * (CONTEXT.md — NIP gate, "nothing malformed may ever reach a paid write").
 */
function checkSchema(input: unknown): SchemaCheck {
  const reasons: string[] = [];

  if (!isRecord(input)) {
    return { ok: false, reasons: ['schema:not-an-object'] };
  }

  const { kind, content, tags, createdAt, provenance } = input;

  const kindIsValidInteger =
    typeof kind === 'number' && Number.isInteger(kind) && kind >= 0;
  if (!kindIsValidInteger) {
    reasons.push('schema:invalid-kind');
  } else if (!SUPPORTED_KINDS.has(kind)) {
    reasons.push('schema:unsupported-kind');
  }

  if (
    typeof createdAt !== 'number' ||
    !Number.isInteger(createdAt) ||
    createdAt <= 0
  ) {
    reasons.push('schema:invalid-created-at');
  }

  if (!isTagList(tags)) {
    reasons.push('schema:invalid-tags');
  }

  if (!isProvenanceShape(provenance)) {
    reasons.push('schema:invalid-provenance');
  }

  if (kindIsValidInteger && kind === 0) {
    if (typeof content !== 'string' || !isJsonObject(content)) {
      reasons.push('schema:invalid-profile-content');
    }
  } else if (typeof content !== 'string') {
    reasons.push('schema:invalid-content');
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return {
    ok: true,
    candidate: {
      kind: kind as number,
      content: content as string,
      tags: tags as readonly (readonly string[])[],
      createdAt: createdAt as number,
      provenance: provenance as Provenance,
    },
  };
}

/**
 * Every ditto must trace to the API resource it projects. Missing fields are
 * incomplete provenance; a sourceId/resourceUrl that doesn't match a source
 * the spec actually configured is forged — claiming a lineage the dimension
 * doesn't have (CONTEXT.md — Ditto, Hermetic framing).
 */
function checkProvenance(
  candidate: CandidateEvent,
  spec: DimensionSpec
): string | undefined {
  const { sourceId, resourceUrl, fetchedAt } = candidate.provenance;

  const isWellFormed =
    sourceId.trim() !== '' &&
    resourceUrl.trim() !== '' &&
    fetchedAt.trim() !== '' &&
    !Number.isNaN(Date.parse(fetchedAt));

  if (!isWellFormed) {
    return 'provenance:missing';
  }

  const source = spec.sources.find(
    (candidateSource) => candidateSource.id === sourceId
  );
  if (!source || !resourceUrl.startsWith(source.endpoint)) {
    return 'provenance:forged-source';
  }

  return undefined;
}

/** The dimension's spec, not just the gate's own schema, bounds which kinds may publish. */
function checkKindAllowed(
  candidate: CandidateEvent,
  spec: DimensionSpec
): string | undefined {
  const allowedKinds = new Set(spec.nipMappings.map((mapping) => mapping.kind));
  return allowedKinds.has(candidate.kind) ? undefined : 'spec:kind-not-allowed';
}

function checkContentSize(candidate: CandidateEvent): string | undefined {
  return candidate.content.length > MAX_CANDIDATE_CONTENT_LENGTH
    ? 'content:oversized'
    : undefined;
}

/**
 * A ditto is a direct projection of a below-resource; it never references
 * another event. Interpretation is the layer that references a ditto
 * (CONTEXT.md — Ditto, Interpretation). An 'e' tag on a provenance-bearing
 * candidate is commentary smuggled through the ditto path, structurally
 * detectable without reading content.
 */
function checkDittoInterpretationSeparation(
  candidate: CandidateEvent
): string | undefined {
  const referencesAnotherEvent = candidate.tags.some((tag) => tag[0] === 'e');
  return referencesAnotherEvent ? 'ditto:interpretation-blend' : undefined;
}

/**
 * The NIP gate: candidate event in, verdict out. Pure and side-effect-free —
 * no mutation, no I/O — so it can run pre-publish on every candidate and be
 * unit-tested directly (CONTEXT.md — NIP gate).
 */
export function evaluateCandidate(
  candidate: unknown,
  spec: DimensionSpec
): GateVerdict {
  const schemaCheck = checkSchema(candidate);
  if (!schemaCheck.ok) {
    return { ok: false, reasons: schemaCheck.reasons };
  }

  const reasons = [
    checkKindAllowed(schemaCheck.candidate, spec),
    checkProvenance(schemaCheck.candidate, spec),
    checkContentSize(schemaCheck.candidate),
    checkDittoInterpretationSeparation(schemaCheck.candidate),
  ].filter((reason): reason is string => reason !== undefined);

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
