#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  assertBrainPlantProofSucceeded,
  runBrainPlantProof,
} from '../brain-plant-proof.js';
import type { BrainPlantProofReport } from '../brain-plant-proof.js';
import {
  ClaudeBrain,
  hasHeadlessClaudeCredentials,
  MAX_SPEC_ATTEMPTS,
} from '../claude-brain.js';
import { runHeadlessQuery } from '../headless-claude.js';
import type {
  HeadlessQuery,
  HeadlessQueryRequest,
  HeadlessQueryResult,
} from '../headless-claude.js';
import { InMemoryRelay } from '../fakes/in-memory-relay.js';

/**
 * The real-IO entry point `.github/workflows/brain-plant-proof.yml`
 * dispatches on a GitHub-hosted runner (fractal#9). Everything that can be
 * tested without a real model lives in `../brain-plant-proof.ts`
 * (plant-through-a-brain-port, read-back verification) and is covered there
 * against a `ScriptedBrain`; this file is intentionally thin glue — wiring
 * the real, credentialed `ClaudeBrain` (already used by `bin/fractal.ts`;
 * fractal#33), capturing its transcript, and printing the result — the same
 * split `devnet-proof.ts`/`bin/devnet-relay-proof.ts` already use for the
 * Relay port (CI stays model-free; only this file ever calls the real
 * model).
 *
 * The Relay port here is a plain in-memory fake, not a real network: the
 * Relay port's realness was already proven live by fractal#8/#32 — this
 * proof is scoped to the Brain port only, and reading its own writes back
 * through an in-memory relay is exactly as probative for that scope as
 * reading them back through a real one.
 *
 * Never import this module from anything that runs inside the sandcastle
 * sandbox: a credential that can spend real model tokens must reach only a
 * reviewed, committed workflow step on a GitHub-hosted runner
 * (`.sandcastle/sandbox-secrets.ts` forwards `CLAUDE_CODE_OAUTH_TOKEN` into
 * the sandbox only to authenticate the `claude-code` CLI that drives the
 * agent itself — never as a plain env var reachable by fractal's own code).
 */

const DEFAULT_UTTERANCE = 'build me a dimension of the indie game dev scene';
/** A well-known, public BIP-39 test mnemonic — safe to hardcode. No chain or funds are involved in this proof (see module doc); it exists only so `deriveDimensionIdentity` has something to derive from. */
const DEFAULT_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DEFAULT_INDEX = 0;

interface ProofConfig {
  readonly utterance: string;
  readonly mnemonic: string;
  readonly index: number;
  readonly apply: boolean;
  readonly model: string | undefined;
  readonly reportPath: string | undefined;
  readonly transcriptPath: string | undefined;
}

interface TranscriptEntry {
  readonly attempt: number;
  readonly prompt: string;
  readonly result: HeadlessQueryResult;
}

function parseNonNegativeInt(name: string, raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `fractal: ${name} must be a non-negative integer, got: ${raw}`
    );
  }
  return value;
}

function readConfig(): ProofConfig {
  return {
    utterance: process.env.FRACTAL_BRAIN_PROOF_UTTERANCE ?? DEFAULT_UTTERANCE,
    mnemonic: process.env.FRACTAL_BRAIN_PROOF_MNEMONIC ?? DEFAULT_MNEMONIC,
    index: parseNonNegativeInt(
      'FRACTAL_BRAIN_PROOF_INDEX',
      process.env.FRACTAL_BRAIN_PROOF_INDEX ?? String(DEFAULT_INDEX)
    ),
    apply: process.env.FRACTAL_BRAIN_PROOF_APPLY === 'true',
    model: process.env.FRACTAL_BRAIN_PROOF_MODEL || undefined,
    reportPath: process.env.FRACTAL_BRAIN_PROOF_REPORT_PATH,
    transcriptPath: process.env.FRACTAL_BRAIN_PROOF_TRANSCRIPT_PATH,
  };
}

/** Wraps the real `runHeadlessQuery` to record every compile attempt's prompt and raw result — the "transcript" fractal#9 asks be captured and linked from the docs. */
function capturingQuery(transcript: TranscriptEntry[]): HeadlessQuery {
  let attempt = 0;
  return async (request: HeadlessQueryRequest) => {
    attempt += 1;
    const result = await runHeadlessQuery(request);
    transcript.push({ attempt, prompt: request.prompt, result });
    return result;
  };
}

/** Dry run: reports whether credentials are present and what an apply run would do. Never calls the model. */
function dryRun(config: ProofConfig): void {
  console.log('## fractal brain plant proof — DRY RUN');
  console.log('');
  console.log(`Claude credentials present: ${hasHeadlessClaudeCredentials()}`);
  console.log(
    `A run with apply=true would plant the seed "${config.utterance}" at index ${config.index} through headless Claude (bounded to ${MAX_SPEC_ATTEMPTS} attempts), then verify the compiled spec validates and every planted event (profile/seed/spec) is readable back.`
  );
  console.log('');
  console.log('Nothing was sent. Re-run with apply: true to execute.');
}

function printReport(
  report: BrainPlantProofReport,
  transcript: readonly TranscriptEntry[]
): void {
  const lines = [
    '## fractal brain plant proof',
    '',
    '| | |',
    '|---|---|',
    `| npub | \`${report.npub}\` |`,
    `| pubkey | \`${report.pubkey}\` |`,
    `| index | ${report.index} |`,
    `| spec valid | ${report.specValid} |`,
    `| planted events verified | ${report.plantedEventsVerified} |`,
    `| compile attempts | ${transcript.length} (bound: ${MAX_SPEC_ATTEMPTS}) |`,
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
  ];
  const text = lines.join('\n');
  console.log(text);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, text + '\n');
  }
  if (report.npub) {
    console.log(
      `::notice title=fractal brain plant proof::npub=${report.npub}`
    );
  }
}

async function writeJsonFile(
  path: string | undefined,
  value: unknown
): Promise<void> {
  if (!path) {
    return;
  }
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main(): Promise<void> {
  const config = readConfig();

  if (!config.apply) {
    dryRun(config);
    return;
  }

  const transcript: TranscriptEntry[] = [];
  const brain = new ClaudeBrain({
    query: capturingQuery(transcript),
    model: config.model,
  });
  const relay = new InMemoryRelay();

  const report = await runBrainPlantProof(
    {
      mnemonic: config.mnemonic,
      index: config.index,
      utterance: config.utterance,
    },
    { relay, brain }
  );

  printReport(report, transcript);
  await writeJsonFile(config.reportPath, report);
  await writeJsonFile(config.transcriptPath, transcript);
  assertBrainPlantProofSucceeded(report);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
