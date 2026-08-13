# Devnet relay proof

Proves the real Relay port (fractal#32's `ToonRelay`) against the live TOON
devnet: a real funded payment channel, a real paid publish, a real free
read-back — not the mocks `toon-relay.test.ts` runs in CI. This is
fractal#8's acceptance criteria, made repeatable by construction rather than
by a written procedure a person has to follow correctly.

## Why a workflow, not a CLI command you run locally

Proving this needs a mnemonic that can sign and pay on devnet
(`E2E_DEV_MNEMONIC` — the same shared devnet-scoped secret used by
`toon-protocol/connector`'s `funded-ops.yml`/`fleet-ops.yml`). That secret
never reaches the sandcastle agent sandbox
(`.sandcastle/sandbox-secrets.ts` forwards only two unrelated tokens) and
never should — it derives keys on every chain and this repo is public. It
lives only in this GitHub Actions secret, consumed only by
[`.github/workflows/devnet-relay-proof.yml`](../.github/workflows/devnet-relay-proof.yml)
running on a GitHub-hosted runner. An agent can *dispatch* the workflow and
read its result back; it can never hold the mnemonic itself.

## What actually runs

- [`packages/fractal/src/devnet-proof.ts`](../packages/fractal/src/devnet-proof.ts)
  — the orchestration: derive the dimension identity, plant it if it isn't
  already living (an explicit spec is always supplied, so the Brain port is
  never touched), tick it once against a fixed fixture source, then verify
  every published event is independently visible back through `readBack`,
  and reconcile the channel's real live claim (`channelSpend`) against the
  tick's self-reported fees. This half is network-free and fully covered by
  `devnet-proof.test.ts` against in-memory fakes.
- [`packages/fractal/src/bin/devnet-relay-proof.ts`](../packages/fractal/src/bin/devnet-relay-proof.ts)
  — thin real-IO glue: reads config from the environment, wires a real
  `ToonClient` (`network: 'devnet'`) and a real nostr `SimplePool`, and calls
  the above. This is the only file in the repo that ever touches the live
  client.

The ditto loop runs against a fixed, deterministic two-item fixture
(`PROOF_SOURCE` / `PROOF_FIXTURE_PAYLOAD` in `devnet-proof.ts`), not a live
API — no real Below port exists in this repo yet, and this proof is scoped
to the Relay port only. A fresh dimension index always dittos the exact same
two events, so a re-run is directly comparable to the last one.

## Dispatching it

From the Actions tab (or `gh workflow run devnet-relay-proof.yml -f apply=true ...`):

| Input | Meaning |
| --- | --- |
| `apply` | **Defaults to `false`.** A dry run only checks (via a free nostr read) whether `account_index` is already planted, and prints what an apply run would do. Nothing is sent. |
| `account_index` | The NIP-06 dimension index to plant or reuse. Pick a fresh one to plant a new dimension; reuse an existing one to avoid opening a new channel. |
| `utterance` | The seed, only used if the index isn't already planted. |
| `relay_set` | Comma-separated relay URLs. Defaults to the public devnet relay. |
| `budget_cap_base_units` | Absolute channel deposit **target** (6dp USDC base units). `fundChannel` tops up to at least this — never an increment — so re-dispatching against the same index is a safe no-op once the channel already holds that much. |
| `price_per_event_base_units` | ILP amount offered per published event. The default is a placeholder — verify it against the devnet apex's actual pricing; the reconciliation check stays meaningful regardless, since it compares the channel's own real claim against the tick's own reported fee, not against this constant. |
| `fund_from_faucet` | Best-effort drip of devnet USDC to the dimension's EVM address before funding the channel (`apply` only; failures are logged, not fatal — the account may already hold funds). |

An `apply: true` run that succeeds:

1. Uploads a `devnet-relay-proof-report-<index>` artifact — the full JSON
   report (npub, published event ids, fee/budget reconciliation).
2. Writes the same report as the job's step summary.
3. Fails the job (`assertProofSucceeded`) if any published event wasn't
   independently visible on read-back, or if the channel's live claim didn't
   reconcile against the tick's reported fees.

## Recording a run

Once a real `apply: true` run has succeeded, record it here so the proof is
legible without re-opening the workflow run:

| Date | npub | Dimension index | Dittos published | Reconciled | Run |
| --- | --- | --- | --- | --- | --- |
| _(none yet — add a row after the first successful `apply: true` dispatch)_ | | | | | |
