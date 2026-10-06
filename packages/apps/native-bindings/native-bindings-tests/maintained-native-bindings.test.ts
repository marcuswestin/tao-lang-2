import { FS, Platform, Time } from '@shared'
import { Deferred, Describe, Expect, settle, Test, until, withTaoFiles } from '@shared/test'
import {
  generateMaintainedNativeBindings,
  inspectMaintainedNativeBindings,
} from '../native-bindings-src/maintained-native-bindings'
import { maintainedNativeSources } from '../native-bindings-src/maintained-native-sources'

function declarations(): Record<string, string> {
  return Object.fromEntries(maintainedNativeSources.flatMap(source => {
    const root = `source/node_modules/${source.packageName}`
    const legacy = source.defer.filter(item => item.declaration === 'build/legacyWarnings.d.ts')
    return [
      [
        `${root}/package.json`,
        JSON.stringify({ name: source.packageName, version: source.version, types: 'build/index.d.ts' }),
      ],
      [
        `${root}/build/index.d.ts`,
        `export * from './legacyWarnings';\nexport * from './operations';\n${
          source.defer.filter(item => item.declaration === 'build/index.d.ts').map(item =>
            `export declare function ${item.symbol}(): void;`
          ).join('\n')
        }`,
      ],
      [`${root}/build/operations.d.ts`, 'export declare function ping(): Promise<void>;'],
      [
        `${root}/build/legacyWarnings.d.ts`,
        legacy.map(item => `export declare function ${item.symbol}(): void;`).join('\n'),
      ],
    ]
  }))
}

function options(root: string) {
  return { stdlibRoot: FS.resolvePath('stdlib', root), sourceRoots: [FS.resolvePath('source', root)] }
}

async function snapshot(paths: readonly string[]): Promise<string[]> {
  return Promise.all(paths.map(async path => Platform.sha256Hex(await FS.readText(path))))
}

Describe('maintained native binding publication', () => {
  Test('lets two independent fresh readers inspect simultaneously without claiming the publication lock', async () => {
    await withTaoFiles('maintained-concurrent-readers', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      const lock = `${await FS.realPath(first)}.tao-file-mutation.lock`
      const release = Deferred()
      let entered = 0
      const readers = [0, 1].map(() =>
        inspectMaintainedNativeBindings(request, {
          afterManifestCapture: async () => {
            entered++
            await release.promise
          },
        })
      )
      try {
        await until(() => entered === 2, { description: 'both native readers to hold their own manifest snapshots' })
        Expect(await FS.exists(lock)).toBe(false)
      } finally {
        release.resolve()
      }
      const results = await Promise.all(readers)
      Expect(results.map(result => result.status)).toEqual(['fresh', 'fresh'])
      Expect(results[0]!.identity).toBe(results[1]!.identity)
    }, { verbatim: true })
  })

  Test('waits for a paused mixed publication instead of reporting a fresh snapshot', async () => {
    await withTaoFiles('maintained-paused-writer', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', request.stdlibRoot)
      const original = await FS.readText(output)
      const entered = Deferred()
      const release = Deferred()
      const writer = FS.withFileMutationLock(first, FS.dirname(first), async () => {
        await FS.writeText(output, 'mixed publication')
        entered.resolve()
        try {
          await release.promise
        } finally {
          await FS.writeText(output, original)
        }
      })
      await entered.promise
      let returned = false
      const reader = inspectMaintainedNativeBindings(request).then(result => {
        returned = true
        return result
      })
      try {
        await settle(20)
        Expect(returned).toBe(false)
      } finally {
        release.resolve()
      }
      await writer
      Expect((await reader).status).toBe('fresh')
    }, { verbatim: true })
  })

  Test('releases the publication lock before fallback readers hash the snapshot', async () => {
    await withTaoFiles('maintained-unlocked-fallback-reader', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      const writerEntered = Deferred()
      const releaseWriter = Deferred()
      const releaseReader = Deferred()
      let competingReaderReturned = false
      let publisherEntered = false
      let fallbackSelected = false
      let captureReached = false
      const writer = FS.withFileMutationLock(first, FS.dirname(first), async () => {
        writerEntered.resolve()
        await releaseWriter.promise
      })
      await writerEntered.promise
      const fallbackReader = inspectMaintainedNativeBindings(request, {
        beforePublicationBarrier: async () => {
          fallbackSelected = true
        },
        afterManifestCapture: async () => {
          captureReached = true
          await releaseReader.promise
        },
      })
      let competingReader: Promise<void> | undefined
      let publisher: Promise<void> | undefined
      try {
        await until(() => fallbackSelected, {
          description: 'native reader to select the publication barrier behind the paused writer',
        })
        releaseWriter.resolve()
        await writer
        await until(() => captureReached, { description: 'fallback native reader to capture its manifests' })
        const lock = `${await FS.realPath(first)}.tao-file-mutation.lock`
        Expect(await FS.exists(lock)).toBe(false)
        competingReader = inspectMaintainedNativeBindings(request).then(result => {
          Expect(result.status).toBe('fresh')
          competingReaderReturned = true
        })
        publisher = FS.withFileMutationLock(first, FS.dirname(first), async () => {
          publisherEntered = true
        })
        await until(
          () => competingReaderReturned && publisherEntered,
          { description: 'another reader and publisher to pass the paused fallback inspection' },
        )
        await Promise.all([competingReader, publisher])
      } finally {
        releaseWriter.resolve()
        releaseReader.resolve()
        await Promise.allSettled([
          writer,
          fallbackReader,
          ...[competingReader, publisher].filter(
            (promise): promise is Promise<void> => promise !== undefined,
          ),
        ])
      }
      Expect((await fallbackReader).status).toBe('fresh')
    }, { verbatim: true })
  })

  Test('confirms a stale optimistic result after a completed output rollback', async () => {
    await withTaoFiles('maintained-optimistic-output-rollback', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', request.stdlibRoot)
      const original = await FS.readText(output)
      const baseline = await inspectMaintainedNativeBindings(request)
      Expect(baseline.status).toBe('fresh')
      let changed = false
      let barrierUsed = false
      const result = await inspectMaintainedNativeBindings(request, {
        beforePublicationBarrier: async () => {
          barrierUsed = true
        },
        afterManifestCapture: async () => {
          changed = true
          await FS.writeText(output, 'temporary output mutation')
        },
        afterInspection: async () => {
          await FS.writeText(output, original)
        },
      })
      Expect(changed).toBe(true)
      Expect(barrierUsed).toBe(false)
      Expect(result.status).toBe('fresh')
      Expect(result.diagnostics).toEqual([])
      Expect(result.identity).toBe(baseline.identity)
    }, { verbatim: true })
  })

  Test('confirms a stale fallback result after a completed output rollback', async () => {
    await withTaoFiles('maintained-fallback-output-rollback', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', request.stdlibRoot)
      const original = await FS.readText(output)
      const baseline = await inspectMaintainedNativeBindings(request)
      Expect(baseline.status).toBe('fresh')
      const writerEntered = Deferred()
      const releaseWriter = Deferred()
      let fallbackSelected = false
      let changed = false
      const writer = FS.withFileMutationLock(first, FS.dirname(first), async () => {
        writerEntered.resolve()
        await releaseWriter.promise
      })
      await writerEntered.promise
      const reader = inspectMaintainedNativeBindings(request, {
        beforePublicationBarrier: async () => {
          fallbackSelected = true
        },
        afterManifestCapture: async () => {
          changed = true
          await FS.writeText(output, 'temporary output mutation')
        },
        afterInspection: async () => {
          await FS.writeText(output, original)
        },
      })
      let result: Awaited<typeof reader> | undefined
      try {
        await until(() => fallbackSelected, {
          description: 'native reader to choose the publication barrier before output rollback',
        })
        releaseWriter.resolve()
        await writer
        result = await reader
      } finally {
        releaseWriter.resolve()
        await Promise.allSettled([writer, reader])
        if (changed) {
          await FS.writeText(output, original)
        }
      }
      Expect(changed).toBe(true)
      Expect(result?.status).toBe('fresh')
      Expect(result?.diagnostics).toEqual([])
      Expect(result?.identity).toBe(baseline.identity)
    }, { verbatim: true })
  })

  Test('retries changed manifest bytes under the lock and refuses the new invalid manifest', async () => {
    await withTaoFiles('maintained-manifest-retry', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', request.stdlibRoot)
      const original = await FS.readText(manifestPath)
      let captured = 0
      const result = await inspectMaintainedNativeBindings(request, {
        afterManifestCapture: async () => {
          captured++
          const manifest = JSON.parse(original) as { engine: string }
          manifest.engine = '0'.repeat(64)
          await FS.writeText(manifestPath, JSON.stringify(manifest))
        },
      })
      Expect(captured).toBe(1)
      Expect(result.status).toBe('stale')
      Expect(result.diagnostics[0]?.message).toContain('pinned TypeScript engine')
      await FS.writeText(manifestPath, original)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('fresh')
      const restoredDuringInspection = await inspectMaintainedNativeBindings(request, {
        afterManifestCapture: async () => {
          const manifest = JSON.parse(original) as { engine: string }
          manifest.engine = '0'.repeat(64)
          await FS.writeText(manifestPath, JSON.stringify(manifest))
        },
        afterInspection: async () => {
          await FS.writeText(manifestPath, original)
        },
      })
      // An independent re-read of the temporary invalid manifest would incorrectly report stale.
      Expect(restoredDuringInspection.status).toBe('fresh')
      Expect(restoredDuringInspection.diagnostics).toEqual([])
    }, { verbatim: true })
  })

  Test('falls back when a writer restores identical manifest bytes but remains active after capture', async () => {
    await withTaoFiles('maintained-manifest-aba', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', request.stdlibRoot)
      const original = await FS.readText(manifestPath)
      const active = Deferred()
      const inspected = Deferred()
      const release = Deferred()
      let writer: Promise<void> | undefined
      let returned = false
      const reader = inspectMaintainedNativeBindings(request, {
        afterManifestCapture: async () => {
          writer = FS.withFileMutationLock(first, FS.dirname(first), async () => {
            await FS.writeText(manifestPath, `${original}\n`)
            await FS.writeText(manifestPath, original)
            active.resolve()
            await release.promise
          })
          await active.promise
        },
        afterInspection: async () => {
          inspected.resolve()
        },
      }).then(result => {
        returned = true
        return result
      })
      try {
        await active.promise
        await inspected.promise
        await settle(20)
        Expect(returned).toBe(false)
      } finally {
        release.resolve()
      }
      await writer
      Expect((await reader).status).toBe('fresh')
    }, { verbatim: true })
  })

  Test('publishes all roots with portable payloads and stable physical imports', async () => {
    await withTaoFiles('maintained-publication', declarations(), async (_paths, root) => {
      const request = options(root)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      Expect(await FS.exists(FS.resolvePath('.tao', request.stdlibRoot))).toBe(false)
      Expect(await FS.isEmptyDirectory(FS.resolvePath('.tao-ts/cache/native-bindings', request.stdlibRoot))).toBe(true)
      const fresh = await inspectMaintainedNativeBindings(request)
      Expect(fresh.status).toBe('fresh')
      Expect(fresh.diagnostics).toEqual([])
      Expect(fresh.outputPaths).toEqual(paths)
      Expect(fresh.inputPaths).toContain(
        FS.resolvePath('source/node_modules/expo-file-system/build/operations.d.ts', root),
      )
      const tao = FS.resolvePath('@tao/device/files/Bindings.tao', request.stdlibRoot)
      const ts = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', request.stdlibRoot)
      Expect(await FS.readText(tao)).toContain('../../../.tao-ts/native-bindings/files/Bindings.ts')
      Expect(await FS.readText(ts)).toContain('../../../@tao/device/files/Bindings.tao')
      const previous = await snapshot(paths)
      await FS.setModifiedTimeMs(ts, 1000000)
      const modified = await FS.modifiedTimeMs(ts)
      Expect(await generateMaintainedNativeBindings({ ...request, mode: 'check' })).toEqual(paths)
      await FS.mkdir(FS.resolvePath('.tao', request.stdlibRoot))
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      Expect(await FS.isEmptyDirectory(FS.resolvePath('.tao/cache/native-bindings', request.stdlibRoot))).toBe(true)
      Expect(await snapshot(paths)).toEqual(previous)
      Expect(await FS.modifiedTimeMs(ts)).toBe(modified)
      Expect((await inspectMaintainedNativeBindings(request)).identity).toBe(fresh.identity)
    }, { verbatim: true })
  })

  Test('detects declaration edits, additions and deletion without API re-extraction', async () => {
    await withTaoFiles('maintained-input-inventory', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const original = await inspectMaintainedNativeBindings(request)
      const extra = FS.resolvePath('source/node_modules/expo-file-system/build/new-export.d.ts', root)
      await FS.writeText(extra, 'export declare function added(): void;')
      const added = await inspectMaintainedNativeBindings(request)
      Expect(added.status).toBe('stale')
      Expect(added.identity).not.toBe(original.identity)
      Expect(added.diagnostics[0]?.message).toContain('inventory or contents changed')
      await FS.remove(extra)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('fresh')
      const input = FS.resolvePath('source/node_modules/expo-file-system/build/operations.d.ts', root)
      await FS.writeText(input, 'export declare function changed(): void;')
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
      await FS.remove(input)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
    }, { verbatim: true })
  })

  Test(
    'rehashes every batch across checks even when input and output sizes and timestamps stay unchanged',
    async () => {
      const contents = 'export declare const original: string;'
      const changed = 'export declare const modified: string;'
      const extra = Object.fromEntries(
        maintainedNativeSources.flatMap(source =>
          Array.from({ length: 65 }, (_, index) => [
            `source/node_modules/${source.packageName}/build/extra-${String(index).padStart(3, '0')}.d.ts`,
            contents,
          ])
        ),
      )
      await withTaoFiles('maintained-batched-contents', { ...declarations(), ...extra }, async (_paths, root) => {
        const request = options(root)
        await generateMaintainedNativeBindings({ ...request, mode: 'write' })
        const original = await inspectMaintainedNativeBindings(request)
        Expect(original.status).toBe('fresh')
        const inputs = maintainedNativeSources.map(source =>
          FS.resolvePath(`source/node_modules/${source.packageName}/build/extra-064.d.ts`, root)
        )
        const timestamps = await Promise.all(inputs.map(path => FS.modifiedTimeMs(path)))
        for (const [index, path] of inputs.entries()) {
          await FS.writeText(path, changed)
          await FS.setModifiedTimeMs(path, timestamps[index]!)
        }
        const stale = await inspectMaintainedNativeBindings(request)
        Expect(stale.status).toBe('stale')
        Expect(stale.diagnostics.map(item => item.filePath)).toEqual(
          maintainedNativeSources.map(source =>
            FS.resolvePath(`.tao-ts/native-bindings/${source.capability}/maintained.json`, request.stdlibRoot)
          ),
        )
        Expect(stale.identity).not.toBe(original.identity)
        for (const [index, path] of inputs.entries()) {
          await FS.writeText(path, contents)
          await FS.setModifiedTimeMs(path, timestamps[index]!)
        }
        Expect((await inspectMaintainedNativeBindings(request)).identity).toBe(original.identity)
        const output = FS.resolvePath(
          '.tao-ts/native-bindings/photos/inputs/node_modules/expo-media-library/build/extra-064.d.ts',
          request.stdlibRoot,
        )
        const timestamp = await FS.modifiedTimeMs(output)
        await FS.writeText(output, changed)
        await FS.setModifiedTimeMs(output, timestamp)
        Expect((await inspectMaintainedNativeBindings(request)).diagnostics[0]?.message).toContain(
          "output inventory or contents changed for 'photos'",
        )
        await FS.writeText(output, contents)
        await FS.setModifiedTimeMs(output, timestamp)
        const restored = await inspectMaintainedNativeBindings(request)
        Expect(restored.status).toBe('fresh')
        Expect(restored.identity).toBe(original.identity)
      }, { verbatim: true })
    },
  )

  Test('detects missing, edited and added outputs and repairs them from pinned inputs', async () => {
    await withTaoFiles('maintained-output-inventory', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const ts = FS.resolvePath('.tao-ts/native-bindings/photos', request.stdlibRoot)
      const binding = FS.resolvePath('Bindings.ts', ts)
      await FS.writeText(binding, 'changed')
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'check' })).rejects.toThrow(
        'output inventory or contents changed',
      )
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      await FS.writeText(FS.resolvePath('obsolete.ts', ts), 'obsolete')
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      Expect(await FS.exists(FS.resolvePath('obsolete.ts', ts))).toBe(false)
      await FS.remove(binding)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      await FS.remove(FS.resolvePath('maintained.json', ts))
      Expect((await inspectMaintainedNativeBindings(request)).diagnostics[0]?.message).toContain('manifest is missing')
    }, { verbatim: true })
  })

  Test('preserves every previous root when the second package fails extraction or its exact pin changes', async () => {
    await withTaoFiles('maintained-atomic-failure', declarations(), async (_paths, root) => {
      const request = options(root)
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const previous = await snapshot(paths)
      await FS.writeText(
        FS.resolvePath('source/node_modules/expo-file-system/build/operations.d.ts', root),
        'export declare function changed(): void;',
      )
      await FS.writeText(
        FS.resolvePath('source/node_modules/expo-media-library/build/operations.d.ts', root),
        'export declare function impossible(callback: () => number): void;',
      )
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'write' })).rejects.toThrow('impossible')
      Expect(await snapshot(paths)).toEqual(previous)
      const manifest = FS.resolvePath('source/node_modules/expo-media-library/package.json', root)
      await FS.writeText(
        manifest,
        JSON.stringify({ name: 'expo-media-library', version: '0.0.0', types: 'build/index.d.ts' }),
      )
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'write' })).rejects.toThrow(
        "exact version '57.0.5'",
      )
      Expect(await snapshot(paths)).toEqual(previous)
      Expect((await inspectMaintainedNativeBindings(request)).status).toBe('stale')
    }, { verbatim: true })
  })

  Test('regenerates offline from verified declarations and refuses corrupted payloads', async () => {
    await withTaoFiles('maintained-offline', declarations(), async (_paths, root) => {
      const request = options(root)
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const previous = await snapshot(paths)
      await FS.remove(FS.resolvePath('source', root))
      const offline = { stdlibRoot: request.stdlibRoot, sourceRoots: [] }
      Expect((await inspectMaintainedNativeBindings(offline)).status).toBe('fresh')
      await generateMaintainedNativeBindings({ ...offline, mode: 'write' })
      Expect(await snapshot(paths)).toEqual(previous)
      const input = FS.resolvePath(
        '.tao-ts/native-bindings/files/inputs/node_modules/expo-file-system/build/operations.d.ts',
        request.stdlibRoot,
      )
      await FS.writeText(input, 'corrupted')
      Expect((await inspectMaintainedNativeBindings(offline)).status).toBe('stale')
      await Expect(generateMaintainedNativeBindings({ ...offline, mode: 'write' })).rejects.toThrow(
        'offline declaration payload',
      )
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'write' })).rejects.toThrow(
        'supplied declaration source roots',
      )
    }, { verbatim: true })
  })

  Test('refuses an unowned fourth root before publishing any earlier root', async () => {
    await withTaoFiles('maintained-unowned-root', declarations(), async (_paths, root) => {
      const request = options(root)
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const photos = FS.resolvePath('.tao-ts/native-bindings/photos', request.stdlibRoot)
      const earlier = paths.filter(path => !FS.pathIsWithin(path, photos))
      const previous = await snapshot(earlier)
      await FS.remove(photos)
      await FS.writeText(FS.resolvePath('Notes.ts', photos), 'handwritten')
      await FS.writeText(
        FS.resolvePath('source/node_modules/expo-file-system/build/operations.d.ts', root),
        'export declare function changed(): void;',
      )
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'write' })).rejects.toThrow(
        'not a generated binding directory',
      )
      Expect(await snapshot(earlier)).toEqual(previous)
      Expect(await FS.readText(FS.resolvePath('Notes.ts', photos))).toBe('handwritten')
    }, { verbatim: true })
  })

  Test('reports engine drift during inspection and rejects unsafe payload package names', async () => {
    await withTaoFiles('maintained-engine-and-paths', declarations(), async (_paths, root) => {
      const request = options(root)
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', request.stdlibRoot)
      const original = await FS.readText(manifestPath)
      const manifest = JSON.parse(original) as { engine: string }
      manifest.engine = '0'.repeat(64)
      await FS.writeText(manifestPath, JSON.stringify(manifest))
      const stale = await inspectMaintainedNativeBindings(request)
      Expect(stale.status).toBe('stale')
      Expect(stale.diagnostics[0]?.message).toContain('pinned TypeScript engine')
      await FS.writeText(manifestPath, original)
      const previous = await snapshot(paths)
      await FS.writeText(
        FS.resolvePath('source/node_modules/decl-package/package.json', root),
        JSON.stringify({ name: '../escape', version: '1.0.0', types: 'index.d.ts' }),
      )
      await FS.writeText(
        FS.resolvePath('source/node_modules/decl-package/index.d.ts', root),
        'export interface Options { value: string }',
      )
      await FS.writeText(
        FS.resolvePath('source/node_modules/expo-media-library/build/operations.d.ts', root),
        `import type { Options } from 'decl-package';\nexport declare function ping(value: Options): void;`,
      )
      await Expect(generateMaintainedNativeBindings({ ...request, mode: 'write' })).rejects.toThrow(
        'payload names must stay inside',
      )
      Expect(await snapshot(paths)).toEqual(previous)
    }, { verbatim: true })
  })

  Test(
    'checks default libraries against the active engine rather than an API private TypeScript type entry',
    async () => {
      await withTaoFiles('maintained-engine-owner', {
        ...declarations(),
        'source/node_modules/expo-file-system/node_modules/typescript/package.json': JSON.stringify({
          name: 'typescript',
          version: '0.0.0',
          types: 'index.d.ts',
          main: 'missing.js',
        }),
        'source/node_modules/expo-file-system/node_modules/typescript/index.d.ts':
          'export declare const Shadow: never;',
      }, async (_paths, root) => {
        const request = options(root)
        await generateMaintainedNativeBindings({ ...request, mode: 'write' })
        const inspected = await inspectMaintainedNativeBindings(request)
        Expect(inspected.status).toBe('fresh')
        Expect(inspected.diagnostics).toEqual([])
        Expect(inspected.inputPaths.some(path => path.endsWith('/typescript/lib/typescript.js'))).toBe(true)
        Expect(inspected.inputPaths).not.toContain(
          FS.resolvePath('source/node_modules/expo-file-system/node_modules/typescript/index.d.ts', root),
        )
      }, { verbatim: true })
    },
  )

  Test('serializes concurrent publication and inspection across the entire maintained registry', async () => {
    await withTaoFiles('maintained-concurrent', declarations(), async (_paths, root) => {
      const request = options(root)
      const paths = await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const previous = await snapshot(paths)
      const results = await Promise.all([
        generateMaintainedNativeBindings({ ...request, mode: 'write' }),
        inspectMaintainedNativeBindings(request),
        generateMaintainedNativeBindings({ ...request, mode: 'check' }),
      ])
      Expect(results[1].status).toBe('fresh')
      Expect(results[2]).toEqual(paths)
      Expect(await snapshot(paths)).toEqual(previous)
    }, { verbatim: true })
  })

  Test('lets concurrent fresh and stale readers all finish after a publication', async () => {
    await withTaoFiles('maintained-many-readers', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const fresh = await Promise.all(Array.from({ length: 16 }, () => inspectMaintainedNativeBindings(request)))
      Expect(fresh.map(result => result.status)).toEqual(fresh.map(() => 'fresh'))
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', request.stdlibRoot)
      await FS.writeText(output, 'drifted output')
      const stale = await Promise.all(Array.from({ length: 8 }, () => inspectMaintainedNativeBindings(request)))
      Expect(stale.map(result => result.status)).toEqual(stale.map(() => 'stale'))
    }, { verbatim: true })
  })

  Test('inspects under the lock when other readers hold it at every final probe', async () => {
    await withTaoFiles('maintained-contended-probe', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const first = FS.resolvePath('@tao/device/files', request.stdlibRoot)
      // Each hold stands in for another reader's barrier or stale confirmation: brief and self-releasing.
      let release = Deferred()
      let holder: Promise<void> = Promise.resolve()
      let probes = 0
      const result = await inspectMaintainedNativeBindings(request, {
        beforeFinalProbe: async () => {
          probes++
          release = Deferred()
          const entered = Deferred()
          const ownRelease = release
          holder = FS.withFileMutationLock(first, FS.dirname(first), async () => {
            entered.resolve()
            // budget-ok: a rival reader's lock is brief by nature; the fallback must find it released.
            await Promise.race([ownRelease.promise, Time.sleep(250)])
          })
          await entered.promise
        },
        beforePublicationBarrier: async () => {
          release.resolve()
          await holder
        },
      })
      await holder
      Expect(probes).toBeGreaterThanOrEqual(2)
      Expect(result.status).toBe('fresh')
    }, { verbatim: true })
  })

  Test('surfaces an unreadable manifest as its own error rather than a changing-files retry', async () => {
    await withTaoFiles('maintained-unreadable-manifest', declarations(), async (_paths, root) => {
      const request = options(root)
      await generateMaintainedNativeBindings({ ...request, mode: 'write' })
      const manifestPath = FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', request.stdlibRoot)
      await FS.chmod(manifestPath, 0o000)
      let reported: string
      try {
        reported = await inspectMaintainedNativeBindings(request).then(
          result => result.diagnostics.map(item => item.message).join('\n'),
          (error: unknown) => String(error),
        )
      } finally {
        await FS.chmod(manifestPath, 0o644)
      }
      Expect(reported).not.toContain('kept changing')
      Expect(reported).toMatch(/EACCES|permission denied/i)
    }, { verbatim: true })
  })
})
