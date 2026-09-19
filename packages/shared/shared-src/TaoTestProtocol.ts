/**
 * TaoTestProtocol owns the one thing `tao test` tells its caller that neither an exit code nor a
 * test report can carry: that a `--name` pattern selected no Tao journey and the run passed on that
 * basis rather than by running anything.
 *
 * The Tao behavior suite produces no per-test reporter metadata, so the repository test runner
 * fabricates a single observation to stand for it. That stand-in used to be recorded `passed`
 * whenever the process exited zero — including when it exited zero precisely because it ran
 * nothing. The runner's own zero-match guard reads the union of every suite's observations and
 * fires only when all of them are `skipped`, so one always-`passed` stand-in disabled it outright:
 * a typo in `just test "<name>"` ran no test anywhere and reported green.
 *
 * `tao-cli` and `tao-dev` cannot import each other — `tao-cli` depends on `tao-dev`, so the
 * dependency only runs one way — and both depend on this package, which is why the sentence the
 * one prints and the other reads is spelled here once instead of twice.
 */

/**
 * NO_JOURNEYS_MATCHED is the marker `tao test` writes when `--pass-with-no-tests` turns an empty
 * `--name` selection into a pass. It is deliberately prose a reader would want to see anyway, so
 * the line carries its own meaning and there is no second machine-only line to keep in step.
 */
const NO_JOURNEYS_MATCHED = 'passing with no tests'

/** TaoTestProtocol is what a scheduler may rely on `tao test` saying about its own run. */
export const TaoTestProtocol = {
  NO_JOURNEYS_MATCHED,
  ranNoJourneys,
} as const

/** ranNoJourneys reports whether a finished `tao test` run says it matched nothing and passed. */
function ranNoJourneys(output: string): boolean {
  return output.includes(NO_JOURNEYS_MATCHED)
}
