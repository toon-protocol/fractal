// Idempotent, retrying `gh pr create` for the agent-implement-issue runner's
// PR-open step (fractal#22).
//
// A single transient GitHub API failure on this step must never discard an
// already-pushed, already-reviewed branch: the expensive implement+review
// cycle is paid for and the commits are on origin, so losing the PR object
// alone should never fail the whole run. We check for an existing PR (open
// OR closed) for this branch before every attempt, because a 500 can mask a
// server-side success — a blind retry would then 422 on "already exists".
// Only after exhausting the backoff schedule do we give up, and even then we
// hand back the exact `gh pr create` command a human can re-run; the pushed
// branch is never touched, let alone deleted, on this path.

export interface PullRequestRef {
  number: number;
  url: string;
}

/** Runs one `gh` invocation. Returns stdout; throws on non-zero exit — the
 * same contract as `execFileSync`. Injected so tests can simulate failures
 * without shelling out to a real `gh`. */
export type GhRun = (args: string[]) => string;

export type Sleep = (ms: number) => Promise<void>;

export interface OpenPrParams {
  branch: string;
  base: string;
  title: string;
  body: string;
  run: GhRun;
  sleep?: Sleep;
  /** Delay before each retry attempt — NOT counting the first, immediate, try. */
  backoffMs?: number[];
  log?: (message: string) => void;
}

/** `recoveryCommand` (present only when `ok` is false) is the exact command
 * a human can re-run. */
export type OpenPrResult =
  | { ok: true; pr: PullRequestRef }
  | { ok: false; recoveryCommand: string };

export const DEFAULT_BACKOFF_MS = [2_000, 8_000, 30_000, 60_000, 120_000];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function findExistingPr(
  run: GhRun,
  branch: string,
  log: (message: string) => void
): PullRequestRef | null {
  try {
    const out = run([
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--json',
      'number,url',
    ]);
    const prs = JSON.parse(out) as PullRequestRef[];
    return prs[0] ?? null;
  } catch (err) {
    log(
      `  [pr-open] existence check failed, treating as not-found: ${errorMessage(err)}`
    );
    return null;
  }
}

export async function openPrWithRetry(
  params: OpenPrParams
): Promise<OpenPrResult> {
  const backoff = params.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep =
    params.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = params.log ?? console.log;
  const maxAttempts = backoff.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const existing = findExistingPr(params.run, params.branch, log);
    if (existing) {
      log(
        `  [pr-open] PR already exists for '${params.branch}': #${existing.number} — ${existing.url}`
      );
      return { ok: true, pr: existing };
    }

    let createFailed = false;
    try {
      params.run([
        'pr',
        'create',
        '--base',
        params.base,
        '--head',
        params.branch,
        '--title',
        params.title,
        '--body',
        params.body,
      ]);
    } catch (err) {
      createFailed = true;
      log(
        `  [pr-open] gh pr create failed (attempt ${attempt}/${maxAttempts}): ${errorMessage(err)}`
      );
    }

    // Confirm via a read rather than trusting either the throw or the stdout
    // of a "successful" create — a 500 can mask a server-side success just as
    // easily as a reported success can mask a not-actually-created PR.
    const created = findExistingPr(params.run, params.branch, log);
    if (created) {
      if (createFailed) {
        log(
          `  [pr-open] PR landed despite the error — #${created.number} — ${created.url}`
        );
      }
      return { ok: true, pr: created };
    }

    if (!createFailed) {
      log(
        `  [pr-open] gh pr create reported success but no PR was found for '${params.branch}' (attempt ${attempt}/${maxAttempts})`
      );
    }

    if (attempt < maxAttempts) {
      await sleep(backoff[attempt - 1]!);
    }
  }

  const recoveryCommand =
    `gh pr create --base ${params.base} --head ${params.branch} ` +
    `--title ${shQuote(params.title)} --body ${shQuote(params.body)}`;
  return { ok: false, recoveryCommand };
}
