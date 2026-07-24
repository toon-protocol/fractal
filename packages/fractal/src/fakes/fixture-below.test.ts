import { describe, expect, it } from 'vitest';
import { FixtureBelow } from './fixture-below.js';

describe('FixtureBelow', () => {
  it('serves a recorded payload for a known source/resource pair', async () => {
    const below = new FixtureBelow({
      fixtures: { 'hn:top': { title: 'Show HN: fractal' } },
      now: () => '2026-07-24T00:00:00.000Z',
    });

    const response = await below.fetch({ sourceId: 'hn', resource: 'top' });

    expect(response).toEqual({
      sourceId: 'hn',
      resource: 'top',
      fetchedAt: '2026-07-24T00:00:00.000Z',
      payload: { title: 'Show HN: fractal' },
    });
  });

  it('rejects a resource with no recorded fixture', async () => {
    const below = new FixtureBelow({ fixtures: {} });

    await expect(
      below.fetch({ sourceId: 'hn', resource: 'top' })
    ).rejects.toThrow(/no recorded payload/i);
  });
});
