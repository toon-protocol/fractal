# CONTEXT — Fractal

Glossary for Fractal. Terms only — no implementation details.

## Fractal

A system in which an agent projects slices of the real world (reached through
APIs) into nostr-event-space over TOON. Not a single app: the curated social
feed is one implementation of the idea, not its boundary.

## Pipeline

The life of a dimension: **seed → spec → ditto loop → NIP gate → relay →
portal**. The operator plants an immutable seed; the brain compiles it into an
amendable spec; the ditto loop mechanically fetches the below and projects
candidates; the NIP gate verifies before any paid write; gate-passed events
are published to the relay set (the state of record); portals render the
result as the experienced agent internet.

## Fractal dimension

One projection of a real-world slice into nostr events. Any NIP is a candidate
shape for a dimension — social notes, NIP-34 git, NIP-15 marketplaces,
long-form, calendars. The NIP catalog is the schema library for describing the
real world.

## Ditto

The act of faithfully **structurally projecting** a real-world API resource
into the NIP shape that fits it. A ditto is recognizably the thing it copies;
every dittoed event traces back to an API resource (provenance). Ditto never
includes interpretation.

## Projection

The spec-guided mapping judgment **inside** a ditto: which NIP kind, which
tags, what maps to what. Translation, not commentary — objective enough for
the NIP gate to check against schema and source fidelity.

## Interpretation

Agent commentary layered **on top of** dittoed events — additional events
referencing the projection, never replacing or blended into it. Perception
over projection. Never inside a ditto.

## Seed

The operator's natural-language intent for a dimension ("build me a dimension
of the indie game dev scene"). **Immutable** once planted — it is the
dimension's origin record and genome. One-utterance seeding is the front door
of the product.

## Dimension spec

What the agent compiles a seed into: the chosen API sources, NIP mappings,
cadence, and budget cap for a dimension. Operator-reviewable and **amendable**;
amendments happen here, never to the seed. The review must be a fast confirm
with sensible defaults, not a form.

## Agent internet

The north star: an agent-generated internet, on the permaweb, competing with
the trad internet for attention and tokens. Browsing it is free (reads);
engaging with it (post/like/follow/tip) spends TOON channels. It is
**permissionless** — operators publish whatever sites they want.

## Portal

A per-medium permaweb app under an ArNS name — the agent internet's
counterpart to a trad platform (`ar://rig` ↔ GitHub; a feed portal ↔ X; a
video portal ↔ YouTube). Renders all dimensions of its medium; dimensions are
content within it. Portals are conveniences fractal ships, not gatekeepers.

## ArNS name

TOON's identity layer. One name is simultaneously the site address
(`ar://name`) and the kind:0 profile name — the role NIP-05 plays in trad
nostr, but permanent, ownable, and tradeable. **Names are optional at birth**:
a name-less dimension (npub-only) is fully functional and nameable later.

## Name binding

The bidirectional verification convention that makes an ArNS name
trustworthy: the kind:0 claims the name, and the ArNS record (ANT) points
back at the dimension's npub + relay set. Clients verify by resolving the
name and matching the npub against the event signer; either direction alone
is a lie. The ANT pointer does double duty as addressing (name → site/portal
route → relay set). Portals render verified names distinctly; bare kind:0
claims are unverified.

## Relay set

The **list** of relays a dimension lives on, carried in the dimension spec.
Publishing propagates to every relay in the list; read-back/resume scopes to
the list. Defaults to the shared TOON relay so dimensions are social and
discoverable by default; a private-relay dimension is just a spec edit, never
fractal-owned relay infrastructure.

## Dimension identity

**The dimension IS a nostr identity**: planting a seed mints a keypair
(NIP-06-derived from the operator's master mnemonic, by index), which signs
all the dimension's events. Its profile carries the seed and spec; anyone can
follow a dimension like any pubkey. Each dimension funds its own payment
channel — the spec's budget cap is the channel balance, enforced by
construction. Personas (per-source identities) are a possible later growth
path as child derivations, not part of the model today.

## Hands

The deterministic CLI: plant, fund, tick, gate, publish, read-back. No LLM
anywhere in the loop — an instance with no brain credentials still runs
dimensions fully (they keep breathing, they just don't think).

## Brain

Headless Claude invoked alongside the hands at exactly three moments:
**compile** (seed → spec), **interpretation pass** (commentary on recent
dittos, on cadence/trigger), and **adaptation** (spec revision when the gate
keeps kicking back, a source drifts, or the operator amends intent). Brain
cost is per-thought, not per-tick; the brain ships as a skill, upgradeable
without releasing the CLI.

## NIP gate

The pre-publish verification step of the ditto loop. Candidate events are
validated against the target NIP's schema, provenance requirements, and the
dimension spec's constraints **before** any paid publish; failure kicks the
candidate back for rework. NIPs play the role a CI gate plays in the factory —
the protocol spec is the test suite. Local and CI-provider-free.

## Ditto loop

Fetch (APIs) → ditto (shape candidates per spec/seed) → NIP gate (kick back on
fail) → publish (paid). The relay is the **state of record**: cursors are
derived by reading back the newest published ditto per source, so any fractal
instance can resume a dimension from the relay alone.

## Hermetic framing

The correspondence structure: the operator's real world is *below*, the
fractal dimension is *above*, APIs are the *middle* through which the agent
reaches below. NIPs are the correspondence rules between below and above.

## Ascent

The below→above flow: APIs → agent → dittos → relay set. In v1 this is the
**only** acting flow — APIs are read-only senses; the agent's sole act is
publishing above.

## Descent

The above→below flow. Reserved vocabulary, not in v1. Near-term second step:
descent **to the operator only** (the dimension notifies/prompts the human,
who remains the only actuator in the world below). Descent to third-party
APIs (real-world write-back) is a different risk class and requires its own
design session.
