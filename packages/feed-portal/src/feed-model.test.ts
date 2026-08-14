import { describe, expect, it } from 'vitest';
import { buildDimensionView } from './feed-model.js';
import {
  FIXTURE_DITTO_EVENT,
  FIXTURE_DITTO_EVENT_NO_PROVENANCE,
  FIXTURE_EVENTS,
  FIXTURE_INTERPRETATION_EVENT,
  FIXTURE_PUBKEY,
} from './fixtures.js';

describe('buildDimensionView', () => {
  it('surfaces the profile, seed, and spec from their latest events', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);

    expect(view.profile).toEqual({
      about: 'A dimension of the indie game dev scene',
    });
    expect(view.seed?.utterance).toBe(
      'build me a dimension of the indie game dev scene'
    );
    expect(view.spec?.cadence).toBe('hourly');
    expect(view.spec?.sources).toHaveLength(1);
  });

  it('classifies dittos and interpretation as distinct feed item types', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);

    const ditto = view.feed.find((item) => item.id === FIXTURE_DITTO_EVENT.id);
    const interpretation = view.feed.find(
      (item) => item.id === FIXTURE_INTERPRETATION_EVENT.id
    );

    expect(ditto?.type).toBe('ditto');
    expect(interpretation?.type).toBe('interpretation');
  });

  it('excludes profile/seed/spec/tick-report events from the feed', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);

    expect(view.feed).toHaveLength(3);
  });

  it('orders the feed newest first', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);

    const createdAts = view.feed.map((item) => item.createdAt);
    expect(createdAts).toEqual([...createdAts].sort((a, b) => b - a));
  });

  it("exposes a ditto's provenance (source + resource link) when the tags carry it", () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);
    const ditto = view.feed.find((item) => item.id === FIXTURE_DITTO_EVENT.id);

    if (ditto?.type !== 'ditto') {
      throw new Error('expected a ditto item');
    }
    expect(ditto.provenance).toEqual({
      sourceId: 'hn',
      resourceUrl: 'https://hn.example/top#0',
    });
  });

  it('leaves provenance undefined for a ditto with no source/resource tags', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);
    const ditto = view.feed.find(
      (item) => item.id === FIXTURE_DITTO_EVENT_NO_PROVENANCE.id
    );

    if (ditto?.type !== 'ditto') {
      throw new Error('expected a ditto item');
    }
    expect(ditto.provenance).toBeUndefined();
  });

  it('carries the referenced ditto ids on an interpretation item', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);
    const interpretation = view.feed.find(
      (item) => item.id === FIXTURE_INTERPRETATION_EVENT.id
    );

    if (interpretation?.type !== 'interpretation') {
      throw new Error('expected an interpretation item');
    }
    expect(interpretation.referencedDittoIds).toEqual([
      FIXTURE_DITTO_EVENT.id,
      FIXTURE_DITTO_EVENT_NO_PROVENANCE.id,
    ]);
  });

  it('ignores events from a different pubkey', () => {
    const foreignEvent = {
      ...FIXTURE_DITTO_EVENT,
      id: 'foreign-event',
      pubkey: 'someone-elses-pubkey',
    };

    const view = buildDimensionView(FIXTURE_PUBKEY, [
      ...FIXTURE_EVENTS,
      foreignEvent,
    ]);

    expect(view.feed.some((item) => item.id === 'foreign-event')).toBe(false);
  });

  it('returns undefined profile/seed/spec when no events exist yet', () => {
    const view = buildDimensionView(FIXTURE_PUBKEY, []);

    expect(view.profile).toBeUndefined();
    expect(view.seed).toBeUndefined();
    expect(view.spec).toBeUndefined();
    expect(view.feed).toEqual([]);
  });
});
