import { describe, expect, it, vi } from 'vitest';
import { openPrWithRetry } from './pr-open.ts';

const BASE_PARAMS = {
  branch: 'sandcastle/issue-22',
  base: 'main',
  title: 'Some issue title',
  body: 'Some PR body',
};

function noExisting(): string {
  return JSON.stringify([]);
}

function existingPr(number: number, url: string): string {
  return JSON.stringify([{ number, url }]);
}

describe('openPrWithRetry', () => {
  it('succeeds on the first try', async () => {
    const run = vi
      .fn<[string[]], string>()
      // pre-check: no existing PR
      .mockReturnValueOnce(noExisting())
      // gh pr create
      .mockReturnValueOnce('')
      // post-create confirmation
      .mockReturnValueOnce(existingPr(101, 'https://github.com/o/r/pull/101'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await openPrWithRetry({ ...BASE_PARAMS, run, sleep });

    expect(result.ok).toBe(true);
    expect(result.pr).toEqual({
      number: 101,
      url: 'https://github.com/o/r/pull/101',
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[1]?.[0]).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'sandcastle/issue-22',
      '--title',
      'Some issue title',
      '--body',
      'Some PR body',
    ]);
  });

  it('retries with backoff after transient failures, then succeeds', async () => {
    const run = vi
      .fn<[string[]], string>()
      // attempt 1: no existing PR, create throws, still no PR after
      .mockReturnValueOnce(noExisting())
      .mockImplementationOnce(() => {
        throw new Error(
          'GraphQL: Something went wrong while executing your query'
        );
      })
      .mockReturnValueOnce(noExisting())
      // attempt 2: no existing PR, create throws, still no PR after
      .mockReturnValueOnce(noExisting())
      .mockImplementationOnce(() => {
        throw new Error('HTTP 500');
      })
      .mockReturnValueOnce(noExisting())
      // attempt 3: no existing PR, create succeeds, PR now found
      .mockReturnValueOnce(noExisting())
      .mockReturnValueOnce('')
      .mockReturnValueOnce(existingPr(202, 'https://github.com/o/r/pull/202'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await openPrWithRetry({
      ...BASE_PARAMS,
      run,
      sleep,
      backoffMs: [2_000, 8_000, 30_000],
    });

    expect(result.ok).toBe(true);
    expect(result.pr).toEqual({
      number: 202,
      url: 'https://github.com/o/r/pull/202',
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 8_000);
  });

  it('is a no-op returning the existing PR when one is already open', async () => {
    const run = vi
      .fn<[string[]], string>()
      .mockReturnValueOnce(existingPr(55, 'https://github.com/o/r/pull/55'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await openPrWithRetry({ ...BASE_PARAMS, run, sleep });

    expect(result.ok).toBe(true);
    expect(result.pr).toEqual({
      number: 55,
      url: 'https://github.com/o/r/pull/55',
    });
    expect(sleep).not.toHaveBeenCalled();
    // Only the existence check ran — no `pr create` was ever attempted.
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]?.[0]).toBe('pr');
    expect(run.mock.calls[0]?.[0]?.[1]).toBe('list');
  });

  it('exits non-zero-worthy (ok: false) with a recovery command once all attempts are exhausted', async () => {
    const backoffMs = [2_000, 8_000];
    const run = vi
      .fn<[string[]], string>()
      .mockImplementation((args) => {
        if (args[0] === 'pr' && args[1] === 'list') {
          return noExisting();
        }
        throw new Error('HTTP 500');
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await openPrWithRetry({
      ...BASE_PARAMS,
      run,
      sleep,
      backoffMs,
    });

    expect(result.ok).toBe(false);
    expect(result.pr).toBeUndefined();
    expect(result.recoveryCommand).toContain('gh pr create');
    expect(result.recoveryCommand).toContain('--base main');
    expect(result.recoveryCommand).toContain('--head sandcastle/issue-22');
    expect(result.recoveryCommand).toContain('Some issue title');
    // 3 attempts total (backoffMs.length + 1), sleeping between each failed one.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 8_000);
  });

  it('treats a masked server-side success (create throws, but the PR is now findable) as success', async () => {
    const run = vi
      .fn<[string[]], string>()
      // pre-check: nothing yet
      .mockReturnValueOnce(noExisting())
      // create throws (e.g. HTTP 500 with an empty body)
      .mockImplementationOnce(() => {
        throw new Error('HTTP 500');
      })
      // but the PR actually landed server-side
      .mockReturnValueOnce(existingPr(303, 'https://github.com/o/r/pull/303'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await openPrWithRetry({ ...BASE_PARAMS, run, sleep });

    expect(result.ok).toBe(true);
    expect(result.pr).toEqual({
      number: 303,
      url: 'https://github.com/o/r/pull/303',
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});
