import { context } from 'esbuild'

const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--minify')

const ctx = await context({
  entryPoints: [
    'ide-extension-src/extension/main.ts',
    'ide-extension-src/language/main.ts',
  ],
  outdir: '_gen-ide-extension',
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
