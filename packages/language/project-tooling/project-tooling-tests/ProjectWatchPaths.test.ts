import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  explicitProjectConfigWatchPaths,
  explicitProjectOwnershipWatchPaths,
  explicitProjectSidecarWatchPaths,
  ignoredProjectWatchPath,
  isProjectWatchInput,
} from '../project-tooling-src/ProjectWatchPaths'

Describe('project watch paths', () => {
  Test('watches exact maintained inputs and native output through generated and installed ignores', () => {
    const root = FS.resolvePath('project')
    const input = FS.resolvePath('host/node_modules/expo-file-system/build/index.d.ts')
    const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', root)
    const native = new Set([input, output, FS.resolvePath('host')])
    const empty = new Set<string>()
    for (const path of [input, output]) {
      Expect(ignoredProjectWatchPath(path, root, empty, empty, empty, empty, native)).toBe(false)
      for (const event of ['add', 'change', 'unlink']) {
        Expect(isProjectWatchInput(event, path, root, empty, empty, empty, empty, native)).toBe(true)
      }
    }
    Expect(ignoredProjectWatchPath(FS.dirname(input), root, empty, empty, empty, empty, native)).toBe(false)
    Expect(
      isProjectWatchInput('change', FS.resolvePath('.tao-ts/Other.ts', root), root, empty, empty, empty, empty, native),
    ).toBe(false)
    Expect(
      isProjectWatchInput('change', FS.resolvePath('host/.tao-ts/Other.ts'), root, empty, empty, empty, empty, native),
    ).toBe(false)
  })

  Test('watches only exact external config inputs and missing targets', () => {
    const root = FS.resolvePath('project')
    const external = FS.resolvePath('shared/config.json')
    const missing = FS.resolvePath('shared/missing.json')
    const generated = FS.resolvePath('.tao/cache/typescript/tsconfig.json', root)
    const dependencies = new Set<string>()
    const inputs = new Set([external, missing, generated])
    Expect(explicitProjectConfigWatchPaths(inputs, root, dependencies)).toEqual([external, missing])
    Expect(ignoredProjectWatchPath(FS.dirname(missing), root, dependencies, inputs)).toBe(false)
    Expect(isProjectWatchInput('add', missing, root, dependencies, inputs)).toBe(true)
    Expect(isProjectWatchInput('change', external, root, dependencies, inputs)).toBe(true)
    Expect(isProjectWatchInput('unlink', missing, root, dependencies, inputs)).toBe(true)
    Expect(isProjectWatchInput('change', FS.resolvePath('shared/unrelated.json'), root, dependencies, inputs))
      .toBe(false)
    Expect(isProjectWatchInput('change', generated, root, dependencies, inputs)).toBe(false)
  })

  Test('watches exact external sidecar files and unresolved candidates', () => {
    const root = FS.resolvePath('project')
    const outside = FS.resolvePath('host/Widget.tsx')
    const missing = FS.resolvePath('host/Helper.ts')
    const sibling = FS.resolvePath('host/Unrelated.ts')
    const generated = FS.resolvePath('host/.tao-ts/Widget.tao.ts')
    const inputs = new Set([outside, missing, generated])
    const dependencies = new Set<string>()
    Expect(explicitProjectSidecarWatchPaths(inputs, root, dependencies)).toEqual([outside, missing])
    Expect(ignoredProjectWatchPath(FS.dirname(missing), root, dependencies, new Set(), inputs)).toBe(false)
    for (const event of ['add', 'change', 'unlink']) {
      Expect(isProjectWatchInput(event, missing, root, dependencies, new Set(), inputs)).toBe(true)
      Expect(isProjectWatchInput(event, sibling, root, dependencies, new Set(), inputs)).toBe(false)
    }
    Expect(isProjectWatchInput('change', generated, root, dependencies, new Set(), inputs)).toBe(false)
  })

  Test('observes only exact external ownership markers as directory events', () => {
    const root = FS.resolvePath('project')
    const marker = FS.resolvePath('host/.tao')
    const sibling = FS.resolvePath('host/other')
    const markerChild = FS.resolvePath('host/.tao/store/project.json')
    const inputs = new Set([marker])
    const dependencies = new Set<string>()
    Expect(explicitProjectOwnershipWatchPaths(inputs, root)).toEqual([marker])
    Expect(ignoredProjectWatchPath(marker, root, dependencies, new Set(), new Set(), inputs)).toBe(false)
    for (const event of ['addDir', 'unlinkDir']) {
      Expect(isProjectWatchInput(event, marker, root, dependencies, new Set(), new Set(), inputs)).toBe(true)
      Expect(isProjectWatchInput(event, sibling, root, dependencies, new Set(), new Set(), inputs)).toBe(false)
    }
    Expect(isProjectWatchInput('add', markerChild, root, dependencies, new Set(), new Set(), inputs)).toBe(false)
    const nested = FS.resolvePath('Host/.tao', root)
    Expect(explicitProjectOwnershipWatchPaths(new Set([nested, FS.resolvePath('.tao', root)]), root))
      .toEqual([nested])
    Expect(isProjectWatchInput('addDir', nested, root, dependencies, new Set(), new Set(), new Set([nested])))
      .toBe(true)
  })

  Test('ignores published contracts and installs without hiding authored source', () => {
    const root = FS.resolvePath('project')
    const dependencies = new Set<string>()
    Expect(ignoredProjectWatchPath(FS.resolvePath('Screen.tao', root), root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(FS.resolvePath('src/Screen.tsx', root), root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(FS.resolvePath('.tao-ts/Screen.tao.ts', root), root, dependencies)).toBe(true)
    Expect(ignoredProjectWatchPath(FS.resolvePath('.tao/cache/typescript/tsconfig.json', root), root, dependencies))
      .toBe(
        true,
      )
    Expect(ignoredProjectWatchPath(FS.resolvePath('node_modules/@tao/runtime/index.ts', root), root, dependencies))
      .toBe(true)
    Expect(ignoredProjectWatchPath(FS.resolvePath('.artifacts/logs/check.log', root), root, dependencies)).toBe(true)
  })

  Test('watches selected local dependencies while excluding their own generated output', () => {
    const root = FS.resolvePath('project')
    const dependencyRoot = FS.resolvePath('Library/cards', root)
    const dependencies = new Set([dependencyRoot])
    Expect(ignoredProjectWatchPath(FS.resolvePath('View.tao', dependencyRoot), root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(FS.resolvePath('.tao-ts/View.tao.ts', dependencyRoot), root, dependencies)).toBe(
      true,
    )
    Expect(ignoredProjectWatchPath(FS.resolvePath('elsewhere/View.tao'), root, dependencies)).toBe(true)
  })

  Test('refreshes for marker and lock inputs without watching generated or installed trees', () => {
    const root = FS.resolvePath('project')
    const dependencies = new Set<string>()
    const marker = FS.resolvePath('.tao', root)
    const gitkeep = FS.resolvePath('.tao/.gitkeep', root)
    const lock = FS.resolvePath('.tao/store/lock.jsonc', root)
    const identity = FS.resolvePath('.tao/store/project.json', root)
    const config = FS.resolvePath('tao.config.jsonc', root)
    const generated = FS.resolvePath('.tao/cache/typescript/tsconfig.json', root)
    const install = FS.resolvePath('.tao/cache/install/origins/one/node_modules/pkg/package.json', root)
    Expect(ignoredProjectWatchPath(marker, root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(gitkeep, root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(lock, root, dependencies)).toBe(false)
    Expect(ignoredProjectWatchPath(identity, root, dependencies)).toBe(false)
    Expect(isProjectWatchInput('addDir', marker, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('unlinkDir', marker, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('add', gitkeep, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('unlink', gitkeep, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('change', lock, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('change', identity, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('change', config, root, dependencies)).toBe(true)
    Expect(isProjectWatchInput('change', generated, root, dependencies)).toBe(false)
    Expect(isProjectWatchInput('add', install, root, dependencies)).toBe(false)
    Expect(isProjectWatchInput('change', FS.resolvePath('.tao/other.jsonc', root), root, dependencies))
      .toBe(false)
  })

  Test('applies the same marker policy to selected dependency roots', () => {
    const root = FS.resolvePath('project')
    const dependencyRoot = FS.resolvePath('Library', root)
    const dependencies = new Set([dependencyRoot])
    Expect(isProjectWatchInput('change', FS.resolvePath('.tao/store/lock.jsonc', dependencyRoot), root, dependencies))
      .toBe(true)
    Expect(isProjectWatchInput('addDir', FS.resolvePath('.tao', dependencyRoot), root, dependencies))
      .toBe(true)
    Expect(
      isProjectWatchInput(
        'change',
        FS.resolvePath('.tao/cache/typescript/tsconfig.json', dependencyRoot),
        root,
        dependencies,
      ),
    )
      .toBe(false)
  })
})
