import { CLI, FS, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  COMPILE_INPUT_FILES,
  COMPILE_SOURCE_ROOTS,
  type CompileAppOptions,
  compileAppOutputHash,
  NO_CACHE_ENV_KEYS,
  runCompileApp,
} from '../dev-src/repository-tests/CompileApp'
import { TAO_TEST_NO_CACHE_ENV_KEY } from '../dev-src/repository-tests/GateRunner'

const APP_PATH = 'Apps/Example/Example.tao'
const OUTPUT_ROOT = 'packages/runtime-toolchain/_gen_tao-app'
const SOURCE_ROOTS = ['packages/compiler/compiler-src', 'packages/stdlib'] as const
const INPUT_FILES = ['bun.lock', 'packages/compiler/package.json'] as const
const STAMP = '.artifacts/compile-app-stamp.json'

/** GENERATED is what the substitute compiler writes, standing in for the generated app tree. */
const GENERATED = ['App.tsx', 'modules/@ui/Shell.tao.tsx', 'modules/external/Views.tao.tsx'] as const

/** repository builds a checkout skeleton with the same shape the real compile stamp reads. */
async function repository(): Promise<string> {
  const root = await mkTestDir('tao-compile-app-')
  await FS.writeText(FS.resolvePath(APP_PATH, root), 'app Example\n')
  await FS.writeText(FS.resolvePath('Apps/Example/@ui/Shell.tao', root), 'view Shell\n')
  await FS.writeText(FS.resolvePath('Apps/Example/@ui/Shell.ts', root), 'export const shell = 1\n')
  await FS.writeText(FS.resolvePath('packages/compiler/compiler-src/Compiler.ts', root), 'export const compiler = 1\n')
  await FS.writeText(FS.resolvePath('packages/stdlib/@tao/Prelude.tao', root), 'package Prelude\n')
  await FS.writeText(FS.resolvePath('bun.lock', root), '{}\n')
  await FS.writeJson(FS.resolvePath('packages/compiler/package.json', root), { name: 'tao-compiler' })
  return root
}

/** compiler substitutes `./tao compile`, recording each call and writing what the compiler writes. */
function compiler(exitCode = 0) {
  const calls: string[] = []
  const compile = async (appPath: string, appName: string | undefined, root: string): Promise<number> => {
    calls.push(`${FS.relativePath(root, appPath)}#${appName ?? ''}`)
    if (exitCode !== 0) {
      return exitCode
    }
    for (const relative of GENERATED) {
      await FS.writeText(FS.resolvePath(`${OUTPUT_ROOT}/${relative}`, root), `compiled ${calls.length}\n`)
    }
    return 0
  }
  return { calls, compile }
}

/**
 * run invokes the stamp against the fixture roots rather than the repository's real ones.
 *
 * `noCache` is pinned rather than left to the environment, because these tests are about the stamp
 * and a lane that ran them under `--no-cache` would set `TAO_TEST_NO_CACHE` on every process in its
 * graph, including this one. Each test then asks the question it means to ask: a test that wants the
 * opt-out passes it, and every other test reads the stamp whatever the lane around it was told.
 * `--concurrent` rules out the alternative of mutating the environment, which every sibling reads.
 */
async function run(
  root: string,
  compile: CompileAppOptions['compile'],
  appName = 'Example',
  overrides: Partial<CompileAppOptions> = {},
): Promise<number> {
  return await runCompileApp({
    appName,
    appPath: APP_PATH,
    compile,
    inputFiles: INPUT_FILES,
    noCache: false,
    outputRoot: OUTPUT_ROOT,
    repositoryRoot: root,
    sourceRoots: SOURCE_ROOTS,
    ...overrides,
  })
}

Describe('app compilation staleness stamp', () => {
  Test('compiles once and skips while the inputs and the generated tree are unchanged', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      Expect(await run(root, tao.compile)).toBe(0)
      Expect(await run(root, tao.compile)).toBe(0)
      Expect(await run(root, tao.compile)).toBe(0)

      Expect(tao.calls).toEqual(['Apps/Example/Example.tao#Example'])
      Expect(await FS.isFile(FS.resolvePath(STAMP, root))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles on a changed app source and skips again once it is reverted', async () => {
    const root = await repository()
    const tao = compiler()
    const source = FS.resolvePath(APP_PATH, root)
    const original = await FS.readText(source)
    try {
      await run(root, tao.compile)
      await FS.writeText(source, `${original}view Added\n`)
      await run(root, tao.compile)
      Expect(tao.calls.length).toBe(2)

      await FS.writeText(source, original)
      await run(root, tao.compile)
      await run(root, tao.compile)
      Expect(tao.calls.length).toBe(3)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when a TypeScript sidecar beside the app sources changes', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('Apps/Example/@ui/Shell.ts', root), 'export const shell = 2\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when a file is added to the app tree without any existing file changing', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('Apps/Example/@data/Data.tao', root), 'package Data\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the compiler source changes, not only when the app does', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('packages/compiler/compiler-src/Compiler.ts', root), 'export const c = 2\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the Tao stdlib changes', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('packages/stdlib/@tao/Prelude.tao', root), 'package Prelude\nview Extra\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the dependency lock changes', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('bun.lock', root), '{"lockfileVersion": 1}\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when a Project.tao appears above the app, changing project identity', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath('Apps/Project.tao', root), 'project Apps\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the selected app name changes though every file is identical', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile, 'Example')

      Expect(await run(root, tao.compile, 'Other')).toBe(0)
      Expect(tao.calls).toEqual(['Apps/Example/Example.tao#Example', 'Apps/Example/Example.tao#Other'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when a generated file is deleted, whatever the stamp says', async () => {
    const root = await repository()
    const tao = compiler()
    const generated = FS.resolvePath(`${OUTPUT_ROOT}/${GENERATED[1]}`, root)
    try {
      await run(root, tao.compile)
      await FS.remove(generated)

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
      Expect(await FS.readText(generated)).toBe('compiled 2\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the whole generated tree is reclaimed', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.remove(FS.resolvePath(OUTPUT_ROOT, root))

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
      Expect(await FS.isFile(FS.resolvePath(`${OUTPUT_ROOT}/${GENERATED[0]}`, root))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when generated output is corrupted, not just when it is missing', async () => {
    const root = await repository()
    const tao = compiler()
    const generated = FS.resolvePath(`${OUTPUT_ROOT}/${GENERATED[0]}`, root)
    try {
      await run(root, tao.compile)
      await FS.writeText(generated, 'truncated by an interrupted write\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
      Expect(await FS.readText(generated)).toBe('compiled 2\n')
    } finally {
      await FS.remove(root)
    }
  })

  Test('recompiles when the tree holds another app, which adds files rather than changing them', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.writeText(FS.resolvePath(`${OUTPUT_ROOT}/modules/@ui/Other.tao.tsx`, root), 'another app\n')

      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('never stamps a failed compile, so the next run repeats the work instead of skipping', async () => {
    const root = await repository()
    const tao = compiler(1)
    try {
      Expect(await run(root, tao.compile)).toBe(1)
      Expect(await FS.exists(FS.resolvePath(STAMP, root))).toBe(false)

      Expect(await run(root, tao.compile)).toBe(1)
      Expect(tao.calls.length).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses to stamp a compile whose inputs moved while it ran', async () => {
    const root = await repository()
    const source = FS.resolvePath(APP_PATH, root)
    try {
      await Expect(run(root, async (_appPath, _appName, repositoryRoot) => {
        for (const relative of GENERATED) {
          await FS.writeText(FS.resolvePath(`${OUTPUT_ROOT}/${relative}`, repositoryRoot), 'raced\n')
        }
        await FS.writeText(source, 'app Example\nview RacedIn\n')
        return 0
      })).rejects.toThrow('inputs changed while the compile ran')

      Expect(await FS.exists(FS.resolvePath(STAMP, root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails when the compile reports success but writes nothing', async () => {
    const root = await repository()
    try {
      await Expect(run(root, async () => 0)).rejects.toThrow('produced no output')
      Expect(await FS.exists(FS.resolvePath(STAMP, root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an app path that names no file', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await Expect(runCompileApp({
        appPath: 'Apps/Missing/Missing.tao',
        compile: tao.compile,
        inputFiles: INPUT_FILES,
        outputRoot: OUTPUT_ROOT,
        repositoryRoot: root,
        sourceRoots: SOURCE_ROOTS,
      })).rejects.toThrow('No Tao app file found at')
      Expect(tao.calls).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('hashes the generated tree by content, so equal trees at different paths agree', async () => {
    const root = await repository()
    const other = await mkTestDir('tao-compile-app-copy-')
    const tao = compiler()
    try {
      await run(root, tao.compile)
      await FS.copyDirectory(FS.resolvePath(OUTPUT_ROOT, root), FS.resolvePath(OUTPUT_ROOT, other))

      Expect(await compileAppOutputHash(FS.resolvePath(OUTPUT_ROOT, other)))
        .toBe(await compileAppOutputHash(FS.resolvePath(OUTPUT_ROOT, root)))
    } finally {
      await FS.remove(other)
      await FS.remove(root)
    }
  })

  Test('leaves no temporary stamp file behind', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      await run(root, tao.compile)

      Expect(await FS.listDir(FS.resolvePath('.artifacts', root))).toEqual(['compile-app-stamp.json'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('serializes independent compiles and rechecks staleness after acquiring the lock', async () => {
    const root = await repository()
    const releasePath = FS.resolvePath('release-first', root)
    const modulePath = Repo.resolvePath('packages/dev/dev-src/repository-tests/CompileApp.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const worker = (id: string, hold: boolean) => `
      import { Errors, FS, Platform, Time } from ${JSON.stringify(sharedPath)}
      import { runCompileApp } from ${JSON.stringify(modulePath)}
      const root = Platform.runtimeProcess.env['TAO_COMPILE_APP_ROOT']
      if (!root) Errors.throwUnexpected('Missing compile app root.')
      const result = await runCompileApp({
        appName: 'Example',
        appPath: ${JSON.stringify(APP_PATH)},
        inputFiles: ${JSON.stringify(INPUT_FILES)},
        // Pinned for the same reason the in-process helper pins it, and separately: a child process
        // inherits this lane's environment, so a \`--no-cache\` run would have both workers compile
        // and the lock's in-lock staleness recheck would have nothing to decide.
        noCache: false,
        outputRoot: ${JSON.stringify(OUTPUT_ROOT)},
        repositoryRoot: root,
        sourceRoots: ${JSON.stringify(SOURCE_ROOTS)},
        compile: async (_appPath, _appName, repositoryRoot) => {
          await FS.writeText(FS.resolvePath(${JSON.stringify(`entered-${id}`)}, root), '')
          ${hold ? `while (!await FS.exists(${JSON.stringify(releasePath)})) await Time.sleep(5)` : ''}
          for (const relative of ${JSON.stringify(GENERATED)}) {
            const path = FS.resolvePath(${JSON.stringify(OUTPUT_ROOT)} + '/' + relative, repositoryRoot)
            await FS.writeText(path, ${JSON.stringify(`compiled-${id}\n`)})
          }
          return 0
        },
      })
      Platform.runtimeProcess.setExitCode(result)
    `
    const start = (id: string, hold: boolean) =>
      CLI.run('bun', { args: ['-e', worker(id, hold)], env: { TAO_COMPILE_APP_ROOT: root }, stdio: 'pipe' })
    const first = start('first', true)
    let second: Promise<CLI.CommandResult> | undefined
    try {
      Expect(
        await Time.pollUntil(async () => await FS.exists(FS.resolvePath('entered-first', root)), {
          intervalMs: 5,
          timeoutMs: 10_000,
        }),
      ).toBe(true)
      second = start('second', false)
      await Time.sleep(100)
      Expect(await FS.exists(FS.resolvePath('entered-second', root))).toBe(false)
      await FS.writeText(releasePath, '')
      const results = await Promise.all([first, second])

      Expect(results.map(result => result.exitCode)).toEqual([0, 0])
      // The second process reached the lock while the first was still compiling, so it re-read the
      // stamp inside the lock and skipped rather than compiling over the first process's output.
      Expect(await FS.exists(FS.resolvePath('entered-second', root))).toBe(false)
      Expect(await FS.readText(FS.resolvePath(`${OUTPUT_ROOT}/${GENERATED[0]}`, root))).toBe('compiled-first\n')
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await first.catch(() => undefined)
      await second?.catch(() => undefined)
      await FS.remove(root)
    }
  })

  // `--no-cache` is the one flag every verification scope takes, and it means the same thing in all
  // of them: run anyway rather than trust recorded evidence. This gate honoured its stamp whatever
  // the lane said, so the flag a developer reaches for when they suspect a stale generated app was
  // the one flag that could not rebuild it.
  Test('rebuilds when the lane says not to trust recorded evidence', async () => {
    const root = await repository()
    const tao = compiler()
    try {
      Expect(await run(root, tao.compile)).toBe(0)
      Expect(await run(root, tao.compile)).toBe(0)
      Expect(tao.calls).toHaveLength(1)

      Expect(await run(root, tao.compile, 'Example', { noCache: true })).toBe(0)

      Expect(tao.calls).toHaveLength(2)
    } finally {
      await FS.remove(root)
    }
  })

  // The flag reaches this gate as an environment variable a lane sets on every child of its graph,
  // and the two ends live in modules that never read each other's source.
  Test('reads the variable the lane actually sets', () => {
    Expect(NO_CACHE_ENV_KEYS).toContain(TAO_TEST_NO_CACHE_ENV_KEY)
  })

  // Both lists are hand-maintained, and a path that stops existing is recorded `<absent>` rather
  // than reported: a renamed or moved source tree would silently stop being covered, and the stamp
  // would keep skipping compiles over sources it no longer reads. Nothing else notices, because a
  // hash of nothing is a perfectly stable hash.
  Test('names only inputs this checkout actually has', async () => {
    const missing: string[] = []
    for (const root of COMPILE_SOURCE_ROOTS) {
      if (!await FS.isDirectory(Repo.resolvePath(root))) {
        missing.push(root)
      }
    }
    for (const file of COMPILE_INPUT_FILES) {
      if (!await FS.isFile(Repo.resolvePath(file))) {
        missing.push(file)
      }
    }

    Expect(missing).toEqual([])
  })

  // The two lists describe one package each from different angles — its sources and its `exports`
  // map — so a package named in one and not the other is a half-declared input.
  Test("declares each package's sources and its manifest together", () => {
    const packagesWithSources = new Set(
      COMPILE_SOURCE_ROOTS.map(root => root.split('/')[1]).filter(name => name !== undefined),
    )
    const packagesWithManifests = new Set(
      COMPILE_INPUT_FILES.filter(file => file.endsWith('/package.json')).map(file => file.split('/')[1]),
    )

    Expect([...packagesWithSources].toSorted()).toEqual([...packagesWithManifests].toSorted())
  })
})
