import { Workspace } from '@compiler/workspace'
import { FS } from '@shared'
import { Describe, Expect, stubContainer, Test, withTaoFiles } from '@shared/test'
import { sidecarModuleSpecifiers } from '../compiler-src/sidecar-module-specifiers'

Describe('compiler: shared sidecar dependency identity', () => {
  Test('copies a dependency shared by distinct native roots once and rewrites both imports to it', async () => {
    await withTaoFiles('tao-shared-native-dependency-', {
      'Main.tao': `
        app SharedApp { id "com.tao.shared" version "0.1.0" name "Shared" view Home }
        view Home { render Container { First Second } }
        ${stubContainer('Container')}
        view First from ./first/First.tsx
        view Second from ./second/Second.tsx
      `,
      'first/First.tsx': `
        import React from 'react'
        import { state } from '../State'
        export function First() { return React.createElement('div', null, state()) }
      `,
      'second/Second.tsx': `
        import React from 'react'
        import { state } from '../State'
        export function Second() { return React.createElement('div', null, state()) }
      `,
      'State.ts': `let count = 0; export function state() { return ++count }`,
    }, async paths => {
      const compiled = await Workspace.compile(paths['Main.tao'], { appName: 'SharedApp' })
      const copies = compiled.files.filter(file => file.sourcePath === paths['State.ts'])
      Expect(copies).toHaveLength(1)
      for (const source of ['first/First.tsx', 'second/Second.tsx']) {
        const native = compiled.files.find(file => file.sourcePath === paths[source])!
        const dependency = sidecarModuleSpecifiers(native.code, native.sourcePath).find(import_ =>
          import_.value.startsWith('.')
        )!
        Expect(FS.resolvePath(dependency.value, FS.dirname(native.relativePath))).toBe(
          FS.resolvePath(copies[0]!.relativePath.replace(/\.ts$/, '')),
        )
      }
    })
  })
})
