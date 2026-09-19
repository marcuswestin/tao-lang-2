import { FS } from '@shared'
import type * as TestCompiler from './test-compiler/TestCompiler'

/** ROOT heads every Tao journey name, so one pattern can select the whole command's cases. */
const ROOT = 'Tao test command'

/**
 * TestCaseName spells the name one Tao journey runs under in the test runner. The Jest harness builds
 * its `Describe`/`Test` tree out of `segments`, and `tao test --name` matches a pattern against
 * `full`, so the runner's own `--testNamePattern` and this command's own check agree by construction
 * rather than through two copies of the same convention.
 */
export const TestCaseName = {
  full,
  journey,
  ROOT,
  segments,
} as const

/**
 * journey names one check the way a failure already names it: the suite it is declared in, then the
 * journey itself. `test-runner` heads every failed check with this same composition, so a `✓`/`✕`
 * line and the failure below it read as one string rather than two spellings of one journey.
 */
function journey(suite: TestCompiler.Suite, check: TestCompiler.Check): string {
  return `${suite.name} > ${check.name}`
}

/** segments returns the runner's name path for one journey: root, file, then the journey itself. */
function segments(
  file: TestCompiler.File,
  suite: TestCompiler.Suite,
  check: TestCompiler.Check,
): readonly string[] {
  return [ROOT, FS.basename(file.sourcePath), journey(suite, check)]
}

/**
 * full returns the single name a test-name pattern is matched against. Jest identifies a case by its
 * ancestor titles and its own title joined with a single space, so the pattern a person writes reads
 * against exactly that string here too.
 */
function full(
  file: TestCompiler.File,
  suite: TestCompiler.Suite,
  check: TestCompiler.Check,
): string {
  return segments(file, suite, check).join(' ')
}
