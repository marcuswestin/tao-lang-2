/** Opt-in, credential-local Firestore rules probe for the authored Firebase Notes app. */
if (import.meta.main) {
  // Repository tooling runs in its own TypeScript context, outside the app implementation program.
  const implementation =
    new URL('../../../packages/cli/tao-cli/cli-src/firebase-hostile-probe.ts', import.meta.url).href
  const code = `const { main } = await import(${JSON.stringify(implementation)}); process.exitCode = await main(${
    JSON.stringify(import.meta.url)
  }, ${JSON.stringify(Bun.argv.slice(2))});`
  const child = Bun.spawn([process.execPath, '--eval', code], {
    cwd: Bun.fileURLToPath(new URL('../../../', import.meta.url)),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exitCode = await child.exited
}
