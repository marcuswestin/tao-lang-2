import {
  generateMaintainedNativeBindings,
  inspectMaintainedNativeBindings,
  stageNativeBindingResources,
} from '@native-bindings'
import { Errors, FS, HCI, Platform, ProcessTree, ReleaseCapabilities, type ReleasePhase } from '@shared'
import { context, stop } from 'esbuild'
import {
  BUILD_RECORD_NAME,
  buildInputIdentity,
  checkBuildFreshness,
  hashFile,
  hashOutputs,
  makeBuildRecord,
} from './ide-extension-src/build-record/build-identity'
import { stageProjectToolingResources } from './ide-extension-src/resources/project-tooling-resources'
import { writeMergedTaoTextMateGrammar } from './ide-extension-src/syntax/textmate-grammar'

type IdeExtensionPublicationOptions =
  & Pick<
    FS.SynchronizeDirectoryFileSetsOptions,
    'beforeMove' | 'beforeRemove'
  >
  & {
    boundaryPath?: string
  }

type BuildIdeExtensionOptions = {
  minify?: boolean
  releasePhase?: ReleasePhase
  releaseVersion?: string
  packageRoot?: string
  watch?: boolean
}

/** publishIdeExtensionOutputs commits the bundle and syntax roots as one persistent-tree transaction. */
export async function publishIdeExtensionOutputs(
  stagingPackageRoot: string,
  packageRoot: string,
  options: IdeExtensionPublicationOptions = {},
): Promise<void> {
  const generatedRoot = FS.resolvePath('_gen_ide-extension', packageRoot)
  await FS.synchronizeDirectoryFileSets([
    {
      fromPath: FS.resolvePath('_gen_ide-extension', stagingPackageRoot),
      toPath: generatedRoot,
    },
    {
      fromPath: FS.resolvePath('ide-extension-syntaxes/_gen_syntaxes', stagingPackageRoot),
      toPath: FS.resolvePath('ide-extension-syntaxes/_gen_syntaxes', packageRoot),
    },
  ], {
    ...options,
    boundaryPath: options.boundaryPath ?? FS.resolvePath('../../..', packageRoot),
    lockPath: generatedRoot,
    sourceBoundaryPath: stagingPackageRoot,
  })
}

export async function buildIdeExtension(options: BuildIdeExtensionOptions = {}): Promise<void> {
  const releaseArg = Platform.runtimeProcess.argv.indexOf('--release')
  const phaseArg = Platform.runtimeProcess.argv.indexOf('--phase')
  const releaseVersion = options.releaseVersion
    ?? (releaseArg < 0 ? undefined : Platform.runtimeProcess.argv[releaseArg + 1])
  const phase = options.releasePhase
    ?? (phaseArg < 0 ? 'development' : Number(Platform.runtimeProcess.argv[phaseArg + 1]) as ReleasePhase)
  const profile = ReleaseCapabilities.profile(phase)
  if (releaseVersion !== undefined && phase === 'development') {
    Errors.throwUserInput('A public editor release requires a release phase.')
  }
  if (phase !== 'development' && releaseVersion === undefined) {
    Errors.throwUserInput('A public editor profile requires --release <version>.')
  }
  const packageRoot = options.packageRoot ?? import.meta.dir
  const repositoryRoot = FS.resolvePath('../../..', packageRoot)
  const watch = options.watch ?? Platform.runtimeProcess.argv.includes('--watch')
  const minify = options.minify ?? Platform.runtimeProcess.argv.includes('--minify')
  const stagingPackageRoot = await FS.mkTmpDir('tao-ide-extension-build-')
  const stagingGeneratedRoot = FS.resolvePath('_gen_ide-extension', stagingPackageRoot)
  const generatedTaoTextMateGrammar = FS.resolvePath(
    'ide-extension-syntaxes/_gen_syntaxes/tao.tmLanguage.json',
    packageRoot,
  )
  const stagingTaoTextMateGrammar = FS.resolvePath(
    'ide-extension-syntaxes/_gen_syntaxes/tao.tmLanguage.json',
    stagingPackageRoot,
  )
  const taoTextMateGrammarOverlay = FS.resolvePath(
    'ide-extension-syntaxes/tao.tmLanguage.overlay.json',
    packageRoot,
  )
  const formatterPackageRoot = FS.resolvePath('..', Bun.resolveSync('tao-formatter/package.json', packageRoot))
  const dprintTypescriptWasm = Bun.resolveSync('@dprint/typescript/plugin.wasm', formatterPackageRoot)
  const stdlibSourceRoot = FS.resolvePath('../../apps/stdlib/@tao', packageRoot)
  const stagingBundledStdlibRoot = FS.resolvePath('_gen_ide-extension/stdlib/@tao', stagingPackageRoot)
  const runtimeRoot = FS.resolvePath('../../apps/runtime', packageRoot)
  const typescriptPackageRoot = FS.dirname(Bun.resolveSync('typescript/package.json', packageRoot))
  const outputRoots = ['_gen_ide-extension', 'ide-extension-syntaxes/_gen_syntaxes']
  const recordPath = FS.resolvePath(`_gen_ide-extension/${BUILD_RECORD_NAME}`, packageRoot)
  const inputs = await buildInputIdentity(repositoryRoot, {
    minify,
    releaseVersion: releaseVersion ?? 'development',
    phase: profile.phase,
  })
  if (!watch) {
    const freshness = await checkBuildFreshness({
      packageRoot,
      recordPath,
      outputRoots,
      grammarPath: generatedTaoTextMateGrammar,
      inputs,
    })
    if (freshness.status === 'fresh') {
      HCI.logProcessInfo('editor', 'The built extension matches its inputs; nothing to rebuild.')
      await FS.remove(stagingPackageRoot)
      return
    }
    if (freshness.status === 'grammar-unmerged') {
      HCI.logProcessInfo('editor', 'The built extension matches its inputs; merging the regenerated grammar.')
      await writeMergedTaoTextMateGrammar(generatedTaoTextMateGrammar, taoTextMateGrammarOverlay)
      await FS.remove(stagingPackageRoot)
      return
    }
    HCI.logProcessInfo('editor', `Building the extension: ${freshness.reason}.`)
  }

  const ctx = await context({
    absWorkingDir: packageRoot,
    entryPoints: [
      FS.resolvePath('ide-extension-src/extension/main.ts', packageRoot),
      FS.resolvePath('ide-extension-src/language/main.ts', packageRoot),
    ],
    outdir: stagingGeneratedRoot,
    bundle: true,
    target: 'ES2022',
    format: 'cjs',
    define: {
      'import.meta.dir': '__dirname',
      'import.meta.dirname': '__dirname',
      TAO_RELEASE_PHASE: JSON.stringify(profile.phase),
      TAO_RELEASE_VERSION: JSON.stringify(releaseVersion ?? 'development'),
    },
    outExtension: {
      '.js': '.cjs',
    },
    loader: {
      '.ts': 'ts',
    },
    external: ['vscode'],
    plugins: [{
      name: 'bundle-ide-extension-assets',
      setup(build) {
        build.onStart(async () => {
          HCI.logProcessInfo('editor', 'Generating maintained native bindings...')
          if ((await inspectMaintainedNativeBindings({})).status !== 'fresh') {
            await generateMaintainedNativeBindings({ mode: 'write' })
          }
          await FS.remove(stagingGeneratedRoot)
        })
        build.onEnd(async result => {
          if (result.errors.length > 0) {
            return
          }
          await FS.writeJson(FS.resolvePath('release-profile.json', stagingGeneratedRoot), {
            version: releaseVersion ?? 'development',
            ...profile,
            fingerprint: ReleaseCapabilities.fingerprint(profile),
          })
          await FS.copyFile(generatedTaoTextMateGrammar, stagingTaoTextMateGrammar)
          await writeMergedTaoTextMateGrammar(stagingTaoTextMateGrammar, taoTextMateGrammarOverlay)
          await FS.copyFile(
            dprintTypescriptWasm,
            FS.resolvePath('_gen_ide-extension/language/plugin.wasm', stagingPackageRoot),
          )
          await FS.copyFile(
            dprintTypescriptWasm,
            FS.resolvePath('_gen_ide-extension/extension/plugin.wasm', stagingPackageRoot),
          )
          await FS.synchronizeDirectoryFileSets([
            { fromPath: stdlibSourceRoot, toPath: stagingBundledStdlibRoot },
          ], {
            boundaryPath: stagingPackageRoot,
            lockPath: stagingBundledStdlibRoot,
            sourceBoundaryPath: repositoryRoot,
          })
          await stageProjectToolingResources({
            runtimeRoot,
            moduleRoots: [
              FS.resolvePath('node_modules', runtimeRoot),
              FS.resolvePath('../../apps/expo-host/node_modules', packageRoot),
              FS.resolvePath('node_modules', repositoryRoot),
            ],
            typescriptLibRoot: FS.resolvePath('lib', typescriptPackageRoot),
            outputRoot: stagingGeneratedRoot,
          })
          HCI.logProcessInfo('editor', 'Staging native binding implementations and pinned compiler inputs...')
          await stageNativeBindingResources({ outputRoot: stagingGeneratedRoot })
          await FS.copyFile(
            FS.resolvePath('../Package.tao', stdlibSourceRoot),
            FS.resolvePath('stdlib/Package.tao', stagingGeneratedRoot),
          )
          await FS.copyFile(
            FS.resolvePath('../.tao/store/project.json', stdlibSourceRoot),
            FS.resolvePath('stdlib/.tao/store/project.json', stagingGeneratedRoot),
          )
          const baseGrammar = await hashFile(generatedTaoTextMateGrammar)
          await FS.writeJson(
            FS.resolvePath(BUILD_RECORD_NAME, stagingGeneratedRoot),
            makeBuildRecord(inputs, await hashOutputs(stagingPackageRoot, outputRoots), baseGrammar),
          )
          await publishIdeExtensionOutputs(stagingPackageRoot, packageRoot, { boundaryPath: repositoryRoot })
        })
      },
    }],
    platform: 'node',
    sourcemap: !minify,
    minify,
  })

  if (watch) {
    await ctx.watch()
    return
  }
  try {
    await ctx.rebuild()
  } finally {
    await ctx.dispose()
    await FS.remove(stagingPackageRoot)
  }
}

if (import.meta.main) {
  let buildFailed = false
  try {
    await buildIdeExtension()
  } catch (error) {
    buildFailed = true
    throw error
  } finally {
    if (!Platform.runtimeProcess.argv.includes('--watch')) {
      try {
        let owned: ReturnType<typeof ProcessTree.descendants>
        try {
          owned = ProcessTree.descendants(Platform.runtimeProcess.pid)
        } finally {
          await stop()
        }
        await ProcessTree.waitForTrackedExit(owned)
      } catch (error) {
        if (!buildFailed) {
          throw error
        }
        HCI.logProcessError('editor', `Build cleanup could not be verified: ${Errors.messageOf(error)}`)
      }
    }
  }
}
