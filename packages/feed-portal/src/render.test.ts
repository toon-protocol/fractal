import { describe, expect, it } from 'vitest';
import { buildDimensionView } from './feed-model.js';
import { renderDimensionView } from './render.js';
import {
  FIXTURE_DITTO_EVENT,
  FIXTURE_DITTO_EVENT_HOSTILE_RESOURCE,
  FIXTURE_DITTO_EVENT_MALFORMED_RESOURCE,
  FIXTURE_DITTO_EVENT_NO_PROVENANCE,
  FIXTURE_EVENTS,
  FIXTURE_INTERPRETATION_EVENT,
  FIXTURE_PUBKEY,
} from './fixtures.js';

function renderFixtureView(): HTMLElement {
  const container = document.createElement('div');
  const view = buildDimensionView(FIXTURE_PUBKEY, FIXTURE_EVENTS);
  renderDimensionView(container, view);
  return container;
}

describe('renderDimensionView', () => {
  it("renders the dimension's profile, seed, and spec", () => {
    const container = renderFixtureView();

    expect(container.textContent).toContain(
      'A dimension of the indie game dev scene'
    );
    expect(container.textContent).toContain(
      'build me a dimension of the indie game dev scene'
    );
    expect(container.textContent).toContain('hourly');
    expect(container.textContent).toContain('wss://relay.toon.social');
  });

  it('renders dittos and interpretation as structurally distinct event classes', () => {
    const container = renderFixtureView();

    const dittoEl = container.querySelector(
      `[data-event-id="${FIXTURE_DITTO_EVENT.id}"]`
    );
    const interpretationEl = container.querySelector(
      `[data-event-id="${FIXTURE_INTERPRETATION_EVENT.id}"]`
    );

    expect(dittoEl?.classList.contains('feed-item--ditto')).toBe(true);
    expect(
      interpretationEl?.classList.contains('feed-item--interpretation')
    ).toBe(true);
    expect(dittoEl?.classList.contains('feed-item--interpretation')).toBe(
      false
    );
    expect(interpretationEl?.classList.contains('feed-item--ditto')).toBe(
      false
    );
  });

  it("hides a ditto's provenance until the reveal control is used", () => {
    const container = renderFixtureView();
    const dittoEl = container.querySelector(
      `[data-event-id="${FIXTURE_DITTO_EVENT.id}"]`
    );
    const details = dittoEl?.querySelector<HTMLElement>('.provenance-details');

    expect(details?.hidden).toBe(true);
  });

  it('reveals source + resource link on demand when the provenance toggle is clicked', () => {
    const container = renderFixtureView();
    const dittoEl = container.querySelector(
      `[data-event-id="${FIXTURE_DITTO_EVENT.id}"]`
    );
    const toggle =
      dittoEl?.querySelector<HTMLButtonElement>('.provenance-toggle');

    toggle?.click();

    const details = dittoEl?.querySelector<HTMLElement>('.provenance-details');
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain('hn');
    expect(details?.querySelector('a')?.getAttribute('href')).toBe(
      'https://hn.example/top#0'
    );
  });

  it('renders a javascript: resource URL as plain text, never as a link', () => {
    const container = document.createElement('div');
    const view = buildDimensionView(FIXTURE_PUBKEY, [
      FIXTURE_DITTO_EVENT_HOSTILE_RESOURCE,
    ]);
    renderDimensionView(container, view);

    const details = container.querySelector<HTMLElement>('.provenance-details');
    expect(details?.querySelector('a')).toBeNull();
    expect(details?.textContent).toContain('javascript:alert(1)');
  });

  it('renders an unparseable resource URL as plain text, never as a link', () => {
    const container = document.createElement('div');
    const view = buildDimensionView(FIXTURE_PUBKEY, [
      FIXTURE_DITTO_EVENT_MALFORMED_RESOURCE,
    ]);
    renderDimensionView(container, view);

    const details = container.querySelector<HTMLElement>('.provenance-details');
    expect(details?.querySelector('a')).toBeNull();
    expect(details?.textContent).toContain('not a url');
  });

  it('renders no provenance toggle for a ditto with no provenance tags', () => {
    const container = renderFixtureView();
    const dittoEl = container.querySelector(
      `[data-event-id="${FIXTURE_DITTO_EVENT_NO_PROVENANCE.id}"]`
    );

    expect(dittoEl?.querySelector('.provenance-toggle')).toBeNull();
  });

  it('renders an empty feed without throwing when the dimension has no events yet', () => {
    const container = document.createElement('div');
    const view = buildDimensionView(FIXTURE_PUBKEY, []);

    expect(() => renderDimensionView(container, view)).not.toThrow();
    expect(container.querySelectorAll('.feed-item')).toHaveLength(0);
  });
});
