/**
 * The NIP gate's pre-publish pure-function output: a candidate event either
 * passes, or is kicked back with reasons for rework — never published
 * unverified (CONTEXT.md — NIP gate).
 */
export type GateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasons: readonly string[] };
