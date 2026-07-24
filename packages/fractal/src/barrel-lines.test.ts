import { describe, expect, it } from 'vitest';
import { findDuplicateStatements } from './barrel-lines.js';

describe('findDuplicateStatements', () => {
  it('returns statements that appear more than once', () => {
    expect(
      findDuplicateStatements(
        "export * from './a.js';\nexport * from './a.js';\n"
      )
    ).toEqual(["export * from './a.js';"]);
  });

  it('treats a multi-line statement as one unit, ignoring internal line breaks', () => {
    expect(
      findDuplicateStatements(
        "export type {\n  Foo,\n} from './a.js';\nexport type {\n  Bar,\n} from './b.js';\nexport type {\n  Foo,\n} from './a.js';\n"
      )
    ).toEqual(["export type { Foo, } from './a.js';"]);
  });

  it('returns nothing when every statement is unique', () => {
    expect(
      findDuplicateStatements(
        "export * from './a.js';\nexport * from './b.js';\n"
      )
    ).toEqual([]);
  });
});
