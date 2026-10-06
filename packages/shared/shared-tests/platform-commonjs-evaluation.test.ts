import { CLI, FS, Platform, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'

// Bun caches the transpiled form of a module over 50 KB, in a directory it fixes at startup. The
// installed CLI names that directory only after startup, so a large file it requires lands in the
// user's home cache instead; evaluating the file directly must leave no cache entry at all.
Test('evaluating a large CommonJS file resolves its requires and writes no transpiler cache', async () => {
  const directory = await mkTestDir('tao-commonjs-evaluation-')
  const filler = `// ${'x'.repeat(98)}\n`.repeat(700)
  await FS.writeFile(FS.resolvePath('sibling.js', directory), `module.exports = { answer: 42 }\n`)
  await FS.writeFile(
    FS.resolvePath('large.js', directory),
    `${filler}exports.answer = require('./sibling.js').answer\nexports.file = __filename\n`,
  )
  const platform = FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot())
  const large = FS.resolvePath('large.js', directory)
  const run = async (cache: string, load: string) => {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: ['-e', load],
      cwd: Repo.getRoot(),
      env: { BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache },
    })
    Expect(result.exitCode).toBe(0)
    return { cached: (await FS.exists(cache)) ? await FS.listDir(cache) : [], stdout: result.stdout.trim() }
  }

  const required = await run(
    FS.resolvePath('required-cache', directory),
    `process.stdout.write(String(require(${JSON.stringify(large)}).answer))`,
  )
  Expect(required.stdout).toBe('42')
  // Only the large file is over the threshold here, so this one entry is its cached form.
  Expect(required.cached).toHaveLength(1)

  const evaluated = await run(
    FS.resolvePath('evaluated-cache', directory),
    `const Platform = await import(${JSON.stringify(platform)});`
      + ` const value = Platform.evaluateCommonJsFile(${JSON.stringify(large)});`
      + ` process.stdout.write(JSON.stringify([value.answer, value.file]))`,
  )
  Expect(JSON.parse(evaluated.stdout)).toEqual([42, large])
  // Platform's own sources may be cached; the evaluated file must not be.
  Expect(evaluated.cached).not.toContain(required.cached[0])
})
