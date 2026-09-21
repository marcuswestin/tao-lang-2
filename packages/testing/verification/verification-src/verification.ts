/**
 * `verification`'s own callers so far reach a specific module through `@verification/<File>`
 * (the gate runner, `repo-lint`, and the landing/finalize machinery each have their own shape and
 * no natural single entry point ties them together). This barrel exists for the `@verification`
 * alias and the package's own `module`/`exports` field; it re-exports the handful of symbols a
 * caller outside this package is most likely to reach for by package name rather than by file.
 */
export { FinalizeCommand, type FinalizeResult, LandCommand } from './Finalize'
export { runGates } from './GateRunner'
export { type LintIssueSource, repoLintIssues } from './repo-lint'
export { TestRunner } from './TestRunner'
