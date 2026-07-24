# Coding Standards — Fractal

Loaded by the reviewer agent during code review (`@.sandcastle/CODING_STANDARDS.md`), so these
are enforced at review time without costing implementation tokens. Fractal's domain glossary is
`CONTEXT.md` at the repo root — its vocabulary (seed, spec, ditto, projection, interpretation,
NIP gate, relay set, portal) is the canonical language for names, docs, and commit messages.

## Style

- TypeScript, ESM (`"type": "module"`), Node ≥ 22. `strict` + `noUncheckedIndexedAccess`.
- Named exports over default exports. `camelCase` values, `PascalCase` types.
- `import type { ... }` for type-only imports (enforced by `consistent-type-imports`).
- No `any` (`@typescript-eslint/no-explicit-any` is an error). Model unknowns as `unknown` and
  narrow.
- Prefix intentionally-unused bindings with `_`.
- Formatting is Prettier (`prettier.config.js`) — do not hand-format; run `pnpm format`.

## Domain invariants (the load-bearing rules)

- **Ditto never includes interpretation.** A ditto is a faithful structural projection of an API
  resource with provenance; agent commentary is a separate interpretation event referencing the
  ditto. Code that blends the two is wrong by construction.
- **Nothing publishes without passing the NIP gate.** The gate is pure (candidate event in →
  verdict out) and runs pre-publish; a paid write of an unverified candidate is a bug.
- **The relay is the state of record.** Cursors and resume derive from read-back, never from
  local-only state; local state is cache.
- **Seeds are immutable; specs are amendable.** No code path mutates a planted seed.
- **The hands are deterministic.** No LLM invocation inside the ditto loop; the brain is invoked
  only at compile / interpretation / adaptation moments, behind the Brain port.
- **Outside world only through the ports.** API fetches go through the Below port, publish/read
  through the Relay port, thinking through the Brain port — no direct network or LLM calls
  elsewhere. Tests fake the ports; they never hit real networks or invoke real models.

## Testing

- Every public function/module gets at least one test. Tests live in
  `packages/*/src/**/*.test.ts` and import from `vitest` explicitly.
- Test names state the expected behavior, not the implementation.
- Assert external behavior (what arrives at the relay fake, what commands report) — never
  internal module state.
