#!/usr/bin/env node
import { runCommand } from '../command.js';
import type { Ports } from '../command.js';
import type { BelowPort } from '../ports/below.js';
import type { RelayPort } from '../ports/relay.js';
import type { BrainPort } from '../ports/brain.js';

function notWired(port: string): never {
  throw new Error(
    `fractal: the ${port} port has no real implementation yet — this command is not wired for live use`
  );
}

const below: BelowPort = { fetch: () => notWired('Below') };
const relay: RelayPort = {
  publish: () => notWired('Relay'),
  readBack: () => notWired('Relay'),
  quoteFee: () => notWired('Relay'),
};
const brain: BrainPort = {
  compile: () => notWired('Brain'),
  interpret: () => notWired('Brain'),
  adapt: () => notWired('Brain'),
};

const ports: Ports = { below, relay, brain };
const result = await runCommand(process.argv.slice(2), ports);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
