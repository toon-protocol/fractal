import type { MediumAdapter } from '../ports/adapter.js';
import type { BelowPort, BelowResponse } from '../ports/below.js';
import type { CandidateEvent } from '../domain/event.js';
import type { SourceConfig } from '../domain/spec.js';

/** The feed medium's only candidate shape in v1: NIP-01 kind:1 notes. */
const FEED_NOTE_KIND = 1;

/**
 * v1's fixed resource convention: one current listing per source, no
 * pagination yet. Every feed-kind source is fetched at this resource
 * regardless of its underlying format (CONTEXT.md — Ditto loop).
 */
export const FEED_RESOURCE = 'latest';

/**
 * The documented feed projection convention: each candidate field is read
 * from the first present field-name variant, so the same faithful mapping
 * covers both RSS-shaped and HN-shaped resources without interpreting
 * either — a title is a title whichever API produced it.
 */
const TITLE_FIELDS = ['title'] as const;
const LINK_FIELDS = ['link', 'url'] as const;
const AUTHOR_FIELDS = ['author', 'creator', 'by'] as const;
const CONTENT_FIELDS = ['content', 'summary', 'description', 'text'] as const;
const TIMESTAMP_FIELDS = ['pubDate', 'publishedAt', 'time'] as const;

interface NormalizedFeedItem {
  readonly title: string;
  readonly link: string;
  readonly author: string;
  readonly content: string;
  readonly publishedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(
  record: Record<string, unknown>,
  fields: readonly string[]
): string {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return '';
}

/** HN's `time` is unix seconds; RSS's `pubDate` is a date string — both faithfully become unix seconds. */
function pickTimestamp(
  record: Record<string, unknown>,
  fields: readonly string[],
  fallbackIso: string
): number {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return Math.floor(parsed / 1000);
      }
    }
  }
  return Math.floor(Date.parse(fallbackIso) / 1000);
}

function normalizeFeedItem(
  record: Record<string, unknown>,
  fetchedAt: string
): NormalizedFeedItem {
  return {
    title: pickString(record, TITLE_FIELDS),
    link: pickString(record, LINK_FIELDS),
    author: pickString(record, AUTHOR_FIELDS),
    content: pickString(record, CONTENT_FIELDS),
    publishedAt: pickTimestamp(record, TIMESTAMP_FIELDS, fetchedAt),
  };
}

function buildContent(item: NormalizedFeedItem): string {
  return [item.title, item.content, item.link]
    .filter((part) => part !== '')
    .join('\n\n');
}

function buildTags(item: NormalizedFeedItem): string[][] {
  const tags: string[][] = [];
  if (item.link !== '') {
    tags.push(['r', item.link]);
  }
  if (item.author !== '') {
    tags.push(['author', item.author]);
  }
  return tags;
}

function extractItems(payload: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(payload) ? payload.filter(isRecord) : [];
}

/** Provenance ties back to the fetched API resource, not the item's own link — position disambiguates items within it (CONTEXT.md — Hermetic framing). */
function buildResourceUrl(
  source: SourceConfig,
  response: BelowResponse,
  position: number
): string {
  const base = source.endpoint.endsWith('/')
    ? source.endpoint.slice(0, -1)
    : source.endpoint;
  return `${base}/${response.resource}#${position}`;
}

function toCandidate(
  raw: Record<string, unknown>,
  position: number,
  response: BelowResponse,
  source: SourceConfig
): CandidateEvent | undefined {
  const normalized = normalizeFeedItem(raw, response.fetchedAt);
  if (normalized.title === '' && normalized.content === '') {
    return undefined;
  }

  return {
    kind: FEED_NOTE_KIND,
    content: buildContent(normalized),
    tags: buildTags(normalized),
    createdAt: normalized.publishedAt,
    provenance: {
      sourceId: source.id,
      resourceUrl: buildResourceUrl(source, response, position),
      fetchedAt: response.fetchedAt,
    },
  };
}

/**
 * The feed medium's adapter: real-world feed sources (RSS, HN today; Reddit
 * per the founding spec) become faithful ditto candidates. Fetch is a fixed
 * resource per source; project is a pure structural mapping with zero
 * commentary (CONTEXT.md — Ditto, Projection).
 */
export const feedAdapter: MediumAdapter = {
  supportedKinds: ['rss', 'hn'],

  fetch(source: SourceConfig, below: BelowPort): Promise<BelowResponse> {
    return below.fetch({ sourceId: source.id, resource: FEED_RESOURCE });
  },

  project(
    response: BelowResponse,
    source: SourceConfig
  ): readonly CandidateEvent[] {
    return extractItems(response.payload)
      .map((raw, position) => toCandidate(raw, position, response, source))
      .filter(
        (candidate): candidate is CandidateEvent => candidate !== undefined
      );
  },
};
