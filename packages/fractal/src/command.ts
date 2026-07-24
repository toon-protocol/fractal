import type { BelowPort } from './ports/below.js';
import type { RelayPort } from './ports/relay.js';
import type { BrainPort } from './ports/brain.js';
import { plant } from './plant.js';
import type { PlantRequest } from './plant.js';
import { tick } from './tick.js';

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

  return {
    exitCode: 1,
    stdout: '',
    stderr: `fractal: unknown command "${command ?? ''}"\n`,
  };
}

type ParsedMnemonicAndIndex =
  | { readonly ok: true; readonly mnemonic: string; readonly index: number }
  | { readonly ok: false; readonly error: string };

/** Shared by every command that acts on a dimension identity (plant, tick, ...). */
function parseMnemonicAndIndexFlags(
  flags: readonly string[],
  commandName: string
): ParsedMnemonicAndIndex {
  let mnemonic: string | undefined;
  let indexRaw: string | undefined;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === '--mnemonic') {
      mnemonic = flags[i + 1];
      i += 1;
    } else if (flags[i] === '--index') {
      indexRaw = flags[i + 1];
      i += 1;
    }
  }

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
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0) {
    return {
      ok: false,
      error: `fractal ${commandName}: --index must be a non-negative integer\n`,
    };
  }

  return { ok: true, mnemonic, index };
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

async function runPlant(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parsePlantArgv(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  try {
    const result = await plant(parsed.args, ports);
    const stdout = `${result.npub}\n${JSON.stringify(result.spec, null, 2)}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

async function runTick(
  argv: readonly string[],
  ports: Ports
): Promise<CommandResult> {
  const parsed = parseMnemonicAndIndexFlags(argv, 'tick');
  if (!parsed.ok) {
    return { exitCode: 1, stdout: '', stderr: parsed.error };
  }

  try {
    const result = await tick(
      { mnemonic: parsed.mnemonic, index: parsed.index },
      { below: ports.below, relay: ports.relay }
    );
    const summary = {
      published: result.published.length,
      kickedBack: result.kickedBack,
    };
    const stdout = `${result.npub}\n${JSON.stringify(summary, null, 2)}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
