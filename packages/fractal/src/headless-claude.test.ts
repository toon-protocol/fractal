import { beforeEach, describe, expect, it, vi } from 'vitest';

// The SDK is stubbed, never loaded: this suite proves how the streaming
// message union is collapsed into the ok/text shape `ClaudeBrain` consumes,
// and CI stays model-free (fractal#33).
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

const { runHeadlessQuery } = await import('./headless-claude.js');

async function* streamOf(...messages: readonly unknown[]) {
  for (const message of messages) {
    yield message;
  }
}

function resultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'a lively week for indie devs',
    ...overrides,
  };
}

const SPEC_SCHEMA = { type: 'object', properties: { cadence: {} } };

describe('runHeadlessQuery', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns the result text, asking for a single tool-free turn', async () => {
    queryMock.mockReturnValue(streamOf({ type: 'system' }, resultMessage()));

    const result = await runHeadlessQuery({
      prompt: 'write commentary',
      model: 'claude-fable-5',
    });

    expect(result).toEqual({ ok: true, text: 'a lively week for indie devs' });
    const input = queryMock.mock.calls[0]?.[0];
    expect(input.prompt).toBe('write commentary');
    expect(input.options).toMatchObject({
      model: 'claude-fable-5',
      maxTurns: 1,
      tools: [],
    });
    expect(input.options.outputFormat).toBeUndefined();
  });

  it('asks for structured output when given a JSON schema, and returns it as JSON text', async () => {
    queryMock.mockReturnValue(
      streamOf(resultMessage({ structured_output: { cadence: 'hourly' } }))
    );

    const result = await runHeadlessQuery({
      prompt: 'compile this seed',
      jsonSchema: SPEC_SCHEMA,
    });

    expect(result).toEqual({ ok: true, text: '{"cadence":"hourly"}' });
    expect(queryMock.mock.calls[0]?.[0].options.outputFormat).toEqual({
      type: 'json_schema',
      schema: SPEC_SCHEMA,
    });
  });

  it('reports the failure subtype when the query ends in an error result', async () => {
    queryMock.mockReturnValue(
      streamOf(resultMessage({ subtype: 'error_max_turns', is_error: true }))
    );

    const result = await runHeadlessQuery({ prompt: 'compile this seed' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/error_max_turns/);
    }
  });

  it('treats a success result flagged as an error as a failure', async () => {
    queryMock.mockReturnValue(streamOf(resultMessage({ is_error: true })));

    const result = await runHeadlessQuery({ prompt: 'compile this seed' });

    expect(result.ok).toBe(false);
  });

  it('reports a failure when the stream ends without a result message', async () => {
    queryMock.mockReturnValue(streamOf({ type: 'system' }));

    const result = await runHeadlessQuery({ prompt: 'compile this seed' });

    expect(result).toEqual({
      ok: false,
      error: 'headless Claude query produced no result',
    });
  });
});
