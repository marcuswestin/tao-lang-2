import { FS } from '@shared'
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
      Expect(source).not.toMatch(/(?:from\s+|import\s*(?:\(\s*)?)['"](?:node:|@shared)/)
    }
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
