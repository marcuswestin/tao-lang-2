import { FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { CheckCache } from '../cli-src/check-cache'
import { type CheckWorkspaceOutcome, runCheck } from '../cli-src/source-commands'
import { withTaoFixture } from './test-cli-files'

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
  'AppOne/Project.tao': 'project {\n   id "check-cache-one"\n   name "Check cache one"\n}\n',
  'AppTwo/Main.tao': CANONICAL_VIEW,
  'AppTwo/Project.tao': 'project {\n   id "check-cache-two"\n   name "Check cache two"\n}\n',
} as const

/** checkedWorkspaces runs a check against a fixture-local stamp and names what it did to each workspace. */
async function checkedWorkspaces(rootDir: string): Promise<Record<string, CheckWorkspaceOutcome['resolution']>> {
  const outcomes: Record<string, CheckWorkspaceOutcome['resolution']> = {}
  await runCheck(rootDir, {
    cache: { repositoryRoot: rootDir },
    onWorkspace: outcome => {
      outcomes[FS.relativePath(rootDir, outcome.workspaceRoot)] = outcome.resolution
    },
  })
  return outcomes
}

Describe('tao check per-workspace stamp', () => {
  Test('checks every workspace cold and replays every workspace warm', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
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

  Test('re-checks every workspace when the Tao stdlib changed', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'packages/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n' },
      async rootDir => {
        await checkedWorkspaces(rootDir)
        await FS.writeText(FS.resolvePath('packages/stdlib/@tao/ui/Shell.ts', rootDir), 'export const shell = 2\n')

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
      },
    )
  })

  Test('re-checks every workspace when the generated parser changed', async () => {
    const generated = 'packages/parser/parser-src/_gen_tao-parser/grammar.ts'
    await withTaoFixture({ ...TWO_WORKSPACES, [generated]: 'export const grammar = 1\n' }, async rootDir => {
      await checkedWorkspaces(rootDir)
      await FS.writeText(FS.resolvePath(generated, rootDir), 'export const grammar = 2\n')

      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'checked' })
    })
  })

  Test('replays a workspace whose validation errors tao check does not report', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'AppOne/Main.tao': 'view MainView() {\n   render Unknown()\n}\n' },
      async rootDir => {
        // An unresolved render target is an error-severity diagnostic, and `tao check` reports
        // canonical form and warnings rather than errors — so its verdict here is "unchanged, no
        // warnings", and the replay has to say exactly that rather than invent a verdict of its own.
        const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
        Expect(cold.every(result => result.status === 'unchanged' && result.warnings === undefined)).toBe(true)

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
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

  Test('replays a stamped workspace warnings word for word', async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'AppOne/Main.tao': 'use Placeholder from @tao/ui\n\nview MainView() {\n   render Placeholder("Main")\n}\n',
    }, async rootDir => {
      const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
      const warm = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })

      Expect(cold.some(result => (result.warnings ?? []).length > 0)).toBe(true)
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
          Expect(CheckCache.disabled()).toBe(true)
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
  }
})

Describe('tao check toolchain identity', () => {
  const TOOLCHAIN_FILES = {
    'bun.lock': '{}\n',
    'package.json': '{ "name": "toolchain" }\n',
    'packages/formatter/formatter-src/Formatter.ts': 'export const format = 1\n',
    'packages/parser/parser-src/_gen_tao-parser/grammar.ts': 'export const grammar = 1\n',
    'packages/stdlib/@tao/ui/Shell.ts': 'export const shell = 1\n',
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

  Test('refuses an identity when TAO_STDLIB_ROOT names a stdlib it does not hash', async () => {
    await withTaoFixture(TOOLCHAIN_FILES, async rootDir => {
      const previous = Platform.runtimeProcess.env['TAO_STDLIB_ROOT']
      Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = FS.resolvePath('elsewhere', rootDir)
      try {
        Expect(await CheckCache.toolchainIdentity(rootDir)).toBeUndefined()
        Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] = FS.resolvePath('packages/stdlib', rootDir)
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
