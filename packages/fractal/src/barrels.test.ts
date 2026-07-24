import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findDuplicateStatements } from './barrel-lines.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// Keep in sync with the `merge=union` paths in the repo-root .gitattributes.
const BARREL_FILES = [
  'index.ts',
  'domain/index.ts',
  'ports/index.ts',
  'fakes/index.ts',
];

describe('union-merge barrels have no duplicate lines', () => {
  it.each(BARREL_FILES)('%s', (relativePath) => {
    const contents = readFileSync(join(SRC_DIR, relativePath), 'utf8');
    expect(findDuplicateStatements(contents)).toEqual([]);
  });
});
