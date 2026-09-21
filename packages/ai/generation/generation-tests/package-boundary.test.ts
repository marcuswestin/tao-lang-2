import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

type GenerationManifest = {
  exports?: Record<string, string>
}

const generationRoot = FS.resolvePath('..', import.meta.dir)

Describe('generation package boundary', () => {
  Test('keeps the main entry portable and the native service behind a server subpath', async () => {
    const manifest = await FS.readJson<GenerationManifest>(FS.resolvePath('package.json', generationRoot))
    Expect(manifest.exports).toMatchObject({
      '.': './generation-src/generation.ts',
      './apple/server': './generation-src/apple-server.ts',
    })

    const portableSources = await relativeDependencySources(
      FS.resolvePath('generation-src/generation.ts', generationRoot),
    )
    for (const [path, source] of portableSources) {
      Expect(path).not.toContain('apple-foundation-models-service')
      // `@shared/core` is the platform-free half of `@shared` — the error taxonomy, `Assert`,
      // `Switch`, `Text`, `Time` — and it is what Metro resolves into an app bundle. The portable
      // entry may reach it; the `@shared` root and its Node-backed wrappers stay out.
      Expect(source).not.toMatch(/(?:from\s+|import\s*(?:\(\s*)?)['"](?:node:|@shared(?!\/core))/)
    }
  })

  Test('keeps @shared/core platform-free, which is what lets a bundle-bound entry reach it', async () => {
    // The rule above narrowed from `@shared` to `@shared/core`, so "no Node reaches an app bundle"
    // now rests entirely on that entry staying clean. Nothing asserted it until here: a `node:` import
    // added to `core/Text.ts` would have satisfied both this package's boundary and Metro's alias.
    const coreRoot = FS.resolvePath('packages/shared/shared-src/core', Repo.getRoot())
    const offenders: string[] = []
    for await (const path of FS.walk(coreRoot, { extensions: ['.ts'] })) {
      const source = await FS.readText(path)
      if (/(?:from\s+|import\s*(?:\(\s*)?)['"]node:/.test(source)) {
        offenders.push(FS.relativePath(Repo.getRoot(), path))
      }
    }

    Expect(offenders).toEqual([])
  })
})

async function relativeDependencySources(entry: string): Promise<Map<string, string>> {
  const sources = new Map<string, string>()
  const pending = [entry]
  while (pending.length > 0) {
    const path = pending.pop()!
    if (sources.has(path)) {
      continue
    }
    const source = await FS.readText(path)
    sources.set(path, source)
    for (const match of source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1]!
      pending.push(FS.resolvePath(`${specifier}.ts`, FS.dirname(path)))
    }
  }
  return sources
}
