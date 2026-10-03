import { FS, Platform, TaoStdlib } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { TestCache } from '../cli-src/test-cache'
import { withGitTaoFixture, withTaoFixture } from './test-cli-files'

/**
 * The fingerprint is the whole of the correctness argument for reusing compiled output: anything it
 * fails to cover is a run that can be handed a stale green. These tests own the inputs an
 * end-to-end `tao test` run cannot vary — the set of files being run, where the output lives, and a
 * project file above every directory the command was pointed at.
 */

const fixture = {
  'Project.tao': 'project { id "cache-fingerprint-test" name "Cache fingerprint test" }',
  'Nested/Project.tao': 'project { id "cache-fingerprint-nested" name "Cache fingerprint nested" }',
  'Nested/App.tao': 'app Fingerprinted { view Main }\nview Main() { }\n',
  'Nested/App.test.tao': 'use Fingerprinted from ./\ntest "Fingerprinted" { }\n',
  'Nested/Other.test.tao': 'use Fingerprinted from ./\ntest "Other" { }\n',
  'Nested/@ui/Shell.tao': 'public view Shell() { }\n',
  'Nested/@ui/Shell.ts': 'export const shell = 1\n',
} as const

/** requestFor builds one run's fingerprint request over the nested project inside a fixture. */
function requestFor(rootDir: string, testFileNames: readonly string[] = ['App.test.tao']) {
  const nested = FS.resolvePath('Nested', rootDir)
  return {
    roots: [nested],
    runtimeRoot: FS.resolvePath('runtime-root', rootDir),
    testPaths: testFileNames.map(name => FS.resolvePath(name, nested)),
  }
}

/** withDeclaredStdlibRoot points `TAO_STDLIB_ROOT` at a payload tree for the duration of one test. */
async function withDeclaredStdlibRoot<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
  Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = value
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = previous
    }
  }
}

/** fingerprintOf resolves the fingerprint and fails the test rather than silently comparing nothing. */
async function fingerprintOf(request: ReturnType<typeof requestFor>): Promise<string> {
  const found = await TestCache.fingerprint(request)
  Expect(found).toBeDefined()
  return found!
}

Describe('tao test compiled-output fingerprint', () => {
  // The manifest describes one whole run. Reusing it for a different set of test files would run
  // the files the manifest names rather than the files that were asked for.
  Test('changes with the set of test files the run covers', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const one = await fingerprintOf(requestFor(rootDir))
      const both = await fingerprintOf(requestFor(rootDir, ['App.test.tao', 'Other.test.tao']))

      Expect(both).not.toBe(one)
    })
  })

  // Compiled output lives inside the runtime package root and names it in every module path.
  Test('changes with the runtime package root the output is compiled into', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const here = await fingerprintOf(requestFor(rootDir))
      const elsewhere = await fingerprintOf({
        ...requestFor(rootDir),
        runtimeRoot: FS.resolvePath('other-runtime-root', rootDir),
      })

      Expect(elsewhere).not.toBe(here)
    })
  })

  Test('changes when a Tao source under the tested paths changes', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const before = await fingerprintOf(requestFor(rootDir))
      await FS.writeText(
        FS.resolvePath('Nested/App.tao', rootDir),
        'app Fingerprinted { view Main }\nview Main() { }\n// edited\n',
      )

      Expect(await fingerprintOf(requestFor(rootDir))).not.toBe(before)
    })
  })

  // A Tao project carries more than its declarations: `@` package directories hold TypeScript
  // sidecars beside the `.tao` files, and a fingerprint over `.tao` alone would hand a run compiled
  // output built from a sidecar it no longer contains.
  Test('changes when a non-Tao file inside the project changes', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const before = await fingerprintOf(requestFor(rootDir))
      await FS.writeText(FS.resolvePath('Nested/@ui/Shell.ts', rootDir), 'export const shell = 2\n')

      Expect(await fingerprintOf(requestFor(rootDir))).not.toBe(before)
    })
  })

  // The parse of every file below a project root carries the nearest project file above it, which
  // sits outside every path the command was given and outside the owning project root.
  Test('changes when a project file above the tested paths changes', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const before = await fingerprintOf(requestFor(rootDir))
      await FS.writeText(
        FS.resolvePath('Project.tao', rootDir),
        'project { id "cache-fingerprint-test" name "Renamed above the run" }',
      )

      Expect(await fingerprintOf(requestFor(rootDir))).not.toBe(before)
    })
  })

  // A project can sit above the very directory the run compiles into. Hashing that output would
  // make every run's fingerprint depend on the previous run's result, so nothing would ever repeat.
  Test('ignores the generated trees a run writes below the tested paths', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const before = await fingerprintOf(requestFor(rootDir))
      await FS.writeText(FS.resolvePath('runtime-root/_gen_tao-app-test/run-1-a/App.tsx', rootDir), 'compiled\n')
      await FS.writeText(FS.resolvePath('Nested/_gen_tao-app/App.tsx', rootDir), 'compiled\n')

      Expect(await fingerprintOf(requestFor(rootDir))).toBe(before)
    })
  })

  // The packaged Studio runner ships its stdlib as a payload tree outside `packages/`, where the
  // toolchain hash cannot see it. Refusing to fingerprint that configuration is honest but turns
  // the cache off for the one build that ships, so the declared tree is hashed instead.
  Test('fingerprints a run whose stdlib is declared outside the repository', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const payload = FS.resolvePath('payload-stdlib', rootDir)
      await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', payload), 'public view Text(Value text) { }\n')
      await withDeclaredStdlibRoot(payload, async () => {
        Expect(await fingerprintOf(requestFor(rootDir))).toBe(await fingerprintOf(requestFor(rootDir)))
      })
    })
  })

  Test('changes when a source inside a stdlib declared outside the repository changes', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const payload = FS.resolvePath('payload-stdlib', rootDir)
      const view = FS.resolvePath('@tao/ui/Views.tao', payload)
      await FS.writeText(view, 'public view Text(Value text) { }\n')
      await withDeclaredStdlibRoot(payload, async () => {
        const before = await fingerprintOf(requestFor(rootDir))
        await FS.writeText(view, 'public view Text(Value text) { }\n// edited\n')

        Expect(await fingerprintOf(requestFor(rootDir))).not.toBe(before)
      })
    })
  })

  // Redirecting the stdlib is itself a change to what compiles, even when the tree it is redirected
  // to is one the toolchain hash already covers.
  Test('changes when the stdlib is redirected at all', async () => {
    await withTaoFixture({ ...fixture }, async rootDir => {
      const payload = FS.resolvePath('payload-stdlib', rootDir)
      await FS.writeText(FS.resolvePath('@tao/ui/Views.tao', payload), 'public view Text(Value text) { }\n')
      const builtIn = await fingerprintOf(requestFor(rootDir))
      const redirected = await withDeclaredStdlibRoot(payload, () => fingerprintOf(requestFor(rootDir)))

      Expect(redirected).not.toBe(builtIn)
    })
  })

  // A project can live under a Git-ignored path — a scratch app under `.artifacts/tmp/` is the
  // documented way to try something out — and the source walk asks Git what is there. Git answers
  // with nothing, which is not "these sources are unchanged" but "I cannot see these sources", and
  // hashing that answer hands every later run of an edited scratch app the first run's green.
  Test('changes when a source under a Git-ignored path changes', async () => {
    await withGitTaoFixture({ ...fixture, '.gitignore': 'Nested/\n' }, async rootDir => {
      const before = await fingerprintOf(requestFor(rootDir))
      await FS.writeText(
        FS.resolvePath('Nested/App.tao', rootDir),
        'app Fingerprinted { view Main }\nview Main() { }\n// edited under an ignored path\n',
      )

      Expect(await fingerprintOf(requestFor(rootDir))).not.toBe(before)
    })
  })

  // The toolchain term is what ties a fingerprint to the compiler that produced the output. Without
  // it a run reuses output built by a different build of the compiler over byte-identical sources —
  // and every other term in the key is one this suite already varies, so its absence would show up
  // nowhere.
  Test('changes when the toolchain that compiled the output changes', async () => {
    await withTaoFixture(
      { ...fixture, 'toolchain/packages/language/parser/parser-src/Parse.ts': 'export const v = 1\n' },
      async rootDir => {
        const toolchainRoot = FS.resolvePath('toolchain', rootDir)
        const request = { ...requestFor(rootDir), toolchainRoot }
        const before = await fingerprintOf(request)
        await FS.writeText(
          FS.resolvePath('packages/language/parser/parser-src/Parse.ts', toolchainRoot),
          'export const v = 2\n',
        )

        Expect(await fingerprintOf(request)).not.toBe(before)
      },
    )
  })

  Test('reports reuse as switched off only for the documented value', async () => {
    const previous = Platform.runtimeProcess.env[TestCache.NO_CACHE_ENV]
    try {
      for (const [value, expected] of [[undefined, false], ['1', false], ['true', true]] as const) {
        if (value === undefined) {
          delete Platform.runtimeProcess.env[TestCache.NO_CACHE_ENV]
        } else {
          Platform.runtimeProcess.env[TestCache.NO_CACHE_ENV] = value
        }

        Expect(TestCache.disabled()).toBe(expected)
      }
    } finally {
      if (previous === undefined) {
        delete Platform.runtimeProcess.env[TestCache.NO_CACHE_ENV]
      } else {
        Platform.runtimeProcess.env[TestCache.NO_CACHE_ENV] = previous
      }
    }
  })
})
