import { FS, Platform } from '@shared'
import { context } from 'esbuild'
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
  const packageRoot = options.packageRoot ?? import.meta.dir
  const repositoryRoot = FS.resolvePath('../../..', packageRoot)
  const watch = options.watch ?? Platform.runtimeProcess.argv.includes('--watch')
  const minify = options.minify ?? Platform.runtimeProcess.argv.includes('--minify')
  const stagingPackageRoot = await FS.mkTmpDir('tao-ide-extension-build-')
  const stagingGeneratedRoot = FS.resolvePath('_gen_ide-extension', stagingPackageRoot)
  const generatedTaoTextMateGrammar = FS.resolvePath(
    'ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
    packageRoot,
  )
  const stagingTaoTextMateGrammar = FS.resolvePath(
    'ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json',
    stagingPackageRoot,
  )
  const taoTextMateGrammarOverlay = FS.resolvePath(
    'ide-extension-syntaxes/tao-lang.tmLanguage.overlay.json',
    packageRoot,
  )
  const formatterPackageRoot = FS.resolvePath('..', Bun.resolveSync('tao-formatter/package.json', packageRoot))
  const dprintTypescriptWasm = Bun.resolveSync('@dprint/typescript/plugin.wasm', formatterPackageRoot)
  const stdlibSourceRoot = FS.resolvePath('../../apps/stdlib/@tao', packageRoot)
  const stagingBundledStdlibRoot = FS.resolvePath('_gen_ide-extension/@tao', stagingPackageRoot)

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
      'import.meta.dirname': '__dirname',
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
          await FS.remove(stagingGeneratedRoot)
        })
        build.onEnd(async result => {
          if (result.errors.length > 0) {
            return
          }
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
  await buildIdeExtension()
}
