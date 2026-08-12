#!/usr/bin/env node
import { runCommand } from '../command.js';
import type { Ports } from '../command.js';
import type { BelowPort } from '../ports/below.js';
import type { RelayPort } from '../ports/relay.js';
import { ClaudeBrain } from '../claude-brain.js';

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
// The real Brain port: headless Claude behind the same interface every other
// port uses. With no credentials it still constructs cleanly — mechanical
// commands and `plant --spec` never touch it — and throws a clear,
// actionable error only when a brain-requiring call is actually made
// (CONTEXT.md — Brain, Hands; fractal#33).
const brain = new ClaudeBrain();

const ports: Ports = { below, relay, brain };
const result = await runCommand(process.argv.slice(2), ports);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
