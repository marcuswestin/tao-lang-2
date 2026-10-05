import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { type BuildRecord, runTaoBuild } from '../cli-src/build-command'
import { runTaoInstall } from '../cli-src/install-command'

Describe('tao build project dependency snapshot', () => {
  Test('builds an own-app view through an unmarked sibling helper without copying its neighbours', async () => {
    const root = await mkTestDir('tao-build-external-sidecar-', { location: 'host' })
    const app = FS.resolvePath('App', root)
    const output = FS.resolvePath('builds', root)
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', app), '')
      await FS.writeText(
        FS.resolvePath('Main.tao', app),
        `app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   view Main
}

view Main() from ../Host/Widget.tsx
`,
      )
      await FS.writeText(
        FS.resolvePath('Host/Widget.tsx', root),
        `import { value } from './Helper'
export function Main(_props: unknown) { return value === 'reached-helper' ? null : null }
`,
      )
      await FS.writeText(FS.resolvePath('Host/Helper.ts', root), "export const value = 'reached-helper'\n")
      await FS.writeText(FS.resolvePath('Host/Unrelated.ts', root), "export const value = 'unrelated-sibling'\n")

      Expect(await runTaoBuild(app, { appName: 'Reader', targets: ['web'], output, compileOnly: true })).toBe(0)
      const [buildId] = await FS.listDir(output)
      const record = await FS.readJson<BuildRecord>(FS.resolvePath(`${buildId}/build.json`, output))
      Expect(record.results.web?.status).toBe('succeeded')
      const generated = record.results.web?.status === 'succeeded' ? record.results.web.artifact : ''
      const emitted: string[] = []
      for await (const path of FS.walk(generated, { extensions: ['.ts', '.tsx'] })) {
        emitted.push(await FS.readText(path))
      }
      Expect(emitted.join('\n')).toContain('reached-helper')
      Expect(emitted.join('\n')).not.toContain('unrelated-sibling')
      await FS.writeText(FS.resolvePath('Host/Unrelated.ts', root), "export const value = 'changed-neighbour'\n")
      Expect(await runTaoBuild(app, { appName: 'Reader', targets: ['web'], output, compileOnly: true })).toBe(0)
      const buildIds = await FS.listDir(output)
      const secondId = buildIds.find(id => id !== buildId)!
      const second = await FS.readJson<BuildRecord>(FS.resolvePath(`${secondId}/build.json`, output))
      Expect(second.sourceDigest).toBe(record.sourceDigest)
    } finally {
      await FS.remove(root)
    }
  }, 180_000)

  Test('exports a sibling publication with a private TypeScript helper and npm aliases', async () => {
    const root = await mkTestDir('tao-build-dependencies-')
    const consumer = FS.resolvePath('consumer', root)
    const library = FS.resolvePath('library', root)
    const output = FS.resolvePath('builds', root)
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', consumer), '')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', library), '')
      await FS.writeText(
        FS.resolvePath('App.tao', consumer),
        `use Card from @cards

app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   requires ../library version ^1.0.0 { @ui as @cards }
   view Main
}

view Main() { render Card() }
`,
      )
      await FS.writeText(
        FS.resolvePath('Package.tao', library),
        `package {
   version 1.0.0
   license MIT
   includes @ui
   requires ts npm:some-name version 1.0.0 as localutil
   requires ts npm:other-name version 2.0.0 as otherutil
}
`,
      )
      await FS.writeText(FS.resolvePath('@ui/Card.tao', library), 'public view Card() from ./Native.tsx\n')
      await FS.writeText(
        FS.resolvePath('@ui/Native.tsx', library),
        `import { mark } from 'localutil'
import { tag } from 'otherutil'
import { prefix } from './Helper'
export function Card(_props: unknown) { mark(prefix); tag(prefix); return null }
`,
      )
      await FS.writeText(FS.resolvePath('@ui/Helper.ts', library), 'export const prefix = "private helper"\n')
      await runTaoInstall(consumer, { appName: 'Reader' }, {
        installNpm: async directory => {
          for (
            const dependency of [
              {
                alias: 'localutil',
                name: 'some-name',
                version: '1.0.0',
                declaration: 'export declare function mark(value: string): string\n',
                implementation: 'exports.mark = value => value\n',
              },
              {
                alias: 'otherutil',
                name: 'other-name',
                version: '2.0.0',
                declaration: 'export declare function tag(value: string): string\n',
                implementation: 'exports.tag = value => value\n',
              },
            ]
          ) {
            const packageRoot = FS.resolvePath(`node_modules/${dependency.alias}`, directory)
            await FS.writeJson(FS.resolvePath('package.json', packageRoot), {
              name: dependency.name,
              version: dependency.version,
              main: 'index.js',
              types: 'index.d.ts',
            })
            await FS.writeText(FS.resolvePath('index.d.ts', packageRoot), dependency.declaration)
            await FS.writeText(FS.resolvePath('index.js', packageRoot), dependency.implementation)
          }
        },
      })

      Expect(await runTaoBuild(consumer, { appName: 'Reader', targets: ['web'], output }))
        .toBe(0)
      const [buildId] = await FS.listDir(output)
      const record = await FS.readJson<BuildRecord>(FS.resolvePath(`${buildId}/build.json`, output))
      Expect(record.results.web?.status).toBe('succeeded')
      Expect(record.sourceDigest).toMatch(/^[a-f0-9]{64}$/u)
      Expect(await FS.isFile(FS.resolvePath(`${buildId}/web/site/index.html`, output))).toBe(true)

      const compiledOutput = FS.resolvePath('compiled-builds', root)
      Expect(
        await runTaoBuild(consumer, {
          appName: 'Reader',
          targets: ['web'],
          output: compiledOutput,
          compileOnly: true,
        }),
      ).toBe(0)
      const [compiledId] = await FS.listDir(compiledOutput)
      const compiled = await FS.readJson<BuildRecord>(FS.resolvePath(`${compiledId}/build.json`, compiledOutput))
      Expect(compiled.results.web?.status).toBe('succeeded')
      const generated = compiled.results.web?.status === 'succeeded' ? compiled.results.web.artifact : ''
      const generatedSources: string[] = []
      for await (const path of FS.walk(generated, { extensions: ['.tsx'] })) {
        generatedSources.push(await FS.readText(path))
      }
      const compiledCode = generatedSources.join('\n')
      Expect(compiledCode).toContain(`"tao.declaration",1,"${ProjectIdentity.read(consumer)}"`)
      Expect(compiledCode).toContain(`"tao.declaration",1,"${ProjectIdentity.read(library)}"`)
      const links = await FS.readJson<{ links: { relativePath: string; target: string }[] }>(
        `${generated}.tao-module-links.json`,
      )
      const dependencyLinks = links.links.filter(link => link.relativePath.includes('/dependencies/'))
      Expect(dependencyLinks.length).toBe(1)
      const sharedModules = dependencyLinks[0]!.target
      await FS.remove(FS.resolvePath('.tao/cache/install', consumer))
      Expect(await FS.exists(FS.resolvePath('.tao/cache/install', consumer))).toBe(false)
      const artifactRoot = FS.resolvePath(compiledId!, compiledOutput)
      const resolvedModules = await FS.realPath(sharedModules)
      Expect(FS.pathIsWithin(resolvedModules, artifactRoot)).toBe(true)
      const packageParents: string[] = []
      for (
        const [alias, implementation] of [
          ['localutil', 'exports.mark = value => value\n'],
          ['otherutil', 'exports.tag = value => value\n'],
        ]
      ) {
        const resolvedPackage = await FS.realPath(FS.resolvePath(alias, sharedModules))
        Expect(FS.pathIsWithin(resolvedPackage, artifactRoot)).toBe(true)
        packageParents.push(FS.dirname(resolvedPackage))
        Expect(await FS.readText(FS.resolvePath('index.js', resolvedPackage))).toBe(implementation)
      }
      Expect(packageParents[0]).toBe(packageParents[1])
      Expect(await FS.exists(FS.resolvePath('.tao-ts', library))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('node_modules', library))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  }, 60_000)
})
