import { FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { CheckCache } from '../cli-src/check-cache'
import { checkedWorkspaces, NESTED_WORKSPACE, TWO_WORKSPACES } from './helpers/check-cache-fixtures'
import { copyMaintainedBindingPayload } from './maintained-bindings-fixture'
import { withTaoFixture } from './test-cli-files'

Describe('tao check per-workspace stamp', () => {
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
      await copyMaintainedBindingPayload(FS.resolvePath('packages/apps/stdlib', rootDir))
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
