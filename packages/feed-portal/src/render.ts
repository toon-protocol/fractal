import type {
  DimensionView,
  DittoItem,
  FeedItem,
  InterpretationItem,
} from './feed-model.js';
import type { DimensionSpec } from '@toon-protocol/fractal/domain';

function appendField(dl: HTMLDListElement, label: string, value: string): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderSpec(spec: DimensionSpec): HTMLDListElement {
  const dl = document.createElement('dl');
  dl.className = 'dimension-spec';
  appendField(
    dl,
    'Sources',
    spec.sources.map((source) => source.id).join(', ')
  );
  appendField(dl, 'Cadence', spec.cadence);
  appendField(dl, 'Budget cap', String(spec.budgetCap));
  appendField(dl, 'Relay set', spec.relaySet.join(', '));
  return dl;
}

function renderHeader(view: DimensionView): HTMLElement {
  const header = document.createElement('section');
  header.className = 'dimension-header';

  const heading = document.createElement('h1');
  heading.textContent = view.profile?.about ?? view.pubkey;
  header.appendChild(heading);

  if (view.seed) {
    const seedEl = document.createElement('p');
    seedEl.className = 'dimension-seed';
    seedEl.textContent = view.seed.utterance;
    header.appendChild(seedEl);
  }

  if (view.spec) {
    header.appendChild(renderSpec(view.spec));
  }

  return header;
}

/**
 * A ditto's `resource` tag is untrusted relay data — any pubkey can publish
 * an event whose resource is a `javascript:` URL, and the agent internet is
 * permissionless, so hostile content is this renderer's expected input
 * (CONTEXT.md — Agent internet). Only http(s) resources become clickable;
 * everything else renders as plain text.
 */
function isLinkableResourceUrl(resourceUrl: string): boolean {
  try {
    const { protocol } = new URL(resourceUrl);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function renderResource(resourceUrl: string): HTMLElement {
  if (!isLinkableResourceUrl(resourceUrl)) {
    const text = document.createElement('span');
    text.className = 'provenance-resource';
    text.textContent = resourceUrl;
    return text;
  }
  const link = document.createElement('a');
  link.className = 'provenance-resource';
  link.href = resourceUrl;
  link.textContent = resourceUrl;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  return link;
}

/**
 * Provenance is disclosed on demand, not printed inline — the feed reads as
 * a feed by default, and any ditto still reveals its below-source with one
 * click (CONTEXT.md — Ditto, "provenance on demand").
 */
function renderProvenanceDisclosure(item: DittoItem): HTMLElement | undefined {
  if (!item.provenance) {
    return undefined;
  }
  const { sourceId, resourceUrl } = item.provenance;

  const wrapper = document.createElement('div');
  wrapper.className = 'provenance';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'provenance-toggle';
  toggle.textContent = 'Show provenance';

  const details = document.createElement('div');
  details.className = 'provenance-details';
  details.hidden = true;

  const source = document.createElement('span');
  source.className = 'provenance-source';
  source.textContent = `Source: ${sourceId}`;

  details.append(source, renderResource(resourceUrl));

  toggle.addEventListener('click', () => {
    details.hidden = !details.hidden;
    toggle.textContent = details.hidden ? 'Show provenance' : 'Hide provenance';
  });

  wrapper.append(toggle, details);
  return wrapper;
}

function renderDitto(item: DittoItem): HTMLElement {
  const li = document.createElement('li');
  li.className = 'feed-item feed-item--ditto';
  li.dataset.eventId = item.id;

  const content = document.createElement('p');
  content.className = 'feed-item-content';
  content.textContent = item.content;
  li.appendChild(content);

  const disclosure = renderProvenanceDisclosure(item);
  if (disclosure) {
    li.appendChild(disclosure);
  }

  return li;
}

function renderInterpretation(item: InterpretationItem): HTMLElement {
  const li = document.createElement('li');
  li.className = 'feed-item feed-item--interpretation';
  li.dataset.eventId = item.id;

  const badge = document.createElement('span');
  badge.className = 'interpretation-badge';
  badge.textContent = 'Interpretation';
  li.appendChild(badge);

  const content = document.createElement('p');
  content.className = 'feed-item-content';
  content.textContent = item.content;
  li.appendChild(content);

  const refs = document.createElement('p');
  refs.className = 'interpretation-refs';
  refs.textContent = `Commentary on ${item.referencedDittoIds.length} ditto(s)`;
  li.appendChild(refs);

  return li;
}

function renderFeedItem(item: FeedItem): HTMLElement {
  return item.type === 'ditto' ? renderDitto(item) : renderInterpretation(item);
}

function renderFeed(feed: readonly FeedItem[]): HTMLOListElement {
  const list = document.createElement('ol');
  list.className = 'feed';
  for (const item of feed) {
    list.appendChild(renderFeedItem(item));
  }
  return list;
}

/**
 * Renders a dimension's portal view into `container` — the full skeleton:
 * profile/seed/spec viewable at the top, then the feed with dittos and
 * interpretation kept as structurally distinct elements
 * (CONTEXT.md — Ditto, Interpretation, Portal).
 */
export function renderDimensionView(
  container: HTMLElement,
  view: DimensionView
): void {
  container.innerHTML = '';
  container.appendChild(renderHeader(view));
  container.appendChild(renderFeed(view.feed));
}
