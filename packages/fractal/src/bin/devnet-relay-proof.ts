#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { SimplePool } from 'nostr-tools/pool';
import { ToonClient, fundWallet } from '@toon-protocol/client';
import { encodeEventToToon, decodeEventFromToon } from '@toon-protocol/relay';
import {
  assertProofSucceeded,
  buildProofFixtures,
  PROOF_SOURCE,
  runDevnetProof,
} from '../devnet-proof.js';
import type { DevnetProofReport } from '../devnet-proof.js';
import { dittoedResourceUrls } from '../relay-reads.js';
import { deriveDimensionIdentity } from '../identity.js';
import { FixtureBelow } from '../fakes/fixture-below.js';
import { ToonRelay } from '../toon-relay.js';
import { SEED_EVENT_KIND } from '../plant.js';

/**
 * The real-IO entry point `.github/workflows/devnet-relay-proof.yml`
 * dispatches on a GitHub-hosted runner. Everything that can be tested
 * without a network lives in `../devnet-proof.ts` (plant-if-needed, tick,
 * read-back verification, fee reconciliation) and is covered there; this
 * file is intentionally thin glue — deriving the identity, wiring the real
 * `ToonClient`/`SimplePool` pair, and printing the result — the same split
 * `toon-relay.ts` and `headless-claude.ts` already use (CI stays
 * network-free; only this file ever touches the real client).
 *
 * Never import this module from anything that runs inside the sandcastle
 * sandbox: `E2E_DEV_MNEMONIC` must reach only a reviewed, committed workflow
 * step on a GitHub-hosted runner (`.sandcastle/sandbox-secrets.ts`).
 */

const DEVNET_RELAY_URL = 'wss://relay-ws.devnet.toonprotocol.dev';
const DEVNET_PROXY_URL = 'https://proxy.devnet.toonprotocol.dev';
const DEVNET_FAUCET_URL = 'https://faucet.devnet.toonprotocol.dev';
const DEFAULT_UTTERANCE =
  'fractal devnet relay proof — plant + tick over a real funded channel';
/** 0.1 USDC at 6dp — a deliberately small top-up target; raise via FRACTAL_DEVNET_BUDGET_CAP. */
const DEFAULT_BUDGET_CAP = 100_000;
/** 0.001 USDC at 6dp per published event — a placeholder; verify against the devnet apex's actual pricing before relying on it (see the workflow's header notes). */
const DEFAULT_PRICE_PER_EVENT = 1_000n;

interface ProofConfig {
  readonly mnemonic: string;
  readonly index: number;
  readonly utterance: string;
  readonly apply: boolean;
  readonly relaySet: readonly string[];
  readonly proxyUrl: string;
  readonly faucetUrl: string;
  readonly budgetCap: number;
  readonly pricePerEvent: bigint;
  readonly fundFromFaucet: boolean;
  readonly reportPath: string | undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`fractal: ${name} is required and was not set`);
  }
  return value;
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

function parsePositiveBigInt(name: string, raw: string): bigint {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new Error(`fractal: ${name} must be an integer, got: ${raw}`);
  }
  if (value <= 0n) {
    throw new Error(`fractal: ${name} must be positive, got: ${raw}`);
  }
  return value;
}

function readConfig(): ProofConfig {
  const mnemonic = requireEnv('E2E_DEV_MNEMONIC');
  // `::add-mask::` is a GitHub Actions workflow command — the runner consumes
  // the line and masks the value from every later log line. Anywhere else it
  // is just a print of the phrase itself, so it is emitted only on a runner.
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log('::add-mask::' + mnemonic);
  }

  const relaySetRaw = process.env.FRACTAL_DEVNET_RELAY_SET;
  const relaySet = relaySetRaw
    ? relaySetRaw.split(',').map((url) => url.trim())
    : [DEVNET_RELAY_URL];

  return {
    mnemonic,
    index: parseNonNegativeInt(
      'FRACTAL_DEVNET_INDEX',
      process.env.FRACTAL_DEVNET_INDEX ?? '0'
    ),
    utterance: process.env.FRACTAL_DEVNET_UTTERANCE ?? DEFAULT_UTTERANCE,
    apply: process.env.FRACTAL_DEVNET_APPLY === 'true',
    relaySet,
    proxyUrl: process.env.FRACTAL_DEVNET_PROXY_URL ?? DEVNET_PROXY_URL,
    faucetUrl: process.env.FRACTAL_DEVNET_FAUCET_URL ?? DEVNET_FAUCET_URL,
    budgetCap: parseNonNegativeInt(
      'FRACTAL_DEVNET_BUDGET_CAP',
      process.env.FRACTAL_DEVNET_BUDGET_CAP ?? String(DEFAULT_BUDGET_CAP)
    ),
    pricePerEvent: parsePositiveBigInt(
      'FRACTAL_DEVNET_PRICE_PER_EVENT',
      process.env.FRACTAL_DEVNET_PRICE_PER_EVENT ??
        String(DEFAULT_PRICE_PER_EVENT)
    ),
    fundFromFaucet: process.env.FRACTAL_DEVNET_FUND_FROM_FAUCET !== 'false',
    reportPath: process.env.FRACTAL_DEVNET_REPORT_PATH,
  };
}

/** Dry run: reads whether this index is already planted, over a read-only nostr pool. Never constructs a `ToonClient` and never spends. */
async function dryRun(config: ProofConfig, pubkey: string): Promise<void> {
  const pool = new SimplePool();
  try {
    const seedEvents = await pool.querySync([...config.relaySet], {
      authors: [pubkey],
      kinds: [SEED_EVENT_KIND],
      limit: 1,
    });
    console.log('## fractal devnet relay proof — DRY RUN');
    console.log('');
    console.log(
      `Dimension index ${config.index} is ${seedEvents.length > 0 ? 'ALREADY PLANTED' : 'NOT YET PLANTED'}.`
    );
    console.log(
      seedEvents.length > 0
        ? 'A run with apply=true would reuse it and tick — no new channel would be opened.'
        : `A run with apply=true would plant it (seed: "${config.utterance}"), fund its channel to >= ${config.budgetCap} base units, then tick.`
    );
    console.log('');
    console.log('Nothing was sent. Re-run with apply: true to execute.');
  } finally {
    pool.close([...config.relaySet]);
  }
}

function printReport(report: DevnetProofReport): void {
  const lines = [
    '## fractal devnet relay proof',
    '',
    '| | |',
    '|---|---|',
    `| npub | \`${report.npub}\` |`,
    `| pubkey | \`${report.pubkey}\` |`,
    `| index | ${report.index} |`,
    `| planted this run | ${report.plantedNow} |`,
    `| planted events verified | ${report.plantedEventsVerified} |`,
    `| dittos published | ${report.publishedDittoIds.length} |`,
    `| ditto read-back verified | ${report.dittoReadBackVerified} |`,
    `| tick report published | ${report.reportPublished} |`,
    `| fees paid this tick | ${report.feesPaidThisTick} |`,
    `| channel spend before | ${report.channelSpendBefore ?? 'n/a'} |`,
    `| channel spend after | ${report.channelSpendAfter ?? 'n/a'} |`,
    `| budget cap | ${report.budgetCap} |`,
    `| budget remaining | ${report.budgetRemaining} |`,
    `| reconciled | ${report.reconciled} |`,
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
    console.log(`::notice title=fractal devnet proof::npub=${report.npub}`);
  }
}

async function writeReportFile(
  path: string | undefined,
  report: DevnetProofReport
): Promise<void> {
  if (!path) {
    return;
  }
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function main(): Promise<void> {
  const config = readConfig();
  const identity = deriveDimensionIdentity(config.mnemonic, config.index);
  console.error(
    `fractal devnet relay proof — index ${config.index}, pubkey ${identity.pubkey}, npub ${identity.npub}, apply=${config.apply}`
  );

  if (!config.apply) {
    await dryRun(config, identity.pubkey);
    return;
  }

  const client = new ToonClient({
    network: 'devnet',
    mnemonic: config.mnemonic,
    mnemonicAccountIndex: config.index,
    proxyUrl: config.proxyUrl,
    faucetUrl: config.faucetUrl,
    relayUrl: config.relaySet[0],
    ilpInfo: {
      pubkey: identity.pubkey,
      ilpAddress: `g.toon.fractal.${identity.pubkey.slice(0, 16)}`,
      // Only consulted if a duplex BTP session is ever negotiated; `proxyUrl`
      // selects the stateless one-shot HTTP transport for this run instead
      // (`selectIlpTransport` in @toon-protocol/client). Kept as a
      // structurally-valid placeholder because `IlpPeerInfo.btpEndpoint` is
      // a required field regardless of which transport actually gets used.
      btpEndpoint: config.relaySet[0] ?? DEVNET_RELAY_URL,
      // USDC, 6 decimal places — the devnet apex's settlement asset (matches
      // `DECIMALS`/`TOKEN` in connector's funded-ops.yml, the same devnet).
      assetCode: 'USD',
      assetScale: 6,
    },
    toonEncoder: encodeEventToToon,
    toonDecoder: decodeEventFromToon,
    // Pinned rather than left to the client's own default (also '0'): the
    // channel this run opens is funded EXCLUSIVELY by `ToonRelay.fundChannel`
    // below, to one audited target (FRACTAL_DEVNET_BUDGET_CAP), so every base
    // unit that moves is accounted for by this script rather than by a
    // channel-open default that a client upgrade could change underneath it.
    initialDeposit: '0',
  });

  await client.start();
  const readClient = new SimplePool();
  try {
    if (config.fundFromFaucet) {
      const evmAddress = client.getEvmAddress();
      if (evmAddress) {
        try {
          const result = await fundWallet(config.faucetUrl, evmAddress, 'evm');
          console.error(
            `fractal: faucet drip requested for ${evmAddress}: ${JSON.stringify(result.response)}`
          );
        } catch (error) {
          console.error(
            `fractal: faucet drip failed (continuing — the account may already hold funds): ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    const relay = new ToonRelay({
      publishClient: client,
      readClient,
      relayUrls: config.relaySet,
      pricePerEvent: config.pricePerEvent,
    });
    // The same cursor `tick` consults: which fixture positions prior runs
    // already dittoed. Building this run's fixture from it guarantees one
    // fresh, run-stamped item — so a re-dispatch against an already-planted
    // index still performs (and verifies) a real paid publish instead of
    // passing vacuously with nothing to do.
    const alreadyDittoed = await dittoedResourceUrls(
      relay,
      identity.pubkey,
      PROOF_SOURCE.id
    );
    const runStamp = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
      : new Date().toISOString();
    const below = new FixtureBelow({
      fixtures: buildProofFixtures(alreadyDittoed, runStamp),
    });

    const report = await runDevnetProof(
      {
        mnemonic: config.mnemonic,
        index: config.index,
        utterance: config.utterance,
        relaySet: config.relaySet,
        budgetCap: config.budgetCap,
      },
      { relay, below }
    );

    printReport(report);
    await writeReportFile(config.reportPath, report);
    assertProofSucceeded(report);
  } finally {
    readClient.close([...config.relaySet]);
    await client.stop();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
