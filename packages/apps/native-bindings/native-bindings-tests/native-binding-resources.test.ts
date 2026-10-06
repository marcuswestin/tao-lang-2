import { FS, Platform, TaoResources, TaoStdlib } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import {
  generateMaintainedNativeBindings,
  inspectMaintainedNativeBindings,
} from '../native-bindings-src/maintained-native-bindings'
import { maintainedNativeSources } from '../native-bindings-src/maintained-native-sources'
import { stageNativeBindingResources } from '../native-bindings-src/native-binding-resources'
import { resolveTypeScriptApiEngineInput } from '../native-bindings-src/typescript-api-source'

const resourceEnvironment = testOverrideSlot<{ resources: string | undefined; stdlib: string | undefined }>({
  read: () => ({
    resources: Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV],
    stdlib: Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV],
  }),
  equals: (left, right) => left.resources === right.resources && left.stdlib === right.stdlib,
  write: value => {
    for (
      const [name, setting] of [[TaoResources.DECLARED_ROOT_ENV, value.resources], [
        TaoStdlib.DECLARED_ROOT_ENV,
        value.stdlib,
      ]] as const
    ) {
      if (setting === undefined) {
        delete Platform.runtimeProcess.env[name]
      } else {
        Platform.runtimeProcess.env[name] = setting
      }
    }
  },
})

async function withResources<T>(resources: string, run: () => Promise<T>): Promise<T> {
  const restore = resourceEnvironment.install({ resources, stdlib: undefined })
  try {
    return await run()
  } finally {
    restore()
  }
}

async function fixture(
  run: (options: { stdlibRoot: string; sourceRoots: string[] }, root: string) => Promise<void>,
): Promise<void> {
  const declarations = Object.fromEntries(maintainedNativeSources.flatMap(source => {
    const directory = `source/node_modules/${source.packageName}`
    return [
      [
        `${directory}/package.json`,
        JSON.stringify({ name: source.packageName, version: source.version, types: 'build/index.d.ts' }),
      ],
      [
        `${directory}/build/index.d.ts`,
        `export * from './legacyWarnings';\nexport declare function ping(): Promise<void>;\n${
          source.defer.filter(item => item.declaration === 'build/index.d.ts').map(item =>
            `export declare function ${item.symbol}(): void;`
          ).join('\n')
        }`,
      ],
      [
        `${directory}/build/legacyWarnings.d.ts`,
        source.defer.filter(item => item.declaration === 'build/legacyWarnings.d.ts').map(item =>
          `export declare function ${item.symbol}(): void;`
        ).join('\n'),
      ],
    ]
  }))
  await withTaoFiles('native-resource-staging', declarations, async (_paths, root) => {
    const options = {
      stdlibRoot: FS.resolvePath('original-stdlib', root),
      sourceRoots: [FS.resolvePath('source', root)],
    }
    const restore = resourceEnvironment.install({ resources: undefined, stdlib: undefined })
    try {
      const engine = resolveTypeScriptApiEngineInput(options.sourceRoots[0]!)
      const bootstrapRoot = FS.resolvePath('source-engine/resources', root)
      const bootstrapEngine = FS.resolvePath(
        `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
        bootstrapRoot,
      )
      await FS.copyDirectory(
        await FS.realPath(FS.dirname(FS.dirname(engine))),
        FS.dirname(FS.dirname(bootstrapEngine)),
      )
      await withResources(bootstrapRoot, async () => {
        Expect(resolveTypeScriptApiEngineInput(options.sourceRoots[0]!)).toBe(bootstrapEngine)
        await generateMaintainedNativeBindings({ ...options, mode: 'write' })
        await run(options, root)
      })
    } finally {
      restore()
    }
  }, { verbatim: true })
}

async function copyVisibleBindings(from: string, resourceRoot: string): Promise<void> {
  for (const source of maintainedNativeSources) {
    await FS.copyDirectory(
      FS.resolvePath(`@tao/device/${source.capability}`, from),
      FS.resolvePath(`${TaoResources.STDLIB_DIRECTORY}/@tao/device/${source.capability}`, resourceRoot),
    )
  }
}

async function filesIdentity(directory: string, suffix?: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for await (const path of FS.walk(directory, { includeHidden: true })) {
    if (suffix === undefined || path.endsWith(suffix)) {
      files[FS.relativePath(directory, path)] = Platform.sha256Hex(await FS.readText(path))
    }
  }
  return files
}

Describe('installed native binding resource staging', () => {
  Test('copies the exact engine, generator and hidden implementations without installing a native host', async () => {
    await fixture(async (options, root) => {
      const outputRoot = FS.resolvePath('distribution/resources', root)
      const originalEngine = resolveTypeScriptApiEngineInput(options.sourceRoots[0]!)
      const engineHash = Platform.sha256Hex(await FS.readText(originalEngine))
      const generator = FS.resolvePath('../native-bindings-src', import.meta.dir)
      const generatorFiles = await filesIdentity(generator, '.ts')
      await stageNativeBindingResources({ ...options, outputRoot })
      const stagedEngine = FS.resolvePath(
        `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
        outputRoot,
      )
      Expect(Platform.sha256Hex(await FS.readText(stagedEngine))).toBe(engineHash)
      Expect(await filesIdentity(FS.resolvePath(TaoResources.NATIVE_BINDINGS_GENERATOR_DIRECTORY, outputRoot), '.ts'))
        .toEqual(generatorFiles)
      Expect(await filesIdentity(FS.resolvePath('stdlib/.tao-ts/native-bindings', outputRoot))).toEqual(
        await filesIdentity(FS.resolvePath('.tao-ts/native-bindings', options.stdlibRoot)),
      )
      Expect(await FS.exists(FS.resolvePath('stdlib/@tao/device/files/Bindings.tao', outputRoot))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('../host', outputRoot))).toBe(false)
      await copyVisibleBindings(options.stdlibRoot, outputRoot)
      await withResources(outputRoot, async () => {
        Expect(TaoStdlib.declaredRoot()).toBe(FS.resolvePath(TaoResources.STDLIB_DIRECTORY, outputRoot))
        Expect(resolveTypeScriptApiEngineInput(root)).toBe(stagedEngine)
        const inspected = await inspectMaintainedNativeBindings()
        Expect(inspected.status).toBe('fresh')
        Expect(inspected.inputPaths).toContain(stagedEngine)
        Expect(inspected.inputPaths).not.toContain(FS.resolvePath('../../../..', import.meta.dirname))
        Expect(inspected.inputPaths).not.toContain('/')
      })
    })
  })

  Test('checks and regenerates a relocated distribution after its original source tree is removed', async () => {
    await fixture(async (options, root) => {
      const originalRoot = FS.resolvePath('distribution/resources', root)
      await stageNativeBindingResources({ ...options, outputRoot: originalRoot })
      await copyVisibleBindings(options.stdlibRoot, originalRoot)
      const relocated = FS.resolvePath('relocated/resources', root)
      await FS.copyDirectory(originalRoot, relocated)
      const before = await filesIdentity(FS.resolvePath(TaoResources.STDLIB_DIRECTORY, relocated))
      await FS.remove(originalRoot)
      await FS.remove(options.stdlibRoot)
      await FS.remove(options.sourceRoots[0]!)
      await FS.remove(FS.resolvePath('source-engine', root))
      await withResources(relocated, async () => {
        Expect(await FS.exists(FS.resolvePath('../host', relocated))).toBe(false)
        const inspected = await inspectMaintainedNativeBindings({ sourceRoots: [] })
        Expect(inspected.status).toBe('fresh')
        Expect(resolveTypeScriptApiEngineInput(root)).toBe(
          FS.resolvePath(
            `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
            relocated,
          ),
        )
        Expect(await generateMaintainedNativeBindings({ sourceRoots: [], mode: 'check' })).toEqual(
          inspected.outputPaths,
        )
        await generateMaintainedNativeBindings({ sourceRoots: [], mode: 'write' })
        Expect(await filesIdentity(FS.resolvePath(TaoResources.STDLIB_DIRECTORY, relocated))).toEqual(before)
        Expect(await FS.exists(FS.resolvePath('../host', relocated))).toBe(false)
      })
    })
  })

  Test(
    'refuses ready staging and offline regeneration when the staged engine or declaration payload drifts',
    async () => {
      await fixture(async (options, root) => {
        const outputRoot = FS.resolvePath('distribution/resources', root)
        await stageNativeBindingResources({ ...options, outputRoot })
        await copyVisibleBindings(options.stdlibRoot, outputRoot)
        const engine = FS.resolvePath(
          `${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib/typescript.js`,
          outputRoot,
        )
        const originalEngine = await FS.readText(engine)
        const blocked = FS.resolvePath('blocked/resources', root)
        await FS.writeText(FS.resolvePath('sentinel.txt', blocked), 'keep')
        await withResources(outputRoot, async () => {
          await FS.writeText(engine, `${originalEngine}\n// changed engine payload\n`)
          const changedEngine = await inspectMaintainedNativeBindings({ sourceRoots: [] })
          Expect(changedEngine.status).toBe('stale')
          Expect(changedEngine.diagnostics[0]?.message).toContain('pinned TypeScript engine')
          await Expect(generateMaintainedNativeBindings({ sourceRoots: [], mode: 'write' })).rejects.toThrow(
            'pinned TypeScript engine',
          )
          await Expect(stageNativeBindingResources({ sourceRoots: [], outputRoot: blocked })).rejects.toThrow(
            'pinned TypeScript engine',
          )
          await FS.writeText(engine, originalEngine)
          const input = FS.resolvePath(
            'stdlib/.tao-ts/native-bindings/photos/inputs/node_modules/expo-media-library/build/index.d.ts',
            outputRoot,
          )
          await FS.writeText(input, `${await FS.readText(input)}\nexport declare function added(): void;\n`)
          const changedPayload = await inspectMaintainedNativeBindings({ sourceRoots: [] })
          Expect(changedPayload.status).toBe('stale')
          Expect(changedPayload.diagnostics[0]?.message).toContain('inventory or contents changed')
          await Expect(generateMaintainedNativeBindings({ sourceRoots: [], mode: 'write' })).rejects.toThrow(
            'offline declaration payload',
          )
          await Expect(stageNativeBindingResources({ sourceRoots: [], outputRoot: blocked })).rejects.toThrow(
            'inventory or contents changed',
          )
          Expect(await FS.readText(FS.resolvePath('sentinel.txt', blocked))).toBe('keep')
          Expect(await FS.exists(FS.resolvePath('stdlib/.tao-ts', blocked))).toBe(false)
        })
      })
    },
  )
})
