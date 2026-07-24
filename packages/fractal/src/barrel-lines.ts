// Barrel manifests are declared `merge=union` in the repo-root .gitattributes
// so concurrent PRs that each append a new export line merge automatically.
// The tradeoff: union merge duplicates a statement if both sides added the
// identical export. This is the guard that surfaces that at the test gate.
//
// Statements (not raw lines) are the unit of comparison: a multi-line
// `export type {\n  Foo,\n} from './x.js';` block shares its opening-brace
// line with unrelated blocks, so line-level comparison false-positives on
// barrels that enumerate symbols instead of using `export * from`.
export function findDuplicateStatements(contents: string): string[] {
  const statements = contents
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const statement of statements) {
    if (seen.has(statement)) {
      duplicates.add(statement);
    }
    seen.add(statement);
  }
  return [...duplicates];
}
