import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { Errors, FS, Platform } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

AfterEach(() => cleanup())

/**
 * declareTaoJourneys declares one Jest case per Tao journey rather than one per Tao test file. Every
 * isolation boundary a journey needs already belongs to the journey itself, so this costs nothing
 * but Jest's own per-case bookkeeping — and it is what makes `--testNamePattern`, and therefore
 * `tao test --name`, able to select one journey.
 *
 * `sourcePaths` narrows the run's manifest to the Tao test files this Jest entrypoint owns. Jest
 * distributes test *files* across its worker pool, so a run that declares its whole manifest in one
 * entrypoint leaves the pool nothing to distribute; `tao test` therefore generates one entrypoint
 * per Tao test file and names that file here. Naming no path declares the whole manifest, which is
 * what a bare `jest --config jest.tao-test.config.cjs` run gets.
 *
 * The name tree is the same either way: `TestCaseName` composes it, an entrypoint only decides which
 * of the files under it are declared, and a case's full name never mentions the entrypoint.
 */
export function declareTaoJourneys(sourcePaths?: readonly string[]): void {
  const files = ownedFiles(requestedManifest(), sourcePaths)
  Describe(RuntimeTesting.TestCaseName.ROOT, () => {
    for (const file of files) {
      Describe(FS.basename(file.sourcePath), () => {
        for (const suite of file.suites) {
          for (const check of suite.checks) {
            Test(RuntimeTesting.TestCaseName.journey(suite, check), async () => {
              await RuntimeTesting.runTestCheck(suite.name, check)
            })
          }
        }
      })
    }
  })
}

/**
 * ownedFiles picks the manifest entries one entrypoint was generated for. A named file the manifest
 * does not declare is a generated entrypoint that outlived the run it belongs to, which would
 * otherwise show up as a Jest file that quietly contains no tests.
 */
function ownedFiles(
  manifest: RuntimeTesting.TestCompiler.Manifest,
  sourcePaths: readonly string[] | undefined,
): readonly RuntimeTesting.TestCompiler.File[] {
  if (sourcePaths === undefined) {
    return manifest.files
  }
  const declared = new Map(manifest.files.map(file => [FS.resolvePath(file.sourcePath), file]))
  const owned: RuntimeTesting.TestCompiler.File[] = []
  const missing: string[] = []
  for (const sourcePath of sourcePaths) {
    const file = declared.get(FS.resolvePath(sourcePath))
    if (file === undefined) {
      missing.push(FS.displayPath(sourcePath))
      continue
    }
    owned.push(file)
  }
  if (missing.length > 0) {
    Errors.throwUnexpected(
      `${RuntimeTesting.TEST_MANIFEST_ENV} declares no compiled output for ${missing.join(', ')}.`,
    )
  }
  return owned
}

function requestedManifest(): RuntimeTesting.TestCompiler.Manifest {
  const manifestPath = Platform.runtimeProcess.env[RuntimeTesting.TEST_MANIFEST_ENV]
  if (!manifestPath) {
    Errors.throwHostEnvironment(`${RuntimeTesting.TEST_MANIFEST_ENV} is required`)
  }
  return JSON.parse(FS.readTextSync(manifestPath)) as RuntimeTesting.TestCompiler.Manifest
}
