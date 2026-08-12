import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options as ClaudeQueryOptions } from '@anthropic-ai/claude-agent-sdk';

export interface HeadlessQueryRequest {
  readonly prompt: string;
  readonly model?: string;
  /** When present, the query asks for structured output matching this JSON schema (`outputFormat: 'json_schema'`). */
  readonly jsonSchema?: Record<string, unknown>;
}

export type HeadlessQueryResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/**
 * Runs one headless Claude prompt to completion. The real SDK's `query()`
 * streams a large union of `SDKMessage`s over an async generator; this
 * collapses that down to the plain ok/text (or ok/error) shape `ClaudeBrain`
 * actually needs, so its retry loop — and its tests — depend on this simple
 * type rather than the SDK's streaming union.
 */
export type HeadlessQuery = (
  request: HeadlessQueryRequest
) => Promise<HeadlessQueryResult>;

/**
 * The only module that imports `@anthropic-ai/claude-agent-sdk` directly.
 * Single-turn, no built-in tools — the brain compiles/interprets/adapts, it
 * never acts (CONTEXT.md — Brain, Hands). Never invoked in CI: exercising
 * this against a real model is #9's proof, not this issue's; `ClaudeBrain`
 * tests inject a scripted `HeadlessQuery` instead.
 */
export const runHeadlessQuery: HeadlessQuery = async (request) => {
  const options: Pick<
    ClaudeQueryOptions,
    'model' | 'maxTurns' | 'tools' | 'outputFormat'
  > = {
    model: request.model,
    maxTurns: 1,
    tools: [],
    outputFormat: request.jsonSchema
      ? { type: 'json_schema', schema: request.jsonSchema }
      : undefined,
  };

  const stream = query({ prompt: request.prompt, options });

  for await (const message of stream) {
    if (message.type !== 'result') {
      continue;
    }
    if (message.subtype !== 'success' || message.is_error) {
      return {
        ok: false,
        error: `headless Claude query failed — ${message.subtype}`,
      };
    }
    const text =
      message.structured_output !== undefined
        ? JSON.stringify(message.structured_output)
        : message.result;
    return { ok: true, text };
  }

  return { ok: false, error: 'headless Claude query produced no result' };
};
