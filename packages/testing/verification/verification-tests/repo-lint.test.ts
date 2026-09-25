import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  CONVENTION_RULES,
  conventionRuleIssues,
  crossPackageSourceImportIssues,
  DEV_ENTRY_PATH,
  developerEnvironmentIndexes,
  developerEnvironmentLedgerIssues,
  devLazyStudioImportIssues,
  duplicateDescribeTitleIssues,
  justRecipeIssues,
  langiumImportIssues,
  missingTestAppReadmeEntries,
  repoLintIssues,
  wordFlowerDirectoryIssues,
} from '../verification-src/repo-lint'
import type { LedgerSide } from '../verification-src/repo-lint'

const absorbed = '// Tranche status: absorbed'
const open = '// Tranche status: open'
const healthyJustfile = `
bench:
    bun run language-performance.ts
check:
    ./dev gates _test
verify:
    ./dev gates _test
verify-full:
    ./dev gates _test
_test:
    ./dev test
`

Describe('repo lint contracts', () => {
  Test('keeps the language benchmark in bench and out of correctness gates', () => {
    Expect(justRecipeIssues(`
VERIFY_FULL_GATES := "_test _native"
bench iterations="10":
    bun run packages/dev/dev-src/performance/language-performance.ts "{{ iterations }}"
check:
    ./dev gates _test
verify: deps
    ./dev gates _test
verify-full: deps
    ./dev gates {{ VERIFY_FULL_GATES }}
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
VERIFY_FULL_GATES := "_test _bench-check"
bench:
    bun run language-performance.ts
check:
    ./dev gates _test
verify:
    ./dev gates _test
verify-full:
    ./dev gates {{ VERIFY_FULL_GATES }}
_test:
    ./dev test
_bench-check:
    just bench
`)).toEqual([
      "Justfile recipe 'verify-full' must not invoke the language performance benchmark.",
    ])
  })

  Test('reports a raw Error built anywhere, not only inside a rejection', () => {
    const source =
      `function run(reject: (e: unknown) => void) {\n  const failure = ${'new Error'}('nope')\n  reject(failure)\n}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawError,
      [{ path: 'packages/ides/studio/studio-src/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/ides/studio/studio-src/StudioNew.ts:2 constructs a raw `Error`; where an error object must exist rather than'
      + ' be thrown, build `new Errors.UserInputError(...)`, `new Errors.UnexpectedBehaviorError(...)`, or'
      + ' `new Errors.HostEnvironmentError(...)`, wrap an unknown with `Errors.asError(...)`, or cancel with'
      + ' `Errors.abortError(...)`.',
    ])
  })

  Test('a file-keyed node-import entry blesses every site in that file', () => {
    const path = 'packages/dev/dev-tests/fixtures.test.ts'
    const source = "import 'node:path'\nconst x = 1\nimport 'node:fs'\n"
    Expect(conventionRuleIssues(CONVENTION_RULES.nodeImport, [{ path, source }], [path])).toEqual([])
  })

  Test('a line-keyed node-import entry blesses only its own site', () => {
    const path = 'packages/apps/expo-host/expo-host-tests/shipped.test.ts'
    const source = "import 'node:path'\nconst x = 1\nimport 'node:fs'\n"
    Expect(conventionRuleIssues(CONVENTION_RULES.nodeImport, [{ path, source }], [`${path}:1`]))
      .toEqual([
        `${path}:3 imports a \`node:\` module directly; reach for \`FS\`, \`CLI\`, \`Platform\`, or \`HCI\` from`
        + ' `@shared`, and add the seam there when none fits.',
      ])
  })

  Test('reports a file-keyed node-import entry whose file no longer imports one', () => {
    const path = 'packages/dev/dev-tests/swept.test.ts'
    Expect(conventionRuleIssues(CONVENTION_RULES.nodeImport, [{ path, source: 'export const x = 1\n' }], [path]))
      .toEqual([
        `${path} no longer imports a \`node:\` module; drop its repo lint allowlist entry.`,
      ])
  })

  Test('reports a raw-error allowlist entry that no longer builds one', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawError,
      [{ path: 'packages/ides/studio/studio-src/Clean.ts', source: 'export const clean = 1\n' }],
      ['packages/ides/studio/studio-src/Clean.ts'],
    )).toEqual([
      'packages/ides/studio/studio-src/Clean.ts no longer constructs a raw `Error`; drop its repo lint allowlist entry.',
    ])
  })

  Test('a raw-error exemption allows one site rather than its whole file', () => {
    const path = 'packages/apps/runtime/TR-tests/failure.test.ts'
    const source = `${rawError('first')}\n${rawError('second')}\n`
    Expect(conventionRuleIssues(CONVENTION_RULES.rawError, [{ path, source }], [`${path}:1`])).toEqual([
      `${path}:2 constructs a raw \`Error\`; where an error object must exist rather than be thrown,`
      + ' build `new Errors.UserInputError(...)`, `new Errors.UnexpectedBehaviorError(...)`, or'
      + ' `new Errors.HostEnvironmentError(...)`, wrap an unknown with `Errors.asError(...)`, or cancel with'
      + ' `Errors.abortError(...)`.',
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
      await FS.writeText(FS.resolvePath(DEV_ENTRY_PATH, root), importFrom('@shared'))

      Expect(await repoLintIssues(root)).toEqual([
        'Apps/WordFlower/2 - Next is absorbed but .contract.bin differs from Apps/WordFlower/1 - Current.',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('ignores generated Tao dev directories before reading WordFlower files', async () => {
    const root = await mkTestDir('tao-repo-lint-dev-')
    try {
      await FS.writeText(FS.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao', root), absorbed)
      await FS.writeText(FS.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next', root), absorbed)
      await FS.writeText(FS.resolvePath('Apps/Test Apps/README.md', root), '# Test Apps\n')
      await FS.writeText(FS.resolvePath('Justfile', root), healthyJustfile)
      await FS.writeText(FS.resolvePath(DEV_ENTRY_PATH, root), importFrom('@shared'))
      await FS.writeText(FS.resolvePath('Apps/WordFlower/1 - Current/.tao/dev/runtime/App.tsx', root), 'generated\n')
      await FS.symlink(
        FS.resolvePath('Apps/WordFlower/1 - Current/.tao/dev/runtime', root),
        FS.resolvePath('Apps/WordFlower/1 - Current/.tao/dev/node_modules', root),
      )

      Expect(await repoLintIssues(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('scans Apps, runtime, and CommonJS executable sources for raw errors', async () => {
    const root = await mkTestDir('tao-repo-lint-sources-')
    try {
      await FS.writeText(FS.resolvePath('Justfile', root), healthyJustfile)
      await FS.writeText(FS.resolvePath('Apps/Test Apps/README.md', root), '# Test Apps\n')
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao', root),
        absorbed,
      )
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next', root),
        absorbed,
      )
      const source = `const failure = ${rawError('unclassified')}\n`
      await FS.writeText(FS.resolvePath('Apps/Sample/Adapter.ts', root), source)
      await FS.writeText(FS.resolvePath('packages/apps/runtime/TR-tests/failure.test.ts', root), source)
      await FS.writeText(FS.resolvePath('packages/plugin/config.cjs', root), source)
      await FS.writeText(FS.resolvePath(DEV_ENTRY_PATH, root), importFrom('@shared'))

      Expect(await repoLintIssues(root)).toEqual([
        rawErrorIssue('Apps/Sample/Adapter.ts'),
        // Executable files are walked in path order; `apps/runtime` now sorts before `plugin`.
        rawErrorIssue('packages/apps/runtime/TR-tests/failure.test.ts'),
        rawErrorIssue('packages/plugin/config.cjs'),
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('scans untracked worktree sources while preserving ignores and repository boundaries', async () => {
    const root = await mkTestDir('tao-repo-lint-worktree-')
    try {
      await CLI.mustRun('git', { args: ['init', '--quiet'], cwd: root })
      await FS.writeText(FS.resolvePath('Justfile', root), healthyJustfile)
      await FS.writeText(FS.resolvePath('.gitignore', root), 'packages/ignored/\n')
      await FS.writeText(FS.resolvePath('Apps/Test Apps/README.md', root), '# Test Apps\n')
      await FS.writeText(FS.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao', root), absorbed)
      await FS.writeText(FS.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next', root), absorbed)
      const source = `const failure = ${rawError('unclassified')}\n`
      await FS.writeText(FS.resolvePath('Apps/Sample/NewAdapter.ts', root), source)
      await FS.writeText(FS.resolvePath('packages/ignored/Ignored.ts', root), source)
      await FS.writeText(FS.resolvePath('packages/tool/_gen_output/Ignored.ts', root), source)
      await FS.writeText(FS.resolvePath('Outside.ts', root), source)
      await FS.writeText(FS.resolvePath(DEV_ENTRY_PATH, root), importFrom('@shared'))

      Expect(await repoLintIssues(root)).toEqual([rawErrorIssue('Apps/Sample/NewAdapter.ts')])
    } finally {
      await FS.remove(root)
    }
  })

  Test('ignores Tao-owned project state when checking absorbed source parity', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', absorbed),
        file('.tao-project/lock.jsonc', '{ "ship": true }'),
        file('.tao/sessions/owner.json', '{ "owner": "studio" }'),
        file('.tao/sessions/session.json', '{ "status": "active" }'),
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

  Test('reports two developer-environment entries that claim the same ID, in either half', () => {
    Expect(developerEnvironmentLedgerIssues(
      openSide('', ['DEVENV-904-one.md']),
      archivedSide('', ['DEVENV-904-two.md']),
    )).toEqual([
      'Developer environment upgrades: DEVENV-904 is claimed by Developer environment upgrades/DEVENV-904-one.md,'
      + ' Developer environment upgrades/Archive/DEVENV-904-two.md; rename the later-merged file.',
    ])
  })

  Test('accepts a developer-environment backlog whose entries and generated index agree', () => {
    const open: LedgerSide = {
      entries: [
        { heading: 'DEVENV-901 — One', name: 'DEVENV-901-one.md', section: 'External', status: 'Candidate' },
        { heading: 'DEVENV-902 — Two', name: 'DEVENV-902-two.md', section: 'Deferred', status: 'Incoming' },
        { name: '.DS_Store', status: '' },
      ],
      index: '',
    }
    const archived: LedgerSide = {
      entries: [{ heading: 'DEVENV-900 — Done', name: 'DEVENV-900-done.md', status: 'Resolved' }],
      index: '',
    }
    const generated = developerEnvironmentIndexes(open, archived)
    Expect(developerEnvironmentLedgerIssues(
      { ...open, index: generated.openIndex },
      { ...archived, index: generated.archiveIndex },
    )).toEqual([])
  })

  Test('reports when the generated developer-environment index is out of date', () => {
    const open: LedgerSide = {
      entries: [
        { heading: 'DEVENV-906 — Drifted', name: 'DEVENV-906-drifted.md', section: 'External', status: 'Candidate' },
      ],
      index: '',
    }
    const generated = developerEnvironmentIndexes(open, emptySide)
    Expect(developerEnvironmentLedgerIssues({ ...open, index: `${generated.openIndex}stray text\n` }, emptySide))
      .toEqual([
        'Developer environment upgrades.md is out of date with its entry files; run `just _fix-ledger-index` to'
        + ' regenerate it.',
      ])
  })

  Test('reports when the generated developer-environment archive index is out of date', () => {
    const archived: LedgerSide = {
      entries: [{ heading: 'DEVENV-907 — Drifted', name: 'DEVENV-907-drifted.md', status: 'Resolved' }],
      index: '',
    }
    const generated = developerEnvironmentIndexes(emptySide, archived)
    Expect(
      developerEnvironmentLedgerIssues(emptySide, { ...archived, index: `${generated.archiveIndex}stray text\n` }),
    ).toEqual([
      'Developer environment upgrades archive.md is out of date with its entry files; run `just _fix-ledger-index`'
      + ' to regenerate it.',
    ])
  })

  Test('rejects a wrapped developer-environment status that the index would truncate', () => {
    Expect(developerEnvironmentLedgerIssues(
      {
        entries: [{
          name: 'DEVENV-909-wrapped.md',
          section: 'External',
          status: 'Candidate',
          statusMultiline: true,
        }],
        index: '',
      },
      emptySide,
    )).toContain(
      'Developer environment upgrades/DEVENV-909-wrapped.md must keep `**Status:**` on one physical line;'
        + ' move detail to an update field.',
    )
  })

  Test('requires a valid Section on an open developer-environment entry', () => {
    Expect(developerEnvironmentLedgerIssues(
      {
        entries: [{ heading: 'DEVENV-908 — Unsectioned', name: 'DEVENV-908-unsectioned.md', status: 'Candidate' }],
        index: '',
      },
      emptySide,
    )).toEqual([
      'Developer environment upgrades/DEVENV-908-unsectioned.md needs a `**Section:**` of `Deferred` or `External`.',
    ])
  })

  Test('renders developer-environment indexes from entry files, grouped by section and sorted by heading', () => {
    const open: LedgerSide = {
      entries: [
        { heading: 'DEVENV-902 — Bravo', name: 'DEVENV-902-bravo.md', section: 'External', status: 'Candidate' },
        { heading: 'DEVENV-901 — Alpha', name: 'DEVENV-901-alpha.md', section: 'External', status: 'Planned' },
        { heading: 'DEVENV-903 — Charlie', name: 'DEVENV-903-charlie.md', section: 'Deferred', status: 'Blocked' },
      ],
      index: '',
    }
    const archived: LedgerSide = {
      entries: [{ heading: 'DEVENV-900 — Done', name: 'DEVENV-900-done.md', status: 'Resolved' }],
      index: '',
    }
    const { archiveIndex, openIndex } = developerEnvironmentIndexes(open, archived)
    Expect(openIndex).toContain(
      '## Deferred project — begin after the large branches land\n\n'
        + '- [DEVENV-903 — Charlie](<Developer environment upgrades/DEVENV-903-charlie.md>) — Blocked',
    )
    Expect(openIndex).toContain(
      '## External and observational findings\n\n'
        + '- [DEVENV-901 — Alpha](<Developer environment upgrades/DEVENV-901-alpha.md>) — Planned\n'
        + '- [DEVENV-902 — Bravo](<Developer environment upgrades/DEVENV-902-bravo.md>) — Candidate',
    )
    Expect(archiveIndex).toContain(
      '- [DEVENV-900 — Done](<Developer environment upgrades/Archive/DEVENV-900-done.md>) — Resolved',
    )
  })

  Test('reports an addressed entry left in the open backlog, and an open one left in the archive', () => {
    Expect(developerEnvironmentLedgerIssues(
      { entries: [{ name: 'DEVENV-901-done.md', section: 'External', status: 'Resolved' }], index: '' },
      { entries: [{ name: 'DEVENV-902-open.md', status: 'Candidate' }], index: '' },
    )).toEqual([
      'Developer environment upgrades/DEVENV-901-done.md is `Resolved`; move it into'
      + ' `Developer environment upgrades/Archive/` in the change that addressed it.',
      'Developer environment upgrades/Archive/DEVENV-902-open.md is `Candidate`; an entry that is not addressed'
      + ' belongs in the open backlog.',
    ])
  })

  Test('reports a developer-environment file that is named for neither a number nor a title', () => {
    Expect(developerEnvironmentLedgerIssues(openSide('', ['notes.md']), emptySide)).toEqual([
      'Developer environment upgrades/notes.md must be named DEVENV-NAME-WORDS-ETC.md, with the'
      + " title's words in capitals joined by dashes.",
    ])
  })

  Test('accepts an entry named for its title beside a numbered one', () => {
    Expect(developerEnvironmentLedgerIssues(
      openSide('', ['DEVENV-901-numbered.md', 'DEVENV-NAMED-FOR-ITS-TITLE.md']),
      emptySide,
    )).toEqual([])
  })

  Test('reports one title claimed by both halves of the ledger', () => {
    Expect(developerEnvironmentLedgerIssues(
      openSide('', ['DEVENV-SAME-TITLE-TWICE.md']),
      archivedSide('', ['DEVENV-SAME-TITLE-TWICE.md']),
    )).toEqual([
      'Developer environment upgrades: DEVENV-SAME-TITLE-TWICE is claimed by'
      + ' Developer environment upgrades/DEVENV-SAME-TITLE-TWICE.md,'
      + ' Developer environment upgrades/Archive/DEVENV-SAME-TITLE-TWICE.md; rename the later-merged file.',
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
      [{ path: 'packages/ides/studio/studio-src/Dispatch.ts', source: 'function run() {\n  switch (kind) {\n  }\n}' }],
      ['packages/ides/studio/studio-src/Allowed.ts'],
    )).toEqual([
      'packages/ides/studio/studio-src/Dispatch.ts:2 uses a native `switch`; dispatch with `Switch` from `@shared` instead.',
    ])
  })

  Test('accepts a native switch in an allowlisted file', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nativeSwitch,
      [{ path: 'packages/ides/studio/studio-src/Dispatch.ts', source: 'function run() {\n  switch (kind) {\n  }\n}' }],
      ['packages/ides/studio/studio-src/Dispatch.ts'],
    )).toEqual([])
  })

  Test('reports an allowlisted file that no longer uses a native switch', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nativeSwitch,
      [{ path: 'packages/ides/studio/studio-src/Dispatch.ts', source: 'const run = Switch.kind(action, {})' }],
      ['packages/ides/studio/studio-src/Dispatch.ts'],
    )).toEqual([
      'packages/ides/studio/studio-src/Dispatch.ts no longer uses a native `switch`; drop its repo lint allowlist entry.',
    ])
  })

  Test('reports a Tao error constructed only to be thrown', () => {
    // Assembled so this file's own lines do not spell the construct the rule forbids.
    const source = `function run() {\n  ${['throw', 'new'].join(' ')} Errors.UserInputError('Pick a Tao file.')\n}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.constructedThrow,
      [{ path: 'packages/ides/studio/studio-src/StudioNew.ts', source }],
      [],
    )).toEqual([
      'packages/ides/studio/studio-src/StudioNew.ts:2 constructs a Tao error only to throw it; call'
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
      [{ path: 'packages/apps/runtime/TR-tests/TR-views.test.ts', source }],
      [],
    )).toEqual([])
  })

  Test('reports a bun:test import outside the allowlist', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.bunTestImport,
      [{ path: 'packages/apps/runtime/TR-tests/TR-new.test.ts', source: importFrom('bun:test') }],
      ['packages/shared/shared-src/testing/Test-Bun.ts'],
    )).toEqual([
      'packages/apps/runtime/TR-tests/TR-new.test.ts:1 imports `bun:test`; use `@shared/test` instead.',
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
      [{ path: 'packages/ides/studio/studio-src/StudioNew.ts', source: `function run() {\n  ${rawThrow('nope')}\n}` }],
      ['packages/ides/studio/studio-src/Allowed.ts'],
    )).toEqual([
      'packages/ides/studio/studio-src/StudioNew.ts:2 throws a raw `Error`; use `Assert(...)` for invariants,'
      + " `Assert.input(...)` or `Errors.throwUserInput(...)` for the author's mistakes,"
      + ' and `Errors.throwHostEnvironment(...)` for host and environment failures.',
    ])
  })

  Test('accepts a raw Error throw in an allowlisted file', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawThrow,
      [{ path: 'packages/apps/runtime/TaoRuntime-src/TR-data.ts', source: rawThrow('runtime invariant') }],
      ['packages/apps/runtime/TaoRuntime-src/TR-data.ts'],
    )).toEqual([])
  })

  Test('reports an allowlisted file that no longer throws a raw Error', () => {
    Expect(conventionRuleIssues(
      CONVENTION_RULES.rawThrow,
      [{ path: 'packages/ides/studio/studio-src/StudioSwept.ts', source: "Errors.throwUserInput('Pick a Tao file.')" }],
      ['packages/ides/studio/studio-src/StudioSwept.ts'],
    )).toEqual([
      'packages/ides/studio/studio-src/StudioSwept.ts no longer throws a raw `Error`;'
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

  Test('reports side-effect, re-exported, dynamic, and CommonJS node imports', () => {
    const path = 'packages/dev/dev-src/studio/StudioNew.ts'
    const forms = [
      "import 'node:fs'",
      "export { readFile } from 'node:fs'",
      "await import('node:path')",
      "const crypto = require('node:crypto')",
    ]
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nodeImport,
      [{ path, source: forms.join('\n') }],
      [],
    )).toEqual(
      forms.map((_, index) =>
        `${path}:${index + 1} imports a \`node:\` module directly; reach for \`FS\`, \`CLI\`, \`Platform\`, or \`HCI\``
        + ' from `@shared`, and add the seam there when none fits.'
      ),
    )
  })

  Test('a node-import exemption allows one site rather than its whole file', () => {
    const path = 'packages/dev/dev-src/studio/StudioNew.ts'
    const source = [importFrom('node:crypto'), importFrom('node:net')].join('\n')
    Expect(conventionRuleIssues(CONVENTION_RULES.nodeImport, [{ path, source }], [`${path}:1`])).toEqual([
      `${path}:2 imports a \`node:\` module directly; reach for \`FS\`, \`CLI\`, \`Platform\`, or \`HCI\``
      + ' from `@shared`, and add the seam there when none fits.',
    ])
  })

  Test('leaves a type-only node import alone', () => {
    const typeImport = ['import type { Writable }', 'from', "'node:stream'"].join(' ')
    const source = `${typeImport}\n${importFrom('@shared')}`
    Expect(conventionRuleIssues(
      CONVENTION_RULES.nodeImport,
      [{ path: 'packages/cli/tao-cli/cli-src/compile-command.ts', source }],
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
          { path: 'packages/apps/runtime/TaoRuntime-src/TR-data.ts', source },
        ],
        [],
      )).toEqual([])
    }
  })

  Test('reports a langium import outside the parser package', () => {
    Expect(langiumImportIssues([
      { path: 'packages/language/validator/validator-src/Rules.ts', source: importFrom('langium/lsp') },
    ])).toEqual([
      'packages/language/validator/validator-src/Rules.ts:1 imports `langium` outside packages/language/parser/; use `AST` from `@parser` instead.',
    ])
  })

  Test('accepts a langium import inside the parser package', () => {
    Expect(langiumImportIssues([
      { path: 'packages/language/parser/parser-src/langium-exports.ts', source: importFrom('langium') },
    ])).toEqual([])
  })

  Test('reports a relative import that reaches into another package source', () => {
    Expect(crossPackageSourceImportIssues(
      [{
        path: 'packages/dev/dev-src/studio/Packaged.ts',
        source: importFrom('../../../cli/tao-cli/cli-src/test-command'),
      }],
      ['dev', 'cli/tao-cli'],
      [],
    )).toEqual([
      'packages/dev/dev-src/studio/Packaged.ts:1 imports `packages/cli/tao-cli/cli-src/test-command` from another package;'
      + " import that package's entry instead.",
    ])
  })

  Test('reports a relative import that reaches a grouped package from another group', () => {
    Expect(crossPackageSourceImportIssues(
      [{
        path: 'packages/apps/expo-host/expo-host-tests/data-e2e.jest-test.tsx',
        source: importFrom('../../runtime/TaoRuntime-src/TR'),
      }],
      ['apps/expo-host', 'apps/runtime'],
      [],
    )).toEqual([
      'packages/apps/expo-host/expo-host-tests/data-e2e.jest-test.tsx:1 imports'
      + ' `packages/apps/runtime/TaoRuntime-src/TR` from another package;'
      + " import that package's entry instead.",
    ])
  })

  Test('accepts a relative import inside one package', () => {
    Expect(crossPackageSourceImportIssues(
      [{ path: 'packages/dev/dev-src/studio/Packaged.ts', source: importFrom('../repository-tests/repo-lint') }],
      ['dev'],
      [],
    )).toEqual([])
  })

  Test('reports a relative import between two different packages nested inside the same group', () => {
    // Both packages share their group's first path segment ("language"); the owner computation must
    // still tell them apart by their full two-segment names rather than conflating them as one package.
    Expect(crossPackageSourceImportIssues(
      [{
        path: 'packages/language/validator/validator-src/Rules.ts',
        source: importFrom('../../parser/parser-src/langium-exports'),
      }],
      ['language/parser', 'language/validator'],
      [],
    )).toEqual([
      'packages/language/validator/validator-src/Rules.ts:1 imports `packages/language/parser/parser-src/langium-exports`'
      + " from another package; import that package's entry instead.",
    ])
  })

  Test('reports an allowlisted file that no longer imports another package source', () => {
    Expect(crossPackageSourceImportIssues(
      [{ path: 'packages/dev/dev-src/studio/Packaged.ts', source: importFrom('@tao-cli') }],
      ['dev'],
      ['packages/dev/dev-src/studio/Packaged.ts'],
    )).toEqual([
      "packages/dev/dev-src/studio/Packaged.ts no longer imports another package's source;"
      + ' drop its repo lint allowlist entry.',
    ])
  })

  Test('reports a static Studio import in the ./dev entry', () => {
    const entry = DEV_ENTRY_PATH
    Expect(devLazyStudioImportIssues(
      [{ path: entry, source: `${importFrom('@shared')}\n${importFrom('@studio-tooling')}` }],
      entry,
    )).toEqual([
      `${entry}:2 statically reaches \`@studio-tooling\` through`
      + ` ${entry} -> @studio-tooling; load the boundary with \`await import(...)\` inside the`
      + ' command action so the lane commands start in a checkout that has never generated the parser.',
    ])
  })

  Test('reports Studio and Expo modules reached through a static local import chain', () => {
    const entry = DEV_ENTRY_PATH
    const doctorCommand = 'packages/cli/dev-cli/dev-cli-src/doctor/RepositoryDoctorCommand.ts'
    Expect(devLazyStudioImportIssues(
      [
        { path: entry, source: importFrom('./doctor/RepositoryDoctorCommand') },
        { path: doctorCommand, source: importFrom('@expo-host/dev-loop/expo-runner/Ports') },
      ],
      entry,
    )).toEqual([
      `${doctorCommand}:1 statically reaches`
      + ` \`@expo-host/dev-loop/expo-runner/Ports\` through ${entry} ->`
      + ` ${doctorCommand} ->`
      + ' @expo-host/dev-loop/expo-runner/Ports; load the boundary with `await import(...)` inside'
      + ' the command action so the lane commands start in a checkout that has never generated the parser.',
    ])
  })

  Test('accepts the ./dev entry when Studio and Expo load lazily', () => {
    const entry = DEV_ENTRY_PATH
    Expect(devLazyStudioImportIssues(
      [{
        path: entry,
        source: `${importFrom('./repository-tests/GateRunner')}\n`
          + "  const { StudioSmoke } = await import('@studio-tooling/StudioSmoke')\n"
          + "  const { ExpoRunner } = await import('@expo-host/dev-loop/expo-runner/ExpoRunner')\n",
      }],
      entry,
    )).toEqual([])
  })

  Test('leaves Studio imports in every other file alone', () => {
    const entry = DEV_ENTRY_PATH
    Expect(devLazyStudioImportIssues(
      [
        { path: entry, source: importFrom('@shared') },
        { path: 'packages/cli/dev-cli/dev-cli-src/studio/StudioDev.ts', source: importFrom('@studio') },
      ],
      entry,
    )).toEqual([])
  })

  Test('reports a bare @expo-host import, not only @expo-host/dev-loop', () => {
    const entry = DEV_ENTRY_PATH
    Expect(devLazyStudioImportIssues(
      [{ path: entry, source: importFrom('@expo-host') }],
      entry,
    )).toEqual([
      `${entry}:1 statically reaches \`@expo-host\` through ${entry} ->`
      + ' @expo-host; load the boundary with `await import(...)` inside the command action so the lane commands'
      + ' start in a checkout that has never generated the parser.',
    ])
  })

  Test('follows a @verification alias import to find a Studio import routed through it', () => {
    const entry = DEV_ENTRY_PATH
    const gateCatalog = 'packages/testing/verification/verification-src/GateCatalog.ts'
    Expect(devLazyStudioImportIssues(
      [
        { path: entry, source: importFrom('@verification/GateCatalog') },
        { path: gateCatalog, source: importFrom('@studio-tooling') },
      ],
      entry,
    )).toEqual([
      `${gateCatalog}:1 statically reaches \`@studio-tooling\` through`
      + ` ${entry} -> ${gateCatalog} ->`
      + ' @studio-tooling; load the boundary with `await import(...)` inside the command action so the lane'
      + ' commands start in a checkout that has never generated the parser.',
    ])
  })

  Test('reports the entry as moved when the file map does not carry DEV_ENTRY_PATH', () => {
    Expect(devLazyStudioImportIssues([{ path: 'packages/cli/dev-cli/dev-cli-src/other.ts', source: '' }]))
      .toEqual([
        `${DEV_ENTRY_PATH}:1 does not exist, so this rule is not watching the \`./dev\` entry at all; update`
        + ' `DEV_ENTRY_PATH` in packages/testing/verification/verification-src/repo-lint.ts to its new path.',
      ])
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

/** rawError builds a raw `Error` construction without making this test file violate its own rule. */
function rawError(message: string): string {
  return `${['new', 'Error'].join(' ')}('${message}')`
}

function rawErrorIssue(path: string): string {
  return `${path}:1 constructs a raw \`Error\`; where an error object must exist rather than be thrown,`
    + ' build `new Errors.UserInputError(...)`, `new Errors.UnexpectedBehaviorError(...)`, or'
    + ' `new Errors.HostEnvironmentError(...)`, wrap an unknown with `Errors.asError(...)`, or cancel with'
    + ' `Errors.abortError(...)`.'
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

const emptySide: LedgerSide = { entries: [], index: '' }

/**
 * The status and section each helper gives its entries are the ones that belong in that half, so
 * only the case under test differs; a test that cares about a specific section builds its own
 * `LedgerSide` instead of using this helper.
 */
function openSide(index: string, names: readonly string[]): LedgerSide {
  return { entries: names.map(name => ({ name, section: 'External', status: 'Candidate' })), index }
}

function archivedSide(index: string, names: readonly string[]): LedgerSide {
  return { entries: names.map(name => ({ name, status: 'Resolved' })), index }
}
