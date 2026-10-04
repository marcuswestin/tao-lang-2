import { CLI, Diagnostic, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { CheckCache } from '../cli-src/check-cache'
import { type CheckWorkspaceOutcome, runCheck, runFix } from '../cli-src/source-commands'
import { withGitTaoFixture, withTaoFixture } from './test-cli-files'

/**
 * `tao check` skips a workspace whose inputs are byte-identical to the ones behind its last clean
 * check. Every test here is about the one question that makes that safe: does the input set really
 * cover what a verdict depends on. The fixtures give the stamp its own repository root, which is
 * both where it is written and the boundary outside which nothing is ever stamped — so these runs
 * cannot touch the checkout's own stamp, and the checkout's stamp cannot answer them.
 */

const CANONICAL_VIEW = 'use Text from @tao/ui\n\nview MainView() {\n   render Text("Hello")\n}\n'

const TWO_WORKSPACES = {
  'AppOne/Main.tao': CANONICAL_VIEW,
  'AppOne/.tao/.gitkeep': '',
  'AppTwo/Main.tao': CANONICAL_VIEW,
  'AppTwo/.tao/.gitkeep': '',
} as const

const NESTED_WORKSPACE = {
  'App/Main.tao': CANONICAL_VIEW,
  'App/.tao/.gitkeep': '',
  'App/Sub/Other.tao': CANONICAL_VIEW.replace('MainView', 'OtherView'),
} as const

/** checkedWorkspaces runs a check against a fixture-local stamp and names what it did to each workspace. */
async function checkedWorkspaces(
  rootDir: string,
  checkedPath = rootDir,
): Promise<Record<string, CheckWorkspaceOutcome['resolution']>> {
  const outcomes: Record<string, CheckWorkspaceOutcome['resolution']> = {}
  await runCheck(checkedPath, {
    cache: { repositoryRoot: rootDir },
    onWorkspace: outcome => {
      outcomes[FS.relativePath(rootDir, outcome.workspaceRoot)] = outcome.resolution
    },
  })
  return outcomes
}

Describe('tao check per-workspace stamp', () => {
  Test('checks a no-project temp file without entering an unreadable sibling', async () => {
    const rootDir = await mkTestDir('tao-check-unreadable-sibling-')
    const deniedRoot = FS.resolvePath('denied', rootDir)
    try {
      const appPath = FS.resolvePath('fixture/App.tao', rootDir)
      await FS.writeText(appPath, CANONICAL_VIEW)
      await FS.writeText(FS.resolvePath('Secret.txt', deniedRoot), 'private\n')
      // Isolate the filesystem fault: module mocks must not leak into the other check fixtures.
      const probe = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [FS.resolvePath('fixtures/check-unreadable-sibling.ts', import.meta.dir), rootDir],
        processPolicy: 'test',
      })
      Expect({ exitCode: probe.exitCode, stderr: probe.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const { results, traversedByCheck, deniedByWalk } = JSON.parse(probe.stdout) as {
        results: Awaited<ReturnType<typeof runCheck>>
        traversedByCheck: string[]
        deniedByWalk: string[]
      }
      Expect(traversedByCheck).not.toContain('denied')
      Expect(deniedByWalk).toEqual(['denied'])
      const app = results.find(result => result.path === appPath)
      Expect(app?.error).toBeUndefined()
      Expect(results.flatMap(result => result.diagnostics ?? []).some(Diagnostic.isError)).toBe(true)
      Expect(
        results.flatMap(result => result.diagnostics ?? [])
          .some(diagnostic => diagnostic.message.includes('No Tao project marker')),
      ).toBe(true)
    } finally {
      await FS.remove(rootDir)
    }
  })

  Test('checks a standalone file at a Git root containing a directory symlink', async () => {
    await withGitTaoFixture(
      { 'App.tao': CANONICAL_VIEW, 'linked/Sidecar.ts': 'export const value = 1\n' },
      async rootDir => {
        const linkPath = FS.resolvePath('directory-link', rootDir)
        await FS.symlink('linked', linkPath)
        Expect(await Repo.filesUnder(rootDir)).toContain(linkPath)
        Expect(await CheckCache.open({ repositoryRoot: rootDir })).toBeDefined()
        const results = await runCheck('App.tao', { cwd: rootDir, cache: { repositoryRoot: rootDir } })

        Expect(results.map(result => FS.relativePath(rootDir, result.path))).toContain('App.tao')
      },
    )
  })

  Test('regenerates deleted metadata for an imported bridge on a targeted cached check', async () => {
    await withGitTaoFixture({
      'App/.gitignore': '/.tao-ts/\n/.tao/local/\n/.tao/cache/\nnode_modules/\n',
      'App/.tao/.gitkeep': '',
      'App/Main.tao': `use CountWords from ./Bridge.tao

function Total() returns number {
   return CountWords("hello")
}
`,
      'App/Bridge.tao': `public function CountWords(Value text) returns number {
   return CountWords(Value) from ./Words.ts
}
`,
      'App/Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
    }, async rootDir => {
      const main = FS.resolvePath('App/Main.tao', rootDir)
      const metadata = FS.resolvePath('App/.tao-ts/Bridge.tao.ts', rootDir)
      await runFix(FS.resolvePath('App', rootDir))
      const first = await runCheck(main, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(first.map(result => result.status)).toEqual(['unchanged'])
      Expect(await FS.isFile(metadata)).toBe(true)
      Expect(await checkedWorkspaces(rootDir, main)).toEqual({ App: 'replayed' })
      await FS.remove(metadata)
      Expect(await checkedWorkspaces(rootDir, main)).toEqual({ App: 'checked' })
      Expect(await FS.isFile(metadata)).toBe(true)
    })
  })

  Test('re-checks only the workspace whose Tao source changed', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/Main.tao', rootDir),
        'use Text from @tao/ui\n\nview MainView() {\n   render Text("Goodbye")\n}\n',
      )

      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('invalidates a clean verdict when root configuration or the shared lock changes', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
      await FS.writeText(
        FS.resolvePath('AppOne/tsconfig.json', rootDir),
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"strict":false}}\n',
      )
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      await FS.writeText(FS.resolvePath('AppOne/.tao/store/lock.jsonc', rootDir), '{"schemaVersion":1}\n')
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('does not replay a clean verdict through an external extended TypeScript config', async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'AppOne/Sidecar.ts': 'export function answer() { const unused = 1; return 42 }\n',
    }, async rootDir => {
      const sharedConfig = FS.resolvePath('shared/tsconfig.json', rootDir)
      await FS.writeText(sharedConfig, '{"compilerOptions":{"noUnusedLocals":false}}\n')
      await FS.writeText(
        FS.resolvePath('AppOne/tsconfig.json', rootDir),
        '{"extends":["./.tao/cache/typescript/tsconfig.json","../shared/tsconfig.json"]}\n',
      )
      const cold = await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: rootDir } })
      Expect(cold.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })

      await FS.writeText(sharedConfig, '{"compilerOptions":{"noUnusedLocals":true}}\n')
      const changed = await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: rootDir } })
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(diagnostic => diagnostic.code === 'TS6133'))
        .toBe(true)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('does not replay through a mutable root node_modules installation', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/node_modules/installed/package.json', rootDir),
        '{"name":"installed","version":"1.0.0"}\n',
      )
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('replays with only the repository-owned runtime link installed', async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'packages/apps/runtime/package.json': '{"name":"@tao/runtime","version":"1.0.0"}\n',
    }, async rootDir => {
      await checkedWorkspaces(rootDir)
      const scope = FS.resolvePath('AppOne/node_modules/@tao', rootDir)
      await FS.mkdir(scope)
      await FS.symlink(FS.resolvePath('packages/apps/runtime', rootDir), FS.resolvePath('runtime', scope))
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
    })
  })

  Test('re-checks a workspace when a file is added beside the ones it was asked about', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(
        FS.resolvePath('AppOne/Second.tao', rootDir),
        'use Text from @tao/ui\n\nview SecondView() {\n   render Text("Second")\n}\n',
      )

      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
    })
  })

  Test('re-checks a workspace when a TypeScript sidecar beside its declarations changed', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'AppOne/@ui/Shell.ts': 'export const shell = 1\n' },
      async rootDir => {
        await checkedWorkspaces(rootDir)
        await FS.writeText(FS.resolvePath('AppOne/@ui/Shell.ts', rootDir), 'export const shell = 2\n')

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test('checks an unmarked external helper after a clean check and reports its type error', async () => {
    await withGitTaoFixture({
      'App/.tao/.gitkeep': '',
      'App/Main.tao': 'view Main() from ../Host/Widget.tsx\n',
      'Host/Widget.tsx': `import { value } from './Helper'
export function Main(_props: unknown) { return value.toUpperCase() ? null : null }
`,
      'Host/Helper.ts': "export const value = 'ready'\n",
    }, async rootDir => {
      const app = FS.resolvePath('App', rootDir)
      const first = await runCheck(app, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir, app)).toEqual({ App: 'checked' })

      await FS.writeText(FS.resolvePath('Host/Helper.ts', rootDir), 'export const value = 1\n')
      const outcomes: CheckWorkspaceOutcome[] = []
      const changed = await runCheck(app, {
        cache: { repositoryRoot: rootDir },
        onWorkspace: outcome => outcomes.push(outcome),
      })
      Expect(outcomes.map(outcome => outcome.resolution)).toEqual(['checked'])
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(diagnostic => diagnostic.code === 'TS2339'))
        .toBe(true)
    })
  })

  Test('invalidates a warm verdict when a sidecar directory gains an empty project marker', async () => {
    await withGitTaoFixture({
      'App/.tao/.gitkeep': '',
      'App/Main.tao': 'view Main() from ./Host/Widget.tsx\n',
      'App/Host/Widget.tsx': 'export function Main(_props: unknown) { return null }\n',
    }, async rootDir => {
      const app = FS.resolvePath('App', rootDir)
      const first = await runCheck(app, { cache: { repositoryRoot: rootDir } })
      Expect(first.flatMap(result => result.diagnostics ?? []).filter(Diagnostic.isError)).toEqual([])
      Expect(await checkedWorkspaces(rootDir, app)).toEqual({ App: 'replayed' })

      await FS.mkdir(FS.resolvePath('Host/.tao', app))
      const outcomes: CheckWorkspaceOutcome[] = []
      const changed = await runCheck(app, {
        cache: { repositoryRoot: rootDir },
        onWorkspace: outcome => outcomes.push(outcome),
      })
      Expect(outcomes.map(outcome => outcome.resolution)).toEqual(['checked'])
      Expect(changed.flatMap(result => result.diagnostics ?? []).some(Diagnostic.isError)).toBe(true)
    })
  })

  Test('re-checks every workspace when the Tao stdlib changed', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'packages/apps/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n' },
      async rootDir => {
        await checkedWorkspaces(rootDir)
        await FS.writeText(FS.resolvePath('packages/apps/stdlib/@tao/ui/Shell.ts', rootDir), 'export const shell = 2\n')

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
      },
    )
  })

  // `tao check` reports errors, and its exit code rides on them, so a stamp that replayed one would
  // keep failing a run whose source the author may already have fixed. A workspace carrying an error
  // is never stamped; its neighbour, which carries none, still is.
  Test('never stamps a workspace with an error, and reports that error on every run', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'AppOne/Main.tao': 'view MainView() {\n   render Unknown()\n}\n' },
      async rootDir => {
        const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
        const errors = cold.flatMap(result => (result.diagnostics ?? []).filter(Diagnostic.isError))

        Expect(errors.map(error => error.message)).toContain("No view named 'Unknown' is in scope.")
        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
        Expect(await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })).toEqual(cold)
      },
    )
  })

  Test('never stamps a workspace holding a file that does not parse', async () => {
    await withTaoFixture(
      {
        ...TWO_WORKSPACES,
        'AppOne/Main.tao': 'use Column, Text from @tao/ui\n\nview MainView() {\n   render Column {\n   }\n}\n',
      },
      async rootDir => {
        const results = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
        Expect(results.some(result => result.status === 'error')).toBe(true)

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test('never stamps a workspace holding a file that is not canonical', async () => {
    await withTaoFixture(
      {
        ...TWO_WORKSPACES,
        'AppOne/Main.tao': 'use Text from @tao/ui\n\nview   MainView() {\n   render Text("Hello")\n}\n',
      },
      async rootDir => {
        await checkedWorkspaces(rootDir)

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test("replays a stamped workspace's warnings word for word", async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'AppOne/Main.tao': 'use Placeholder from @tao/ui\n\nview MainView() {\n   render Placeholder("Main")\n}\n',
    }, async rootDir => {
      const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
      const warm = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })

      Expect(cold.some(result => (result.diagnostics ?? []).some(Diagnostic.isWarning))).toBe(true)
      Expect(warm).toEqual(cold)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
    })
  })

  Test('stamps nothing for a workspace outside the stamp repository root', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      const boundary = FS.resolvePath('AppTwo', rootDir)
      await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: boundary } })

      Expect(await FS.exists(FS.resolvePath('.artifacts/tao-check-stamp.json', boundary))).toBe(false)
    })
  })

  for (const key of CheckCache.NO_CACHE_ENV_KEYS) {
    Test(`checks every workspace from source when ${key} is set`, async () => {
      await withTaoFixture(TWO_WORKSPACES, async rootDir => {
        await checkedWorkspaces(rootDir)
        const previous = Platform.runtimeProcess.env[key]
        Platform.runtimeProcess.env[key] = 'true'
        try {
          Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
        } finally {
          if (previous === undefined) {
            delete Platform.runtimeProcess.env[key]
          } else {
            Platform.runtimeProcess.env[key] = previous
          }
        }
        // The opt-out refuses to read the stamp; it does not invalidate what is already in it.
        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
      })
    })

    // Every test above is about whether a stamp may be reused, and a `--no-cache` lane sets exactly
    // this variable on every process in its graph. Inherited, it would answer all of them the same
    // way and hide the whole contract — a failure mode that stays invisible until someone runs the
    // one scope that passes the flag. The fixture therefore clears it, and this says so.
    Test(`clears an inherited ${key} so the stamp is what these tests measure`, async () => {
      const previous = Platform.runtimeProcess.env[key]
      Platform.runtimeProcess.env[key] = 'true'
      try {
        await withTaoFixture(TWO_WORKSPACES, async rootDir => {
          Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
          Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
        })
        Expect(Platform.runtimeProcess.env[key]).toBe('true')
      } finally {
        if (previous === undefined) {
          delete Platform.runtimeProcess.env[key]
        } else {
          Platform.runtimeProcess.env[key] = previous
        }
      }
    })
  }
})

Describe('tao check toolchain identity', () => {
  const TOOLCHAIN_FILES = {
    'bun.lock': '{}\n',
    'package.json': '{ "name": "toolchain" }\n',
    'packages/language/formatter/formatter-src/Formatter.ts': 'export const format = 1\n',
    'packages/language/parser/parser-src/_gen_tao-parser/grammar.ts': 'export const grammar = 1\n',
    'packages/apps/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n',
  } as const

  for (const changed of Object.keys(TOOLCHAIN_FILES)) {
    Test(`changes when ${changed} changes`, async () => {
      await withTaoFixture(TOOLCHAIN_FILES, async rootDir => {
        const before = await CheckCache.toolchainIdentity(rootDir)
        await FS.writeText(FS.resolvePath(changed, rootDir), 'export const changed = 2\n')

        Expect(await CheckCache.toolchainIdentity(rootDir)).not.toBe(before)
      })
    })
  }

  // One workspace checked through two different sets of entry files is two questions: a check of a
  // subdirectory validates a smaller graph than a check of the whole workspace, so one verdict must
  // never replay for the other. Without the entry set in the key, the narrower run would be handed
  // the wider run's clean answer over files it never looked at.
  Test('holds a separate verdict for each set of entry files a workspace is checked through', async () => {
    await withTaoFixture(NESTED_WORKSPACE, async rootDir => {
      Expect(await checkedWorkspaces(rootDir)).toEqual({ App: 'checked' })
      Expect(await checkedWorkspaces(rootDir)).toEqual({ App: 'replayed' })

      // The same workspace, reached through one of its subdirectories. The stamp already holds a
      // clean verdict for it, and this must not be that verdict.
      Expect(await checkedWorkspaces(rootDir, FS.resolvePath('App/Sub', rootDir))).toEqual({ App: 'checked' })
      Expect(await checkedWorkspaces(rootDir, FS.resolvePath('App/Sub', rootDir))).toEqual({ App: 'replayed' })
      // And the wider question still has its own answer, untouched by the narrower one.
      Expect(await checkedWorkspaces(rootDir)).toEqual({ App: 'replayed' })
    })
  })

  Test('refuses a relative TAO_STDLIB_ROOT rather than resolving it against two different roots', async () => {
    await withTaoFixture(TOOLCHAIN_FILES, async rootDir => {
      const previous = Platform.runtimeProcess.env['TAO_STDLIB_ROOT']
      Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = 'packages/stdlib'
      try {
        await Expect(CheckCache.toolchainIdentity(rootDir)).rejects.toThrow('must be an absolute path')
      } finally {
        if (previous === undefined) {
          delete Platform.runtimeProcess.env['TAO_STDLIB_ROOT']
        } else {
          Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = previous
        }
      }
    })
  })

  Test('refuses an identity when TAO_STDLIB_ROOT names a stdlib it does not hash', async () => {
    await withTaoFixture(TOOLCHAIN_FILES, async rootDir => {
      const previous = Platform.runtimeProcess.env['TAO_STDLIB_ROOT']
      Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = FS.resolvePath('elsewhere', rootDir)
      try {
        Expect(await CheckCache.toolchainIdentity(rootDir)).toBeUndefined()
        Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = FS.resolvePath('packages/apps/stdlib', rootDir)
        Expect(await CheckCache.toolchainIdentity(rootDir)).toBeDefined()
      } finally {
        if (previous === undefined) {
          delete Platform.runtimeProcess.env['TAO_STDLIB_ROOT']
        } else {
          Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = previous
        }
      }
    })
  })
})
