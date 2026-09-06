import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  CONVENTION_RULES,
  conventionRuleIssues,
  crossPackageSourceImportIssues,
  devLazyStudioImportIssues,
  duplicateDescribeTitleIssues,
  justRecipeIssues,
  langiumImportIssues,
  missingTestAppReadmeEntries,
  repoLintIssues,
  wordFlowerDirectoryIssues,
} from '../dev-src/repository-tests/repo-lint'

const absorbed = '// Tranche status: absorbed'
const open = '// Tranche status: open'
const healthyJustfile = `
bench:
    bun run language-performance.ts
check:
    ./dev gates _test
verify:
    ./dev gates _test
full-verify:
    ./dev gates _test
_test:
    ./dev test
`

Describe('repo lint contracts', () => {
  Test('keeps the language benchmark in bench and out of correctness gates', () => {
    Expect(justRecipeIssues(`
FULL_VERIFY_GATES := "_test _native"
bench iterations="10":
    bun run packages/dev/dev-src/performance/language-performance.ts "{{ iterations }}"
check:
    ./dev gates _test
verify: deps
    ./dev gates _test
full-verify: deps
    ./dev gates {{ FULL_VERIFY_GATES }}
_test:
    ./dev test
_native:
    ./dev studio-smoke
deps:
    bun install
`)).toEqual([])
  })

  Test('reports a benchmark reached through a verification gate variable and recipe', () => {
    Expect(justRecipeIssues(`
FULL_VERIFY_GATES := "_test _bench-check"
bench:
    bun run language-performance.ts
check:
    ./dev gates _test
verify:
    ./dev gates _test
full-verify:
    ./dev gates {{ FULL_VERIFY_GATES }}
_test:
    ./dev test
_bench-check:
    just bench
`)).toEqual([
      "Justfile recipe 'full-verify' must not invoke the language performance benchmark.",
    ])
  })

  Test('reports a raw Error handed to a promise rejection', () => {
    const source = `function run(reject: (e: unknown) => void) {\n  reject(${'new Error'}('nope'))\n}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rejectedRawError,
      [{ path: 'packages/studio/studio-src/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/studio/studio-src/StudioNew.ts:2 rejects with a raw `Error`; reach for the same taxonomy'
      + ' a throw would use, since a rejection reaches the reader the same way.',
    ])
  })

  Test('reports a rejection allowlist entry that no longer rejects raw', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rejectedRawError,
      [{ path: 'packages/studio/studio-src/Clean.ts', source: 'export const clean = 1\n' }],
      ['packages/studio/studio-src/Clean.ts'],
    )).toEqual([
      'packages/studio/studio-src/Clean.ts no longer rejects with a raw `Error`; drop its repo lint allowlist entry.',
    ])
  })

  Test('accepts absorbed byte-identical mapped WordFlower directories', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`), file('nested/Feature.test.tao', 'test "Feature" { }')],
      [
        file('WordFlower.tao-next', `${absorbed}\nview Main { }`),
        file('nested/Feature.test.tao-next', 'test "Feature" { }'),
      ],
    ))).toEqual([])
  })

  Test('accepts explicitly open content divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { render New() }`)],
    ))).toEqual([])
  })

  Test('accepts an open directory when a mapped Current file is missing from Next', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', `${absorbed}\nview Main { }`),
        file('Documents.tao', 'view Documents { }'),
      ],
      [file('WordFlower.tao-next', `${open}\nview Main { }`)],
    ))).toEqual([])
  })

  Test('accepts an open directory when Next has an extra mapped file', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('Documents.tao-next', 'view Documents { }'),
      ],
    ))).toEqual([])
  })

  Test('keeps Next open while the nested scratch package exists', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('@tao-next/Prelude.tao-next', 'primitive item'),
      ],
    ))).toEqual([])
  })

  Test('allows either Next status when mapped content matches', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { }`)],
    ))).toEqual([])
  })

  Test('rejects absorbed Current and Next content divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { render New() }`)],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects absorbed Current and Next mapped file-set divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${absorbed}\nview Main { }`),
        file('Shared.tao-next', 'let Shared = 1'),
      ],
    ))).toEqual(['Next is absorbed but Shared.tao is missing from Current.'])
  })

  Test('rejects an absorbed Current file missing from mapped Next', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', `${absorbed}\nview Main { }`),
        file('Documents.tao', 'view Documents { }'),
      ],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { }`)],
    ))).toEqual(['Next is absorbed but Documents.tao is missing from its mapped files.'])
  })

  Test('rejects absorbed mapped whitespace differences', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }\n`)],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { } \n`)],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects absorbed mapped byte differences', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', absorbed, Buffer.from([...Buffer.from(absorbed), 0x80]))],
      [file('WordFlower.tao-next', absorbed, Buffer.from([...Buffer.from(absorbed), 0x81]))],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects hidden file divergence in an absorbed repository tranche', async () => {
    const root = await mkTestDir('tao-repo-lint-')
    try {
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao', root),
        absorbed,
      )
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next', root),
        absorbed,
      )
      await FS.writeFile(
        FS.resolvePath('Apps/WordFlower/1 - Current/.contract.bin', root),
        Buffer.from([0x80]),
      )
      await FS.writeFile(
        FS.resolvePath('Apps/WordFlower/2 - Next/.contract.bin', root),
        Buffer.from([0x81]),
      )
      await FS.writeText(FS.resolvePath('Apps/Test Apps/README.md', root), '# Test Apps\n')
      await FS.writeText(FS.resolvePath('Justfile', root), healthyJustfile)
      await FS.mkdir(FS.resolvePath('packages', root))

      Expect(await repoLintIssues(root)).toEqual([
        'Apps/WordFlower/2 - Next is absorbed but .contract.bin differs from Apps/WordFlower/1 - Current.',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('ignores Tao-owned project state when checking absorbed source parity', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', absorbed),
        file('.tao-project/lock.jsonc', '{ "ship": true }'),
      ],
      [file('WordFlower.tao-next', absorbed)],
    ))).toEqual([])
  })

  Test('requires Current to remain absorbed', () => {
    const issues = wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${open}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { render New() }`)],
    ))

    Expect(issues).toEqual(['Current must remain at tranche status absorbed.'])
  })

  Test('requires exactly one status header across each WordFlower directory', () => {
    const issues = wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', 'view Main { }')],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('WordFlower.test.tao-next', `${open}\ntest "Main" { }`),
      ],
    ))

    Expect(issues).toEqual([
      'Current must contain exactly one tranche status header across the directory.',
      'Next must contain exactly one tranche status header across the directory.',
    ])
  })

  Test('reports Test App directories without README contracts', () => {
    Expect(missingTestAppReadmeEntries(
      ['Data MVP', 'Navigation MVP'],
      '# Test Apps\n\n## Navigation MVP\n\nNavigation behavior.\n',
    )).toEqual(['Data MVP'])
  })

  Test('reports Describe titles duplicated across test files', () => {
    Expect(duplicateDescribeTitleIssues([
      { path: 'a.test.ts', source: "Describe('shared title', () => {})" },
      { path: 'b.test.ts', source: 'Describe("shared title", () => {})' },
      { path: 'c.test.ts', source: "Describe('distinct title', () => {})" },
    ])).toEqual(['Describe title "shared title" is duplicated across a.test.ts, b.test.ts.'])
  })

  Test('reports Describe titles duplicated across backtick literals', () => {
    Expect(duplicateDescribeTitleIssues([
      { path: 'a.test.ts', source: 'Describe(`template title`, () => {})' },
      { path: 'b.test.ts', source: 'Describe(`template title`, () => {})' },
      { path: 'c.test.ts', source: 'Describe(`title ${variant}`, () => {})' },
      { path: 'd.test.ts', source: 'Describe(`title ${variant}`, () => {})' },
    ])).toEqual(['Describe title "template title" is duplicated across a.test.ts, b.test.ts.'])
  })

  Test('allows a Describe title repeated within one test file', () => {
    Expect(duplicateDescribeTitleIssues([{
      path: 'a.test.ts',
      source: "Describe('local grouping', () => {})\nDescribe('local grouping', () => {})",
    }])).toEqual([])
  })
})

Describe('repo lint conventions', () => {
  Test('reports a native switch outside the allowlist', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nativeSwitch,
      [{ path: 'packages/studio/studio-src/Dispatch.ts', source: 'function run() {\n  switch (kind) {\n  }\n}' }],
      ['packages/studio/studio-src/Allowed.ts'],
    )).toEqual([
      'packages/studio/studio-src/Dispatch.ts:2 uses a native `switch`; dispatch with `Switch` from `@shared` instead.',
    ])
  })

  Test('accepts a native switch in an allowlisted file', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nativeSwitch,
      [{ path: 'packages/studio/studio-src/Dispatch.ts', source: 'function run() {\n  switch (kind) {\n  }\n}' }],
      ['packages/studio/studio-src/Dispatch.ts'],
    )).toEqual([])
  })

  Test('reports an allowlisted file that no longer uses a native switch', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nativeSwitch,
      [{ path: 'packages/studio/studio-src/Dispatch.ts', source: 'const run = Switch.kind(action, {})' }],
      ['packages/studio/studio-src/Dispatch.ts'],
    )).toEqual([
      'packages/studio/studio-src/Dispatch.ts no longer uses a native `switch`; drop its repo lint allowlist entry.',
    ])
  })

  Test('reports a Tao error constructed only to be thrown', () => {
    // Assembled so this file's own lines do not spell the construct the rule forbids.
    const source = `function run() {\n  ${['throw', 'new'].join(' ')} Errors.UserInputError('Pick a Tao file.')\n}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.constructedThrow,
      [{ path: 'packages/studio/studio-src/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/studio/studio-src/StudioNew.ts:2 constructs a Tao error only to throw it; call'
      + ' `Errors.throwUserInput(...)`, `Errors.throwUnexpected(...)`, or `Errors.throwHostEnvironment(...)` instead,'
      + ' which also narrow control flow.',
    ])
  })

  Test('leaves the runtime and its tests to their own error vocabulary', () => {
    const source = `${
      ['throw', 'new'].join(' ')
    } UnexpectedBehaviorError('design resolution must not mount navigation')`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.constructedThrow,
      [{ path: 'packages/runtime/TR-tests/TR-views.test.ts', source }],
      [],
    )).toEqual([])
  })

  Test('reports a bun:test import outside the allowlist', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.bunTestImport,
      [{ path: 'packages/runtime/TR-tests/TR-new.test.ts', source: importFrom('bun:test') }],
      ['packages/shared/shared-src/testing/Test-Bun.ts'],
    )).toEqual([
      'packages/runtime/TR-tests/TR-new.test.ts:1 imports `bun:test`; use `@shared/test` instead.',
    ])
  })

  Test('accepts a bun:test import in an allowlisted file', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.bunTestImport,
      [{ path: 'packages/shared/shared-src/testing/Test-Bun.ts', source: importFrom('bun:test') }],
      ['packages/shared/shared-src/testing/Test-Bun.ts'],
    )).toEqual([])
  })

  Test('reports a raw Error throw outside the allowlist', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawThrow,
      [{ path: 'packages/studio/studio-src/StudioNew.ts', source: `function run() {\n  ${rawThrow('nope')}\n}` }],
      ['packages/studio/studio-src/Allowed.ts'],
    )).toEqual([
      'packages/studio/studio-src/StudioNew.ts:2 throws a raw `Error`; use `Assert(...)` for invariants,'
      + " `Assert.input(...)` or `Errors.throwUserInput(...)` for the author's mistakes,"
      + ' and `Errors.throwHostEnvironment(...)` for host and environment failures.',
    ])
  })

  Test('accepts a raw Error throw in an allowlisted file', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawThrow,
      [{ path: 'packages/runtime/TaoRuntime-src/TR-data.ts', source: rawThrow('runtime invariant') }],
      ['packages/runtime/TaoRuntime-src/TR-data.ts'],
    )).toEqual([])
  })

  Test('reports an allowlisted file that no longer throws a raw Error', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawThrow,
      [{ path: 'packages/studio/studio-src/StudioSwept.ts', source: "Errors.throwUserInput('Pick a Tao file.')" }],
      ['packages/studio/studio-src/StudioSwept.ts'],
    )).toEqual([
      'packages/studio/studio-src/StudioSwept.ts no longer throws a raw `Error`;'
      + ' drop its repo lint allowlist entry.',
    ])
  })

  Test('reports a node module imported outside the wrappers', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nodeImport,
      [{ path: 'packages/dev/dev-src/studio/StudioNew.ts', source: importFrom('node:crypto') }],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/StudioNew.ts:1 imports a `node:` module directly; reach for `FS`, `CLI`,'
      + ' `Platform`, or `HCI` from `@shared`, and add the seam there when none fits.',
    ])
  })

  Test('leaves a type-only node import alone', () => {
    const typeImport = ['import type { Writable }', 'from', "'node:stream'"].join(' ')
    const source = `${typeImport}\n${importFrom('@shared')}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nodeImport,
      [{ path: 'packages/tao-cli/cli-src/compile-command.ts', source }],
      [],
    )).toEqual([])
  })

  Test('reports a global console write outside the allowlist', () => {
    const source = `function report(error: unknown) {\n  ${['console', 'error'].join('.')}('failed', error)\n}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.consoleCall,
      [{ path: 'packages/dev/dev-src/studio/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/StudioNew.ts:2 writes through the global console; use `HCI.writeLine` or'
      + ' `HCI.writeErrorLine` for a person, and `Platform.runtimeConsole` where the output must stay raw.',
    ])
  })

  Test('reports a direct process read outside the allowlist', () => {
    const source = `const home = ${['process', 'env'].join('.')}['HOME']\n`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.processAccess,
      [{ path: 'packages/dev/dev-src/studio/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/StudioNew.ts:1 reads the process environment, arguments, streams, or exit'
      + ' state directly; go through `Platform.runtimeProcess`.',
    ])
  })

  Test('reports a Bun convenience call outside the allowlist', () => {
    const source = `await ${['Bun', 'sleep'].join('.')}(100)\n`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.bunConvenience,
      [{ path: 'packages/dev/dev-src/studio/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/StudioNew.ts:1 calls a Bun convenience API directly; use `Time.sleep`,'
      + ' `Platform.randomUUID`, `Platform.semverSatisfies`, or `Platform.parseToml`, which keep the Bun'
      + ' dependency inside the wrappers.',
    ])
  })

  Test('leaves the wrappers and the runtime outside the platform rules', () => {
    const source = `const env = ${['process', 'env'].join('.')}\n${importFrom('node:os')}`
    for (const rule of [CONVENTION_RULES.nodeImport, CONVENTION_RULES.processAccess]) {
      Expect(conventionRuleIssues(
        rule,
        [
          { path: 'packages/shared/shared-src/Platform.ts', source },
          { path: 'packages/runtime/TaoRuntime-src/TR-data.ts', source },
        ],
        [],
      )).toEqual([])
    }
  })

  Test('reports a langium import outside the parser package', () => {
    Expect(langiumImportIssues([
      { path: 'packages/validator/validator-src/Rules.ts', source: importFrom('langium/lsp') },
    ])).toEqual([
      'packages/validator/validator-src/Rules.ts:1 imports `langium` outside packages/parser/; use `AST` from `@parser` instead.',
    ])
  })

  Test('accepts a langium import inside the parser package', () => {
    Expect(langiumImportIssues([
      { path: 'packages/parser/parser-src/langium-exports.ts', source: importFrom('langium') },
    ])).toEqual([])
  })

  Test('reports a relative import that reaches into another package source', () => {
    Expect(crossPackageSourceImportIssues(
      [{
        path: 'packages/dev/dev-src/studio/Packaged.ts',
        source: importFrom('../../../tao-cli/cli-src/test-command'),
      }],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/Packaged.ts:1 imports `packages/tao-cli/cli-src/test-command` from another package;'
      + " import that package's entry instead.",
    ])
  })

  Test('accepts a relative import inside one package', () => {
    Expect(crossPackageSourceImportIssues(
      [{ path: 'packages/dev/dev-src/studio/Packaged.ts', source: importFrom('../repository-tests/repo-lint') }],
      [],
    )).toEqual([])
  })

  Test('reports an allowlisted file that no longer imports another package source', () => {
    Expect(crossPackageSourceImportIssues(
      [{ path: 'packages/dev/dev-src/studio/Packaged.ts', source: importFrom('@tao-cli') }],
      ['packages/dev/dev-src/studio/Packaged.ts'],
    )).toEqual([
      "packages/dev/dev-src/studio/Packaged.ts no longer imports another package's source;"
      + ' drop its repo lint allowlist entry.',
    ])
  })

  Test('reports a static Studio import in the ./dev entry', () => {
    const entry = 'packages/dev/dev-src/dev.ts'
    Expect(devLazyStudioImportIssues(
      [{ path: entry, source: `${importFrom('@shared')}\n${importFrom('./studio/StudioSmoke')}` }],
      entry,
    )).toEqual([
      'packages/dev/dev-src/dev.ts:2 statically imports `./studio/StudioSmoke`; load it with'
      + ' `await import(...)` inside the command action so the lane commands start in a checkout'
      + ' that has never generated the parser.',
    ])
  })

  Test('accepts the ./dev entry when Studio and Expo load lazily', () => {
    const entry = 'packages/dev/dev-src/dev.ts'
    Expect(devLazyStudioImportIssues(
      [{
        path: entry,
        source: `${importFrom('./repository-tests/GateRunner')}\n`
          + "  const { StudioSmoke } = await import('./studio/StudioSmoke')\n"
          + "  const { ExpoRunner } = await import('./expo-dev-loop/expo-runner/ExpoRunner')\n",
      }],
      entry,
    )).toEqual([])
  })

  Test('leaves Studio imports in every other file alone', () => {
    Expect(devLazyStudioImportIssues(
      [{ path: 'packages/dev/dev-src/studio/StudioDev.ts', source: importFrom('@studio') }],
      'packages/dev/dev-src/dev.ts',
    )).toEqual([])
  })
})

/** importFrom builds an import line at call time so this file never matches the rules it exercises. */
function importFrom(specifier: string): string {
  return `import { thing } from '${specifier}'`
}

/** rawThrow builds a raw `Error` throw at call time so this file never matches the rule it exercises. */
function rawThrow(message: string): string {
  return `${['throw', 'new', 'Error'].join(' ')}('${message}')`
}

function directory(currentFiles: readonly TestFile[], nextFiles: readonly TestFile[]) {
  return {
    currentFiles,
    currentPath: 'Current',
    nextFiles,
    nextPath: 'Next',
  }
}

type TestFile = {
  bytes?: Uint8Array
  path: string
  source: string
}

function file(path: string, source: string, bytes?: Uint8Array): TestFile {
  return { bytes, path, source }
}
