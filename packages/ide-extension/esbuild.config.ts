import { FS, Platform } from '@shared'
import { context } from 'esbuild'
import { writeMergedTaoTextMateGrammar } from './ide-extension-src/syntax/textmate-grammar'

const watch = Platform.runtimeProcess.argv.includes('--watch')
const minify = Platform.runtimeProcess.argv.includes('--minify')
const generatedTaoTextMateGrammar = FS.resolvePath('ide-extension-syntaxes/_gen_syntaxes/tao-lang.tmLanguage.json', {
  cwd: import.meta.dir,
})
const taoTextMateGrammarOverlay = FS.resolvePath('ide-extension-syntaxes/tao-lang.tmLanguage.overlay.json', {
  cwd: import.meta.dir,
})
const dprintTypescriptWasm = FS.resolvePath('../formatter/node_modules/@dprint/typescript/plugin.wasm', {
  cwd: import.meta.dir,
})
const bundledDprintTypescriptWasm = FS.resolvePath('_gen_ide-extension/language/plugin.wasm', {
  cwd: import.meta.dir,
})
const bundledExtensionDprintTypescriptWasm = FS.resolvePath('_gen_ide-extension/extension/plugin.wasm', {
  cwd: import.meta.dir,
})

const ctx = await context({
  entryPoints: [
    FS.joinPath('ide-extension-src/extension/main.ts'),
    FS.joinPath('ide-extension-src/language/main.ts'),
  ],
  outdir: '_gen_ide-extension',
  bundle: true,
  target: 'ES2022',
  format: 'cjs',
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
      build.onEnd(async result => {
        if (result.errors.length === 0) {
          await writeMergedTaoTextMateGrammar(generatedTaoTextMateGrammar, taoTextMateGrammarOverlay)
          await FS.copyFile(dprintTypescriptWasm, bundledDprintTypescriptWasm)
          await FS.copyFile(dprintTypescriptWasm, bundledExtensionDprintTypescriptWasm)
        }
      })
    },
  }],
  platform: 'node',
  sourcemap: !minify,
  minify,
})

if (watch) {
  await ctx.watch()
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
