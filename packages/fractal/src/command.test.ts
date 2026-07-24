import { describe, expect, it } from 'vitest';
import { runCommand, CLI_VERSION } from './command.js';
import type { Ports } from './command.js';
import { FixtureBelow } from './fakes/fixture-below.js';
import { InMemoryRelay } from './fakes/in-memory-relay.js';
import { ScriptedBrain } from './fakes/scripted-brain.js';

function fakedPorts(): { ports: Ports; relay: InMemoryRelay } {
  const relay = new InMemoryRelay();
  const ports: Ports = {
    below: new FixtureBelow({ fixtures: {} }),
    relay,
    brain: new ScriptedBrain({}),
  };
  return { ports, relay };
}

describe('runCommand (black-box command layer)', () => {
  it('reports the CLI version end-to-end, through all three faked ports', async () => {
    const { ports, relay } = fakedPorts();

    const result = await runCommand(['--version'], ports);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${CLI_VERSION}\n`,
      stderr: '',
    });
    expect(await relay.readBack({})).toEqual([]);
  });

  it('accepts -v as a version alias', async () => {
    const { ports } = fakedPorts();

    const result = await runCommand(['-v'], ports);

    expect(result.stdout).toBe(`${CLI_VERSION}\n`);
    expect(result.exitCode).toBe(0);
  });

  it('rejects an unknown command without touching any port', async () => {
    const { ports, relay } = fakedPorts();

    const result = await runCommand(['plant'], ports);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/unknown command/i);
    expect(await relay.readBack({})).toEqual([]);
  });
});
