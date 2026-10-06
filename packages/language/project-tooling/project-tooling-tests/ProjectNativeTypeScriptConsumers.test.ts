import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import * as ts from 'typescript'
import { withNativeProgram } from './ProjectNativeTestSupport'

Describe('isolated native TypeScript checking for authored consumers', () => {
  Test('retains generated native ping types in an ordinary authored consumer', async () => {
    await withNativeProgram(async ({ root, check }) => {
      Expect((await check()).diagnostics).toEqual([])
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        'import type { Ping } from "./Native.tao"\nexport const ping: Ping = value => value\nping(123)\n',
      )
      Expect((await check()).diagnostics.some(diagnostic =>
        diagnostic.code === 'TS2345'
        && diagnostic.filePath === FS.resolvePath('Main.ts', root)
      )).toBe(true)
    })
  })

  Test('preserves ordinary authored Node imports while checking native code without host globals', async () => {
    await withNativeProgram(async ({ root, check }) => {
      await FS.writeText(
        FS.resolvePath('Host.ts', root),
        'import { readFileSync } from "node:fs"\nexport const bytes: Buffer = readFileSync("example")\n',
      )
      Expect((await check()).diagnostics).toEqual([])
      await FS.writeText(
        FS.resolvePath('Host.ts', root),
        'import { readFileSync } from "node:fs"\nexport const bytes: number = readFileSync("example")\n',
      )
      Expect((await check()).diagnostics.some(diagnostic =>
        diagnostic.code === 'TS2322'
        && diagnostic.filePath === FS.resolvePath('Host.ts', root)
      )).toBe(true)
    })
  })

  Test('isolates an incompatible authored global from actual generated native wrapper checking', async () => {
    await withNativeProgram(async ({ root, implementation, check }) => {
      Expect(await FS.readText(implementation)).toContain('ArrayBufferResize')
      await FS.writeText(
        FS.resolvePath('HostGlobals.ts', root),
        'export {}\ndeclare global { interface ArrayBuffer { resize(length: number): string } }\n',
      )
      const read = ts.readConfigFile(FS.resolvePath('tsconfig.json', root), ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
      const mixed = ts.createProgram(parsed.fileNames, parsed.options)
      Expect(
        ts.getPreEmitDiagnostics(mixed).some(diagnostic =>
          diagnostic.code === 2322
          && diagnostic.file?.fileName === implementation
        ),
      ).toBe(true)
      Expect((await check()).diagnostics).toEqual([])
    })
  })
})
