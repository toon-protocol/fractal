# Brain plant proof

Proves the real Brain port (fractal#33's `ClaudeBrain`) against a live model:
one operator utterance compiled into a validated spec through headless Claude
by the same `plant` use case `fractal plant "<seed>"` invokes — not the
`ScriptedBrain` `claude-brain.test.ts` runs in CI. This is fractal#9's
acceptance criteria, made repeatable by construction rather than by a written
procedure a person has to follow correctly.

## Why a workflow, not a CLI command you run locally

Proving this needs a credential that can spend real model tokens
(`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — the same credential
`agent-implement.yml` already uses to drive `claude-code`). That credential
never reaches the sandcastle agent sandbox as a plain env var fractal's own
code could read (`.sandcastle/sandbox-secrets.ts` forwards
`CLAUDE_CODE_OAUTH_TOKEN` only to authenticate the `claude-code` CLI driving
the agent itself) and never should. It lives only in GitHub Actions secrets,
consumed only by
[`.github/workflows/brain-plant-proof.yml`](../.github/workflows/brain-plant-proof.yml)
running on a GitHub-hosted runner. An agent can *dispatch* the workflow and
read its result back; it can never hold the credential itself.

## What actually runs

- [`packages/fractal/src/brain-plant-proof.ts`](../packages/fractal/src/brain-plant-proof.ts)
  — the orchestration: derive the dimension identity, refuse to run against
  an already-planted index, `plant()` the seed through the given Brain port,
  re-validate the resulting spec independently of `plant`'s own internal
  check, then verify every planted event (profile/seed/spec) is
  independently visible back through `readBack` — catching a half-plant
  fractal#33 was built to make impossible. This half is model-free and fully
  covered by `brain-plant-proof.test.ts` against a `ScriptedBrain`.
- [`packages/fractal/src/bin/brain-plant-proof.ts`](../packages/fractal/src/bin/brain-plant-proof.ts)
  — thin real-IO glue: reads config from the environment, wires the real,
  credentialed `ClaudeBrain` (the same class `bin/fractal.ts` wires for live
  use) with a transcript-capturing query wrapper, and calls the above. This
  is the only file in the repo that ever calls the real model.

The Relay port used here is a plain in-memory fake, not a real network: the
Relay port's realness was already proven live by
[`devnet-relay-proof.md`](./devnet-relay-proof.md) (fractal#8/#32), and this
proof is scoped to the Brain port only — reading its own writes back through
an in-memory relay is exactly as probative for that scope as a real one, and
it means this workflow needs no funded devnet channel or `E2E_DEV_MNEMONIC`.

## Dispatching it

From the Actions tab (or `gh workflow run brain-plant-proof.yml -f apply=true ...`):

| Input | Meaning |
| --- | --- |
| `apply` | **Defaults to `false`.** A dry run reports only whether a Claude credential is present in the environment and what an apply run would do. The model is never called. |
| `utterance` | The one-utterance seed compiled via headless Claude. |
| `account_index` | The NIP-06 index the dimension's key is derived at. No chain is touched by this proof — pick any value; a fresh in-memory relay backs every dispatch, so the same index can be reused freely across runs. |
| `model` | Optional model override for the headless Claude call. Leave blank for the SDK default. |

An `apply: true` run that succeeds:

1. Uploads a `brain-plant-proof-<index>` artifact containing the JSON report
   (npub, whether the compiled spec validated, whether every planted event
   was readable back) **and** the transcript — every compile attempt's
   prompt and raw headless-Claude result, in order.
2. Writes the report as the job's step summary.
3. Fails the job (`assertBrainPlantProofSucceeded`) if the compiled spec did
   not validate, or if the profile/seed/spec events were not all
   independently visible on read-back.

## Comparing against fractal#33's scripted assumptions

`claude-brain.test.ts` scripts four failure shapes for the bounded-retry
loop: an invalid spec is kicked back with `spec:<validation reason>`,
unparseable model output with `json:unparseable-response`, a query-level
failure with `query:<error>`, and persistent failure gives up after exactly
`MAX_SPEC_ATTEMPTS` (3) attempts. After a real `apply: true` run, download
its transcript artifact and check whether the real model's behaviour matches:
does it ever wrap JSON in markdown fences despite the prompt's "no markdown
fences" instruction, produce a technically-valid-JSON-but-schema-invalid
reply the scripted tests didn't anticipate, or take more than one attempt in
practice? File any divergence you observe as a follow-up issue referencing
this doc and fractal#33, and note it in the run table below.

## Recording a run

Once a real `apply: true` run has succeeded, record it here so the proof is
legible without re-opening the workflow run:

| Date | npub | Compile attempts | Spec valid | Divergences from fractal#33's scripted assumptions | Run |
| --- | --- | --- | --- | --- | --- |
| _(none yet — add a row after the first successful `apply: true` dispatch)_ | | | | | |
