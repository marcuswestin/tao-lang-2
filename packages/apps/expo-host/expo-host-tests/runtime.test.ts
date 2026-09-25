import Runtime, { type GeneratePreviewOptions, type ShipManifest } from '@expo-host'
import TR from '@runtime/TR'
import { Assert, CLI, Errors, FS, Repo } from '@shared'
import { AfterEach, Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'

const wordFlowerDir = Repo.resolvePath('Apps/WordFlower/1 - Current')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const previewProject = '/workspace/preview-project'
const runtimeRoots: string[] = []

async function createRuntimePackageRoot(): Promise<string> {
  const runtimePackageRoot = await mkTestDir('tao-runtime-test-')
  runtimeRoots.push(runtimePackageRoot)
  return runtimePackageRoot
}

async function createExecutableRuntimePackageRoot(name: string): Promise<string> {
  const runtimePackageRoot = await mkTestDir(`tao-runtime-${name}-`)
  // Register ownership before the next fallible acquisition step so AfterEach can always reclaim it.
  runtimeRoots.push(runtimePackageRoot)
  await FS.symlink(
    Repo.resolvePath('packages/apps/expo-host/node_modules'),
    FS.resolvePath('node_modules', runtimePackageRoot),
  )
  return runtimePackageRoot
}

function generatedAppPath(runtimePackageRoot: string): string {
  return FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
}

function generatedPreviewPath(runtimePackageRoot: string, relativePath: string): string {
  return FS.resolvePath(`_gen_tao-app/${relativePath}`, runtimePackageRoot)
}

function previewOptions(
  revision: number,
  overrides: Partial<GeneratePreviewOptions> = {},
): GeneratePreviewOptions {
  return {
    project: previewProject,
    revision,
    sourceVersions: { 'Main.tao': `text-v${revision}` },
    ...overrides,
  }
}

AfterEach(async () => {
  await cleanupRuntimeRoots(runtimeRoots.splice(0))
})

type RuntimeRootCleanupOperations = {
  remove: (root: string) => Promise<void> | void
  reset: (root: string) => Promise<void> | void
}

async function cleanupRuntimeRoots(
  roots: readonly string[],
  operations: RuntimeRootCleanupOperations = {
    remove: root => FS.remove(root),
    reset: root => Runtime.resetStudioPreviewSession({ runtimePackageRoot: root }),
  },
): Promise<void> {
  const failures: Array<{ error: unknown; label: string }> = []
  for (const root of roots) {
    try {
      await operations.reset(root)
    } catch (error) {
      failures.push({ error, label: `reset preview session ${root}` })
    }
    try {
      await operations.remove(root)
    } catch (error) {
      failures.push({ error, label: `remove runtime root ${root}` })
    }
  }
  if (failures.length > 0) {
    Errors.throwUnexpected(
      `${failures.length} runtime test cleanup operations failed:\n${
        failures.map(failure => `- ${failure.label}: ${Errors.messageOf(failure.error)}`).join('\n')
      }`,
      {
        cause: failures.map(failure => ({
          error: Errors.formatForLog(failure.error),
          label: failure.label,
        })),
      },
    )
  }
}

Describe('Tao runtime app generation', () => {
  Test('runtime cleanup reports every failure and continues to later operations', async () => {
    const calls: string[] = []
    let cleanupError: unknown
    try {
      await cleanupRuntimeRoots(['runtime-first', 'runtime-second'], {
        remove: root => {
          calls.push(`remove:${root}`)
          if (root.endsWith('first')) {
            Errors.throwHostEnvironment('remove failed')
          }
        },
        reset: root => {
          calls.push(`reset:${root}`)
          if (root.endsWith('first')) {
            Errors.throwHostEnvironment('reset failed')
          }
        },
      })
    } catch (error) {
      cleanupError = error
    }

    Expect(calls).toEqual([
      'reset:runtime-first',
      'remove:runtime-first',
      'reset:runtime-second',
      'remove:runtime-second',
    ])
    Expect(Errors.messageOf(cleanupError)).toContain('reset preview session runtime-first: reset failed')
    Expect(Errors.messageOf(cleanupError)).toContain('remove runtime root runtime-first: remove failed')
  })

  Test('prefers apps declared in the requested file over imported base apps during selection', async () => {
    await withTaoFiles('tao-runtime-app-names-', {
      'Main.tao': `
        use Base from ./Base.tao
        app Preview = Base with { Name "Preview" }
      `,
      'Base.tao': `
        folder app Base { view Home }
        view Home() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async paths => {
      Expect(await Runtime.appNames(paths['Main.tao']!)).toEqual(['Preview'])
    })
  })

  Test('generates app paths from the supplied app path', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const appPath = FS.resolvePath('WordFlower.tao', wordFlowerDir)

    const generated = await Runtime.generateApp(appPath, {
      appName: 'WordFlower',
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(appPath)
    Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp(appPath, {
      appName: 'WordFlower',
      runtimePackageRoot,
    })

    Expect(generatedAgain.outputPath).toBe(generated.outputPath)
    Expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  Test('resolves relative app paths from an explicit working directory', async () => {
    const outsideRoot = await createRuntimePackageRoot()
    const runtimePackageRoot = FS.resolvePath('runtime', outsideRoot)

    const generated = await Runtime.generateApp('WordFlower.tao', {
      appName: 'WordFlower',
      cwd: wordFlowerDir,
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(FS.resolvePath('WordFlower.tao', wordFlowerDir))
    Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
  })

  Test('publishes a typed ship manifest only with a release graph and removes it on development compile', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const ship: ShipManifest = {
      buildNumber: '202609021545',
      bundleIdentifier: 'lang.tao.release.variant',
      git: { commit: 'abc1234', dirty: false },
      icon: 'badged',
      ios: { usesNonExemptEncryption: false },
      name: 'Release Variant',
      schemaVersion: 1,
      slug: 'release-variant',
      updates: {
        channel: 'release-variant',
        runtimeFingerprint: 'native-fingerprint-1',
        runtimeVersion: 'native-fingerprint-1',
        url: 'https://updates.devtao.com/v1/release-variant',
      },
      version: '1.2.3',
    }

    await withTaoFiles(
      'tao-runtime-release-manifest-',
      { 'Main.tao': 'app Release { view Main }\nview Main() { render inject ```ts return null ``` }' },
      async paths => {
        const generated = await Runtime.generateApp(paths['Main.tao'], {
          runtimePackageRoot,
          ship,
          validationMode: 'release',
        })
        const shipManifestPath = generatedPreviewPath(runtimePackageRoot, 'ship.json')

        Expect(generated.shipManifest).toEqual(ship)
        Expect(generated.shipManifestPath).toBe(shipManifestPath)
        Expect(await FS.readJson(shipManifestPath)).toEqual(ship)

        const development = await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })

        Expect(development.shipManifest).toBeUndefined()
        Expect(development.shipManifestPath).toBeUndefined()
        Expect(await FS.exists(shipManifestPath)).toBe(false)
      },
    )
  })

  Test('refuses a ship manifest outside an isolated release generation', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const ship: ShipManifest = {
      buildNumber: '202609021545',
      bundleIdentifier: 'lang.tao.release',
      git: { commit: 'abc1234', dirty: false },
      icon: 'default',
      ios: { usesNonExemptEncryption: false },
      name: 'Release',
      schemaVersion: 1,
      slug: 'release',
      version: '1.2.3',
    }

    await withTaoFiles(
      'tao-runtime-release-manifest-guard-',
      { 'Main.tao': 'app Release { view Main }\nview Main() { render inject ```ts return null ``` }' },
      async paths => {
        await Expect(Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot, ship }))
          .rejects.toThrow('only in release validation mode')
        await Expect(Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(1),
          runtimePackageRoot,
          ship,
          validationMode: 'release',
        })).rejects.toThrow('not combined with a Studio preview publication')
      },
    )
  })

  Test('generates a stable preview root with a caller-supplied revision', async () => {
    const runtimePackageRoot = await createExecutableRuntimePackageRoot('preview-bridge-tests')

    await withTaoFiles(
      'tao-runtime-preview-root-',
      {
        'Main.tao': 'app Preview { view Main }\nview Main() { render inject ```ts return null ``` }',
      },
      async paths => {
        for (
          const legacyPath of [
            'current/TaoApp.tsx',
            'revisions/revision-6/TaoApp.tsx',
            'TaoStudioActivePreview.ts',
            'TaoStudioProject.ts',
            'TaoStudioRevision.ts',
          ]
        ) {
          await FS.writeText(generatedPreviewPath(runtimePackageRoot, legacyPath), 'legacy\n')
        }
        const generated = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(7),
          runtimePackageRoot,
        })
        const stableRoot = await FS.readText(generated.outputPath)
        const taoAppPath = generatedPreviewPath(runtimePackageRoot, 'TaoApp.tsx')
        const publicationPath = generatedPreviewPath(runtimePackageRoot, 'TaoStudioPublication.ts')

        Expect(generated.preview).toEqual({
          appName: 'Preview',
          project: previewProject,
          revision: 7,
          sourceVersions: { [`${previewProject}/Main.tao`]: 'text-v7' },
        })
        Expect(generated.previewRevision).toBe(7)
        Expect(generated.studioManifest?.views.map(view => view.name)).toEqual(['Main'])
        Expect(generated.code).toBe(stableRoot)
        Expect(stableRoot).toContain("import TR from '@runtime/TR'")
        Expect(stableRoot).toContain("import TaoApp from './TaoAppRefresh'")
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoAppRefresh.tsx')))
          .toContain("import TaoApp from './TaoApp'")
        Expect(stableRoot).toContain("import TaoStudioManifest from './TaoStudioManifest'")
        Expect(stableRoot).toContain("import TaoStudioPublication from './TaoStudioPublication'")
        // Every platform but web mounts the device host around the same app, manifest, and cell adapter.
        Expect(stableRoot).toContain("require('react-native').Platform?.OS !== 'web'")
        Expect(stableRoot).toContain('<TR.Studio.DeviceHost')
        Expect(stableRoot).toContain('cellRuntime={studioCellRuntime}')
        Expect(stableRoot).toContain('publication={TaoStudioPublication}')
        Expect(stableRoot).toContain("TaoStudioNativeDevice || typeof window === 'undefined'")
        Expect(stableRoot).toContain("params.get('taoStudioParentOrigin')")
        Expect(stableRoot).toContain("params.get('taoStudioPreviewInstanceId')")
        Expect(stableRoot).toContain("params.get('taoStudioSessionId')")
        Expect(stableRoot).toContain("params.get('taoStudioCell') === '1'")
        Expect(stableRoot).toContain("'/api/preview/cell/bootstrap'")
        Expect(stableRoot).toContain("'/sessions/' + encodeURIComponent(TaoStudioPreviewBootstrap.sessionId)")
        Expect(stableRoot).toContain('setBootstrapError(error)')
        Expect(stableRoot).toContain("value?.type === 'preview-runtime-update'")
        Expect(stableRoot).toContain('event.source !== window.parent')
        // A same-identity runtime update must not replace the applied cell object (a new cell
        // object rebuilds the provider overlay without the remount that alone would justify it).
        // `studio-preview-runtime-dedupe.jest-test.tsx` mirrors this exact comparison to prove the
        // behavior against real data/provider primitives it cannot reach by importing this module;
        // an edit here without a matching edit there fails this assertion instead of silently
        // drifting the two apart.
        Expect(stableRoot).toContain(
          'setAppliedRuntime((previous: any) => sameRuntimeIdentity(previous, next) ? previous : next)',
        )
        Expect(stableRoot).toContain('previousIdentity.compileRevision === nextIdentity.compileRevision')
        Expect(stableRoot).toContain('previousIdentity.cellRevision === nextIdentity.cellRevision')
        Expect(stableRoot).toContain('previousIdentity.manifestRevision === nextIdentity.manifestRevision')
        Expect(stableRoot).toContain('TR.Studio.Bootstrap.reconcile(nextCell, TaoStudioPublication, newerRevision => {')
        Expect(stableRoot).toContain('window.location.replace(nextUrl.toString())')
        Expect(stableRoot).toContain('<TR.Studio.Pending />')
        Expect(stableRoot).toContain('<TR.Studio.Failure error={bootstrapError} />')
        Expect(stableRoot).toContain('<TR.Studio.ErrorBoundary resetKey={[')
        Expect(stableRoot).not.toContain('<TR.Studio.ErrorBoundary key={[')
        Expect(stableRoot).toContain('manifest={active.manifest}')
        Expect(stableRoot).toContain(
          'const active = TaoStudioPreviewBootstrap?.cell === true ? appliedRuntime : wholeApp',
        )
        Expect(stableRoot).toContain('TaoStudioPreviewBootstrap?.cell === true && active === undefined')
        Expect(stableRoot).toContain('if (TaoStudioPreviewConfig === undefined)')
        Expect(stableRoot).toContain('return <TaoApp />')
        Expect(stableRoot).toContain('<TR.Studio.PreviewBridge config={config}>')
        Expect(stableRoot).toContain('</TR.Studio.PreviewBridge>')
        Expect(await FS.readText(taoAppPath)).toContain(
          'export default TaoApps["Preview"]',
        )
        const firstPublication = await FS.readText(publicationPath)
        Expect(firstPublication).toContain(JSON.stringify({
          appName: 'Preview',
          compileRevision: 7,
          project: previewProject,
          sourceVersions: { [`${previewProject}/Main.tao`]: 'text-v7' },
        }))

        const stableRootWrite = await FS.modifiedTimeMs(generated.outputPath)
        const stableTaoAppWrite = await FS.modifiedTimeMs(taoAppPath)
        const next = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(8),
          runtimePackageRoot,
        })

        Expect(next.previewRevision).toBe(8)
        Expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(stableRootWrite)
        Expect(await FS.modifiedTimeMs(taoAppPath)).toBe(stableTaoAppWrite)
        Expect(await FS.readText(generated.outputPath)).toBe(stableRoot)
        Expect(await FS.readText(publicationPath)).toContain('"compileRevision":8')
        Expect(await FS.readText(publicationPath)).toContain('text-v8')
        Expect(await FS.exists(generatedPreviewPath(runtimePackageRoot, 'revisions'))).toBe(false)
        Expect(await FS.exists(generatedPreviewPath(runtimePackageRoot, 'current'))).toBe(false)
        Expect(await FS.exists(generatedPreviewPath(runtimePackageRoot, 'TaoStudioActivePreview.ts'))).toBe(false)
        Expect(await FS.exists(generatedPreviewPath(runtimePackageRoot, 'TaoStudioProject.ts'))).toBe(false)
        Expect(await FS.exists(generatedPreviewPath(runtimePackageRoot, 'TaoStudioRevision.ts'))).toBe(false)

        const typecheck = await typecheckGeneratedApp(runtimePackageRoot)
        Assert(typecheck.exitCode === 0, 'generated Studio preview bridge type-checks', {
          stderr: typecheck.stderr,
          stdout: typecheck.stdout,
        })

        const standard = await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        Expect(standard.previewRevision).toBe(undefined)
        Expect(standard.studioManifest).toBeUndefined()
        Expect(await FS.readText(standard.outputPath)).toBe(standard.code)
        Expect(standard.code).not.toContain("import TaoApp from './TaoApp'")
        Expect(await FS.exists(taoAppPath)).toBe(false)
        Expect(await FS.exists(publicationPath)).toBe(false)
      },
    )
  })

  Test('preserves multi-app selection for stable previews', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-multi-app-',
      {
        'Main.tao': `
          app First { view Main }
          app Second { view Main }
          view Main() { render inject \`\`\`ts return null \`\`\` }
        `,
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], {
          appName: 'Second',
          preview: previewOptions(1),
          runtimePackageRoot,
        })

        const taoApp = await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoApp.tsx'))
        Expect(taoApp).toContain('"First": TaoApp_First')
        Expect(taoApp).toContain('"Second": TaoApp_Second')
        Expect(taoApp).toContain('export default TaoApps["Second"]')
      },
    )
  })

  Test('generates the real WordFlower scenario as an isolated focused-view host', async () => {
    const runtimePackageRoot = await createExecutableRuntimePackageRoot('wordflower-studio-host-tests')
    const appPath = FS.resolvePath('WordFlower.tao', wordFlowerDir)

    const generated = await Runtime.generateApp(appPath, {
      appName: 'WordFlower',
      preview: previewOptions(1, { project: wordFlowerDir }),
      runtimePackageRoot,
    })

    const scenario = generated.studioManifest?.scenarios.find(candidate =>
      candidate.group === 'states' && candidate.name === 'novel'
    )
    const taoApp = await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoApp.tsx'))
    const stableRoot = await FS.readText(generated.outputPath)
    Expect(scenario?.subject.kind).toBe('view')
    Expect(taoApp).toContain('const useTaoGeneratedStudioScenario = TR.Studio.Environment.useScenario')
    Expect(taoApp).toContain('useTaoGeneratedStudioScenario()')
    Expect(taoApp).toContain(JSON.stringify(scenario?.subject.subjectId))
    // The focused view mounts under a navigator of its own rather than bare, so `present` inside
    // it — which `WorkspaceRow` does — has somewhere to go.
    Expect(taoApp).toContain('<TR.Studio.SubjectHost arguments={_TaoStudioArgs} definition={_TaoStudioSubject} />')
    Expect(taoApp).toContain('TR.NavKind.Slot()')
    Expect(taoApp).toContain('restoration: { exclusions: [], mode: \'fresh\' as const, variant: "WordFlower" }')
    Expect(stableRoot).toContain('<TR.Studio.Environment.Host cell={TaoStudioCell}>')

    const typecheck = await typecheckGeneratedApp(runtimePackageRoot)
    Assert(typecheck.exitCode === 0, 'generated WordFlower Studio host type-checks', {
      stderr: typecheck.stderr,
      stdout: typecheck.stdout,
    })
  })

  Test('requires monotonic revisions and a stable project/app identity until an explicit reset', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-session-',
      {
        'Main.tao': `
          app First { view Main }
          app Second { view Main }
          view Main() { render inject \`\`\`ts return null \`\`\` }
        `,
      },
      async paths => {
        const first = await Runtime.generateApp(paths['Main.tao'], {
          appName: 'First',
          preview: previewOptions(4, { project: '/workspace/first' }),
          runtimePackageRoot,
        })
        const publishedGraph = await generatedGraph(runtimePackageRoot)

        await Expect(Runtime.generateApp(paths['Main.tao'], {
          appName: 'First',
          preview: previewOptions(4, { project: '/workspace/first' }),
          runtimePackageRoot,
        })).rejects.toThrow('revision increases monotonically')
        await Expect(Runtime.generateApp(paths['Main.tao'], {
          appName: 'First',
          preview: previewOptions(5, { project: '/workspace/other' }),
          runtimePackageRoot,
        })).rejects.toThrow('retains its project and app identity until reset')
        await Expect(Runtime.generateApp(paths['Main.tao'], {
          appName: 'Second',
          preview: previewOptions(5, { project: '/workspace/first' }),
          runtimePackageRoot,
        })).rejects.toThrow('retains its project and app identity until reset')
        Expect(await generatedGraph(runtimePackageRoot)).toEqual(publishedGraph)
        Expect(first.preview).toMatchObject({ appName: 'First', project: '/workspace/first', revision: 4 })

        await Runtime.resetStudioPreviewSession({ runtimePackageRoot })
        const reset = await Runtime.generateApp(paths['Main.tao'], {
          appName: 'Second',
          preview: previewOptions(1, { project: '/workspace/other' }),
          runtimePackageRoot,
        })

        Expect(reset.preview).toMatchObject({ appName: 'Second', project: '/workspace/other', revision: 1 })
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoStudioPublication.ts'))).toContain(
          '"appName":"Second"',
        )
      },
    )
  })

  Test('retains the last successful preview graph and publication when a draft does not compile', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-invalid-draft-',
      {
        'Main.tao': 'app Preview { view Main }\nview Main() { render inject ```ts return null ``` }',
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(2),
          runtimePackageRoot,
        })
        const lastGoodGraph = await generatedGraph(runtimePackageRoot)

        await FS.writeText(paths['Main.tao'], 'app Preview {')
        await Expect(Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(3),
          runtimePackageRoot,
        })).rejects.toThrow()

        Expect(await generatedGraph(runtimePackageRoot)).toEqual(lastGoodGraph)

        await FS.writeText(
          paths['Main.tao'],
          'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>Recovered</RN.Text> ``` }',
        )
        const recovered = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(3),
          runtimePackageRoot,
        })

        Expect(recovered.preview).toMatchObject({ appName: 'Preview', project: previewProject, revision: 3 })
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoStudioPublication.ts'))).toContain(
          '"compileRevision":3',
        )
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'App.injection-1.tsx')))
          .toContain('Recovered')
      },
    )
  })

  Test('removes stale generated module files and empty directories when imports change', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await Runtime.generateApp(runtimeStdlibTestsPath, { runtimePackageRoot })
    const stdlibModulePath = await findGeneratedModule(runtimePackageRoot, 'Views.tao.tsx')
    const stdlibInjectionPath = await findGeneratedModule(runtimePackageRoot, 'Views.tao.injection-1.tsx')
    const stdlibModuleDir = FS.dirname(stdlibModulePath)

    Expect(await FS.exists(stdlibModulePath)).toBe(true)
    Expect(await FS.exists(stdlibInjectionPath)).toBe(true)
    Expect(await FS.exists(stdlibModuleDir)).toBe(true)

    const generated = await Runtime.generateApp(typeSystemTestsPath, { runtimePackageRoot })

    Expect(await FS.exists(stdlibModulePath)).toBe(false)
    Expect(await FS.exists(stdlibInjectionPath)).toBe(false)
    // Type System Tests now imports @tao/nav, so the shared generated stdlib directory remains.
    Expect(await FS.exists(stdlibModuleDir)).toBe(true)
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
  })

  for (const errorCode of ['EPERM', 'EFAULT'] as const) {
    Test(
      `restores the complete ordinary generated graph after an injected ${errorCode} publication failure`,
      async () => {
        const runtimePackageRoot = await createRuntimePackageRoot()

        await withTaoFiles(
          `tao-runtime-ordinary-${errorCode.toLowerCase()}-rollback-`,
          {
            'Main.tao':
              'app Example { view Main }\nview Main() { render inject ```ts return <RN.Text>Before</RN.Text> ``` }',
          },
          async paths => {
            await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
            await FS.writeText(generatedPreviewPath(runtimePackageRoot, 'stale.ts'), 'persistent stale bytes\n')
            const lastGoodGraph = await generatedGraph(runtimePackageRoot)
            await FS.writeText(
              paths['Main.tao'],
              'app Example { view Main }\nview Main() { render inject ```ts return <RN.Text>After</RN.Text> ``` }',
            )
            let injected = false

            await Expect(Runtime.generateApp(paths['Main.tao'], {
              publicationHooks: {
                beforeRemove: async path => {
                  if (!injected && FS.basename(path) === 'stale.ts') {
                    injected = true
                    Errors.throwHostEnvironment(`${errorCode}: injected ordinary publication failure`)
                  }
                },
              },
              runtimePackageRoot,
            })).rejects.toThrow(errorCode)

            Expect(injected).toBe(true)
            Expect(await generatedGraph(runtimePackageRoot)).toEqual(lastGoodGraph)
          },
        )
      },
    )
  }

  Test('rolls a stable preview graph back when publication cleanup fails', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-publication-rollback-',
      {
        'Main.tao':
          'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>Before</RN.Text> ``` }',
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(2),
          runtimePackageRoot,
        })
        const blockedDirectory = generatedPreviewPath(runtimePackageRoot, 'obsolete')
        await FS.writeText(FS.resolvePath('stale.ts', blockedDirectory), 'stale\n')
        const lastGoodGraph = await generatedGraph(runtimePackageRoot)
        await FS.chmod(blockedDirectory, 0o500)
        try {
          await FS.writeText(
            paths['Main.tao'],
            'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>After</RN.Text> ``` }',
          )
          await Expect(Runtime.generateApp(paths['Main.tao'], {
            preview: previewOptions(3),
            runtimePackageRoot,
          })).rejects.toThrow()
          Expect(await generatedGraph(runtimePackageRoot)).toEqual(lastGoodGraph)
        } finally {
          await FS.chmod(blockedDirectory, 0o700)
        }

        const recovered = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(3),
          runtimePackageRoot,
        })
        Expect(recovered.previewRevision).toBe(3)
        Expect(await FS.exists(blockedDirectory)).toBe(false)
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'App.injection-1.tsx'))).toContain('After')
      },
    )
  })

  Test('does not restore the publication marker before a failing graph rollback', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-publication-rollback-order-',
      {
        'Main.tao':
          'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>Before</RN.Text> ``` }',
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(2),
          runtimePackageRoot,
        })
        const injectionPath = generatedPreviewPath(runtimePackageRoot, 'App.injection-1.tsx')
        const blockedRollbackPath = `${injectionPath}.tao-rollback`
        await FS.writeText(FS.resolvePath('stale.ts', blockedRollbackPath), 'stale\n')
        await FS.chmod(blockedRollbackPath, 0o500)
        try {
          await FS.writeText(
            paths['Main.tao'],
            'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>After</RN.Text> ``` }',
          )
          await Expect(Runtime.generateApp(paths['Main.tao'], {
            preview: previewOptions(3),
            runtimePackageRoot,
          })).rejects.toThrow()

          // Cleanup triggers rollback, and the blocked graph rollback then fails. The marker must
          // still describe the new graph; restoring it first would expose revision 2 with "After".
          Expect(await FS.readText(injectionPath)).toContain('After')
          Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoStudioPublication.ts'))).toContain(
            '"compileRevision":3',
          )
        } finally {
          await FS.chmod(blockedRollbackPath, 0o700)
        }

        const recovered = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(3),
          runtimePackageRoot,
        })
        Expect(recovered.previewRevision).toBe(3)
        Expect(await FS.exists(blockedRollbackPath)).toBe(false)
      },
    )
  })

  Test('restores the retired preview root before a failing first-migration rollback', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await withTaoFiles(
      'tao-runtime-preview-migration-rollback-order-',
      {
        'Main.tao':
          'app Preview { view Main }\nview Main() { render inject ```ts return <RN.Text>Stable</RN.Text> ``` }',
      },
      async paths => {
        const retiredRoot = "export { default } from './current/TaoApp'\n"
        const stableRootPath = generatedAppPath(runtimePackageRoot)
        const injectionPath = generatedPreviewPath(runtimePackageRoot, 'App.injection-1.tsx')
        const blockedRollbackPath = `${injectionPath}.tao-rollback`
        await FS.writeText(stableRootPath, retiredRoot)
        await FS.writeText(generatedPreviewPath(runtimePackageRoot, 'current/TaoApp.tsx'), 'export default null\n')
        await FS.writeText(injectionPath, 'export default null\n')
        await FS.writeText(FS.resolvePath('stale.ts', blockedRollbackPath), 'stale\n')
        await FS.chmod(blockedRollbackPath, 0o500)
        try {
          await Expect(Runtime.generateApp(paths['Main.tao'], {
            preview: previewOptions(1),
            runtimePackageRoot,
          })).rejects.toThrow()

          // The graph rollback is deliberately blocked. The retired importer must already be live,
          // so an interrupted migration still points at its untouched revision-addressed graph.
          Expect(await FS.readText(stableRootPath)).toBe(retiredRoot)
          Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'current/TaoApp.tsx')))
            .toBe('export default null\n')
        } finally {
          await FS.chmod(blockedRollbackPath, 0o700)
        }

        const recovered = await Runtime.generateApp(paths['Main.tao'], {
          preview: previewOptions(1),
          runtimePackageRoot,
        })
        Expect(recovered.previewRevision).toBe(1)
        Expect(await FS.readText(stableRootPath)).toContain("import TaoApp from './TaoAppRefresh'")
        Expect(await FS.exists(blockedRollbackPath)).toBe(false)
      },
    )
  })

  Test('serializes overlapping generation into one self-consistent module graph', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    await withTaoFiles(
      'tao-runtime-concurrent-generation-',
      {
        'Large.tao': injectionHeavyApp('Large', 120),
        'Small.tao': injectionHeavyApp('Small', 1),
      },
      async paths => {
        const largeGeneration = Runtime.generateApp(paths['Large.tao'], { runtimePackageRoot })
        const smallGeneration = Runtime.generateApp(paths['Small.tao'], { runtimePackageRoot })
        const [, generatedSmall] = await Promise.all([largeGeneration, smallGeneration])

        Expect(await FS.readText(generatedSmall.outputPath)).toBe(generatedSmall.code)
        const generatedFiles: string[] = []
        const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
        for await (const path of FS.walk(generatedRoot)) {
          generatedFiles.push(FS.relativePath(generatedRoot, path))
        }
        Expect(generatedFiles.toSorted()).toEqual(['App.injection-1.tsx', 'App.tsx'])
      },
    )
  })

  Test('serializes overlapping preview generation and publishes the latest complete graph', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    await withTaoFiles(
      'tao-runtime-concurrent-preview-generation-',
      {
        'Large.tao': injectionHeavyApp('Preview', 120),
        'Small.tao': injectionHeavyApp('Preview', 1),
      },
      async paths => {
        const largeGeneration = Runtime.generateApp(paths['Large.tao'], {
          preview: previewOptions(20),
          runtimePackageRoot,
        })
        const smallGeneration = Runtime.generateApp(paths['Small.tao'], {
          preview: previewOptions(21),
          runtimePackageRoot,
        })
        const [, generatedSmall] = await Promise.all([largeGeneration, smallGeneration])

        Expect(generatedSmall.previewRevision).toBe(21)
        Expect(await FS.readText(generatedSmall.outputPath)).toBe(generatedSmall.code)
        Expect(await FS.readText(generatedPreviewPath(runtimePackageRoot, 'TaoStudioPublication.ts'))).toContain(
          '"compileRevision":21',
        )
        const generatedFiles: string[] = []
        const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
        for await (const path of FS.walk(generatedRoot)) {
          generatedFiles.push(FS.relativePath(generatedRoot, path))
        }
        Expect(generatedFiles.toSorted()).toEqual([
          'App.injection-1.tsx',
          'App.tsx',
          'TaoApp.tsx',
          'TaoAppRefresh.tsx',
          'TaoStudioManifest.ts',
          'TaoStudioPublication.ts',
        ])
      },
    )
  })

  Test('isolates inline injections from generated and Tao module bindings', async () => {
    const runtimePackageRoot = await createExecutableRuntimePackageRoot('injection-boundary-tests')

    await withTaoFiles(
      'tao-runtime-injection-boundary-valid-',
      {
        'Main.tao': `
          let Explicit = "safe"
          app InjectionBoundary { view Main }
          view Main() {
            render inject Explicit \`\`\`ts
              void process.env.NODE_ENV
              return <RN.Text>{TR.Value(Explicit).jsValue}</RN.Text>
            \`\`\`
          }
        `,
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        const boundaryPath = await findGeneratedModule(runtimePackageRoot, 'App.injection-1.tsx')
        const boundary = await FS.readText(boundaryPath)
        Expect(boundary).toContain("import TR from '@runtime/TR'")
        Expect(boundary).toContain("import * as RN from 'react-native'")
        Expect(boundary).toContain('void process.env.NODE_ENV')
        Expect(boundary).not.toContain('_Scope')
        Expect(boundary).not.toContain('_ViewProps')
        Expect(boundary).not.toContain('TaoApps')

        const typecheck = await typecheckGeneratedApp(runtimePackageRoot)
        Assert(typecheck.exitCode === 0, 'explicit injection boundary type-checks', {
          stderr: typecheck.stderr,
          stdout: typecheck.stdout,
        })
      },
    )

    await withTaoFiles(
      'tao-runtime-injection-boundary-private-',
      {
        'Main.tao': `
          let Secret = "hidden"
          app InjectionBoundary { view Main }
          view Main() {
            render inject \`\`\`ts
              return <RN.Text>{String([_Scope, _ViewProps, TaoApps, Secret])}</RN.Text>
            \`\`\`
          }
        `,
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        const typecheck = await typecheckGeneratedApp(runtimePackageRoot)
        Expect(typecheck.exitCode).not.toBe(0)
        const diagnostics = `${typecheck.stdout}\n${typecheck.stderr}`
        for (const name of ['_Scope', '_ViewProps', 'TaoApps', 'Secret']) {
          Expect(diagnostics).toContain(`Cannot find name '${name}'`)
        }
      },
    )
  })

  Test('generates, type-checks, and conforms a sidecar navigation implementation', async () => {
    const runtimePackageRoot = await createExecutableRuntimePackageRoot('sidecar-tests')
    await withTaoFiles(
      'tao-runtime-sidecar-',
      {
        'Main.tao': `
          use SidecarStack from ./Constructs.tao
          app SidecarApp {
            Name "Sidecar App"
            Navigator SidecarStack { Initial Home }
          }
          view Home() { render inject \`\`\`ts return null \`\`\` }
        `,
        'Constructs.tao': `
          public type SidecarStack is nav with {
            Initial view
            nav SidecarStack from ./SidecarStack.ts
          }
        `,
        'SidecarStack.ts': `
          import TR from '@runtime/TR'
          import { RuntimeAssert } from '@runtime/TR-assert'
          import type { SidecarStackConfig } from './Constructs.tao'

          let factoryCalls = 0
          export function SidecarStack(): TR.NavKind<'stack', SidecarStackConfig> {
            factoryCalls++
            RuntimeAssert(factoryCalls === 1, 'the sidecar factory to be evaluated exactly once')
            return TR.NavKind.Stack()
          }
        `,
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        const modulePath = await findGeneratedModule(runtimePackageRoot, 'Constructs.tao.tsx')
        const declarationsPath = await findGeneratedModule(runtimePackageRoot, 'Constructs.tao.d.ts')
        const sidecarPath = await findGeneratedModule(runtimePackageRoot, 'SidecarStack.ts')
        const moduleCode = await FS.readText(modulePath)

        Expect(await FS.exists(declarationsPath)).toBe(true)
        Expect(await FS.exists(sidecarPath)).toBe(true)
        Expect(moduleCode).toContain(
          "import { SidecarStack as __tao_configuration_implementation_SidecarStack__ } from './SidecarStack'",
        )
        Expect(moduleCode).toContain('__tao_configuration_implementation_SidecarStack__')

        const typecheck = await typecheckGeneratedApp(runtimePackageRoot)
        Assert(typecheck.exitCode === 0, 'generated sidecar configuration contract type-checks', {
          stderr: typecheck.stderr,
          stdout: typecheck.stdout,
        })

        const generatedModule = await import(modulePath) as {
          __tao_type_SidecarStack: {
            kind: TR.NavKind<'stack', TR.StackNavConfiguration>
          }
        }
        const sidecarDeclaration = generatedModule.__tao_type_SidecarStack
        Expect(sidecarDeclaration.kind.profile).toBe('stack')
        TR.testNavKind(sidecarDeclaration.kind, 'stack')
      },
    )
  })

  Test('copies the relative import graph for a foreign view while leaving installed packages external', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    await withTaoFiles(
      'tao-runtime-foreign-view-',
      {
        'Main.tao': `
          app ForeignApp { view Main }
          view Main() {
            action Change(Value text) { }
            render CodeEditor("draft", Change)
          }
          view CodeEditor(Content text, Change action(text)) from ./CodeEditor.tsx
        `,
        'CodeEditor.tsx': `
          import React from 'react'
          import { editorTheme } from './editor/theme.js'

          // import './editor/comment-only'
          const documentation = "export { fake } from './editor/string-only'"

          export function CodeEditor(props: { Content: string; Change: { invoke(value: unknown): unknown } }) {
            void React
            void props
            void documentation
            return editorTheme === 'tao' ? null : null
          }
        `,
        'editor/theme.ts': `
          export { editorTheme } from './tokens'
        `,
        'editor/tokens.ts': `
          export const editorTheme = 'tao'
        `,
      },
      async paths => {
        const generated = await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        const codeEditorPath = await findGeneratedModule(runtimePackageRoot, 'CodeEditor.tsx')
        const themePath = await findGeneratedModule(runtimePackageRoot, 'theme.ts')
        const tokensPath = await findGeneratedModule(runtimePackageRoot, 'tokens.ts')

        Expect(await FS.exists(codeEditorPath)).toBe(true)
        Expect(await FS.exists(themePath)).toBe(true)
        Expect(await FS.exists(tokensPath)).toBe(true)
        Expect(generated.code).toContain("from './CodeEditor.files/CodeEditor'")
        Expect(await FS.readText(codeEditorPath)).toContain("from 'react'")
      },
    )
  })
})

async function findGeneratedModule(runtimePackageRoot: string, fileName: string): Promise<string> {
  const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  let foundPath: string | undefined
  for await (const path of FS.walk(generatedRoot)) {
    if (FS.basename(path) === fileName) {
      foundPath = path
      break
    }
  }
  Assert.defined(foundPath, 'generated module exists', { fileName })
  return foundPath
}

async function generatedGraph(runtimePackageRoot: string): Promise<Record<string, string>> {
  const outputRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  const graph: Record<string, string> = {}
  for await (const path of FS.walk(outputRoot)) {
    graph[FS.relativePath(outputRoot, path)] = await FS.isFile(path)
      ? await FS.readText(path)
      : `-> ${FS.relativePath(outputRoot, await FS.realPath(path))}`
  }
  return graph
}

async function typecheckGeneratedApp(
  runtimePackageRoot: string,
): Promise<Awaited<ReturnType<typeof CLI.run>>> {
  const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  const typecheckConfig = FS.resolvePath('tsconfig.json', runtimePackageRoot)
  await FS.writeJson(typecheckConfig, {
    extends: Repo.resolvePath('packages/tsconfig.base.json'),
    compilerOptions: {
      allowImportingTsExtensions: true,
      composite: false,
      declaration: false,
      incremental: false,
      jsx: 'react-jsx',
      lib: ['ES2023', 'DOM'],
      noEmit: true,
      rootDir: '/',
      typeRoots: [Repo.resolvePath('node_modules/@types')],
      types: ['bun', 'node'],
    },
    include: [`${generatedRoot}/**/*.ts`, `${generatedRoot}/**/*.tsx`],
  })
  // TypeScript 7's native compiler (the `typescript-native` alias, as `just _typecheck` uses):
  // the same check takes well under a second where `typescript` 5.9 takes about three.
  return await CLI.run('bun', {
    args: [Repo.resolvePath('node_modules/typescript-native/bin/tsc'), '--project', typecheckConfig],
  })
}

function injectionHeavyApp(appName: string, viewCount: number): string {
  const views = Array.from(
    { length: viewCount },
    (_, index) => `view ${appName}View${index}() { render inject \`\`\`ts return null \`\`\` }`,
  )
  return `app ${appName} { view ${appName}View0 }\n${views.join('\n')}`
}
