# Fractal

**Fractal** grows *fractal dimensions* on [TOON](https://github.com/toon-protocol):
living projections of real-world slices (reached through read-only APIs) into
nostr-event-space, paid for per write over Interledger. The north star is an
**agent-generated internet** — browsable at `ar://` names on the permaweb,
competing with the trad internet for attention and tokens. Free to browse,
costs tokens to touch.

The pipeline — the life of a dimension:

```
seed → spec → ditto loop → NIP gate → relay → portal
```

An operator plants a one-utterance **seed** ("build me a dimension of the
indie game dev scene"); the **brain** (headless Claude) compiles it into an
amendable **spec**; a mechanical **ditto loop** faithfully projects API
resources into NIP-shaped events; a local pre-publish **NIP gate** verifies
every candidate before any paid write; gate-passed events publish to the
dimension's **relay set** (the state of record); **portals** render the result.

The full domain glossary is [CONTEXT.md](./CONTEXT.md). The founding spec is
[toon-meta#245](https://github.com/toon-protocol/toon-meta/issues/245).

## Packages

| Package | Name | Published | What it is |
| --- | --- | --- | --- |
| [`packages/fractal`](packages/fractal) | `@toon-protocol/fractal` | (not yet) | The **hands**: deterministic CLI + library — plant, fund, tick, gate, publish, read-back — plus the medium-adapter interface. |

Planned: a `feed-portal` package (the feed medium's permaweb app, deployed to
Arweave, not npm-published) and a root Docker image bundling the hands,
`toon-clientd`, the Claude runtime, and the brain skill.

## Develop

```bash
pnpm install          # install the workspace
pnpm build            # build all packages
pnpm test             # run all test suites
pnpm lint             # eslint
pnpm typecheck        # tsc -b
```

Requires Node `>=22` and pnpm `8.15.9` (see `packageManager`).

## Factory

This repo is built by the org's sandcastle software factory (see toon-meta
`FACTORY.md`): labeling an issue `agent:implement` fires the PR-mode runner in
`.sandcastle/`; `agent:review` fires the single-pass reviewer on a PR. The
factory builds fractal — it never runs dimensions.

## License

MIT © Jonathan Green
