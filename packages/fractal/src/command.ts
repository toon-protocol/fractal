import type { BelowPort } from './ports/below.js';
import type { RelayPort } from './ports/relay.js';
import type { BrainPort } from './ports/brain.js';
import { plant } from './plant.js';
import type { PlantRequest } from './plant.js';
import { tick } from './tick.js';
import { interpret } from './interpret.js';
import { status } from './status.js';
import { amend } from './amend.js';
import type { DimensionSpec } from './domain/spec.js';

/**
 * Tracks packages/fractal/package.json's version — the CLI's own version
 * report, not a dimension's.
 */
export const CLI_VERSION = '0.0.0';

/**
 * The only way fractal commands reach the outside world. Every command is a
 * function of argv and these three ports, so tests can drive the CLI as a
 * black box with fakes injected here (CONTEXT.md — Hands; the founding
 * spec's "three ports isolate the outside world").
 */
export interface Ports {
  readonly below: BelowPort;
  readonly relay: RelayPort;
  readonly brain: BrainPort;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runCommand(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const [command, ...rest] = argv;

  if (command === '--version' || command === '-v') {
    return { exitCode: 0, stdout: `${CLI_VERSION}\n`, stderr: '' };
  }

  if (command === 'plant') {
    return runPlant(rest, ports);
  }

  if (command === 'tick') {
    return runTick(rest, ports);
  }

  if (command === 'interpret') {
    return runInterpret(rest, ports);
  }

  if (command === 'status') {
    return runStatus(rest, ports);
  }

  if (command === 'amend') {
    return runAmend(rest, ports);
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `fractal: unknown command "${command ?? ''}"\n`,
  };
}

type ParsedIndex =
  | { readonly ok: true; readonly index: number }
  | { readonly ok: false; readonly error: string };

/** Shared by every command that parses a `--index` value (plant, tick, status, ...). */
function parseIndexValue(
  raw: string | undefined,
  commandName: string
): ParsedIndex {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    return {
      ok: false,
      error: `fractal ${commandName}: --index must be a non-negative integer\n`,
    };
  }
  return { ok: true, index };
}

/** Last occurrence wins, matching argv convention for repeated flags. */
function findFlagValue(
  argv: readonly string[],
  flagName: string
): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flagName) {
      value = argv[i + 1];
    }
  }
  return value;
}

type ParsedMnemonicAndIndex =
  | { readonly ok: true; readonly mnemonic: string; readonly index: number }
  | { readonly ok: false; readonly error: string };

/** Shared by every command that acts on a dimension identity (plant, tick, ...). */
function parseMnemonicAndIndexFlags(
  flags: readonly string[],
  commandName: string
): ParsedMnemonicAndIndex {
  const mnemonic = findFlagValue(flags, '--mnemonic');
  const indexRaw = findFlagValue(flags, '--index');

  if (!mnemonic) {
    return {
      ok: false,
      error: `fractal ${commandName}: --mnemonic is required\n`,
    };
  }
  if (indexRaw === undefined) {
    return {
      ok: false,
      error: `fractal ${commandName}: --index is required\n`,
    };
  }
  const parsedIndex = parseIndexValue(indexRaw, commandName);
  if (!parsedIndex.ok) {
    return parsedIndex;
  }

  return { ok: true, mnemonic, index: parsedIndex.index };
}

type ParsedPlantArgs =
  | { readonly ok: true; readonly args: PlantRequest }
  | { readonly ok: false; readonly error: string };

function parsePlantArgv(argv: readonly string[]): ParsedPlantArgs {
  const [utterance, ...flags] = argv;
  if (!utterance) {
    return { ok: false, error: 'fractal plant: missing seed utterance\n' };
  }

  const parsed = parseMnemonicAndIndexFlags(flags, 'plant');
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    args: { utterance, mnemonic: parsed.mnemonic, index: parsed.index },
  };
}

/** Runs a command's ported action, formatting its stdout on success or its thrown error on failure. */
async function toCommandResult(
  action: () => Promise<string>
): Promise<CommandResult> {
  try {
    const stdout = await action();
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

async function runPlant(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parsePlantArgv(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  return toCommandResult(async () => {
    const result = await plant(parsed.args, ports);
    return `${result.npub}\n${JSON.stringify(result.spec, null, 2)}\n`;
  });
}

async function runTick(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parseMnemonicAndIndexFlags(argv, 'tick');
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  return toCommandResult(async () => {
    const result = await tick(
      { mnemonic: parsed.mnemonic, index: parsed.index },
      { below: ports.below, relay: ports.relay }
    );
    const summary = {
      published: result.published.length,
      feesPaid: result.feesPaid,
      budgetRemaining: result.budgetRemaining,
      kickedBack: result.kickedBack,
      withheld: result.withheld,
    };
    return `${result.npub}\n${JSON.stringify(summary, null, 2)}\n`;
  });
}

type ParsedAmendArgs =
  | {
      readonly ok: true;
      readonly mnemonic: string;
      readonly index: number;
      readonly spec: DimensionSpec;
    }
  | { readonly ok: false; readonly error: string };

function parseAmendArgv(argv: readonly string[]): ParsedAmendArgs {
  const parsed = parseMnemonicAndIndexFlags(argv, 'amend');
  if (!parsed.ok) {
    return parsed;
  }

  const specRaw = findFlagValue(argv, '--spec');
  if (specRaw === undefined) {
    return { ok: false, error: 'fractal amend: --spec is required\n' };
  }

  let spec: DimensionSpec;
  try {
    spec = JSON.parse(specRaw) as DimensionSpec;
  } catch {
    return { ok: false, error: 'fractal amend: --spec must be valid JSON\n' };
  }

  return { ok: true, mnemonic: parsed.mnemonic, index: parsed.index, spec };
}

async function runAmend(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parseAmendArgv(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  return toCommandResult(async () => {
    const result = await amend(
      { mnemonic: parsed.mnemonic, index: parsed.index, spec: parsed.spec },
      { relay: ports.relay }
    );
    return `${result.npub}\n${JSON.stringify(result.spec, null, 2)}\n`;
  });
}

async function runInterpret(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parseMnemonicAndIndexFlags(argv, 'interpret');
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  return toCommandResult(async () => {
    const result = await interpret(
      { mnemonic: parsed.mnemonic, index: parsed.index },
      { relay: ports.relay, brain: ports.brain }
    );
    const summary = {
      published: result.published.length,
      kickedBack: result.kickedBack,
    };
    return `${result.npub}\n${JSON.stringify(summary, null, 2)}\n`;
  });
}

type ParsedStatusArgs =
  | {
      readonly ok: true;
      readonly mnemonic: string;
      readonly indices: readonly number[];
    }
  | { readonly ok: false; readonly error: string };

/** `--index` may repeat — the operator's forest is every dimension index they name, zero or more. */
function parseStatusArgv(argv: readonly string[]): ParsedStatusArgs {
  let mnemonic: string | undefined;
  const indices: number[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mnemonic') {
      mnemonic = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--index') {
      const parsedIndex = parseIndexValue(argv[i + 1], 'status');
      if (!parsedIndex.ok) {
        return parsedIndex;
      }
      indices.push(parsedIndex.index);
      i += 1;
    }
  }

  if (!mnemonic) {
    return { ok: false, error: 'fractal status: --mnemonic is required\n' };
  }

  return { ok: true, mnemonic, indices };
}

async function runStatus(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parseStatusArgv(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  return toCommandResult(async () => {
    const dimensions = [];
    for (const index of parsed.indices) {
      dimensions.push(
        await status(
          { mnemonic: parsed.mnemonic, index },
          { relay: ports.relay }
        )
      );
    }
    return `${JSON.stringify(dimensions, null, 2)}\n`;
  });
}
