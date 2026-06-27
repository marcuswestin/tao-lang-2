import { DevLoopTUI } from './DevLoopTUI'
import { TestTUI } from './test-runner/TestTUI'

/** TUI exposes human-facing interactive output for dev automation. */
export const TUI = {
  ...DevLoopTUI,
  runTestSuites: TestTUI.runTestSuites,
}
