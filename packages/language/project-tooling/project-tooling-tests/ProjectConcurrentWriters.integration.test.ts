import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, Test, until, withTaoFiles } from '@shared/test'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

type ChildResult = {
  phase: number
  results: Array<
    Pick<ProjectToolingResult, 'contractPaths' | 'sourceMappings' | 'status' | 'revision'> & {
      diagnostics: Array<{ code?: string; filePath: string; severity: string }>
    }
  >
}

type OutputManifest = {
  version: number
  outputs: Array<{
    path: string
    sourcePath: string
    hash: string
    kind: string
    sourceMappings: ProjectToolingResult['sourceMappings']
  }>
}

Describe('project tooling concurrent process publication', () => {
  Test('keeps contracts and diagnostics coherent across two independent refresh writers', async () => {
    await withTaoFiles('tao-tooling-concurrent-writers-', {
      'Main.tao': `function CountWords(Value text) returns number {
  return CountWords(Value) from ./Words.ts
}
`,
      'Words.ts': 'export function CountWords(value: string): number { return value.length }\n',
      '.tao-ts/Handwritten.ts': 'export const handwritten = true\n',
    }, async (paths, root) => {
      const gateRoot = FS.resolvePath('gates', root)
      const childFile = FS.resolvePath('ProjectConcurrentWriters.child.ts', import.meta.dir)
      const output = ['', '']
      const children = [0, 1].map(index =>
        CLI.start(Platform.runtimeProcess.execPath, {
          args: [childFile, root, gateRoot],
          onOutput: (stream, chunk) => {
            output[index] += stream === 'stdout' ? chunk.toString() : `STDERR:${chunk.toString()}`
          },
          processPolicy: 'test',
          timeoutMs: 120_000,
          idleOutputMs: 90_000,
          stdio: 'pipe',
        })
      )
      const contractPath = FS.resolvePath('.tao-ts/Main.tao.ts', root)
      const manifestPath = FS.resolvePath('.tao/typescript/outputs.json', root)
      const lockPath = FS.resolvePath('.tao/ts-gen-lock.tao-file-mutation.lock', root)
      const handwrittenPath = paths['.tao-ts/Handwritten.ts']
      let firstContract: string | undefined
      try {
        for (let phase = 0; phase < 3; phase += 1) {
          await until(() => output.every(text => text.includes(`READY:${phase}\n`)), {
            description: `both refresh processes ready for phase ${phase}`,
          })
          await FS.writeText(FS.resolvePath(String(phase), gateRoot), '')
          await until(() => output.every(text => childResults(text).some(result => result.phase === phase)), {
            description: `both refresh processes completed phase ${phase}`,
          })
          const results = output.flatMap(text =>
            childResults(text).find(result => result.phase === phase)?.results ?? []
          )
          Expect(results).toHaveLength(4)
          Expect(results.every(result =>
            result.contractPaths.length === 1
            && result.contractPaths[0] === contractPath
          )).toBe(true)
          Expect(
            results.every(result =>
              result.sourceMappings.some(mapping =>
                mapping.sourcePath === paths['Main.tao'] && mapping.generatedPath === contractPath
              )
            ),
          ).toBe(true)
          for (const text of output) {
            Expect(childResults(text).find(result => result.phase === phase)?.results.map(result => result.revision))
              .toEqual([phase * 2 + 1, phase * 2 + 2])
          }

          if (phase === 1) {
            Expect(results.every(result =>
              result.status === 'stale'
              && result.diagnostics.some(diagnostic =>
                diagnostic.filePath === paths['Main.tao'] && diagnostic.code === 'TS2344'
              )
            )).toBe(true)
          } else {
            Expect(results.every(result =>
              result.status === 'fresh'
              && result.diagnostics.every(diagnostic => diagnostic.severity !== 'error')
            )).toBe(true)
          }

          const manifest = await FS.readJson<OutputManifest>(manifestPath)
          const contract = await FS.readText(contractPath)
          if (phase === 0) {
            firstContract = contract
          } else {
            Expect(contract).toBe(firstContract)
          }
          Expect(manifest.version).toBe(1)
          Expect(manifest.outputs).toHaveLength(1)
          Expect(manifest.outputs[0]?.path).toBe(contractPath)
          Expect(manifest.outputs[0]?.sourcePath).toBe(paths['Main.tao'])
          Expect(manifest.outputs[0]?.kind).toBe('contract')
          Expect(manifest.outputs[0]?.hash).toBe(Platform.sha256Hex(contract))
          Expect(manifest.outputs[0]?.sourceMappings).toEqual(results[0]?.sourceMappings)
          Expect(await FS.readText(handwrittenPath)).toBe('export const handwritten = true')
          Expect(await FS.isFile(lockPath)).toBe(false)

          if (phase === 0) {
            const rootConfig = await FS.readJson<{ extends: string }>(FS.resolvePath('tsconfig.json', root))
            const generatedConfig = await FS.readJson<{ compilerOptions: { noEmit: boolean } }>(
              FS.resolvePath('.tao/typescript/tsconfig.json', root),
            )
            Expect(rootConfig.extends).toBe('./.tao/typescript/tsconfig.json')
            Expect(generatedConfig.compilerOptions.noEmit).toBe(true)
            await FS.writeText(
              paths['Words.ts'],
              'export function CountWords(value: number): number { return value }\n',
            )
          } else if (phase === 1) {
            await FS.writeText(
              paths['Words.ts'],
              'export function CountWords(value: string): number { return value.length }\n',
            )
          }
        }
        const completions = await Promise.all(children.map(child => child.waitForClose()))
        Expect(completions.every(completion => completion.exitCode === 0)).toBe(true)
      } finally {
        await Promise.all(children.map(async child => {
          child.kill('SIGKILL')
          await child.waitForClose()
          await child.closeOutput()
        }))
      }
    })
  }, 180_000)
})

function childResults(output: string): ChildResult[] {
  return output.split('\n').filter(line => line.startsWith('RESULT:'))
    .map(line => JSON.parse(line.slice('RESULT:'.length)) as ChildResult)
}
