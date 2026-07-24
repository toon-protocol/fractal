import { describe, expect, it } from 'vitest';
import { feedAdapter, FEED_RESOURCE } from './feed.js';
import { FixtureBelow } from '../fakes/fixture-below.js';
import type { SourceConfig } from '../domain/spec.js';
import type { BelowResponse } from '../ports/below.js';
import { evaluateCandidate } from '../domain/gate.js';
import type { DimensionSpec } from '../domain/spec.js';

const RSS_SOURCE: SourceConfig = {
  id: 'indie-blog',
  kind: 'rss',
  endpoint: 'https://indie.example/feed',
};

const HN_SOURCE: SourceConfig = {
  id: 'hn-top',
  kind: 'hn',
  endpoint: 'https://hacker-news.example/api',
};

const RSS_PAYLOAD = [
  {
    title: 'Shipping a roguelike in a weekend',
    link: 'https://indie.example/posts/roguelike-weekend',
    author: 'ada',
    pubDate: '2026-07-20T12:00:00.000Z',
    content: 'How I built a roguelike in 48 hours.',
  },
  {
    title: 'Pixel art without an artist',
    link: 'https://indie.example/posts/pixel-art',
    creator: 'grace',
    pubDate: '2026-07-21T09:30:00.000Z',
    description: 'Tools that make programmer art look intentional.',
  },
];

const HN_PAYLOAD = [
  {
    id: 41,
    title: 'Show HN: fractal',
    url: 'https://hacker-news.example/items/41',
    by: 'pg',
    time: 1_784_000_000,
    text: 'A CLI that grows nostr dimensions from a seed.',
  },
  {
    id: 42,
    title: 'Ask HN: best roguelike devlogs?',
    by: 'dang',
    time: 1_784_003_600,
  },
];

async function fetchAndProject(
  source: SourceConfig,
  fixtures: Readonly<Record<string, unknown>>
) {
  const below = new FixtureBelow({
    fixtures,
    now: () => '2026-07-24T00:00:00.000Z',
  });
  const response = await feedAdapter.fetch(source, below);
  return feedAdapter.project(response, source);
}

function fixtureFor(source: SourceConfig, payload: unknown) {
  return { [`${source.id}:${FEED_RESOURCE}`]: payload };
}

describe('feedAdapter.fetch', () => {
  it('pulls the source through the Below port at the feed resource convention', async () => {
    const below = new FixtureBelow({
      fixtures: fixtureFor(RSS_SOURCE, RSS_PAYLOAD),
    });

    const response: BelowResponse = await feedAdapter.fetch(RSS_SOURCE, below);

    expect(response.sourceId).toBe(RSS_SOURCE.id);
    expect(response.resource).toBe(FEED_RESOURCE);
    expect(response.payload).toEqual(RSS_PAYLOAD);
  });
});

describe('feedAdapter.project', () => {
  it('faithfully projects an RSS-shaped resource into kind:1 candidates', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, RSS_PAYLOAD)
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      kind: 1,
      content:
        'Shipping a roguelike in a weekend\n\nHow I built a roguelike in 48 hours.\n\nhttps://indie.example/posts/roguelike-weekend',
      tags: [
        ['r', 'https://indie.example/posts/roguelike-weekend'],
        ['author', 'ada'],
      ],
      createdAt: Math.floor(Date.parse('2026-07-20T12:00:00.000Z') / 1000),
      provenance: {
        sourceId: 'indie-blog',
        resourceUrl: 'https://indie.example/feed/latest#0',
        fetchedAt: '2026-07-24T00:00:00.000Z',
      },
    });
    // Second item uses the 'creator'/'description' field-name variants.
    expect(candidates[1]).toMatchObject({
      content:
        'Pixel art without an artist\n\nTools that make programmer art look intentional.\n\nhttps://indie.example/posts/pixel-art',
      tags: [
        ['r', 'https://indie.example/posts/pixel-art'],
        ['author', 'grace'],
      ],
    });
  });

  it('faithfully projects an HN-shaped resource into kind:1 candidates', async () => {
    const candidates = await fetchAndProject(
      HN_SOURCE,
      fixtureFor(HN_SOURCE, HN_PAYLOAD)
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      kind: 1,
      content:
        'Show HN: fractal\n\nA CLI that grows nostr dimensions from a seed.\n\nhttps://hacker-news.example/items/41',
      tags: [
        ['r', 'https://hacker-news.example/items/41'],
        ['author', 'pg'],
      ],
      createdAt: 1_784_000_000,
      provenance: {
        sourceId: 'hn-top',
        resourceUrl: 'https://hacker-news.example/api/latest#0',
        fetchedAt: '2026-07-24T00:00:00.000Z',
      },
    });
    // Second item has no url/text — content falls back to title only.
    expect(candidates[1]).toEqual({
      kind: 1,
      content: 'Ask HN: best roguelike devlogs?',
      tags: [['author', 'dang']],
      createdAt: 1_784_003_600,
      provenance: {
        sourceId: 'hn-top',
        resourceUrl: 'https://hacker-news.example/api/latest#1',
        fetchedAt: '2026-07-24T00:00:00.000Z',
      },
    });
  });

  it('gives every candidate a distinct provenance resourceUrl encoding its position', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, RSS_PAYLOAD)
    );

    const urls = candidates.map(
      (candidate) => candidate.provenance.resourceUrl
    );
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url.startsWith(RSS_SOURCE.endpoint)).toBe(true);
    }
  });

  it('is deterministic: identical fixture input projects identical candidates', async () => {
    const below = new FixtureBelow({
      fixtures: fixtureFor(RSS_SOURCE, RSS_PAYLOAD),
      now: () => '2026-07-24T00:00:00.000Z',
    });
    const response = await feedAdapter.fetch(RSS_SOURCE, below);

    const first = feedAdapter.project(response, RSS_SOURCE);
    const second = feedAdapter.project(response, RSS_SOURCE);

    expect(first).toEqual(second);
  });

  it('skips an item with neither title nor content to project', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, [
        { author: 'nobody', link: 'https://indie.example/x' },
      ])
    );

    expect(candidates).toEqual([]);
  });

  it('projects nothing from a non-list resource payload', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, { unexpected: 'shape' })
    );

    expect(candidates).toEqual([]);
  });

  it('never emits an interpretation-style event reference tag', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, RSS_PAYLOAD)
    );

    for (const candidate of candidates) {
      expect(candidate.tags.some((tag) => tag[0] === 'e')).toBe(false);
    }
  });

  it('produces candidates that pass the NIP gate as-is', async () => {
    const candidates = await fetchAndProject(
      RSS_SOURCE,
      fixtureFor(RSS_SOURCE, RSS_PAYLOAD)
    );
    const spec: DimensionSpec = {
      sources: [RSS_SOURCE],
      nipMappings: [{ nip: 'NIP-01', kind: 1 }],
      cadence: 'hourly',
      budgetCap: 1000,
      relaySet: ['wss://relay.toon.example'],
    };

    for (const candidate of candidates) {
      expect(evaluateCandidate(candidate, spec)).toEqual({ ok: true });
    }
  });
});
