import type { BelowPort } from './ports/below.js';
import type { RelayPort } from './ports/relay.js';
import type { BrainPort } from './ports/brain.js';

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
  _ports: Ports
): Promise<CommandResult> {
  const [command] = argv;

  if (command === '--version' || command === '-v') {
    return { exitCode: 0, stdout: `${CLI_VERSION}\n`, stderr: '' };
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `fractal: unknown command "${command ?? ''}"\n`,
  };
}
